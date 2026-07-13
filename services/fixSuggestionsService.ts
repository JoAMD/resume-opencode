import fs from 'fs';
import path from 'path';
import { enqueueAIRequest, runOpenCode, FIX_SUGGESTIONS_PROMPT } from './ai';
import { ResumeData } from './types';
import { buildLatex } from './latex';
import { compilePDF } from './compiler';
import { createVersionedBackup, BackupResult } from './backupService';
import { log, logError } from './logger';

export type AttachedFile = { name: string; path: string };

export interface ApplySuggestionsInput {
  jobDir: string;
  userSuggestions: string;
  attachedFiles: AttachedFile[];
  resumePath: string;
  redactedResumePath: string;
  modelSelect?: string;
  promptLogDir?: string;
}

export interface ApplySuggestionsResult {
  resume: ResumeData;
  pdfUrl: string;
  sessionId: string;
  backup: BackupResult;
}

export class NoOpResultError extends Error {
  readonly code = 'no-op';
  readonly backup: BackupResult;
  constructor(backup: BackupResult) {
    super('Model did not change the resume (no-op after retry)');
    this.backup = backup;
  }
}

const REDACTED_FILE_NAME = 'structured-output-redacted.json';
const RESUME_FILE_NAME = 'structured-output.json';
const ATTACHED_FILE_MAX_BYTES = 200_000;
const DEFAULT_MODEL = 'opencode-go/minimax-m3';
const RESERVED_FILE_NAMES = new Set([REDACTED_FILE_NAME, RESUME_FILE_NAME]);

const ATTACH_ORDER = ['job-description.txt', 'full-jd.txt', 'other-input.txt', 'ats-analysis.md'];

const NOOP_FOLLOWUP =
  'Your previous response did not actually modify the resume file. ' +
  'Use the opencode `edit` tool (NOT `write`) to apply the user\'s ' +
  'suggestions directly to the structured-output.json on disk. ' +
  'Make small, concrete edits (a few words or a bullet) and verify the ' +
  'file changed.';

function safeReadFile(filePath: string, maxBytes = ATTACHED_FILE_MAX_BYTES): string {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error(`Not a file: ${filePath}`);
  if (stat.size > maxBytes) {
    throw new Error(`Attached file too large (${stat.size} bytes, max ${maxBytes}): ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize((value as Record<string, unknown>)[k])).join(',') + '}';
}

export function resumesAreEqual(a: unknown, b: unknown): boolean {
  return canonicalize(a) === canonicalize(b);
}

function requireExists(label: string, filePath: string): void {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`${label} does not exist: ${filePath}`);
  }
}

function validateInput(input: ApplySuggestionsInput): void {
  requireExists('jobDir', input.jobDir);
  requireExists('resumePath', input.resumePath);
  requireExists('redactedResumePath', input.redactedResumePath);
  if (!input.userSuggestions?.trim()) {
    throw new Error('userSuggestions is required');
  }
}

function resolveAttachedFileMap(attachedFiles: AttachedFile[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of attachedFiles) {
    map.set(f.name, safeReadFile(f.path));
  }
  return map;
}

function appendAttachedBlock(blocks: string[], name: string, content: string): void {
  blocks.push(`${name.toUpperCase()}:\n${content}`);
  blocks.push('');
}

function appendOrderedAttachedBlocks(blocks: string[], fileContents: Map<string, string>): Set<string> {
  const included = new Set<string>();
  for (const name of ATTACH_ORDER) {
    const content = fileContents.get(name);
    if (content === undefined) continue;
    appendAttachedBlock(blocks, name, content);
    included.add(name);
  }
  return included;
}

function appendRemainingAttachedBlocks(blocks: string[], fileContents: Map<string, string>, excluded: Set<string>): void {
  for (const [name, content] of fileContents.entries()) {
    if (excluded.has(name) || RESERVED_FILE_NAMES.has(name)) continue;
    appendAttachedBlock(blocks, name, content);
  }
}

function buildUserContent(input: ApplySuggestionsInput, fileContents: Map<string, string>): string {
  const blocks: string[] = [];
  appendAttachedBlock(blocks, 'USER SUGGESTIONS', input.userSuggestions.trim());
  const included = appendOrderedAttachedBlocks(blocks, fileContents);
  appendRemainingAttachedBlocks(blocks, fileContents, included);
  blocks.push(`REDACTED RESUME (read this; PII already stripped): ${input.redactedResumePath}`);
  blocks.push(`REAL RESUME FILE TO EDIT IN PLACE: ${input.resumePath}`);
  blocks.push('Preserve every PII field (name, phone, email, linkedinUrl, linkedinDisplay) and the full education array. Only change the sections the user asked about.');
  return blocks.join('\n');
}

interface ModelContext {
  model: string | undefined;
  promptLogDir: string;
}

interface ModelAttempt {
  sessionId?: string;
}

async function runModelAttempt(modelCtx: ModelContext, userContent: string): Promise<ModelAttempt> {
  return enqueueAIRequest(modelCtx.model || DEFAULT_MODEL, () =>
    runOpenCode({
      systemPrompt: FIX_SUGGESTIONS_PROMPT(),
      userContent,
      model: modelCtx.model,
      promptLogDir: modelCtx.promptLogDir,
    })
  );
}

function buildRetryUserContent(userContent: string): string {
  return `${userContent}\n\n---\nFOLLOW-UP: ${NOOP_FOLLOWUP}`;
}

class ResumeFile {
  constructor(readonly path: string) {}
  read(): string { return fs.readFileSync(this.path, 'utf8'); }
  readJson(): ResumeData { return JSON.parse(this.read()) as ResumeData; }
  unchangedSince(snapshot: string): boolean {
    try { return this.read() === snapshot; } catch { return true; }
  }
  writeJson(resume: ResumeData): void {
    fs.writeFileSync(this.path, JSON.stringify(resume, null, 2), 'utf8');
  }
}

function snapshotResume(resume: ResumeFile): string {
  return resume.read();
}

interface DiffOutcome {
  newResume: ResumeData;
  sessionId: string;
  noOp: boolean;
}

async function runWithNoOpRetry(args: {
  before: string;
  resume: ResumeFile;
  userContent: string;
  modelCtx: ModelContext;
}): Promise<DiffOutcome> {
  const first = await runModelAttempt(args.modelCtx, args.userContent);
  if (!args.resume.unchangedSince(args.before)) {
    return { newResume: args.resume.readJson(), sessionId: first.sessionId ?? '', noOp: false };
  }

  log('applySuggestions: first attempt was a no-op; retrying once with follow-up');
  const retryUserContent = buildRetryUserContent(args.userContent);
  const second = await runModelAttempt(args.modelCtx, retryUserContent);
  return {
    newResume: args.resume.readJson(),
    sessionId: second.sessionId ?? first.sessionId ?? '',
    noOp: args.resume.unchangedSince(args.before),
  };
}

async function writeOutputs(jobDir: string, resume: ResumeData): Promise<void> {
  const latexSource = buildLatex(resume);
  const pdfBuffer = await compilePDF(latexSource);
  fs.writeFileSync(path.join(jobDir, RESUME_FILE_NAME), JSON.stringify(resume, null, 2), 'utf8');
  fs.writeFileSync(path.join(jobDir, 'resume.tex'), latexSource, 'utf8');
  fs.writeFileSync(path.join(jobDir, 'resume.pdf'), pdfBuffer);
}

export async function applySuggestions(input: ApplySuggestionsInput): Promise<ApplySuggestionsResult> {
  validateInput(input);

  const backup = createVersionedBackup(input.jobDir, 'resume');
  const resume = new ResumeFile(input.resumePath);
  const before = snapshotResume(resume);
  const fileContents = resolveAttachedFileMap(input.attachedFiles);
  const promptLogDir = input.promptLogDir || path.join(input.jobDir, 'prompt-logs', 'fix-suggestions');
  fs.mkdirSync(promptLogDir, { recursive: true });
  const userContent = buildUserContent(input, fileContents);

  log('applySuggestions: starting first attempt, model:', input.modelSelect ?? '<env default>');

  const outcome = await runWithNoOpRetry({
    before,
    resume,
    userContent,
    modelCtx: { model: input.modelSelect, promptLogDir },
  });

  if (outcome.noOp) {
    logError('applySuggestions: retry was also a no-op; surfacing no-op error');
    throw new NoOpResultError(backup);
  }

  await writeOutputs(input.jobDir, outcome.newResume);

  return {
    resume: outcome.newResume,
    pdfUrl: `/jobs/${path.basename(input.jobDir)}/resume.pdf`,
    sessionId: outcome.sessionId,
    backup,
  };
}
