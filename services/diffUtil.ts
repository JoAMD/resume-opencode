// services/diffUtil.ts — shared diff helpers for the in-app resume diff viewer (RESUME_DIFF_VIEWER_PLAN.md Step 1).

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
  const pair: LinePair = { before: a.split('\n'), after: b.split('\n') };
  const prefix = countCommonPrefix(pair);
  const suffix = countCommonSuffix(pair, prefix);
  const beforeMiddle = pair.before.slice(prefix, pair.before.length - suffix);
  const afterMiddle = pair.after.slice(prefix, pair.after.length - suffix);
  const header = `@@ -${prefix + 1},${beforeMiddle.length} +${prefix + 1},${afterMiddle.length} @@`;
  const out: string[] = [`--- ${labelA}`, `+++ ${labelB}`, header];
  for (const line of pair.before.slice(0, prefix)) out.push(` ${line}`);
  for (const line of beforeMiddle) out.push(`-${line}`);
  for (const line of afterMiddle) out.push(`+${line}`);
  for (const line of pair.before.slice(pair.before.length - suffix)) out.push(` ${line}`);
  return out.join('\n') + '\n';
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

export { canonicalize, resumesAreEqual, unifiedDiffText, summariseJsonDiff };
