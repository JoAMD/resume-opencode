import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-opencode-jd-search-'));
vi.mock('../services/paths', () => ({
  findProjectRoot: () => tmpRoot,
}));

import {
  searchJobDescriptions,
  SEARCH_MODES,
} from '../services/jobDescriptionSearch.js';

const jobsDir = path.join(tmpRoot, 'jobs');

function makeJobDir(slug: string, opts: { jd?: string; fullJd?: string; mtimeMs?: number } = {}): string {
  const dir = path.join(jobsDir, slug);
  fs.mkdirSync(dir, { recursive: true });
  if (opts.jd !== undefined) {
    fs.writeFileSync(path.join(dir, 'job-description.txt'), opts.jd, 'utf8');
  }
  if (opts.fullJd !== undefined) {
    fs.writeFileSync(path.join(dir, 'full-jd.txt'), opts.fullJd, 'utf8');
  }
  if (opts.mtimeMs !== undefined) {
    const targets = [path.join(dir, 'job-description.txt'), path.join(dir, 'full-jd.txt')];
    for (const t of targets) {
      if (fs.existsSync(t)) fs.utimesSync(t, new Date(opts.mtimeMs), new Date(opts.mtimeMs));
    }
  }
  return dir;
}

function makeNestedJobDir(group: string, slug: string, opts: { jd?: string; fullJd?: string; mtimeMs?: number } = {}): string {
  const dir = path.join(jobsDir, group, slug);
  fs.mkdirSync(dir, { recursive: true });
  if (opts.jd !== undefined) {
    fs.writeFileSync(path.join(dir, 'job-description.txt'), opts.jd, 'utf8');
  }
  if (opts.fullJd !== undefined) {
    fs.writeFileSync(path.join(dir, 'full-jd.txt'), opts.fullJd, 'utf8');
  }
  if (opts.mtimeMs !== undefined) {
    const targets = [path.join(dir, 'job-description.txt'), path.join(dir, 'full-jd.txt')];
    for (const t of targets) {
      if (fs.existsSync(t)) fs.utimesSync(t, new Date(opts.mtimeMs), new Date(opts.mtimeMs));
    }
  }
  return dir;
}

beforeEach(() => {
  if (fs.existsSync(jobsDir)) {
    for (const entry of fs.readdirSync(jobsDir)) {
      fs.rmSync(path.join(jobsDir, entry), { recursive: true, force: true });
    }
  } else {
    fs.mkdirSync(jobsDir, { recursive: true });
  }
});

describe('SEARCH_MODES', () => {
  it('exposes the two supported mode names', () => {
    expect(SEARCH_MODES).toEqual(['all-words-AND', 'exact-substring']);
  });
});

describe('searchJobDescriptions — guards', () => {
  it('returns [] for empty text', () => {
    makeJobDir('a', { jd: 'software engineer' });
    expect(searchJobDescriptions({ text: '', jobsDir })).toEqual([]);
  });

  it('returns [] for whitespace-only text', () => {
    makeJobDir('a', { jd: 'software engineer' });
    expect(searchJobDescriptions({ text: '   \t\n  ', jobsDir })).toEqual([]);
  });

  it('returns [] when jobsDir does not exist', () => {
    const missing = path.join(tmpRoot, 'does-not-exist');
    expect(searchJobDescriptions({ text: 'software', jobsDir: missing })).toEqual([]);
  });

  it('skips non-directory entries inside jobsDir', () => {
    fs.writeFileSync(path.join(jobsDir, 'stray.txt'), 'software', 'utf8');
    expect(searchJobDescriptions({ text: 'software', jobsDir })).toEqual([]);
  });
});

describe("searchJobDescriptions — 'all-words-AND' mode", () => {
  it('matches when a single word is present (case-insensitive)', () => {
    makeJobDir('a', { jd: 'We are hiring a Software Engineer in Adelaide.' });
    const hits = searchJobDescriptions({ text: 'software', mode: 'all-words-AND', jobsDir });
    expect(hits).toHaveLength(1);
    expect(hits[0].jobDir).toBe('a');
    expect(hits[0].matchedFile).toBe('job-description.txt');
    expect(hits[0].snippet.toLowerCase()).toContain('software');
  });

  it('requires every whitespace-separated token to be present', () => {
    makeJobDir('hit', { jd: 'Senior Software Engineer based in Adelaide.' });
    makeJobDir('miss', { jd: 'Senior Software Engineer based in Melbourne.' });
    const hits = searchJobDescriptions({ text: 'senior software adelaide', mode: 'all-words-AND', jobsDir });
    expect(hits.map((h) => h.jobDir)).toEqual(['hit']);
  });

  it('rejects when any token is missing', () => {
    makeJobDir('a', { jd: 'Senior Software Engineer.' });
    const hits = searchJobDescriptions({ text: 'senior chef', mode: 'all-words-AND', jobsDir });
    expect(hits).toEqual([]);
  });

  it('matches case-insensitively', () => {
    makeJobDir('a', { jd: 'SOFTWARE engineer' });
    const hits = searchJobDescriptions({ text: 'software', mode: 'all-words-AND', jobsDir });
    expect(hits).toHaveLength(1);
  });

  it('centres the snippet on the first matched token', () => {
    const jd = 'Intro paragraph.\n\nLooking for a senior software engineer with cloud experience.\n\nMore text.';
    makeJobDir('a', { jd });
    const hits = searchJobDescriptions({ text: 'senior', mode: 'all-words-AND', jobsDir });
    expect(hits[0].snippet.toLowerCase()).toContain('senior');
  });
});

describe("searchJobDescriptions — 'exact-substring' mode", () => {
  it('matches when the literal phrase is present (case-insensitive)', () => {
    makeJobDir('a', { jd: 'We are looking for a Senior Software Engineer.' });
    const hits = searchJobDescriptions({
      text: 'senior software engineer',
      mode: 'exact-substring',
      jobsDir,
    });
    expect(hits).toHaveLength(1);
  });

  it('does not match when only individual words are present', () => {
    makeJobDir('a', { jd: 'Senior then Software then Engineer, but not together.' });
    const hits = searchJobDescriptions({
      text: 'senior software engineer',
      mode: 'exact-substring',
      jobsDir,
    });
    expect(hits).toEqual([]);
  });

  it('is case-insensitive', () => {
    makeJobDir('a', { jd: 'SENIOR SOFTWARE ENGINEER wanted.' });
    const hits = searchJobDescriptions({
      text: 'senior software engineer',
      mode: 'exact-substring',
      jobsDir,
    });
    expect(hits).toHaveLength(1);
  });

  it('centres the snippet on the matched phrase', () => {
    const jd = 'Intro line.\n\nWe need a senior software engineer with cloud.\n\nOutro line.';
    makeJobDir('a', { jd });
    const hits = searchJobDescriptions({
      text: 'senior software engineer',
      mode: 'exact-substring',
      jobsDir,
    });
    expect(hits[0].snippet.toLowerCase()).toContain('senior software engineer');
  });
});

describe('searchJobDescriptions — file scope', () => {
  it('hits job-description.txt when present', () => {
    makeJobDir('a', { jd: 'software engineer wanted' });
    const hits = searchJobDescriptions({ text: 'software', mode: 'all-words-AND', jobsDir });
    expect(hits).toHaveLength(1);
    expect(hits[0].matchedFile).toBe('job-description.txt');
  });

  it('hits full-jd.txt when present and job-description.txt is missing', () => {
    makeJobDir('a', { fullJd: 'software engineer wanted in the longer JD' });
    const hits = searchJobDescriptions({ text: 'software', mode: 'all-words-AND', jobsDir });
    expect(hits).toHaveLength(1);
    expect(hits[0].matchedFile).toBe('full-jd.txt');
  });

  it('produces two hits per folder when both files are present and both match', () => {
    makeJobDir('a', { jd: 'short software JD', fullJd: 'long software JD with more words' });
    const hits = searchJobDescriptions({ text: 'software', mode: 'all-words-AND', jobsDir });
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.matchedFile).sort()).toEqual(['full-jd.txt', 'job-description.txt']);
  });

  it('produces no hit when neither file is present', () => {
    makeJobDir('a');
    const hits = searchJobDescriptions({ text: 'software', mode: 'all-words-AND', jobsDir });
    expect(hits).toEqual([]);
  });
});

describe('searchJobDescriptions — limit + ordering', () => {
  it('caps results at the supplied limit', () => {
    for (let i = 0; i < 5; i++) makeJobDir(`job-${i}`, { jd: `software engineer ${i}` });
    const hits = searchJobDescriptions({ text: 'software', mode: 'all-words-AND', jobsDir, limit: 3 });
    expect(hits).toHaveLength(3);
  });

  it('defaults to 50 when limit is not supplied', () => {
    for (let i = 0; i < 60; i++) makeJobDir(`job-${i}`, { jd: `software ${i}` });
    const hits = searchJobDescriptions({ text: 'software', mode: 'all-words-AND', jobsDir });
    expect(hits).toHaveLength(50);
  });

  it('clamps limit to a sane upper bound', () => {
    for (let i = 0; i < 3; i++) makeJobDir(`job-${i}`, { jd: `software ${i}` });
    const hits = searchJobDescriptions({ text: 'software', mode: 'all-words-AND', jobsDir, limit: 9999 });
    expect(hits.length).toBeLessThanOrEqual(200);
    expect(hits).toHaveLength(3);
  });

  it('sorts hits by mtimeMs descending (newer first)', () => {
    const older = makeJobDir('older', { jd: 'software' });
    const newer = makeJobDir('newer', { jd: 'software' });
    fs.utimesSync(path.join(older, 'job-description.txt'), new Date(1000), new Date(1000));
    fs.utimesSync(path.join(newer, 'job-description.txt'), new Date(2000), new Date(2000));
    const hits = searchJobDescriptions({ text: 'software', mode: 'all-words-AND', jobsDir });
    expect(hits[0].jobDir).toBe('newer');
    expect(hits[1].jobDir).toBe('older');
  });
});

describe('searchJobDescriptions — depth-1 recursion (jobs/<group>/<slug>/)', () => {
  it('finds JD content under jobs/<group>/<slug>/job-description.txt', () => {
    makeNestedJobDir('previous', 'a', { jd: 'software engineer wanted' });
    const hits = searchJobDescriptions({ text: 'software', mode: 'all-words-AND', jobsDir });
    expect(hits).toHaveLength(1);
    expect(hits[0].jobDir).toBe('a');
    expect(hits[0].rootName).toBe('previous');
    expect(hits[0].matchedFile).toBe('job-description.txt');
  });

  it('tags top-level hits with no rootName and nested hits with the group name', () => {
    makeJobDir('top', { jd: 'software engineer' });
    makeNestedJobDir('previous', 'nested', { jd: 'software engineer' });
    const hits = searchJobDescriptions({ text: 'software', mode: 'all-words-AND', jobsDir });
    expect(hits).toHaveLength(2);
    const top = hits.find((h) => h.jobDir === 'top');
    const nested = hits.find((h) => h.jobDir === 'nested');
    expect(top?.rootName).toBeUndefined();
    expect(nested?.rootName).toBe('previous');
  });

  it('does NOT recurse into a subdir that already has JD files (it is a job folder)', () => {
    makeJobDir('looks-like-group', { jd: 'senior engineer wanted' });
    fs.mkdirSync(path.join(jobsDir, 'looks-like-group', 'inner'), { recursive: true });
    fs.writeFileSync(path.join(jobsDir, 'looks-like-group', 'inner', 'job-description.txt'), 'software', 'utf8');
    const hits = searchJobDescriptions({ text: 'senior', mode: 'all-words-AND', jobsDir });
    expect(hits).toHaveLength(1);
    expect(hits[0].jobDir).toBe('looks-like-group');
    expect(hits[0].rootName).toBeUndefined();
    const innerHits = searchJobDescriptions({ text: 'software', mode: 'all-words-AND', jobsDir });
    expect(innerHits).toEqual([]);
  });

  it('does NOT recurse beyond depth 1 (jobs/<a>/<b>/<c>/ is invisible)', () => {
    makeNestedJobDir('group', 'leaf', { jd: 'surface level' });
    const deeper = path.join(jobsDir, 'group', 'leaf', 'deeper');
    fs.mkdirSync(deeper, { recursive: true });
    fs.writeFileSync(path.join(deeper, 'job-description.txt'), 'software engineer hidden', 'utf8');
    const hits = searchJobDescriptions({ text: 'hidden', mode: 'all-words-AND', jobsDir });
    expect(hits).toEqual([]);
  });

  it('searches both job-description.txt and full-jd.txt under a grouped folder', () => {
    makeNestedJobDir('previous', 'a', { jd: 'short jd no match', fullJd: 'long jd with software mention' });
    const hits = searchJobDescriptions({ text: 'software', mode: 'all-words-AND', jobsDir });
    expect(hits).toHaveLength(1);
    expect(hits[0].matchedFile).toBe('full-jd.txt');
    expect(hits[0].jobDir).toBe('a');
    expect(hits[0].rootName).toBe('previous');
  });

  it('mixed top-level + nested folders are merged in the same result list', () => {
    makeJobDir('top', { jd: 'software engineer alpha' });
    makeNestedJobDir('archive', 'old-1', { jd: 'software engineer beta' });
    makeNestedJobDir('archive', 'old-2', { jd: 'software engineer gamma' });
    const hits = searchJobDescriptions({ text: 'software', mode: 'all-words-AND', jobsDir });
    const byFolder = new Map(hits.map((h) => [h.jobDir, h]));
    expect(byFolder.get('top')?.rootName).toBeUndefined();
    expect(byFolder.get('old-1')?.rootName).toBe('archive');
    expect(byFolder.get('old-2')?.rootName).toBe('archive');
  });

  it('empty subdir under a group is silently skipped', () => {
    fs.mkdirSync(path.join(jobsDir, 'previous', 'empty'), { recursive: true });
    makeNestedJobDir('previous', 'real', { jd: 'software engineer' });
    const hits = searchJobDescriptions({ text: 'software', mode: 'all-words-AND', jobsDir });
    expect(hits).toHaveLength(1);
    expect(hits[0].jobDir).toBe('real');
  });
});
