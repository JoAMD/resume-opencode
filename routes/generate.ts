import { Router, type Request } from 'express';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import slugify from 'slugify';
import { generateResumeJSON, generateCoverLetterJSON, generateCombinedJSON, CoverLetterJSON, normaliseBodyParagraph, analyzeATSKeywordsAgainstResume, extractATSKeywordsFromJDViaAI } from '../services/ai';
import { ResumeData } from '../services/types';
import { log, logError } from '../services/logger';
import { buildLatex, buildCoverLetterLatex } from '../services/latex';
import { compilePDF } from '../services/compiler';
import { compilePDFViaTectonic } from '../services/texCompiler';
import { findProjectRoot } from '../services/paths';
import { appendApplication, findApplications, writeLinkToJobDir } from '../services/applications';

const router = Router();

export { router };
const projectRoot = findProjectRoot(__dirname);
const jobsDir = path.join(projectRoot, 'jobs');

router.use((req, _res, next) => {
  log(`${req.method} /generate${req.path}`);
  next();
});

type GenerateRequestBody = {
  jobDescription?: string;
  fullJD?: string;
  companyName?: string;
  roleName?: string;
  link?: string;
  extraNotes?: string;
  generateWithoutJD?: boolean;
  coverOutput?: 'pdf' | 'txt' | 'none';
  lowTokenMode?: boolean;
  modelSelect?: string;
  modelPreference?: string;
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
  sessionId?: string;
  coverLetterSessionId?: string;
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

export function appendJobFile(dirPath: string, filename: string, content: string): void {
  fs.appendFileSync(path.join(dirPath, filename), content, 'utf8');
}

export function writeSessionInfo(dirPath: string, info: { sessionId: string; model?: string; coverLetterSessionId?: string }): void {
  const lines = [
    `OpenCode Session ID: ${info.sessionId}`,
    `Model: ${info.model || ''}`,
    `Generated At: ${new Date().toISOString()}`,
  ];
  if (info.coverLetterSessionId && info.coverLetterSessionId !== info.sessionId) {
    lines.push(`Cover Letter Session ID: ${info.coverLetterSessionId}`);
  }
  saveJobFile(dirPath, 'session-info.txt', lines.join('\n') + '\n');
}

const RESUME_TYPE_LABELS: Record<string, string> = {
  software: 'Software Engineer',
  qa: 'QA Engineer',
};

const MODEL_PREFERENCE_LABELS: Record<string, string> = {
  auto: 'Auto (default)',
  'non-premium': 'Non-premium only',
};

const COVER_OUTPUT_LABELS: Record<string, string> = {
  pdf: 'PDF (also saves LaTeX)',
  txt: 'TXT only',
  none: 'None',
};

function formatOtherInput(body: GenerateRequestBody): string {
  const lines: string[] = [];
  lines.push(`Resume Type: ${RESUME_TYPE_LABELS[body.resumeType ?? ''] ?? body.resumeType ?? ''}`);
  lines.push('');
  lines.push(`Company Name: ${body.companyName ?? ''}`);
  lines.push('');
  lines.push(`Role / Title: ${body.roleName ?? ''}`);
  lines.push('');
  lines.push(`Job posting link: ${body.link ?? ''}`);
  lines.push('');
  lines.push('Job Description:');
  lines.push(body.jobDescription ? '(see job-description.txt)' : '(empty)');
  lines.push('');
  lines.push(`Generate based on role title only: ${body.generateWithoutJD ? 'yes' : 'no'}`);
  lines.push('');
  lines.push('Extra Notes:');
  lines.push(body.extraNotes ?? '');
  lines.push('');
  lines.push(`Model Mode: ${MODEL_PREFERENCE_LABELS[body.modelPreference ?? ''] ?? body.modelPreference ?? ''}`);
  lines.push('');
  lines.push(`Model: ${body.modelSelect ?? ''}`);
  lines.push('');
  lines.push(`Cover Letter Output: ${COVER_OUTPUT_LABELS[body.coverOutput ?? ''] ?? body.coverOutput ?? ''}`);
  lines.push('');
  lines.push(`Low-token test mode: ${body.lowTokenMode ? 'yes' : 'no'}`);
  lines.push(`STAR method for govt roles: ${body.useStarMethodForGovtRoles ? 'yes' : 'no'}`);
  lines.push(`Use combined generation: ${body.useCombinedGeneration ? 'yes' : 'no'}`);
  return lines.join('\n') + '\n';
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
  const bodyParagraphs = normaliseBodyParagraph(cl.bodyParagraph);
  return [
    cl.dateLine,
    cl.recipientLine,
    cl.subjectLine,
    '',
    cl.greeting,
    '',
    cl.openingParagraph,
    '',
    ...bodyParagraphs,
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
    sessionId: task.sessionId,
    coverLetterSessionId: task.coverLetterSessionId,
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
    const jobDir = createJobDir(companyName, roleName, body.modelSelect);
    const options = buildGenerationOptions(body, jobDir.jobDir);

    saveJobFile(jobDir.jobDir, 'job-description.txt', jobDescription ?? '');
    if (body.fullJD && body.fullJD.trim()) {
      saveJobFile(jobDir.jobDir, 'full-jd.txt', body.fullJD);
    }
    saveJobFile(jobDir.jobDir, 'other-input.txt', formatOtherInput(body));
    if (body.link?.trim()) {
      writeLinkToJobDir(jobDir.jobDir, body.link.trim());
    }
    const taskId = createTaskId();
    taskMap.set(taskId, { status: 'pending', startedAt: Date.now() });
    res.json({ taskId, jobDir: jobDir.slug });

    (async () => {
      try {
        const { result, sessionId, coverLetterSessionId } = await executeGeneration(jobDir, options, { jobDescription, companyName, roleName, extraNotes, coverOutput, useCombinedGeneration });
        taskMap.set(taskId, { status: 'complete', result, startedAt: Date.now(), sessionId, coverLetterSessionId });
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
    const { coverLetter: coverLetterJSON, sessionId } = await generateCoverLetterJSON(
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
    writeSessionInfo(jobDir, { sessionId, model: modelSelect });

    const latexSource = buildCoverLetterLatex(coverLetterJSON);
    saveJobFile(jobDir, 'cover-letter.tex', latexSource);

    const effectiveCoverOutput = resolveCoverOutput(coverOutput);
    if (effectiveCoverOutput === 'txt') {
      const txtContent = formatCoverLetterText(coverLetterJSON);
      saveJobFile(jobDir, 'cover-letter.txt', txtContent);
      res.json({ txtUrl: `/jobs/${path.basename(jobDir)}/cover-letter.txt`, sessionId });
    } else {
      const pdfBuffer = await compilePDF(latexSource);
      saveJobFile(jobDir, 'cover-letter.pdf', pdfBuffer);
      res.json({ pdfUrl: `/jobs/${path.basename(jobDir)}/cover-letter.pdf`, sessionId });
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

function readDuplicateQuery(req: Request): { link?: string; company?: string; role?: string } {
  const link = typeof req.query.link === 'string' ? req.query.link : undefined;
  const company = typeof req.query.company === 'string' ? req.query.company : undefined;
  const role = typeof req.query.role === 'string' ? req.query.role : undefined;
  return { link, company, role };
}

function hasUsableDuplicateQuery(q: { link?: string; company?: string; role?: string }): boolean {
  if (q.link?.trim()) return true;
  return !!(q.company?.trim() && q.role?.trim());
}

router.get('/checkDuplicate', (req, res) => {
  try {
    const query = readDuplicateQuery(req);
    if (!hasUsableDuplicateQuery(query)) {
      res.json({ duplicate: false, matchedBy: null, row: null, checked: false });
      return;
    }

    const match = findApplications(query);
    if (!match) {
      res.json({ duplicate: false, matchedBy: null, row: null, checked: true });
      return;
    }
    res.json({ duplicate: true, matchedBy: match.matchedBy, row: match.row, checked: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    logError('Check duplicate error:', err);
    res.status(500).json({ error: message });
  }
});

router.post('/markApplied', async (req, res) => {
  try {
    const { folderPath, taskId, company, role, link, job_dir } = req.body as {
      folderPath?: string;
      taskId?: string;
      company?: string;
      role?: string;
      link?: string;
      job_dir?: string;
    };
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

    const csvResult = appendApplication({
      company: company ?? '',
      role: role ?? '',
      link: link ?? '',
      job_dir: job_dir ?? path.basename(newDir),
    });

    log(
      `Marked folder as applied: ${folderName} -> ${path.basename(newDir)}` +
        ` (csvAppended=${csvResult.appended}${csvResult.reason ? `, reason=${csvResult.reason}` : ''})`
    );
    res.json({
      success: true,
      oldPath: targetDir,
      newPath: newDir,
      csvAppended: csvResult.appended,
      csvSkippedReason: csvResult.appended ? null : csvResult.reason,
    });
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

function createJobDir(companyName: string, roleName: string, model?: string): { jobDir: string; slug: string } {
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const time = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}-${String(now.getMilliseconds()).padStart(3, '0')}`;
  const modelSegment = model ? slugify(model, { lower: true, strict: true }) : '';
  const parts = [companyName, roleName, date, time, modelSegment].filter(Boolean);
  const slug = slugify(parts.join('-'), { lower: true, strict: true });
  const jobDir = path.join(jobsDir, slug);
  fs.mkdirSync(jobDir, { recursive: true });
  return { jobDir, slug };
}

function resolveCoverOutput(coverOutput: 'pdf' | 'txt' | 'none' | '' | undefined): 'pdf' | 'txt' | 'none' {
  if (coverOutput === 'pdf' || coverOutput === 'txt' || coverOutput === 'none') {
    return coverOutput;
  }
  return 'pdf';
}

function buildGenerationOptions(body: GenerateRequestBody, jobDirPath: string) {
  return {
    lowTokenMode: Boolean(body.lowTokenMode),
    modelSelect: body.modelSelect,
    promptLogDir: jobDirPath,
    useStarMethodForGovtRoles: Boolean(body.useStarMethodForGovtRoles),
    resumeType: body.resumeType as 'software' | 'qa' | undefined,
    coverOutput: resolveCoverOutput(body.coverOutput),
  };
}

async function executeGeneration(
  jobDir: { jobDir: string; slug: string },
  options: ReturnType<typeof buildGenerationOptions>,
  input: { jobDescription?: string; companyName?: string; roleName?: string; extraNotes?: string; coverOutput?: 'pdf' | 'txt' | 'none' | ''; useCombinedGeneration?: boolean }
): Promise<{ result: Record<string, unknown>; sessionId: string; coverLetterSessionId?: string }> {
  const { jobDescription, companyName, roleName, extraNotes, useCombinedGeneration } = input;
  const coverOutput = resolveCoverOutput(input.coverOutput);

  let resumeJSON: ResumeData;
  let coverLetterJSON: CoverLetterJSON | undefined;
  let atsKeywords: string[] = [];
  let sessionId: string;
  let coverLetterSessionId: string | undefined;

  const context = { companyName: companyName ?? '', roleName: roleName ?? '', generateWithoutJD: false, promptLogDir: jobDir.jobDir };

  if (useCombinedGeneration !== false && coverOutput !== 'none') {
    const combined = await generateCombinedJSON(jobDescription ?? '', extraNotes ?? '', companyName ?? '', roleName ?? '', false, options);
    resumeJSON = combined.resume;
    coverLetterJSON = combined.coverLetter;
    atsKeywords = combined.atsKeywords ?? [];
    sessionId = combined.sessionId;
    coverLetterSessionId = combined.coverLetterSessionId;
  } else {
    const resumeResult = await generateResumeJSON(jobDescription ?? '', extraNotes ?? '', context, options);
    resumeJSON = resumeResult.resume;
    sessionId = resumeResult.sessionId;
  }

  lastGeneratedResumeJSON = resumeJSON;
  log('Resume JSON received');

  const latexSource = buildLatex(resumeJSON, options.resumeType);
  const pdfBuffer = await compilePDF(latexSource);

  saveJobFile(jobDir.jobDir, 'resume.tex', latexSource);
  saveJobFile(jobDir.jobDir, 'resume.pdf', pdfBuffer);
  lastGeneratedTexPath = path.join(jobDir.jobDir, 'resume.tex');

  saveJobFile(jobDir.jobDir, 'structured-output.json', JSON.stringify(resumeJSON, null, 2));

  writeSessionInfo(jobDir.jobDir, { sessionId, model: options.modelSelect, coverLetterSessionId });
  appendJobFile(jobDir.jobDir, 'other-input.txt', `\nOpenCode Session ID: ${sessionId}\n`);

  const result: Record<string, unknown> = {
    pdfUrl: `/jobs/${jobDir.slug}/resume.pdf`,
    jobDir: jobDir.slug,
    sessionId,
  };
  if (coverLetterSessionId) result.coverLetterSessionId = coverLetterSessionId;

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

  return { result, sessionId, coverLetterSessionId };
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
  return execSync(
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

export function buildLatexFromStructured(targetJSON: any, isCoverLetter: boolean, sourceDir: string | null | undefined): { texUrl: string; pdfUrl: string; txtUrl?: string } {
  const latexSource = isCoverLetter ? buildCoverLetterLatex(targetJSON) : buildLatex(targetJSON);
  const outDir = sourceDir && fs.existsSync(sourceDir) ? sourceDir : path.join(jobsDir, 'last-generated');
  fs.mkdirSync(outDir, { recursive: true });

  const texFilename = isCoverLetter ? 'cover-letter.tex' : 'resume.tex';
  const pdfFilename = isCoverLetter ? 'cover-letter.pdf' : 'resume.pdf';

  saveJobFile(outDir, texFilename, latexSource);
  const pdfBuffer = compilePDFViaTectonic(latexSource);
  saveJobFile(outDir, pdfFilename, pdfBuffer);

  const response: { texUrl: string; pdfUrl: string; txtUrl?: string } = {
    texUrl: `/jobs/${path.basename(outDir)}/${texFilename}`,
    pdfUrl: `/jobs/${path.basename(outDir)}/${pdfFilename}`,
  };

  if (isCoverLetter) {
    const bodyParagraphs = normaliseBodyParagraph(targetJSON.bodyParagraph);
    const txtContent = [
      targetJSON.dateLine,
      targetJSON.recipientLine,
      targetJSON.subjectLine,
      '',
      targetJSON.greeting,
      '',
      targetJSON.openingParagraph,
      '',
      ...bodyParagraphs,
      '',
      targetJSON.closingParagraph,
      '',
      targetJSON.signoff,
      targetJSON.fullName,
    ].filter(Boolean).join('\n');
    saveJobFile(outDir, 'cover-letter.txt', txtContent);
    response.txtUrl = `/jobs/${path.basename(outDir)}/cover-letter.txt`;
  }

  return response;
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

if ((process.env.ENABLE_DEBUG_ROUTES ?? '').toLowerCase() === 'true') {
  function readDebugSleepMs(body: any): number {
    return Math.max(0, parseInt(String(body?.sleepMs ?? 0), 10) || 0);
  }

  function withDebugSleep<T>(sleepMs: number, fn: () => Promise<T>): Promise<T> {
    const previous = process.env.OPENCODE_DEBUG_PROMPT_SLEEP_MS;
    process.env.OPENCODE_DEBUG_PROMPT_SLEEP_MS = String(sleepMs);
    const restore = () => {
      if (previous === undefined) delete process.env.OPENCODE_DEBUG_PROMPT_SLEEP_MS;
      else process.env.OPENCODE_DEBUG_PROMPT_SLEEP_MS = previous;
    };
    return fn().finally(restore);
  }

  function describeError(err: any) {
    return {
      error: err?.message ?? String(err),
      name: err?.name,
      code: err?.cause?.code,
    };
  }

  router.post('/debug/slow-prompt', async (req, res) => {
    const sleepMs = readDebugSleepMs(req.body);
    const start = Date.now();
    log('debug: /debug/slow-prompt sleepMs=', sleepMs);
    try {
      const result = await withDebugSleep(sleepMs, () =>
        generateResumeJSON(
          req.body?.jobDescription ?? 'debug jd',
          req.body?.extraNotes ?? '',
          { companyName: 'DebugCo', roleName: 'DebugSWE', promptLogDir: '/tmp' },
          { modelSelect: req.body?.modelSelect ?? 'opencode/gpt-5-nano' }
        )
      );
      res.json({ ok: true, elapsedMs: Date.now() - start, name: result.resume.name, sessionId: result.sessionId });
    } catch (err: any) {
      logError('debug: /debug/slow-prompt error:', err);
      res.status(500).json({ ok: false, elapsedMs: Date.now() - start, ...describeError(err) });
    }
  });
}

export default router;