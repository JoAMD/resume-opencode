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

function resolveAttachedFileMap(attachedFiles: AttachedFile[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of attachedFiles) {
    map.set(f.name, safeReadFile(f.path));
  }
  return map;
}

function buildUserContent(input: ApplySuggestionsInput, fileContents: Map<string, string>): string {
  const blocks: string[] = [];
  blocks.push(`USER SUGGESTIONS:\n${input.userSuggestions.trim()}`);
  blocks.push('');

  const order = ['job-description.txt', 'full-jd.txt', 'other-input.txt', 'ats-analysis.md'];
  const included = new Set<string>();
  for (const name of order) {
    if (fileContents.has(name)) {
      blocks.push(`${name.toUpperCase()}:\n${fileContents.get(name)}`);
      blocks.push('');
      included.add(name);
    }
  }
  for (const [name, content] of fileContents.entries()) {
    if (included.has(name)) continue;
    if (name === 'structured-output.json') continue;
    blocks.push(`${name.toUpperCase()}:\n${content}`);
    blocks.push('');
  }

  blocks.push(`RESUME PATH: ${input.resumePath}`);
  blocks.push(`(The model should read the file at this path before editing.)`);
  return blocks.join('\n');
}

function asResumeData(value: unknown): ResumeData {
  if (!value || typeof value !== 'object') {
    throw new InvalidResponseError('structured response was not an object');
  }
  const r = value as Record<string, unknown>;
  if (typeof r.name !== 'string' || typeof r.summary !== 'string') {
    throw new InvalidResponseError('missing or non-string "name" / "summary" in structured response');
  }
  if (!r.skills || typeof r.skills !== 'object') {
    throw new InvalidResponseError('missing "skills" object in structured response');
  }
  if (!Array.isArray(r.experience) || !Array.isArray(r.education) || !Array.isArray(r.projects)) {
    throw new InvalidResponseError('missing or non-array "experience" / "education" / "projects" in structured response');
  }
  return value as ResumeData;
}

export async function applySuggestions(input: ApplySuggestionsInput): Promise<ApplySuggestionsResult> {
  if (!input.jobDir || !fs.existsSync(input.jobDir)) {
    throw new Error(`jobDir does not exist: ${input.jobDir}`);
  }
  if (!fs.existsSync(input.resumePath)) {
    throw new Error(`resumePath does not exist: ${input.resumePath}`);
  }
  if (!input.userSuggestions?.trim()) {
    throw new Error('userSuggestions is required');
  }

  const backup = createVersionedBackup(input.jobDir, 'resume');
  const currentResumeJson = JSON.parse(safeReadFile(input.resumePath));
  const fileContents = resolveAttachedFileMap(input.attachedFiles);

  const model = input.modelSelect;
  const promptLogDir = input.promptLogDir || path.join(input.jobDir, 'prompt-logs', 'fix-suggestions');
  const userContent = buildUserContent(input, fileContents)
    .replace(RESUME_PATH_PLACEHOLDER, input.resumePath);

  log('applySuggestions: starting first attempt, model:', model ?? '<env default>');

  const first = await enqueueAIRequest(model || 'opencode-go/minimax-m3', () =>
    runOpenCode({
      systemPrompt: FIX_SUGGESTIONS_PROMPT(),
      userContent,
      model,
      promptLogDir,
    })
  );

  let newResume = asResumeData(first.structured);
  let lastSessionId = first.sessionId;

  if (resumesAreEqual(currentResumeJson, newResume)) {
    log('applySuggestions: first attempt was a no-op; retrying once with follow-up');
    const retryUserContent = `${userContent}\n\n---\nFOLLOW-UP: Your previous response did not actually modify the resume. Read the file at ${input.resumePath} again and make concrete, visible edits to the summary, skills, or bullets that align with the user's suggestions above. Return the FULL revised JSON object.`;
    const second = await enqueueAIRequest(model || 'opencode-go/minimax-m3', () =>
      runOpenCode({
        systemPrompt: FIX_SUGGESTIONS_PROMPT(),
        userContent: retryUserContent,
        model,
        promptLogDir,
      })
    );
    newResume = asResumeData(second.structured);
    lastSessionId = second.sessionId;

    if (resumesAreEqual(currentResumeJson, newResume)) {
      logError('applySuggestions: retry was also a no-op; surfacing no-op error');
      throw new NoOpResultError(backup);
    }
  }

  const latexSource = buildLatex(newResume);
  const pdfBuffer = await compilePDF(latexSource);

  fs.writeFileSync(path.join(input.jobDir, 'structured-output.json'), JSON.stringify(newResume, null, 2), 'utf8');
  fs.writeFileSync(path.join(input.jobDir, 'resume.tex'), latexSource, 'utf8');
  fs.writeFileSync(path.join(input.jobDir, 'resume.pdf'), pdfBuffer);

  const slug = path.basename(input.jobDir);
  return {
    resume: newResume,
    pdfUrl: `/jobs/${slug}/resume.pdf`,
    sessionId: lastSessionId ?? '',
    backup,
  };
}
