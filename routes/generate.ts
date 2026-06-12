import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import slugify from 'slugify';
import { generateResumeJSON, generateCoverLetterJSON, generateCombinedJSON, CoverLetterJSON, analyzeATSKeywordsAgainstResume, extractATSKeywordsFromJDViaAI } from '../services/ai';
import { ResumeData } from '../services/types';
import { log, logError } from '../services/logger';
import { buildLatex, buildCoverLetterLatex } from '../services/latex';
import { compilePDF } from '../services/compiler';
import { findProjectRoot } from '../services/paths';

const router = Router();
const projectRoot = findProjectRoot(__dirname);
const jobsDir = path.join(projectRoot, 'jobs');

router.use((req, _res, next) => {
  log(`${req.method} /generate${req.path}`);
  next();
});

type GenerateRequestBody = {
  jobDescription?: string;
  companyName?: string;
  roleName?: string;
  extraNotes?: string;
  generateWithoutJD?: boolean;
  coverOutput?: 'pdf' | 'txt' | 'none';
  lowTokenMode?: boolean;
  modelSelect?: string;
  useStarMethodForGovtRoles?: boolean;
  resumeType?: 'software' | 'qa';
  useCombinedGeneration?: boolean;
};

let lastGeneratedResumeJSON: any = null;
let lastGeneratedTexPath: string | null = null;
let lastGeneratedCoverLetterJSON: CoverLetterJSON | null = null;

type TaskStatus = 'pending' | 'complete' | 'error';
type TaskResult = {
  status: TaskStatus;
  result?: any;
  error?: string;
};

const taskMap = new Map<string, TaskResult & { startedAt: number }>();

function createTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function findLatestTexFile(): string | null {
  if (!fs.existsSync(jobsDir)) return null;
  const files = fs.readdirSync(jobsDir).filter(f => f.endsWith('.tex'));
  if (!files.length) return null;
  const filePaths = files.map(f => path.join(jobsDir, f));
  filePaths.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return filePaths[0];
}

async function compileTexFile(texPath: string): Promise<Buffer> {
  const latexSource = fs.readFileSync(texPath, 'utf8');
  return await compilePDF(latexSource);
}

function resolveJobDir(input: string): string {
  return path.isAbsolute(input) ? input : path.join(jobsDir, input);
}

function loadStructuredJSON(dirPath: string): any | null {
  const structuredPath = path.join(dirPath, 'structured-output.json');
  if (fs.existsSync(structuredPath)) {
    try {
      return JSON.parse(fs.readFileSync(structuredPath, 'utf8'));
    } catch (e) {
      logError('Failed to parse structured-output.json:', e);
    }
  }
  return null;
}

function saveJobFile(dirPath: string, filename: string, content: string | Buffer): void {
  const filePath = path.join(dirPath, filename);
  if (Buffer.isBuffer(content)) {
    fs.writeFileSync(filePath, content);
  } else {
    fs.writeFileSync(filePath, content, 'utf8');
  }
}

function resolveTargetDir(params: {
  folderPath?: string;
  taskId?: string;
  lastTexPath?: string | null;
}): string | null {
  const { folderPath, taskId, lastTexPath } = params;

  if (folderPath?.trim()) {
    const resolved = resolveJobDir(folderPath);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      return resolved;
    }
    return null;
  }

  if (taskId) {
    const task = taskMap.get(taskId);
    if (task?.status === 'complete' && task.result?.jobDir) {
      const targetDir = path.join(jobsDir, task.result.jobDir);
      if (fs.existsSync(targetDir)) {
        return targetDir;
      }
    }
    return null;
  }

  if (lastTexPath) {
    return path.dirname(lastTexPath);
  }

  return null;
}

function formatCoverLetterText(cl: CoverLetterJSON): string {
  return [
    cl.dateLine,
    cl.recipientLine,
    cl.subjectLine,
    '',
    cl.greeting,
    '',
    cl.openingParagraph,
    '',
    cl.bodyParagraph,
    '',
    cl.closingParagraph,
    '',
    cl.signoff,
  ].filter(Boolean).join('\n');
}

router.get('/task/:taskId', (req, res) => {
  const { taskId } = req.params;
  const task = taskMap.get(taskId);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  res.json({
    status: task.status,
    result: task.result,
    error: task.error,
    startedAt: task.startedAt,
  });
});

router.post('/', async (req, res) => {
  const body = req.body as GenerateRequestBody;
  const { jobDescription, companyName, roleName, extraNotes, generateWithoutJD, coverOutput, lowTokenMode, useCombinedGeneration } = body;

  const validationError = validateGenerateRequest(body);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  try {
    const jobDir = createJobDir(companyName, roleName);
    const options = buildGenerationOptions(body, jobDir.jobDir);

    saveJobFile(jobDir.jobDir, 'job-description.txt', jobDescription ?? '');
    const taskId = createTaskId();
    taskMap.set(taskId, { status: 'pending', startedAt: Date.now() });
    res.json({ taskId, jobDir: jobDir.slug });

    (async () => {
      try {
        const result = await executeGeneration(jobDir, options, { jobDescription, companyName, roleName, extraNotes, coverOutput, useCombinedGeneration });
        taskMap.set(taskId, { status: 'complete', result, startedAt: Date.now() });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Internal server error';
        logError('Background generation error:', err);
        taskMap.set(taskId, { status: 'error', error: message, startedAt: Date.now() });
      }
    })();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    logError('Generation error:', err);
    res.status(500).json({ error: message });
  }
});

router.post('/coverLetter', async (req, res) => {
  const { companyName, roleName, jobDescription, extraNotes, coverOutput, modelSelect, useStarMethodForGovtRoles, folderPath } = req.body as GenerateRequestBody & { folderPath?: string };
  if (!companyName || !roleName) {
    res.status(400).json({ error: 'companyName and roleName are required.' });
    return;
  }

  let resumeJSON = lastGeneratedResumeJSON;

  if (!resumeJSON && folderPath?.trim()) {
    const resolved = resolveJobDir(folderPath);
    resumeJSON = loadStructuredJSON(resolved);
    if (resumeJSON) log('Loaded resume JSON from folder:', resolved);
  }

  if (!resumeJSON) {
    res.status(400).json({ error: 'No resume JSON available. Generate a resume first, or provide a folderPath with structured-output.json.' });
    return;
  }

  try {
    const coverLetterJSON = await generateCoverLetterJSON(
      resumeJSON,
      jobDescription ?? '',
      extraNotes ?? '',
      companyName,
      roleName,
      { modelSelect, useStarMethodForGovtRoles }
    );
    lastGeneratedCoverLetterJSON = coverLetterJSON;

    const jobDir = resolveCoverLetterJobDir(companyName, roleName);
    saveJobFile(jobDir, 'cover-letter.json', JSON.stringify(coverLetterJSON, null, 2));

    const latexSource = buildCoverLetterLatex(coverLetterJSON);
    saveJobFile(jobDir, 'cover-letter.tex', latexSource);

    if (coverOutput === 'txt') {
      const txtContent = formatCoverLetterText(coverLetterJSON);
      saveJobFile(jobDir, 'cover-letter.txt', txtContent);
      res.json({ txtUrl: `/jobs/${path.basename(jobDir)}/cover-letter.txt` });
    } else {
      const pdfBuffer = await compilePDF(latexSource);
      saveJobFile(jobDir, 'cover-letter.pdf', pdfBuffer);
      res.json({ pdfUrl: `/jobs/${path.basename(jobDir)}/cover-letter.pdf` });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    logError('Cover letter error:', err);
    res.status(500).json({ error: message });
  }
});

router.post('/compileLastTex', async (req, res) => {
  try {
    const texPath = lastGeneratedTexPath ?? findLatestTexFile();
    if (!texPath) {
      res.status(400).json({ error: 'No .tex file found. Generate a resume first.' });
      return;
    }
    if (!fs.existsSync(texPath)) {
      res.status(400).json({ error: `File not found: ${texPath}` });
      return;
    }
    const pdfBuffer = await compileTexFile(texPath);
    const pdfPath = texPath.replace(/\.tex$/i, '.pdf');
    fs.writeFileSync(pdfPath, pdfBuffer);
    const pdfUrl = `/jobs/${path.basename(path.dirname(texPath))}/${path.basename(pdfPath)}`;
    res.json({ pdfUrl });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    logError('Compile last tex error:', err);
    res.status(500).json({ error: message });
  }
});

router.post('/compileFolderTex', async (req, res) => {
  try {
    const { folderPath } = req.body as { folderPath?: string };
    const targetDir = resolveCompileTargetDir(folderPath);

    if (targetDir === 'single-file') {
      const pdfBuffer = await compileTexFile(folderPath!);
      const pdfPath = folderPath!.replace(/\.tex$/i, '.pdf');
      fs.writeFileSync(pdfPath, pdfBuffer);
      res.json({ count: 1 });
      return;
    }

    if (!targetDir) {
      res.status(400).json({ error: 'Directory does not exist.' });
      return;
    }

    const count = compileAllTexInDir(targetDir);
    res.json({ count });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    logError('Compile folder error:', err);
    res.status(500).json({ error: message });
  }
});

router.post('/latexFromStructured', async (req, res) => {
  try {
    const { structuredJSON, structuredPath } = req.body as { structuredJSON?: any; structuredPath?: string };
    const parseResult = parseStructuredInput(structuredJSON, structuredPath);

    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error });
      return;
    }

    const targetJSON = parseResult.json!;
    const isCoverLetter = parseResult.isCoverLetter;
    const sourceDir = parseResult.sourceDir;

    const result = buildLatexFromStructured(targetJSON, isCoverLetter, sourceDir);
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    logError('Latex from structured error:', err);
    res.status(500).json({ error: message });
  }
});

router.post('/markApplied', async (req, res) => {
  try {
    const { folderPath, taskId } = req.body as { folderPath?: string; taskId?: string };
    log(`markApplied called: folderPath="${folderPath}", taskId="${taskId}"`);

    const targetDir = resolveTargetDir({ folderPath, taskId, lastTexPath: lastGeneratedTexPath });

    if (!targetDir) {
      res.status(400).json({ error: 'No folder path provided and no recently generated resume found' });
      return;
    }

    const folderName = path.basename(targetDir);
    if (folderName.startsWith('(applied) ')) {
      res.status(400).json({ error: 'Folder is already marked as applied' });
      return;
    }

    const newDir = renameJobDir(targetDir, '(applied) ');
    if (!newDir) {
      res.status(500).json({ error: 'Failed to rename directory' });
      return;
    }

    log(`Marked folder as applied: ${folderName} -> ${path.basename(newDir)}`);
    res.json({ success: true, oldPath: targetDir, newPath: newDir });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    logError('Mark applied error:', err);
    res.status(500).json({ error: message });
  }
});

router.post('/runATSAnalysis', async (req, res) => {
  try {
    const { jobDescription, resumeJSON, atsKeywordsFromAI, folderPath } = req.body as {
      jobDescription?: string;
      resumeJSON?: ResumeData;
      atsKeywordsFromAI?: string[];
      folderPath?: string;
    };

    const result = await executeATSAnalysis({
      folderPath,
      resumeJSON,
      jobDescription,
      atsKeywordsFromAI,
      lastGeneratedResumeJSON,
    });

    if (result.error) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json(result.analysis);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    logError('ATS analysis error:', err);
    res.status(500).json({ error: message });
  }
});

function validateGenerateRequest(body: GenerateRequestBody): string | null {
  const { companyName, roleName, jobDescription, generateWithoutJD } = body;
  if (!companyName || !roleName) {
    return 'companyName and roleName are required.';
  }
  if (!generateWithoutJD && !jobDescription?.trim()) {
    return 'jobDescription is required unless generateWithoutJD is true.';
  }
  return null;
}

function createJobDir(companyName: string, roleName: string): { jobDir: string; slug: string } {
  const date = new Date().toISOString().slice(0, 10);
  const slug = slugify(`${companyName}-${roleName}-${date}`, { lower: true, strict: true });
  const jobDir = path.join(jobsDir, slug);
  fs.mkdirSync(jobDir, { recursive: true });
  return { jobDir, slug };
}

function buildGenerationOptions(body: GenerateRequestBody, jobDirPath: string) {
  return {
    lowTokenMode: Boolean(body.lowTokenMode),
    modelSelect: body.modelSelect,
    promptLogDir: jobDirPath,
    useStarMethodForGovtRoles: Boolean(body.useStarMethodForGovtRoles),
    resumeType: body.resumeType as 'software' | 'qa' | undefined,
  };
}

async function executeGeneration(
  jobDir: { jobDir: string; slug: string },
  options: ReturnType<typeof buildGenerationOptions>,
  input: { jobDescription?: string; companyName?: string; roleName?: string; extraNotes?: string; coverOutput?: string; useCombinedGeneration?: boolean }
): Promise<Record<string, unknown>> {
  const { jobDescription, companyName, roleName, extraNotes, coverOutput, useCombinedGeneration } = input;

  let resumeJSON: ResumeData;
  let coverLetterJSON: CoverLetterJSON | undefined;
  let atsKeywords: string[] = [];

  const context = { companyName: companyName ?? '', roleName: roleName ?? '', generateWithoutJD: false, promptLogDir: jobDir.jobDir };

  if (useCombinedGeneration !== false && coverOutput && coverOutput !== 'none') {
    const combined = await generateCombinedJSON(jobDescription ?? '', extraNotes ?? '', companyName ?? '', roleName ?? '', false, options);
    resumeJSON = combined.resume;
    coverLetterJSON = combined.coverLetter;
    atsKeywords = combined.atsKeywords ?? [];
  } else {
    resumeJSON = await generateResumeJSON(jobDescription ?? '', extraNotes ?? '', context, options);
  }

  lastGeneratedResumeJSON = resumeJSON;
  log('Resume JSON received');

  const latexSource = buildLatex(resumeJSON, options.resumeType);
  const pdfBuffer = await compilePDF(latexSource);

  saveJobFile(jobDir.jobDir, 'resume.tex', latexSource);
  saveJobFile(jobDir.jobDir, 'resume.pdf', pdfBuffer);
  lastGeneratedTexPath = path.join(jobDir.jobDir, 'resume.tex');

  saveJobFile(jobDir.jobDir, 'structured-output.json', JSON.stringify(resumeJSON, null, 2));

  const result: Record<string, unknown> = {
    pdfUrl: `/jobs/${jobDir.slug}/resume.pdf`,
    jobDir: jobDir.slug,
  };

  if (coverLetterJSON) {
    lastGeneratedCoverLetterJSON = coverLetterJSON;
    saveJobFile(jobDir.jobDir, 'cover-letter.json', JSON.stringify(coverLetterJSON, null, 2));

    const coverLatex = buildCoverLetterLatex(coverLetterJSON);
    saveJobFile(jobDir.jobDir, 'cover-letter.tex', coverLatex);

    if (coverOutput === 'txt') {
      const txtContent = formatCoverLetterText(coverLetterJSON);
      saveJobFile(jobDir.jobDir, 'cover-letter.txt', txtContent);
      result.coverTxtUrl = `/jobs/${jobDir.slug}/cover-letter.txt`;
    } else if (coverOutput === 'pdf') {
      const coverPdfBuffer = await compilePDF(coverLatex);
      saveJobFile(jobDir.jobDir, 'cover-letter.pdf', coverPdfBuffer);
      result.coverPdfUrl = `/jobs/${jobDir.slug}/cover-letter.pdf`;
    }
  }

  if (atsKeywords.length > 0) {
    const atsResult = analyzeATSKeywordsAgainstResume(atsKeywords, resumeJSON);
    result.atsCoverage = atsResult.coveragePercent;
    result.atsKeywords = atsKeywords;
    saveJobFile(jobDir.jobDir, 'ats-analysis.json', JSON.stringify(atsResult, null, 2));
    log(`ATS analysis: ${atsResult.coveragePercent}% coverage, ${atsKeywords.length} keywords`);
  }

  return result;
}

function resolveCoverLetterJobDir(companyName: string, roleName: string): string {
  if (lastGeneratedTexPath) {
    return path.dirname(lastGeneratedTexPath);
  }
  const date = new Date().toISOString().slice(0, 10);
  const slug = slugify(`cover-letter-${companyName}-${roleName}-${date}`, { lower: true, strict: true });
  const jobDir = path.join(jobsDir, slug);
  fs.mkdirSync(jobDir, { recursive: true });
  return jobDir;
}

function resolveCompileTargetDir(folderPath?: string): string | null | 'single-file' {
  if (folderPath && fs.existsSync(folderPath)) {
    if (fs.statSync(folderPath).isDirectory()) {
      return folderPath;
    }
    if (folderPath.toLowerCase().endsWith('.tex')) {
      return 'single-file';
    }
  }
  if (fs.existsSync(jobsDir)) {
    return jobsDir;
  }
  return null;
}

function compileAllTexInDir(targetDir: string): number {
  let count = 0;
  const texFiles = fs.readdirSync(targetDir).filter(f => f.toLowerCase().endsWith('.tex'));
  for (const texFile of texFiles) {
    const texPath = path.join(targetDir, texFile);
    try {
      const pdfBuffer = compileTexFileSync(texPath);
      const pdfPath = texPath.replace(/\.tex$/i, '.pdf');
      fs.writeFileSync(pdfPath, pdfBuffer);
      count++;
    } catch (e) {
      logError(`Failed to compile ${texPath}:`, e);
    }
  }
  return count;
}

function compileTexFileSync(texPath: string): Buffer {
  const latexSource = fs.readFileSync(texPath, 'utf8');
  return require('child_process').execSync(
    `cd "${path.dirname(texPath)}" && pdflatex -interaction=nonstopmode "${texPath}"`,
    { maxBuffer: 50 * 1024 * 1024 }
  );
}

interface ParseStructuredInputResult {
  success: boolean;
  json?: any;
  isCoverLetter?: boolean;
  sourceDir?: string | null;
  error?: string;
}

function parseStructuredInput(structuredJSON?: any, structuredPath?: string): ParseStructuredInputResult {
  let targetJSON = structuredJSON;
  let isCoverLetter = false;

  if (structuredPath && fs.existsSync(structuredPath)) {
    const stat = fs.statSync(structuredPath);
    let jsonPath = structuredPath;

    if (stat.isDirectory()) {
      const resumeCandidate = path.join(structuredPath, 'structured-output.json');
      const coverLetterCandidate = path.join(structuredPath, 'cover-letter-structured-output.json');

      if (fs.existsSync(resumeCandidate)) {
        jsonPath = resumeCandidate;
      } else if (fs.existsSync(coverLetterCandidate)) {
        jsonPath = coverLetterCandidate;
        isCoverLetter = true;
      } else {
        return { success: false, error: 'No structured-output.json or cover-letter-structured-output.json found in the directory.' };
      }
    } else if (structuredPath.toLowerCase().includes('cover-letter')) {
      isCoverLetter = true;
    }

    const raw = fs.readFileSync(jsonPath, 'utf8');
    targetJSON = JSON.parse(raw);
  }

  if (!targetJSON) {
    return { success: false, error: 'structuredJSON is required (or provide a valid structuredPath).' };
  }

  const sourceDir = structuredPath && fs.existsSync(structuredPath) && fs.statSync(structuredPath).isDirectory()
    ? structuredPath
    : (structuredPath ? path.dirname(structuredPath) : null);

  return { success: true, json: targetJSON, isCoverLetter, sourceDir };
}

function buildLatexFromStructured(targetJSON: any, isCoverLetter: boolean, sourceDir: string | null | undefined): { texUrl: string; pdfUrl: string; txtUrl?: string } {
  const latexSource = isCoverLetter ? buildCoverLetterLatex(targetJSON) : buildLatex(targetJSON);
  const date = new Date().toISOString().slice(0, 10);
  const tmpDir = path.join(jobsDir, `structured-${date}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const texFilename = isCoverLetter ? 'cover-letter.tex' : 'resume.tex';
  const pdfFilename = isCoverLetter ? 'cover-letter.pdf' : 'resume.pdf';

  saveJobFile(tmpDir, texFilename, latexSource);
  const pdfBuffer = compilePDFViaTectonic(latexSource);
  saveJobFile(tmpDir, pdfFilename, pdfBuffer);

  const response: { texUrl: string; pdfUrl: string; txtUrl?: string } = {
    texUrl: `/jobs/${path.basename(tmpDir)}/${texFilename}`,
    pdfUrl: `/jobs/${path.basename(tmpDir)}/${pdfFilename}`,
  };

  if (isCoverLetter) {
    const txtContent = [
      targetJSON.dateLine,
      targetJSON.recipientLine,
      targetJSON.subjectLine,
      '',
      targetJSON.greeting,
      '',
      targetJSON.openingParagraph,
      '',
      targetJSON.bodyParagraph,
      '',
      targetJSON.closingParagraph,
      '',
      targetJSON.signoff,
      targetJSON.fullName,
    ].filter(Boolean).join('\n');
    saveJobFile(tmpDir, 'cover-letter.txt', txtContent);
    response.txtUrl = `/jobs/${path.basename(tmpDir)}/cover-letter.txt`;

    if (sourceDir && fs.existsSync(sourceDir)) {
      saveJobFile(sourceDir, 'cover-letter.txt', txtContent);
    }
  }

  return response;
}

function compilePDFSync(latexSource: string): Buffer {
  const tmpDir = path.join(jobsDir, 'tmp-compile');
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpTex = path.join(tmpDir, 'tmp.tex');
  fs.writeFileSync(tmpTex, latexSource, 'utf8');
  return compilePDFSyncFile(tmpTex);
}

const TECTONIC_URL = process.env.TECTONIC_URL || 'http://localhost:4000/compile';

function compilePDFViaTectonic(latexSource: string): Buffer {
  const result = require('child_process').spawnSync(
    'curl',
    ['-sS', '-X', 'POST', '--data-binary', '@-', TECTONIC_URL],
    {
      input: latexSource,
      timeout: 60000,
      maxBuffer: 50 * 1024 * 1024,
    }
  );
  if (result.status !== 0) {
    const stderr = result.stderr?.toString() ?? '';
    throw new Error(`tectonic request failed (exit ${result.status}): ${stderr}`);
  }
  const body = result.stdout ?? Buffer.from('');
  if (body.length < 5 || body.slice(0, 4).toString() !== '%PDF') {
    throw new Error(`tectonic did not return a PDF: ${body.toString('utf8').slice(0, 500)}`);
  }
  return body;
}

function readLatexLogTail(logPath: string): string {
  if (!fs.existsSync(logPath)) return '';
  return fs.readFileSync(logPath, 'utf8').split('\n').slice(-40).join('\n');
}

function reportLatexFailure(texPath: string, err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  const stderr = (err as { stderr?: Buffer | null })?.stderr?.toString() ?? '';
  const logTail = readLatexLogTail(texPath.replace(/\.tex$/i, '.log'));
  console.error(`[compilePDFSyncFile] pdflatex failed for ${texPath}\n${message}\n${stderr}\n--- log tail ---\n${logTail}`);
  throw new Error(`pdflatex failed for ${path.basename(texPath)}: ${message}`);
}

function compilePDFSyncFile(texPath: string): Buffer {
  try {
    require('child_process').execFileSync(
      'pdflatex',
      ['-interaction=nonstopmode', '-halt-on-error', texPath],
      { cwd: path.dirname(texPath), timeout: 60000, stdio: ['ignore', 'ignore', 'pipe'] }
    );
  } catch (err) {
    reportLatexFailure(texPath, err);
  }

  const pdfPath = texPath.replace(/\.tex$/i, '.pdf');
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`pdflatex produced no PDF for ${path.basename(texPath)}`);
  }
  return fs.readFileSync(pdfPath);
}

function renameJobDir(targetDir: string, prefix: string): string | null {
  if (!fs.existsSync(targetDir)) return null;
  const folderName = path.basename(targetDir);
  const parentDir = path.dirname(targetDir);
  const newDir = path.join(parentDir, `${prefix}${folderName}`);
  fs.renameSync(targetDir, newDir);
  return newDir;
}

interface ATSAnalysisResult {
  coveragePercent: number;
  extractedFromJD: string[];
  includedInResume: string[];
  missingFromResume: string[];
}

interface ExecuteATSAnalysisInput {
  folderPath?: string;
  resumeJSON?: ResumeData;
  jobDescription?: string;
  atsKeywordsFromAI?: string[];
  lastGeneratedResumeJSON: ResumeData | null;
}

async function executeATSAnalysis(input: ExecuteATSAnalysisInput): Promise<{ analysis: ATSAnalysisResult | null; error?: string }> {
  let targetResume: ResumeData | undefined;
  let targetJobDescription = input.jobDescription;
  let extractedAtsKeywords: string[] | undefined;

  if (input.folderPath?.trim()) {
    const resolved = resolveJobDir(input.folderPath);

    const resumePath = path.join(resolved, 'structured-output.json');
    if (fs.existsSync(resumePath)) {
      const resumeData = fs.readFileSync(resumePath, 'utf8');
      targetResume = JSON.parse(resumeData);
      extractedAtsKeywords = (targetResume as any).atsKeywords;
    }

    const atsPath = path.join(resolved, 'ats-analysis.json');
    if (fs.existsSync(atsPath)) {
      const atsData = JSON.parse(fs.readFileSync(atsPath, 'utf8'));
      if (!extractedAtsKeywords?.length && atsData.extractedFromJD?.length) {
        extractedAtsKeywords = atsData.extractedFromJD;
      }
    }

    const jdPath = path.join(resolved, 'job-description.txt');
    if (fs.existsSync(jdPath)) {
      targetJobDescription = fs.readFileSync(jdPath, 'utf8');
    }
  } else {
    targetResume = input.resumeJSON ?? input.lastGeneratedResumeJSON;
  }

  if (!targetResume) {
    return { analysis: null, error: 'No resume JSON available. Provide folderPath with structured-output.json, or resumeJSON, or generate a resume first.' };
  }

  let atsKeywords: string[] = [];

  if (input.atsKeywordsFromAI && input.atsKeywordsFromAI.length > 0) {
    atsKeywords = input.atsKeywordsFromAI;
  } else if (extractedAtsKeywords?.length) {
    atsKeywords = extractedAtsKeywords;
  } else if (targetJobDescription?.trim()) {
    atsKeywords = await extractATSKeywordsFromJDViaAI(targetJobDescription);
  } else {
    return { analysis: null, error: 'No job description available. Provide atsKeywordsFromAI or ensure job-description.txt exists in folderPath.' };
  }

  if (!atsKeywords.length) {
    return { analysis: { coveragePercent: 0, extractedFromJD: [], includedInResume: [], missingFromResume: [] } };
  }

  const atsResult = analyzeATSKeywordsAgainstResume(atsKeywords, targetResume);

  if (input.folderPath?.trim()) {
    const resolved = resolveJobDir(input.folderPath);
    saveJobFile(resolved, 'ats-analysis.json', JSON.stringify(atsResult, null, 2));
  }

  return { analysis: atsResult };
}

export default router;