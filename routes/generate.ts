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
import { appendApplication, findApplications, writeLinkToJobDir, type ApplicationRow } from '../services/applications';
import {
  searchJobDescriptions,
  SEARCH_MODES,
  type SearchMode,
} from '../services/jobDescriptionSearch';
import { applySuggestions, AttachedFile, NoOpResultError } from '../services/fixSuggestionsService';
import { ensureRedactedResumeFile, loadRedactedResumeFromDir } from '../services/redactResume';
import { unifiedDiffText, summariseJsonDiff, generateInlineDiff } from '../services/diffUtil';
import { latestBackupVersion, listBackupVersions, listJobDirs } from '../services/backupService';
import { loadOtherInputFromDir, loadFullJdFromDir, loadJobDescriptionFromDir, resolveJobFolder } from '../services/jobDir';

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
  coverOutput?: 'pdf' | 'txt' | 'both' | 'none';
  lowTokenMode?: boolean;
  modelSelect?: string;
  modelPreference?: string;
  useStarMethodForGovtRoles?: boolean;
  resumeType?: 'software' | 'qa';
  useCombinedGeneration?: boolean;
  force?: boolean;
  permalinkUrl?: string;
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
  step?: number;
  stepLabel?: string;
};

const STEP_LABELS: Record<number, string> = {
  1: 'Generating resume + cover letter',
  2: 'Running ATS analysis',
  3: 'Applying ATS suggestions',
  4: 'Final ATS analysis',
};

export function setTaskStep(taskId: string, step: number): void {
  const record = taskMap.get(taskId);
  if (!record) return;
  record.step = step;
  record.stepLabel = STEP_LABELS[step] ?? '';
}

const taskMap = new Map<string, TaskResult & { startedAt: number; step: number; stepLabel: string }>();

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

export function validatePermalinkUrl(raw: unknown, slug: string): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  if (!/^https?:\/\//i.test(raw)) return null;
  if (!raw.includes('#job=')) return null;
  const baseSlug = path.basename(slug);
  if (!baseSlug) return null;
  if (!raw.includes(encodeURIComponent(baseSlug)) && !raw.includes(baseSlug)) return null;
  return raw;
}

export function writePermalinkTxt(realJobDir: string, permalinkUrl: string): void {
  fs.writeFileSync(path.join(realJobDir, 'permalink.txt'), permalinkUrl + '\n', 'utf8');
  log('Wrote permalink.txt for', realJobDir);
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
  both: 'TXT + PDF (also saves LaTeX)',
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
    step: task.step,
    stepLabel: task.stepLabel,
  });
});

function hasLookupCriteria(body: GenerateRequestBody): boolean {
  if (body.link?.trim()) return true;
  return !!body.companyName?.trim();
}

function findExistingApplication(body: GenerateRequestBody) {
  if (!hasLookupCriteria(body)) return null;
  return findApplications({
    link: body.link?.trim(),
    company: body.companyName?.trim(),
    role: body.roleName?.trim(),
  });
}

function duplicateConflictResponse(body: GenerateRequestBody): { matchedBy: 'link' | 'company-role' | 'company'; row: ApplicationRow; partialMatch: boolean } | null {
  if (body.force) return null;
  const existing = findExistingApplication(body);
  if (!existing) return null;
  return existing;
}

router.post('/', async (req, res) => {
  const body = req.body as GenerateRequestBody;
  const { jobDescription, companyName, roleName, extraNotes, generateWithoutJD, coverOutput, lowTokenMode, useCombinedGeneration } = body;

  const validationError = validateGenerateRequest(body);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  const conflict = duplicateConflictResponse(body);
  if (conflict) {
    res.status(409).json({
      error: 'duplicate-application',
      matchedBy: conflict.matchedBy,
      partialMatch: conflict.partialMatch,
      row: conflict.row,
    });
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
    taskMap.set(taskId, { status: 'pending', startedAt: Date.now(), step: 1, stepLabel: STEP_LABELS[1] });
    res.json({ taskId, jobDir: jobDir.slug });

    (async () => {
      try {
        const { result, sessionId, coverLetterSessionId } = await executeGeneration(jobDir, options, { jobDescription, companyName, roleName, extraNotes, coverOutput, useCombinedGeneration });
        taskMap.set(taskId, { status: 'complete', result, startedAt: Date.now(), sessionId, coverLetterSessionId, step: 1, stepLabel: STEP_LABELS[1] });
        const validatedPermalink = validatePermalinkUrl(body.permalinkUrl, jobDir.slug);
        if (validatedPermalink) {
          try { writePermalinkTxt(jobDir.jobDir, validatedPermalink); } catch (e) { logError('Failed to write permalink.txt:', e); }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Internal server error';
        logError('Background generation error:', err);
        taskMap.set(taskId, { status: 'error', error: message, startedAt: Date.now(), step: 1, stepLabel: STEP_LABELS[1] });
      }
    })();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    logError('Generation error:', err);
    res.status(500).json({ error: message });
  }
});

router.post('/coverLetter', async (req, res) => {
  const { companyName, roleName, jobDescription, extraNotes, coverOutput, modelSelect, useStarMethodForGovtRoles, folderPath, permalinkUrl } = req.body as GenerateRequestBody & { folderPath?: string };
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
    const coverUrls = await writeCoverLetterArtifacts(jobDir, coverLetterJSON, latexSource, effectiveCoverOutput);
    const slug = path.basename(jobDir);
    const validatedPermalink = validatePermalinkUrl(permalinkUrl, slug);
    if (validatedPermalink) {
      try { writePermalinkTxt(jobDir, validatedPermalink); } catch (e) { logError('Failed to write permalink.txt:', e); }
    }
    res.json({ sessionId, ...coverUrls });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    logError('Cover letter error:', err);
    res.status(500).json({ error: message });
  }
});

router.post('/prefill', (req, res) => {
  const body = (req.body ?? {}) as { folderPath?: string; slug?: string };
  const input = (body.folderPath || body.slug || '').trim();
  if (!input) {
    res.status(400).json({ error: 'folderPath required' });
    return;
  }
  const realDir = resolveJobFolder(input);
  if (!realDir) {
    res.status(404).json({ error: 'Job folder not found' });
    return;
  }
  const realJobsRoot = ensureJobsRootRealpath();
  if (!realJobsRoot || !pathIsInsideDir(realDir, realJobsRoot)) {
    res.status(400).json({ error: 'folderPath escapes jobs root' });
    return;
  }
  const slug = path.basename(realDir);
  const jd = loadJobDescriptionFromDir(realDir) ?? '';
  const other = loadOtherInputFromDir(realDir);
  const fullJD = loadFullJdFromDir(realDir) ?? '';
  let extraNotes = '';
  const otherInputPath = path.join(realDir, 'other-input.txt');
  if (fs.existsSync(otherInputPath)) {
    extraNotes = fs.readFileSync(otherInputPath, 'utf8');
  }
  res.json({
    jobDescription: jd,
    extraNotes,
    companyName: other?.companyName ?? '',
    roleName: other?.roleName ?? '',
    link: other?.link ?? '',
    fullJD,
    slug,
    folderPath: realDir,
  });
});

router.post('/permalink', (req, res) => {
  const body = (req.body ?? {}) as { slug?: string; permalinkUrl?: string };
  const slug = (body.slug || '').trim();
  if (!slug) {
    res.status(400).json({ error: 'slug is required' });
    return;
  }
  const realDir = safeRealpath(resolveJobDir(slug));
  const realJobsRoot = ensureJobsRootRealpath();
  if (!realDir || !realJobsRoot || !pathIsInsideDir(realDir, realJobsRoot)) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }
  if (!fs.existsSync(realDir) || !fs.statSync(realDir).isDirectory()) {
    res.status(404).json({ error: 'Job folder not found' });
    return;
  }
  const validated = validatePermalinkUrl(body.permalinkUrl, slug);
  if (!validated) {
    res.status(400).json({ error: 'invalid permalinkUrl' });
    return;
  }
  try {
    writePermalinkTxt(realDir, validated);
    res.json({ ok: true });
  } catch (e) {
    logError('Failed to write permalink.txt:', e);
    res.status(500).json({ error: 'failed to write permalink.txt' });
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
  return !!q.company?.trim();
}

router.get('/checkDuplicate', (req, res) => {
  try {
    const query = readDuplicateQuery(req);
    if (!hasUsableDuplicateQuery(query)) {
      res.json({ duplicate: false, matchedBy: null, partialMatch: false, row: null, checked: false });
      return;
    }

    const match = findApplications(query);
    if (!match) {
      res.json({ duplicate: false, matchedBy: null, partialMatch: false, row: null, checked: true });
      return;
    }
    res.json({
      duplicate: true,
      matchedBy: match.matchedBy,
      partialMatch: match.partialMatch,
      row: match.row,
      checked: true,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    logError('Check duplicate error:', err);
    res.status(500).json({ error: message });
  }
});

function readSearchByDescriptionQuery(req: Request): {
  text: string;
  mode: SearchMode;
  limit: number;
} {
  const text = typeof req.query.text === 'string' ? req.query.text : '';
  const rawMode = typeof req.query.mode === 'string' ? req.query.mode : '';
  const mode: SearchMode = (SEARCH_MODES as readonly string[]).includes(rawMode)
    ? (rawMode as SearchMode)
    : 'exact-substring';
  const rawLimit = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : NaN;
  const limit = Number.isFinite(rawLimit) ? rawLimit : 50;
  return { text, mode, limit };
}

router.get('/searchByDescription', (req, res) => {
  try {
    const { text, mode, limit } = readSearchByDescriptionQuery(req);
    if (!SEARCH_MODES.includes(mode)) {
      res.status(400).json({
        error: `Unknown mode "${mode}". Expected one of: ${SEARCH_MODES.join(', ')}.`,
      });
      return;
    }
    const trimmed = (text ?? '').trim();
    if (!trimmed) {
      res.json({ matches: [], mode, text: trimmed, count: 0 });
      return;
    }
    const matches = searchJobDescriptions({ text: trimmed, mode, jobsDir, limit });
    res.json({ matches, mode, text: trimmed, count: matches.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    logError('Search by description error:', err);
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
    log(`markApplied req.body: ${JSON.stringify({ company, role, link, job_dir })}`);

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

    const otherInput = loadOtherInputFromDir(newDir);
    log(`markApplied otherInput from job dir: ${JSON.stringify(otherInput)}`);
    const csvResult = appendApplication({
      company: company || otherInput?.companyName || '',
      role: role || otherInput?.roleName || '',
      link: link || otherInput?.link || '',
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
    const { jobDescription, resumeJSON, atsKeywordsFromAI, folderPath, modelSelect } = req.body as {
      jobDescription?: string;
      resumeJSON?: ResumeData;
      atsKeywordsFromAI?: string[];
      folderPath?: string;
      modelSelect?: string;
    };

    const result = await executeATSAnalysis({
      folderPath,
      resumeJSON,
      jobDescription,
      atsKeywordsFromAI,
      lastGeneratedResumeJSON,
      modelSelect,
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

function buildOpencodeWebLink(sessionId?: string | null): string | null {
  if (!sessionId) return null;
  const host = process.env.OPENCODE_HOSTNAME || 'localhost';
  const port = process.env.OPENCODE_PORT || '4096';
  return `http://${host}:${port}/session/${sessionId}`;
}

function safeRealpath(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

function pathIsInsideDir(candidate: string, dir: string): boolean {
  return candidate.startsWith(dir + path.sep) || candidate === dir;
}

function ensureJobsRootRealpath(): string | null {
  return safeRealpath(jobsDir);
}

type ApplySuggestionsRequestBody = {
  jobDir?: string;
  userSuggestions?: string;
  attachedFilePaths?: string[];
  modelSelect?: string;
};

type ApplySuggestionsServiceInput = {
  jobDir: string;
  slug: string;
  userSuggestions: string;
  attachedFiles: AttachedFile[];
  resumePath: string;
  redactedResumePath: string;
  modelSelect?: string;
};

type ValidationFailure = { ok: false; status: number; error: string };
type ValidationSuccess<T> = { ok: true; value: T };

function isFailure<T>(r: ValidationFailure | ValidationSuccess<T>): r is ValidationFailure {
  return !r.ok;
}

function requireExists(label: string, filePath: string, missingMessage: string): ValidationFailure | null {
  if (fs.existsSync(filePath)) return null;
  return { ok: false, status: 400, error: missingMessage };
}

function requireDir(label: string, dirPath: string): ValidationFailure | null {
  if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) return null;
  return { ok: false, status: 404, error: `${label} not found` };
}

function validateApplySuggestionsRequest(body: ApplySuggestionsRequestBody): ValidationFailure | ValidationSuccess<{ jobDir: string; resumePath: string; redactedResumePath: string; userSuggestions: string; modelSelect?: string; rawAttached: string[] }> {
  const slug = body.jobDir;
  if (!slug) return { ok: false, status: 400, error: 'jobDir is required' };
  const jobDir = resolveJobDir(slug);
  const dirFailure = requireDir('Job directory', jobDir);
  if (dirFailure) return dirFailure;
  const userSuggestions = body.userSuggestions?.trim() ?? '';
  if (!userSuggestions) return { ok: false, status: 400, error: 'userSuggestions is required' };
  const resumePath = path.join(jobDir, 'structured-output.json');
  const resumeFailure = requireExists('structured-output.json', resumePath, 'structured-output.json not found in this job folder');
  if (resumeFailure) return resumeFailure;
  const redactedResumePath = path.join(jobDir, 'structured-output-redacted.json');
  const redactedFailure = requireExists('structured-output-redacted.json', redactedResumePath, 'structured-output-redacted.json not found — call POST /generate/ensureRedactedResume first');
  if (redactedFailure) return redactedFailure;
  return {
    ok: true,
    value: {
      jobDir,
      resumePath,
      redactedResumePath,
      userSuggestions,
      modelSelect: body.modelSelect,
      rawAttached: Array.isArray(body.attachedFilePaths) ? body.attachedFilePaths : [],
    },
  };
}

function resolveAttachedPath(raw: string, realJobDir: string): string {
  if (path.isAbsolute(raw)) return raw;
  return path.join(realJobDir, raw);
}

function validateAttachedFilePaths(rawPaths: string[], realJobDir: string, _realJobsRoot: string): ValidationFailure | ValidationSuccess<AttachedFile[]> {
  const attachedFiles: AttachedFile[] = [];
  for (const p of rawPaths) {
    if (typeof p !== 'string') continue;
    const candidate = resolveAttachedPath(p, realJobDir);
    const real = safeRealpath(candidate);
    if (!real || !pathIsInsideDir(real, realJobDir)) {
      return { ok: false, status: 400, error: `Attached file escapes job directory: ${p}` };
    }
    if (!fs.existsSync(real) || !fs.statSync(real).isFile()) {
      return { ok: false, status: 400, error: `Attached file is not a regular file: ${p}` };
    }
    attachedFiles.push({ name: path.basename(real), path: real });
  }
  return { ok: true, value: attachedFiles };
}

function listJobFilesHandler(req: Request, res: import('express').Response) {
  const slug = typeof req.query.jobDir === 'string' ? req.query.jobDir : '';
  if (!slug) {
    res.status(400).json({ error: 'jobDir required' });
    return;
  }
  const resolved = resolveJobDir(slug);
  const realResolved = safeRealpath(resolved);
  const realJobs = ensureJobsRootRealpath();
  if (!realResolved || !realJobs || !pathIsInsideDir(realResolved, realJobs)) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    res.status(404).json({ error: 'Job directory not found' });
    return;
  }
  const entries = fs.readdirSync(resolved, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile())
    .map((e) => {
      const full = path.join(resolved, e.name);
      const stat = fs.statSync(full);
      return { name: e.name, path: full, size: stat.size };
    });
  res.json({ files });
}

router.get('/listJobFiles', listJobFilesHandler);

function listJobDirsHandler(_req: Request, res: import('express').Response): void {
  const realJobsRoot = ensureJobsRootRealpath();
  if (!realJobsRoot) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }
  const dirs = listJobDirs(realJobsRoot);
  res.json({ dirs });
}

function listBackupsHandler(req: Request, res: import('express').Response): void {
  const slug = typeof req.query.jobDir === 'string' ? req.query.jobDir : '';
  if (!slug) {
    res.status(400).json({ error: 'jobDir required' });
    return;
  }
  const resolved = resolveJobDir(slug);
  const realResolved = safeRealpath(resolved);
  const realJobsRoot = ensureJobsRootRealpath();
  if (!realResolved || !realJobsRoot || !pathIsInsideDir(realResolved, realJobsRoot)) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    res.status(404).json({ error: 'Job directory not found' });
    return;
  }
  const structuredPath = path.join(resolved, 'structured-output.json');
  const hasCurrent = fs.existsSync(structuredPath);
  const backupsRoot = path.join(resolved, 'backups');
  const versions = listBackupVersions(backupsRoot);
  res.json({ versions, hasCurrent });
}

router.get('/listJobDirs', listJobDirsHandler);
router.get('/listBackups', listBackupsHandler);

function ensureRedactedResumeForJob(req: Request, res: import('express').Response): void {
  const validated = validateEnsureRedactedResumeRequest(req.body);
  if (isFailure(validated)) {
    res.status(validated.status).json({ error: validated.error });
    return;
  }
  try {
    const source = JSON.parse(fs.readFileSync(validated.value.resumePath, 'utf8')) as ResumeData;
    const result = ensureRedactedResumeFile(validated.value.jobDir, source);
    res.json({ path: result.path, wroteFile: result.wroteFile });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to ensure redacted resume';
    logError('ensureRedactedResume error:', err);
    res.status(500).json({ error: message });
  }
}

function validateEnsureRedactedResumeRequest(body: unknown): ValidationFailure | ValidationSuccess<{ jobDir: string; resumePath: string }> {
  const slug = typeof (body as { jobDir?: unknown })?.jobDir === 'string' ? (body as { jobDir: string }).jobDir : '';
  if (!slug) return { ok: false, status: 400, error: 'jobDir is required' };
  const jobDir = resolveJobDir(slug);
  const dirFailure = requireDir('Job directory', jobDir);
  if (dirFailure) return dirFailure;
  const resumePath = path.join(jobDir, 'structured-output.json');
  const resumeFailure = requireExists('structured-output.json', resumePath, 'structured-output.json not found in this job folder');
  if (resumeFailure) return resumeFailure;
  return { ok: true, value: { jobDir, resumePath } };
}

router.post('/ensureRedactedResume', ensureRedactedResumeForJob);

router.get('/redactedResumePath', (req, res) => {
  const slug = typeof req.query.jobDir === 'string' ? req.query.jobDir : '';
  if (!slug) {
    res.status(400).json({ error: 'jobDir is required' });
    return;
  }
  const jobDir = resolveJobDir(slug);
  if (!fs.existsSync(jobDir) || !fs.statSync(jobDir).isDirectory()) {
    res.status(404).json({ error: 'Job directory not found' });
    return;
  }
  const existing = loadRedactedResumeFromDir(jobDir);
  if (existing) {
    res.json({ path: path.join(jobDir, 'structured-output-redacted.json'), exists: true });
    return;
  }
  res.json({ path: null, exists: false });
});

type DiffResumeFormat = 'unified' | 'summary' | 'both' | 'word-diff';

type DiffResumeValidated = {
  realJobDir: string;
  jobDir: string;
  backupVersion: number;
  backupFile: string;
  currentFile: string;
  format: DiffResumeFormat;
};

function parseVersionString(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const match = raw.match(/^v([1-9]\d*)$/);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return Number.isFinite(n) ? n : null;
}

function resolveAllowedJobDir(queryJobDir: string): ValidationFailure | ValidationSuccess<{ realJobDir: string; backupsRoot: string }> {
  if (!queryJobDir) return { ok: false, status: 400, error: 'jobDir required' };
  const realJobDir = safeRealpath(resolveJobDir(queryJobDir));
  const realJobsRoot = ensureJobsRootRealpath();
  if (!realJobDir || !realJobsRoot) {
    return { ok: false, status: 500, error: 'Failed to resolve job directory' };
  }
  if (!pathIsInsideDir(realJobDir, realJobsRoot)) {
    return { ok: false, status: 400, error: 'jobDir escapes jobs root' };
  }
  return { ok: true, value: { realJobDir, backupsRoot: path.join(realJobDir, 'backups') } };
}

function resolveBackupVersion(backupsRoot: string, queryVersion: string | undefined): ValidationFailure | ValidationSuccess<number> {
  if (typeof queryVersion === 'string' && queryVersion !== '') {
    const parsed = parseVersionString(queryVersion);
    if (parsed === null) return { ok: false, status: 400, error: 'invalid version' };
    return { ok: true, value: parsed };
  }
  const latest = latestBackupVersion(backupsRoot);
  if (latest === null) return { ok: false, status: 404, error: 'Backup not found' };
  return { ok: true, value: latest };
}

const DIFF_FORMATS: ReadonlySet<DiffResumeFormat> = new Set(['unified', 'summary', 'both', 'word-diff']);

function resolveDiffFormat(raw: unknown): ValidationFailure | ValidationSuccess<DiffResumeFormat> {
  const formatRaw = typeof raw === 'string' ? raw : 'both';
  return DIFF_FORMATS.has(formatRaw as DiffResumeFormat)
    ? { ok: true, value: formatRaw as DiffResumeFormat }
    : { ok: false, status: 400, error: 'invalid format' };
}

function validateDiffResumeRequest(
  req: Request,
  queryJobDir: string,
  queryVersion: string | undefined
): ValidationFailure | ValidationSuccess<DiffResumeValidated> {
  const jobDirCheck = resolveAllowedJobDir(queryJobDir);
  if (isFailure(jobDirCheck)) return jobDirCheck;
  const versionCheck = resolveBackupVersion(jobDirCheck.value.backupsRoot, queryVersion);
  if (isFailure(versionCheck)) return versionCheck;
  const formatCheck = resolveDiffFormat(req.query.format);
  if (isFailure(formatCheck)) return formatCheck;
  const realJobDir = jobDirCheck.value.realJobDir;
  const backupsRoot = jobDirCheck.value.backupsRoot;
  const backupVersion = versionCheck.value;
  const format = formatCheck.value;
  const backupFile = path.join(backupsRoot, `v${backupVersion}`, 'structured-output.json');
  if (!fs.existsSync(backupFile)) {
    return { ok: false, status: 404, error: 'Backup not found' };
  }
  const currentFile = path.join(realJobDir, 'structured-output.json');
  if (!fs.existsSync(currentFile)) {
    return { ok: false, status: 404, error: 'Resume not found' };
  }
  return {
    ok: true,
    value: {
      realJobDir,
      jobDir: queryJobDir,
      backupVersion,
      backupFile,
      currentFile,
      format,
    },
  };
}

function diffResumeHandler(req: Request, res: import('express').Response): void {
  const queryJobDir = typeof req.query.jobDir === 'string' ? req.query.jobDir : '';
  const queryVersion = typeof req.query.version === 'string' ? req.query.version : undefined;
  const validated = validateDiffResumeRequest(req, queryJobDir, queryVersion);
  if (isFailure(validated)) {
    const err = validated.error;
    const includeLocator = err === 'Backup not found' || err === 'Resume not found' || err === 'invalid version';
    if (includeLocator) {
      res.status(validated.status).json({ error: err, jobDir: queryJobDir, version: queryVersion ?? null });
    } else {
      res.status(validated.status).json({ error: err });
    }
    return;
  }
  const v = validated.value;
  const backupParsed = JSON.parse(fs.readFileSync(v.backupFile, 'utf8'));
  const currentParsed = JSON.parse(fs.readFileSync(v.currentFile, 'utf8'));
  const backupPretty = JSON.stringify(backupParsed, null, 2);
  const currentPretty = JSON.stringify(currentParsed, null, 2);
  const response: Record<string, unknown> = {
    jobDir: v.jobDir,
    backupVersion: v.backupVersion,
    backupPath: v.backupFile,
    currentPath: v.currentFile,
  };
  if (v.format === 'unified' || v.format === 'both') {
    response.unifiedDiff = unifiedDiffText(backupPretty, currentPretty, `backup (v${v.backupVersion})`, 'current');
  }
  if (v.format === 'summary' || v.format === 'both') {
    response.summary = summariseJsonDiff(backupParsed, currentParsed);
  }
  if (v.format === 'word-diff') {
    response.wordDiffHtml = generateInlineDiff(backupPretty, currentPretty);
  }
  res.status(200).json(response);
}

router.get('/diffResume', diffResumeHandler);

function buildApplySuggestionsResult(result: Awaited<ReturnType<typeof applySuggestions>>) {
  return {
    pdfUrl: result.pdfUrl,
    sessionId: result.sessionId,
    webLink: buildOpencodeWebLink(result.sessionId),
    backupPath: result.backup.backupDir,
    backupVersion: result.backup.version,
  };
}

function runApplySuggestionsBackground(taskId: string, input: ApplySuggestionsServiceInput): void {
  (async () => {
    try {
      const result = await applySuggestions({
        jobDir: input.jobDir,
        userSuggestions: input.userSuggestions,
        attachedFiles: input.attachedFiles,
        resumePath: input.resumePath,
        redactedResumePath: input.redactedResumePath,
        modelSelect: input.modelSelect,
      });
      taskMap.set(taskId, {
        status: 'complete',
        startedAt: Date.now(),
        sessionId: result.sessionId,
        result: buildApplySuggestionsResult(result),
        step: 3,
        stepLabel: STEP_LABELS[3],
      });
    } catch (err) {
      if (err instanceof NoOpResultError) {
        log('applySuggestions task no-op:', taskId, 'backup:', err.backup.backupDir);
        taskMap.set(taskId, {
          status: 'error',
          error: 'no-op',
          startedAt: Date.now(),
          result: { backupPath: err.backup.backupDir, backupVersion: err.backup.version },
          step: 3,
          stepLabel: STEP_LABELS[3],
        });
        return;
      }
      const message = err instanceof Error ? err.message : 'Internal server error';
      logError('applySuggestions background error:', err);
      taskMap.set(taskId, { status: 'error', error: message, startedAt: Date.now(), step: 3, stepLabel: STEP_LABELS[3] });
    }
  })();
}

router.post('/applySuggestions', (req, res) => {
  const body = req.body as ApplySuggestionsRequestBody;
  const validated = validateApplySuggestionsRequest(body);
  if (isFailure(validated)) {
    res.status(validated.status).json({ error: validated.error });
    return;
  }
  const realJobDir = safeRealpath(validated.value.jobDir);
  const realJobsRoot = ensureJobsRootRealpath();
  if (!realJobDir || !realJobsRoot) {
    res.status(500).json({ error: 'Failed to resolve job directory' });
    return;
  }
  const attachedCheck = validateAttachedFilePaths(validated.value.rawAttached, realJobDir, realJobsRoot);
  if (isFailure(attachedCheck)) {
    res.status(attachedCheck.status).json({ error: attachedCheck.error });
    return;
  }
  const taskId = createTaskId();
  taskMap.set(taskId, { status: 'pending', startedAt: Date.now(), step: 3, stepLabel: STEP_LABELS[3] });
  res.json({ taskId, jobDir: body.jobDir });
  runApplySuggestionsBackground(taskId, {
    jobDir: validated.value.jobDir,
    slug: body.jobDir as string,
    userSuggestions: validated.value.userSuggestions,
    attachedFiles: attachedCheck.value,
    resumePath: validated.value.resumePath,
    redactedResumePath: validated.value.redactedResumePath,
    modelSelect: validated.value.modelSelect,
  });
});

type RunAtsBackgroundInput = {
  jobDir: string;
  atsKeywords?: string[];
  resumeJSON?: import('../services/types').ResumeData | null;
};

function runAtsBackground(taskId: string, input: RunAtsBackgroundInput): void {
  (async () => {
    try {
      const { runAtsAiAnalysis, buildAtsAnalysisMarkdown } = await import('../services/atsAiService.js');
      let resumeJSON = input.resumeJSON;
      let atsKeywords = input.atsKeywords || [];

      if (!resumeJSON) {
        const structuredPath = path.join(input.jobDir, 'structured-output.json');
        if (fs.existsSync(structuredPath)) {
          try {
            resumeJSON = JSON.parse(fs.readFileSync(structuredPath, 'utf8')) as import('../services/types').ResumeData;
          } catch (e) { /* ignore */ }
        }
      }

      if (atsKeywords.length === 0) {
        const atsJsonPath = path.join(input.jobDir, 'ats-analysis.json');
        if (fs.existsSync(atsJsonPath)) {
          try {
            const atsData = JSON.parse(fs.readFileSync(atsJsonPath, 'utf8'));
            atsKeywords = atsData.keywords || [];
          } catch (e) { /* ignore */ }
        }
      }

      let coveragePercent: number;
      try {
        const outcome = await runAtsAiAnalysis({
          jobDescription: '',
          resume: resumeJSON!,
          jdKeywords: atsKeywords,
          jobDir: input.jobDir,
        });
        coveragePercent = outcome.analysis.coveragePercent;
        saveJobFile(input.jobDir, 'ats-analysis.json', JSON.stringify(outcome.analysis, null, 2));
        saveJobFile(input.jobDir, 'ats-analysis.md', buildAtsAnalysisMarkdown(outcome.analysis));
      } catch (err) {
        logError('AtsBackground AI error, falling back to regex:', err);
        const fallback = analyzeATSKeywordsAgainstResume(atsKeywords, resumeJSON!);
        coveragePercent = fallback.coveragePercent;
        const atsAnalysis = { ...fallback, source: 'regex' as const };
        saveJobFile(input.jobDir, 'ats-analysis.json', JSON.stringify(atsAnalysis, null, 2));
        saveJobFile(input.jobDir, 'ats-analysis.md', buildAtsAnalysisMarkdown(atsAnalysis));
      }
      taskMap.set(taskId, {
        status: 'complete',
        startedAt: Date.now(),
        result: { coveragePercent },
        step: 4,
        stepLabel: STEP_LABELS[4],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      logError('ats background error:', err);
      taskMap.set(taskId, { status: 'error', error: message, startedAt: Date.now(), step: 4, stepLabel: STEP_LABELS[4] });
    }
  })();
}

router.post('/runAtsBackground', (req, res) => {
  const { jobDir, atsKeywords, resumeJSON } = req.body as RunAtsBackgroundInput;
  if (!jobDir || typeof jobDir !== 'string') {
    res.status(400).json({ error: 'jobDir is required' });
    return;
  }
  if (!Array.isArray(atsKeywords)) {
    res.status(400).json({ error: 'atsKeywords must be an array' });
    return;
  }
  const taskId = createTaskId();
  taskMap.set(taskId, { status: 'pending', startedAt: Date.now(), step: 4, stepLabel: STEP_LABELS[4] });
  res.json({ taskId });
  runAtsBackground(taskId, { jobDir, atsKeywords: atsKeywords || [], resumeJSON: resumeJSON || null });
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

function resolveCoverOutput(coverOutput: 'pdf' | 'txt' | 'both' | 'none' | '' | undefined): 'pdf' | 'txt' | 'both' | 'none' {
  if (coverOutput === 'pdf' || coverOutput === 'txt' || coverOutput === 'both' || coverOutput === 'none') {
    return coverOutput;
  }
  return 'both';
}

type CoverArtifactUrls = { coverTxtUrl?: string; coverPdfUrl?: string };

async function writeCoverLetterArtifacts(
  jobDir: string,
  coverLetterJSON: CoverLetterJSON,
  coverLatex: string,
  coverOutput: 'pdf' | 'txt' | 'both' | 'none'
): Promise<CoverArtifactUrls> {
  const urls: CoverArtifactUrls = {};
  if (coverOutput === 'txt' || coverOutput === 'both') {
    const txtContent = formatCoverLetterText(coverLetterJSON);
    saveJobFile(jobDir, 'cover-letter.txt', txtContent);
    urls.coverTxtUrl = `/jobs/${path.basename(jobDir)}/cover-letter.txt`;
  }
  if (coverOutput === 'pdf' || coverOutput === 'both') {
    const pdfBuffer = await compilePDF(coverLatex);
    saveJobFile(jobDir, 'cover-letter.pdf', pdfBuffer);
    urls.coverPdfUrl = `/jobs/${path.basename(jobDir)}/cover-letter.pdf`;
  }
  return urls;
}

function buildGenerationOptions(body: GenerateRequestBody, jobDirPath: string) {
  return {
    lowTokenMode: Boolean(body.lowTokenMode),
    modelSelect: body.modelSelect,
    promptLogDir: jobDirPath,
    jobDir: jobDirPath,
    useStarMethodForGovtRoles: Boolean(body.useStarMethodForGovtRoles),
    resumeType: body.resumeType as 'software' | 'qa' | undefined,
    coverOutput: resolveCoverOutput(body.coverOutput),
  };
}

async function executeGeneration(
  jobDir: { jobDir: string; slug: string },
  options: ReturnType<typeof buildGenerationOptions>,
  input: { jobDescription?: string; companyName?: string; roleName?: string; extraNotes?: string;   coverOutput?: 'pdf' | 'txt' | 'both' | 'none' | ''; useCombinedGeneration?: boolean }
): Promise<{ result: Record<string, unknown>; sessionId: string; coverLetterSessionId?: string }> {
  const { jobDescription, companyName, roleName, extraNotes, useCombinedGeneration } = input;
  const coverOutput = resolveCoverOutput(input.coverOutput);

  let resumeJSON: ResumeData;
  let coverLetterJSON: CoverLetterJSON | undefined;
  let atsKeywords: string[] = [];
  let sessionId: string;
  let coverLetterSessionId: string | undefined;

  const context = { companyName: companyName ?? '', roleName: roleName ?? '', generateWithoutJD: false, promptLogDir: jobDir.jobDir, jobDir: jobDir.jobDir };

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

    const coverUrls = await writeCoverLetterArtifacts(jobDir.jobDir, coverLetterJSON, coverLatex, coverOutput);
    Object.assign(result, coverUrls);
  }

  if (atsKeywords.length > 0) {
    const { runAtsAiAnalysis, buildAtsAnalysisMarkdown } = await import('../services/atsAiService.js');
    let atsResult: { coveragePercent: number };
    let atsAnalysis: import('../services/types').ATSAnalysisResult | null = null;
    try {
      const outcome = await runAtsAiAnalysis({
        jobDescription: jobDescription ?? '',
        resume: resumeJSON,
        jdKeywords: atsKeywords,
        jobDir: jobDir.jobDir,
        modelOverride: options.modelSelect,
      });
      atsResult = { coveragePercent: outcome.analysis.coveragePercent };
      atsAnalysis = outcome.analysis;
    } catch (err) {
      logError('Post-generation ATS AI error, falling back to regex:', err);
      const fallback = analyzeATSKeywordsAgainstResume(atsKeywords, resumeJSON);
      atsResult = { coveragePercent: fallback.coveragePercent };
      atsAnalysis = { ...fallback, source: 'regex' };
    }
    result.atsCoverage = atsResult.coveragePercent;
    result.atsKeywords = atsKeywords;
    if (atsAnalysis) {
      saveJobFile(jobDir.jobDir, 'ats-analysis.json', JSON.stringify(atsAnalysis, null, 2));
      saveJobFile(jobDir.jobDir, 'ats-analysis.md', buildAtsAnalysisMarkdown(atsAnalysis));
    }
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
  modelSelect?: string;
}

async function executeATSAnalysis(input: ExecuteATSAnalysisInput): Promise<{ analysis: ATSAnalysisResult | null; error?: string }> {
  const { runATSAnalysis } = await import('../services/atsService.js');
  const outcome = await runATSAnalysis({
    folderPath: input.folderPath,
    resumeJSON: input.resumeJSON,
    jobDescription: input.jobDescription,
    atsKeywordsFromAI: input.atsKeywordsFromAI,
    lastGeneratedResumeJSON: input.lastGeneratedResumeJSON,
    modelSelect: input.modelSelect,
  });
  if (outcome.error) {
    return { analysis: null, error: outcome.error };
  }
  return { analysis: outcome.result };
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