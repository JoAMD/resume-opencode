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

export class InvalidResponseError extends Error {
  readonly code = 'invalid-response';
  constructor(detail: string) {
    super(`Invalid response from OpenCode: ${detail}`);
  }
}

const RESUME_PATH_PLACEHOLDER = '{RESUME_PATH}';
const ATTACHED_FILE_MAX_BYTES = 200_000;
const DEFAULT_MODEL = 'opencode-go/minimax-m3';
const FOLLOW_UP_INSTRUCTION =
  'Your previous response did not actually modify the resume. ' +
  'Read the file at {RESUME_PATH} again and make concrete, visible edits ' +
  'to the summary, skills, or bullets that align with the user\'s suggestions above. ' +
  'Return the FULL revised JSON object.';
const RESERVED_FILE_NAMES = new Set(['structured-output.json']);

const ATTACH_ORDER = ['job-description.txt', 'full-jd.txt', 'other-input.txt', 'ats-analysis.md'];

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
  blocks.push(`RESUME PATH: ${input.resumePath}`);
  blocks.push('(The model should read the file at this path before editing.)');
  return blocks.join('\n');
}

function isStringField(record: Record<string, unknown>, key: string): boolean {
  return typeof record[key] === 'string';
}

function isObjectField(record: Record<string, unknown>, key: string): boolean {
  return Boolean(record[key]) && typeof record[key] === 'object';
}

function isArrayField(record: Record<string, unknown>, key: string): boolean {
  return Array.isArray(record[key]);
}

type FieldType = 'string' | 'object' | 'array';
type FieldSpec = { key: string; type: FieldType };

const REQUIRED_RESUME_FIELDS: readonly FieldSpec[] = [
  { key: 'name', type: 'string' },
  { key: 'summary', type: 'string' },
  { key: 'skills', type: 'object' },
  { key: 'experience', type: 'array' },
  { key: 'education', type: 'array' },
  { key: 'projects', type: 'array' },
];

const TYPE_LABELS: Record<FieldType, string> = { string: 'string', object: 'object', array: 'array' };

function valueMatchesType(value: unknown, type: FieldType): boolean {
  if (type === 'string') return typeof value === 'string';
  if (type === 'object') return Boolean(value) && typeof value === 'object';
  return Array.isArray(value);
}

function checkField(r: Record<string, unknown>, spec: FieldSpec): void {
  if (!valueMatchesType(r[spec.key], spec.type)) {
    throw new InvalidResponseError(`missing or non-${TYPE_LABELS[spec.type]} "${spec.key}" in structured response`);
  }
}

function validateResumeShape(r: Record<string, unknown>): void {
  for (const spec of REQUIRED_RESUME_FIELDS) checkField(r, spec);
}

function asResumeData(value: unknown): ResumeData {
  if (!value || typeof value !== 'object') {
    throw new InvalidResponseError('structured response was not an object');
  }
  validateResumeShape(value as Record<string, unknown>);
  return value as ResumeData;
}

interface ModelAttempt {
  structured: unknown;
  sessionId?: string;
}

interface ModelContext {
  model: string | undefined;
  promptLogDir: string;
}

interface DiffContext {
  currentResumeJson: unknown;
  userContent: string;
  resumePath: string;
  modelCtx: ModelContext;
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

function buildRetryUserContent(userContent: string, resumePath: string): string {
  const followUp = FOLLOW_UP_INSTRUCTION.replace('{RESUME_PATH}', resumePath);
  return `${userContent}\n\n---\nFOLLOW-UP: ${followUp}`;
}

interface DiffOutcome {
  newResume: ResumeData;
  sessionId: string;
  noOp: boolean;
}

async function runWithNoOpRetry(ctx: DiffContext): Promise<DiffOutcome> {
  const first = await runModelAttempt(ctx.modelCtx, ctx.userContent);
  const firstResume = asResumeData(first.structured);
  if (!resumesAreEqual(ctx.currentResumeJson, firstResume)) {
    return { newResume: firstResume, sessionId: first.sessionId ?? '', noOp: false };
  }

  log('applySuggestions: first attempt was a no-op; retrying once with follow-up');
  const retryUserContent = buildRetryUserContent(ctx.userContent, ctx.resumePath);
  const second = await runModelAttempt(ctx.modelCtx, retryUserContent);
  const secondResume = asResumeData(second.structured);
  return { newResume: secondResume, sessionId: second.sessionId ?? '', noOp: resumesAreEqual(ctx.currentResumeJson, secondResume) };
}

async function writeOutputs(jobDir: string, resume: ResumeData): Promise<void> {
  const latexSource = buildLatex(resume);
  const pdfBuffer = await compilePDF(latexSource);
  fs.writeFileSync(path.join(jobDir, 'structured-output.json'), JSON.stringify(resume, null, 2), 'utf8');
  fs.writeFileSync(path.join(jobDir, 'resume.tex'), latexSource, 'utf8');
  fs.writeFileSync(path.join(jobDir, 'resume.pdf'), pdfBuffer);
}

export async function applySuggestions(input: ApplySuggestionsInput): Promise<ApplySuggestionsResult> {
  validateInput(input);

  const backup = createVersionedBackup(input.jobDir, 'resume');
  const currentResumeJson = JSON.parse(safeReadFile(input.resumePath));
  const fileContents = resolveAttachedFileMap(input.attachedFiles);
  const promptLogDir = input.promptLogDir || path.join(input.jobDir, 'prompt-logs', 'fix-suggestions');
  fs.mkdirSync(promptLogDir, { recursive: true });
  const userContent = buildUserContent(input, fileContents)
    .replace(RESUME_PATH_PLACEHOLDER, input.resumePath);

  log('applySuggestions: starting first attempt, model:', input.modelSelect ?? '<env default>');

  const outcome = await runWithNoOpRetry({
    currentResumeJson,
    userContent,
    resumePath: input.resumePath,
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
