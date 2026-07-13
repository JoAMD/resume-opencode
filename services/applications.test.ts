import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-opencode-applications-'));
vi.mock('../services/paths', () => ({
  findProjectRoot: () => tmpRoot,
}));

import {
  appendApplication,
  escapeCsvField,
  findApplications,
  formatLocalTimestamp,
  readApplications,
  writeLinkToJobDir,
} from '../services/applications.js';

beforeEach(() => {
  const jobsDir = path.join(tmpRoot, 'jobs');
  if (fs.existsSync(jobsDir)) {
    for (const entry of fs.readdirSync(jobsDir)) {
      fs.rmSync(path.join(jobsDir, entry), { recursive: true, force: true });
    }
  } else {
    fs.mkdirSync(jobsDir, { recursive: true });
  }
});

describe('formatLocalTimestamp', () => {
  it('formats YYYY-MM-DD HH:MM:SS in local time', () => {
    const d = new Date(2026, 6, 6, 9, 5, 7);
    expect(formatLocalTimestamp(d)).toBe('2026-07-06 09:05:07');
  });

  it('zero-pads single-digit fields', () => {
    const d = new Date(2026, 0, 3, 0, 0, 0);
    expect(formatLocalTimestamp(d)).toBe('2026-01-03 00:00:00');
  });
});

describe('escapeCsvField', () => {
  it('returns empty for empty/nullish input', () => {
    expect(escapeCsvField('')).toBe('');
    expect(escapeCsvField(undefined as unknown as string)).toBe('');
    expect(escapeCsvField(null as unknown as string)).toBe('');
  });

  it('passes simple values through', () => {
    expect(escapeCsvField('Acme Pty Ltd')).toBe('Acme Pty Ltd');
  });

  it('quotes fields with commas', () => {
    expect(escapeCsvField('Acme, Pty Ltd')).toBe('"Acme, Pty Ltd"');
  });

  it('quotes and doubles internal quotes', () => {
    expect(escapeCsvField('She said "hi"')).toBe('"She said ""hi"""');
  });

  it('quotes fields with newlines', () => {
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
  });
});

describe('appendApplication', () => {
  it('writes the header on first call and appends one row', () => {
    const result = appendApplication({
      company: 'Acme',
      role: 'Engineer',
      link: 'https://example.com/job/1',
      job_dir: 'acme-engineer-2026-07-06',
    });

    expect(result.appended).toBe(true);
    expect(result.reason).toBeUndefined();

    const csvPath = path.join(tmpRoot, 'jobs', 'applications.csv');
    const content = fs.readFileSync(csvPath, 'utf8');
    const lines = content.trim().split('\n');
    expect(lines[0]).toBe('applied_at,company,role,link,status,notes,job_dir');
    expect(lines[1]).toMatch(/^[^,]+,Acme,Engineer,https:\/\/example\.com\/job\/1,applied,,acme-engineer-2026-07-06$/);
    expect(lines.length).toBe(2);
  });

  it('refuses to append a second row with the same job_dir', () => {
    appendApplication({
      company: 'Acme',
      role: 'Engineer',
      link: 'https://example.com/job/1',
      job_dir: 'acme-engineer-2026-07-06',
    });
    const second = appendApplication({
      company: 'Acme',
      role: 'Engineer',
      link: 'https://example.com/job/1-different',
      job_dir: 'acme-engineer-2026-07-06',
    });

    expect(second.appended).toBe(false);
    expect(second.reason).toBe('duplicate-job-dir');

    const csvPath = path.join(tmpRoot, 'jobs', 'applications.csv');
    const lines = fs.readFileSync(csvPath, 'utf8').trim().split('\n');
    expect(lines.length).toBe(2);
  });

  it('refuses to append when job_dir is missing', () => {
    const result = appendApplication({
      company: 'Acme',
      role: 'Engineer',
      link: '',
      job_dir: '',
    });
    expect(result.appended).toBe(false);
    expect(result.reason).toBe('no-job-dir');
    expect(fs.existsSync(path.join(tmpRoot, 'jobs', 'applications.csv'))).toBe(false);
  });

  it('uses the supplied status and notes when provided', () => {
    appendApplication({
      company: 'Acme',
      role: 'Engineer',
      link: '',
      job_dir: 'job-1',
      status: 'rejected',
      notes: 'not a fit',
    });
    const rows = readApplications();
    expect(rows[0].status).toBe('rejected');
    expect(rows[0].notes).toBe('not a fit');
  });

  it('handles a link with commas in it (rare but real)', () => {
    appendApplication({
      company: 'Acme',
      role: 'Engineer',
      link: 'https://example.com/job?id=1,2',
      job_dir: 'job-1',
    });
    const rows = readApplications();
    expect(rows[0].link).toBe('https://example.com/job?id=1,2');
  });
});

describe('findApplications', () => {
  beforeEach(() => {
    appendApplication({
      company: 'Acme Pty Ltd',
      role: 'Senior Engineer',
      link: 'https://seek.example/job/1',
      job_dir: 'acme-1',
    });
    appendApplication({
      company: 'Globex',
      role: 'Junior Engineer',
      link: 'https://seek.example/job/2',
      job_dir: 'globex-1',
    });
  });

  it('matches by exact link', () => {
    const result = findApplications({ link: 'https://seek.example/job/2' });
    expect(result?.matchedBy).toBe('link');
    expect(result?.partialMatch).toBe(false);
    expect(result?.row.job_dir).toBe('globex-1');
  });

  it('falls back to case-insensitive company+role when no link match', () => {
    const result = findApplications({
      link: 'https://seek.example/no-such-job',
      company: 'ACME PTY LTD',
      role: 'senior engineer',
    });
    expect(result?.matchedBy).toBe('company-role');
    expect(result?.partialMatch).toBe(false);
    expect(result?.row.job_dir).toBe('acme-1');
  });

  it('link match wins over company+role when both could match different rows', () => {
    const result = findApplications({
      link: 'https://seek.example/job/1',
      company: 'Globex',
      role: 'Junior Engineer',
    });
    expect(result?.matchedBy).toBe('link');
    expect(result?.partialMatch).toBe(false);
    expect(result?.row.job_dir).toBe('acme-1');
  });

  it('returns company-only partial match when role differs', () => {
    const result = findApplications({
      company: 'acme pty ltd',
      role: 'Staff Engineer',
    });
    expect(result?.matchedBy).toBe('company');
    expect(result?.partialMatch).toBe(true);
    expect(result?.row.job_dir).toBe('acme-1');
  });

  it('company+role exact match wins over company-only partial match', () => {
    const result = findApplications({
      company: 'Acme Pty Ltd',
      role: 'Senior Engineer',
    });
    expect(result?.matchedBy).toBe('company-role');
    expect(result?.partialMatch).toBe(false);
    expect(result?.row.job_dir).toBe('acme-1');
  });

  it('returns null when no row matches', () => {
    const result = findApplications({ link: 'https://nope' });
    expect(result).toBeNull();
  });
});

describe('writeLinkToJobDir', () => {
  it('writes link.txt with the supplied link', () => {
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'job-'));
    writeLinkToJobDir(dir, 'https://seek.example/job/3');
    expect(fs.readFileSync(path.join(dir, 'link.txt'), 'utf8')).toBe('https://seek.example/job/3');
  });

  it('does nothing when link is empty', () => {
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'job-'));
    writeLinkToJobDir(dir, '');
    expect(fs.existsSync(path.join(dir, 'link.txt'))).toBe(false);
  });
});
