import { describe, it, expect, beforeEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';

const findProjectRootMock = vi.fn();
vi.mock('./paths', () => ({
  findProjectRoot: () => findProjectRootMock(),
}));

describe('jobDir helpers', () => {
  let tempRoot: string;
  let jobsRoot: string;

  beforeEach(() => {
    findProjectRootMock.mockReset();
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jobdir-test-'));
    jobsRoot = path.join(tempRoot, 'jobs');
    fs.mkdirSync(jobsRoot, { recursive: true });
    findProjectRootMock.mockReturnValue(tempRoot);
  });

  describe('loadFullJdFromDir', () => {
    it('returns file content when full-jd.txt exists', async () => {
      const { loadFullJdFromDir } = await import('./jobDir.js');
      const dir = path.join(jobsRoot, 'sample-slug');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'full-jd.txt'), 'the full jd text', 'utf8');
      expect(loadFullJdFromDir(dir)).toBe('the full jd text');
    });

    it('returns null when full-jd.txt is missing', async () => {
      const { loadFullJdFromDir } = await import('./jobDir.js');
      const dir = path.join(jobsRoot, 'no-full-jd');
      fs.mkdirSync(dir, { recursive: true });
      expect(loadFullJdFromDir(dir)).toBeNull();
    });
  });

  describe('resolveJobFolder', () => {
    it('returns the absolute path when given an existing directory', async () => {
      const { resolveJobFolder } = await import('./jobDir.js');
      const dir = path.join(jobsRoot, 'a-slug');
      fs.mkdirSync(dir, { recursive: true });
      const resolved = resolveJobFolder(dir);
      expect(resolved).toBe(fs.realpathSync(dir));
    });

    it('returns the parent directory when given a file path', async () => {
      const { resolveJobFolder } = await import('./jobDir.js');
      const dir = path.join(jobsRoot, 'b-slug');
      fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, 'structured-output.json');
      fs.writeFileSync(filePath, '{}', 'utf8');
      const resolved = resolveJobFolder(filePath);
      expect(resolved).toBe(fs.realpathSync(dir));
    });

    it('resolves a relative input against the jobs directory', async () => {
      const { resolveJobFolder } = await import('./jobDir.js');
      const dir = path.join(jobsRoot, 'c-slug');
      fs.mkdirSync(dir, { recursive: true });
      const resolved = resolveJobFolder('c-slug');
      expect(resolved).toBe(fs.realpathSync(dir));
    });

    it('returns null when input is the bare jobs root', async () => {
      const { resolveJobFolder } = await import('./jobDir.js');
      const resolved = resolveJobFolder(jobsRoot);
      expect(resolved).toBeNull();
    });

    it('returns null when input does not exist', async () => {
      const { resolveJobFolder } = await import('./jobDir.js');
      const resolved = resolveJobFolder(path.join(jobsRoot, 'does-not-exist'));
      expect(resolved).toBeNull();
    });
  });
});
