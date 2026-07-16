import fs from 'fs';
import path from 'path';

export type SearchMode = 'all-words-AND' | 'exact-substring';

export const SEARCH_MODES: readonly SearchMode[] = ['all-words-AND', 'exact-substring'];

export type SearchedFile = 'job-description.txt' | 'full-jd.txt';

export interface SearchHit {
  jobDir: string;
  matchedFile: SearchedFile;
  snippet: string;
  mtimeMs: number;
}

export interface SearchInput {
  text: string;
  mode?: SearchMode;
  jobsDir: string;
  limit?: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const SNIPPET_HALF = 60;
const SNIPPET_MAX = 200;

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
  const n = Math.floor(limit as number);
  if (n < 1) return DEFAULT_LIMIT;
  if (n > MAX_LIMIT) return MAX_LIMIT;
  return n;
}

function normaliseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function firstIndex(haystack: string, needle: string): number {
  return haystack.indexOf(needle);
}

function firstIndexOfAnyToken(haystack: string, tokens: string[]): number {
  let best = -1;
  for (const t of tokens) {
    const idx = haystack.indexOf(t);
    if (idx === -1) continue;
    if (best === -1 || idx < best) best = idx;
  }
  return best;
}

function buildSnippet(content: string, matchIndex: number, matchLength: number): string {
  if (matchIndex < 0) return '';
  const start = Math.max(0, matchIndex - SNIPPET_HALF);
  const end = Math.min(content.length, matchIndex + matchLength + SNIPPET_HALF);
  const window = content.slice(start, end);
  const cleaned = normaliseWhitespace(window);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < content.length ? '…' : '';
  const combined = `${prefix}${cleaned}${suffix}`;
  if (combined.length <= SNIPPET_MAX) return combined;
  return combined.slice(0, SNIPPET_MAX - 1) + '…';
}

function allTokensPresent(haystack: string, tokens: string[]): boolean {
  for (const t of tokens) {
    if (!haystack.includes(t)) return false;
  }
  return true;
}

function evaluateFile(
  content: string,
  mode: SearchMode,
  query: string,
  tokens: string[]
): { matches: boolean; snippet: string } {
  const haystack = content.toLowerCase();
  if (mode === 'exact-substring') {
    if (!query) return { matches: false, snippet: '' };
    const idx = firstIndex(haystack, query);
    if (idx === -1) return { matches: false, snippet: '' };
    return { matches: true, snippet: buildSnippet(content, idx, query.length) };
  }
  if (tokens.length === 0) return { matches: false, snippet: '' };
  if (!allTokensPresent(haystack, tokens)) return { matches: false, snippet: '' };
  const idx = firstIndexOfAnyToken(haystack, tokens);
  const firstToken = tokens[0] ?? '';
  return { matches: true, snippet: buildSnippet(content, idx, firstToken.length) };
}

function tryHit(
  jobsDir: string,
  folder: string,
  file: SearchedFile,
  mode: SearchMode,
  query: string,
  tokens: string[]
): SearchHit | null {
  const filePath = path.join(jobsDir, folder, file);
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) return null;
  const content = fs.readFileSync(filePath, 'utf8');
  const { matches, snippet } = evaluateFile(content, mode, query, tokens);
  if (!matches) return null;
  return {
    jobDir: folder,
    matchedFile: file,
    snippet,
    mtimeMs: stat.mtimeMs,
  };
}

export function searchJobDescriptions(input: SearchInput): SearchHit[] {
  const text = (input.text ?? '').trim();
  const mode: SearchMode = input.mode ?? 'all-words-AND';
  const query = text.toLowerCase();
  const tokens = text.split(/\s+/).filter((t) => t.length > 0).map((t) => t.toLowerCase());
  const limit = clampLimit(input.limit);
  const jobsDir = input.jobsDir;

  if (!query) return [];
  if (!fs.existsSync(jobsDir)) return [];

  const folders = fs.readdirSync(jobsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const hits: SearchHit[] = [];
  for (const folder of folders) {
    const a = tryHit(jobsDir, folder, 'job-description.txt', mode, query, tokens);
    if (a) hits.push(a);
    const b = tryHit(jobsDir, folder, 'full-jd.txt', mode, query, tokens);
    if (b) hits.push(b);
  }

  hits.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return hits.slice(0, limit);
}
