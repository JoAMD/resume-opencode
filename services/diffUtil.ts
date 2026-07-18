// services/diffUtil.ts — shared diff helpers for the in-app resume diff viewer (RESUME_DIFF_VIEWER_PLAN.md Step 1).
import { structuredPatch, diffWords } from 'diff';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

function resumesAreEqual(a: unknown, b: unknown): boolean {
  return canonicalize(a) === canonicalize(b);
}

interface LinePair {
  before: string[];
  after: string[];
}

function countCommonPrefix(pair: LinePair): number {
  const limit = Math.min(pair.before.length, pair.after.length);
  let n = 0;
  while (n < limit && pair.before[n] === pair.after[n]) n++;
  return n;
}

function countCommonSuffix(pair: LinePair, prefix: number): number {
  const beforeTail = pair.before.length - prefix;
  const afterTail = pair.after.length - prefix;
  const limit = Math.min(beforeTail, afterTail);
  let n = 0;
  while (n < limit && pair.before[pair.before.length - 1 - n] === pair.after[pair.after.length - 1 - n]) n++;
  return n;
}

function unifiedDiffText(a: string, b: string, labelA: string, labelB: string): string {
  if (a === b) return '';
  const result = structuredPatch(labelA, labelB, a, b, '', '', { context: 3 });
  if (!result.hunks || result.hunks.length === 0) {
    return '';
  }
  const header = `--- ${labelA}\n+++ ${labelB}\n`;
  const hunks = result.hunks.map((hunk) => {
    const hunkLines = hunk.lines.map((line) => {
      const prefix = line[0];
      const content = line.slice(1);
      if (prefix === '-') return `-${content}`;
      if (prefix === '+') return `+${content}`;
      return ` ${content}`;
    }).join('\n');
    return `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n${hunkLines}`;
  }).join('\n');
  return header + hunks + '\n';
}

function generateInlineDiff(oldStr: string, newStr: string): string {
  if (oldStr === newStr) {
    return escapeHtml(newStr);
  }
  const changes = diffWords(oldStr, newStr);
  return changes.map((part) => {
    if (part.added) {
      return `<span class="word-added">${escapeHtml(part.value)}</span>`;
    }
    if (part.removed) {
      return `<span class="word-removed">${escapeHtml(part.value)}</span>`;
    }
    return escapeHtml(part.value);
  }).join('');
}

interface DiffSummary {
  changedPaths: string[];
  addedKeys: string[];
  removedKeys: string[];
}

interface WalkContext {
  prefix: string;
  acc: DiffSummary;
}

function joinPath(base: string, key: string): string {
  return base === '' ? key : `${base}.${key}`;
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function pushRemovedKeys(aRec: Record<string, unknown>, bRec: Record<string, unknown>, ctx: WalkContext): void {
  for (const k of Object.keys(aRec)) {
    if (!(k in bRec)) ctx.acc.removedKeys.push(joinPath(ctx.prefix, k));
  }
}

function pushAddedKeys(aRec: Record<string, unknown>, bRec: Record<string, unknown>, ctx: WalkContext): void {
  for (const k of Object.keys(bRec)) {
    if (!(k in aRec)) ctx.acc.addedKeys.push(joinPath(ctx.prefix, k));
  }
}

function recurseSharedKeys(aRec: Record<string, unknown>, bRec: Record<string, unknown>, ctx: WalkContext): void {
  for (const k of Object.keys(aRec)) {
    if (k in bRec) walk(aRec[k], bRec[k], { prefix: joinPath(ctx.prefix, k), acc: ctx.acc });
  }
}

function walkObjectDiff(aRec: Record<string, unknown>, bRec: Record<string, unknown>, ctx: WalkContext): void {
  pushRemovedKeys(aRec, bRec, ctx);
  pushAddedKeys(aRec, bRec, ctx);
  recurseSharedKeys(aRec, bRec, ctx);
}

function walkArrayDiff(aArr: unknown[], bArr: unknown[], ctx: WalkContext): void {
  if (aArr.length !== bArr.length) {
    ctx.acc.changedPaths.push(ctx.prefix);
    return;
  }
  for (let i = 0; i < aArr.length; i++) {
    walk(aArr[i], bArr[i], { prefix: joinPath(ctx.prefix, String(i)), acc: ctx.acc });
  }
}

function walk(aVal: unknown, bVal: unknown, ctx: WalkContext): void {
  if (isPlainRecord(aVal) && isPlainRecord(bVal)) {
    walkObjectDiff(aVal, bVal, ctx);
    return;
  }
  if (Array.isArray(aVal) && Array.isArray(bVal)) {
    walkArrayDiff(aVal, bVal, ctx);
    return;
  }
  if (aVal !== bVal) ctx.acc.changedPaths.push(ctx.prefix);
}

function summariseJsonDiff(a: unknown, b: unknown): DiffSummary {
  const acc: DiffSummary = { changedPaths: [], addedKeys: [], removedKeys: [] };
  walk(a, b, { prefix: '', acc });
  return acc;
}

export { canonicalize, resumesAreEqual, unifiedDiffText, summariseJsonDiff, generateInlineDiff };
