import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const existsSync = vi.fn();
const mkdirSync = vi.fn();
const copyFileSync = vi.fn();
const readdirSync = vi.fn();
const statSync = vi.fn();

vi.mock('fs', () => ({
  default: {
    existsSync: (...args: unknown[]) => existsSync(...args),
    mkdirSync: (...args: unknown[]) => mkdirSync(...args),
    copyFileSync: (...args: unknown[]) => copyFileSync(...args),
    readdirSync: (...args: unknown[]) => readdirSync(...args),
    statSync: (...args: unknown[]) => statSync(...args),
  },
  existsSync: (...args: unknown[]) => existsSync(...args),
  mkdirSync: (...args: unknown[]) => mkdirSync(...args),
  copyFileSync: (...args: unknown[]) => copyFileSync(...args),
  readdirSync: (...args: unknown[]) => readdirSync(...args),
  statSync: (...args: unknown[]) => statSync(...args),
}));

vi.mock('../services/logger', () => ({
  log: vi.fn(),
  logError: vi.fn(),
}));

describe('createVersionedBackup', () => {
  beforeEach(() => {
    existsSync.mockReset();
    mkdirSync.mockReset();
    copyFileSync.mockReset();
    readdirSync.mockReset();
    statSync.mockReset();
    mkdirSync.mockImplementation(() => undefined);
    copyFileSync.mockImplementation(() => undefined);
  });

  it('creates v1 when no backups dir exists, copies resume files', async () => {
    const jobDir = '/tmp/opencode/job-x';
    const backupsRoot = path.join(jobDir, 'backups');
    existsSync.mockImplementation((p: unknown) => {
      if (p === jobDir) return true;
      if (p === backupsRoot) return false;
      const s = String(p);
      if (s === path.join(jobDir, 'structured-output.json')) return true;
      if (s === path.join(jobDir, 'resume.pdf')) return true;
      if (s === path.join(jobDir, 'resume.tex')) return true;
      if (s === path.join(jobDir, 'cover-letter.json')) return false;
      return false;
    });
    statSync.mockImplementation((p: unknown) => ({ isDirectory: () => p === jobDir, isFile: () => p !== jobDir }));

    const { createVersionedBackup } = await import('./backupService.js');
    const result = createVersionedBackup(jobDir, 'resume');

    expect(result.version).toBe(1);
    expect(result.backupDir).toBe(path.join(backupsRoot, 'v1'));
    expect(result.files.sort()).toEqual(['resume.pdf', 'resume.tex', 'structured-output.json']);
    expect(mkdirSync).toHaveBeenCalledWith(backupsRoot, { recursive: true });
    expect(mkdirSync).toHaveBeenCalledWith(result.backupDir, { recursive: true });
  });

  it('auto-increments to v2, v3 when previous versions exist', async () => {
    const jobDir = '/tmp/opencode/job-y';
    const backupsRoot = path.join(jobDir, 'backups');
    existsSync.mockImplementation((p: unknown) => {
      if (p === jobDir) return true;
      if (p === backupsRoot) return true;
      const s = String(p);
      if (s === path.join(jobDir, 'structured-output.json')) return true;
      if (s === path.join(jobDir, 'resume.pdf')) return true;
      return false;
    });
    statSync.mockImplementation((p: unknown) => ({ isDirectory: () => p === jobDir, isFile: () => p !== jobDir }));

    const readdirMock = (() => {
      let n = 0;
      return () => {
        n += 1;
        if (n === 1) return ['v1'];
        if (n === 2) return ['v1', 'v2'];
        return ['v1', 'v2', 'other-folder', 'v10'];
      };
    })();
    readdirSync.mockImplementation(readdirMock);

    const { createVersionedBackup } = await import('./backupService.js');
    const r1 = createVersionedBackup(jobDir, 'resume');
    const r2 = createVersionedBackup(jobDir, 'resume');
    const r3 = createVersionedBackup(jobDir, 'resume');

    expect(r1.version).toBe(2);
    expect(r2.version).toBe(3);
    expect(r3.version).toBe(11);
  });

  it('also copies cover-letter files when kind is "both"', async () => {
    const jobDir = '/tmp/opencode/job-z';
    const backupsRoot = path.join(jobDir, 'backups');
    existsSync.mockImplementation((p: unknown) => {
      if (p === jobDir) return true;
      if (p === backupsRoot) return false;
      return true;
    });
    statSync.mockImplementation((p: unknown) => ({ isDirectory: () => p === jobDir, isFile: () => p !== jobDir }));

    const { createVersionedBackup } = await import('./backupService.js');
    const result = createVersionedBackup(jobDir, 'both');

    expect(result.files).toEqual(expect.arrayContaining(['structured-output.json', 'resume.pdf', 'resume.tex', 'cover-letter.json', 'cover-letter.pdf', 'cover-letter.tex']));
  });

  it('throws when jobDir does not exist', async () => {
    const jobDir = '/tmp/opencode/missing';
    existsSync.mockReturnValue(false);

    const { createVersionedBackup } = await import('./backupService.js');
    expect(() => createVersionedBackup(jobDir, 'resume')).toThrow(/job directory does not exist/);
  });
});

afterEach(() => {
  vi.clearAllMocks();
});
void os;
