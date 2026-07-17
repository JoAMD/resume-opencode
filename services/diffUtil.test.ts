import { describe, it, expect } from 'vitest';
import { canonicalize, resumesAreEqual, unifiedDiffText, summariseJsonDiff } from './diffUtil.js';

describe('canonicalize', () => {
  it('produces a stable string for an object regardless of key order', () => {
    expect(canonicalize({ a: 1, b: 2 })).toBe(canonicalize({ b: 2, a: 1 }));
  });

  it('handles null, primitives, and nested arrays', () => {
    expect(canonicalize(null)).toBe('null');
    expect(canonicalize(42)).toBe('42');
    expect(canonicalize('hi')).toBe('"hi"');
    expect(canonicalize([1, 2, 3])).toBe('[1,2,3]');
    expect(canonicalize([1, { b: 1, a: 2 }])).toBe(canonicalize([1, { a: 2, b: 1 }]));
  });
});

describe('resumesAreEqual', () => {
  it('returns true for objects with reordered keys', () => {
    const a = { name: 'a', skills: 'x' };
    const b = { skills: 'x', name: 'a' };
    expect(resumesAreEqual(a, b)).toBe(true);
  });

  it('returns false when a value differs', () => {
    const a = { name: 'a', skills: 'x' };
    const b = { name: 'a', skills: 'y' };
    expect(resumesAreEqual(a, b)).toBe(false);
  });

  it('returns false for arrays with reordered elements', () => {
    expect(resumesAreEqual({ arr: [1, 2, 3] }, { arr: [3, 2, 1] })).toBe(false);
  });
});

describe('unifiedDiffText', () => {
  it('returns empty string for identical inputs', () => {
    expect(unifiedDiffText('a\nb', 'a\nb', 'a', 'b')).toBe('');
  });

  it('returns a unified-diff block for known-changed inputs', () => {
    const a = 'a\nb\nc\n';
    const b = 'a\nB\nc\n';
    const out = unifiedDiffText(a, b, 'a', 'b');
    expect(out).toContain('--- a');
    expect(out).toContain('+++ b');
    expect(out).toContain('@@ -');
    expect(out).toContain('-b');
    expect(out).toContain('+B');
    expect(out).toContain(' a');
    expect(out).toContain(' c');
  });

  it('emits headers and hunk markers in the right order', () => {
    const a = 'x\ny\n';
    const b = 'x\nz\n';
    const out = unifiedDiffText(a, b, 'before', 'after');
    const lines = out.split('\n');
    expect(lines[0]).toBe('--- before');
    expect(lines[1]).toBe('+++ after');
    expect(lines[2].startsWith('@@ -')).toBe(true);
  });

  it('completes in under 50 ms on a ~30 KB input', () => {
    const line = 'a'.repeat(60);
    const big = (line + '\n').repeat(500);
    const start1 = performance.now();
    unifiedDiffText(big, big, 'a', 'b');
    const elapsedIdentical = performance.now() - start1;
    const modified = line + 'X\n' + (line + '\n').repeat(499);
    const start2 = performance.now();
    unifiedDiffText(big, modified, 'a', 'b');
    const elapsedChanged = performance.now() - start2;
    expect(elapsedIdentical).toBeLessThan(50);
    expect(elapsedChanged).toBeLessThan(50);
  });
});

describe('summariseJsonDiff', () => {
  it('reports an added key with its path', () => {
    const a = { x: 1 };
    const b = { x: 1, y: 2 };
    const r = summariseJsonDiff(a, b);
    expect(r.addedKeys).toContain('y');
    expect(r.removedKeys).toEqual([]);
  });

  it('reports a removed key with its path', () => {
    const a = { x: 1, y: 2 };
    const b = { x: 1 };
    const r = summariseJsonDiff(a, b);
    expect(r.removedKeys).toContain('y');
    expect(r.addedKeys).toEqual([]);
  });

  it('reports a changed scalar at a nested path', () => {
    const a = { contact: { email: 'a@x' } };
    const b = { contact: { email: 'b@x' } };
    const r = summariseJsonDiff(a, b);
    expect(r.changedPaths).toContain('contact.email');
    expect(r.addedKeys).toEqual([]);
    expect(r.removedKeys).toEqual([]);
  });
});
