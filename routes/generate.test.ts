import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import path from 'path';
import fs from 'fs';
import http from 'http';

const spawnSync = vi.fn();
const existsSync = vi.fn();
const mkdirSync = vi.fn();
const writeFileSync = vi.fn();
const appendFileSync = vi.fn();
const readdirSync = vi.fn();
const statSync = vi.fn();
const readFileSync = vi.fn();
const realpathSync = vi.fn();
const mkdtempSync = vi.fn();
const rmSync = vi.fn();

vi.mock('child_process', () => ({
  default: {
    spawnSync: (...args: unknown[]) => spawnSync(...args),
    execFileSync: vi.fn(),
    execSync: vi.fn(),
  },
  spawnSync: (...args: unknown[]) => spawnSync(...args),
  execFileSync: vi.fn(),
  execSync: vi.fn(),
}));

vi.mock('fs', () => ({
  default: {
    existsSync: (...args: unknown[]) => existsSync(...args),
    mkdirSync: (...args: unknown[]) => mkdirSync(...args),
    writeFileSync: (...args: unknown[]) => writeFileSync(...args),
    appendFileSync: (...args: unknown[]) => appendFileSync(...args),
    readFileSync: (...args: unknown[]) => readFileSync(...args),
    readdirSync: (...args: unknown[]) => readdirSync(...args),
    statSync: (...args: unknown[]) => statSync(...args),
    realpathSync: (...args: unknown[]) => realpathSync(...args),
    mkdtempSync: (...args: unknown[]) => mkdtempSync(...args),
    rmSync: (...args: unknown[]) => rmSync(...args),
  },
  existsSync: (...args: unknown[]) => existsSync(...args),
  mkdirSync: (...args: unknown[]) => mkdirSync(...args),
  writeFileSync: (...args: unknown[]) => writeFileSync(...args),
  appendFileSync: (...args: unknown[]) => appendFileSync(...args),
  readFileSync: (...args: unknown[]) => readFileSync(...args),
  readdirSync: (...args: unknown[]) => readdirSync(...args),
  statSync: (...args: unknown[]) => statSync(...args),
  realpathSync: (...args: unknown[]) => realpathSync(...args),
  mkdtempSync: (...args: unknown[]) => mkdtempSync(...args),
  rmSync: (...args: unknown[]) => rmSync(...args),
}));

vi.mock('../services/paths', () => ({
  findProjectRoot: () => '/tmp/opencode/fake-project-root',
}));

vi.mock('../services/latex', () => ({
  buildLatex: () => '\\documentclass{article}\\begin{document}hello\\end{document}',
  buildCoverLetterLatex: () => '\\documentclass{article}\\begin{document}cover\\end{document}',
}));

vi.mock('../services/env', () => ({
  parseDotEnvContent: () => ({}),
  buildProfileFromEnvVars: () => ({}),
  normalizeEnvProfile: () => ({}),
}));

vi.mock('../services/ai', () => ({
  generateResumeJSON: vi.fn(),
  generateCoverLetterJSON: vi.fn(),
  generateCombinedJSON: vi.fn(),
  normaliseBodyParagraph: (v: any) => (Array.isArray(v) ? v : (typeof v === 'string' ? v.split(/\n\s*\n+/) : [])),
  analyzeATSKeywordsAgainstResume: () => ({ coveragePercent: 0, includedInResume: [], missingFromResume: [], extractedFromJD: [] }),
  extractATSKeywordsFromJDViaAI: async () => [],
}));

const applySuggestionsMock = vi.fn();
vi.mock('../services/fixSuggestionsService', () => ({
  applySuggestions: (...args: unknown[]) => applySuggestionsMock(...args),
  NoOpResultError: class NoOpResultError extends Error {
    code = 'no-op';
    constructor(public backup: unknown) { super('no-op'); }
  },
}));

const latestBackupVersionMock = vi.fn();
vi.mock('../services/backupService', () => ({
  createVersionedBackup: vi.fn(),
  latestBackupVersion: (...args: unknown[]) => latestBackupVersionMock(...args),
}));

const TECTONIC_URL = 'http://localhost:4000/compile';

describe('compilePDFViaTectonic', () => {
  beforeEach(() => {
    spawnSync.mockReset();
  });

  it('returns the PDF buffer when curl returns a %PDF body', async () => {
    const fakePdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(100, 'x')]);
    spawnSync.mockReturnValue({ status: 0, stdout: fakePdf, stderr: Buffer.from('') });

    const { compilePDFViaTectonic } = await import('../services/texCompiler.js');
    const result = compilePDFViaTectonic('\\documentclass{article}');

    expect(result).toBe(fakePdf);
    expect(spawnSync).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = spawnSync.mock.calls[0];
    expect(cmd).toBe('curl');
    expect(args).toEqual(['-sS', '-X', 'POST', '--data-binary', '@-', TECTONIC_URL]);
    expect(opts.input).toBe('\\documentclass{article}');
    expect(opts.timeout).toBe(60000);
  });

  it('throws with stderr when curl exits non-zero', async () => {
    spawnSync.mockReturnValue({ status: 7, stdout: Buffer.from(''), stderr: Buffer.from('connection refused') });

    const { compilePDFViaTectonic } = await import('../services/texCompiler.js');

    expect(() => compilePDFViaTectonic('any source')).toThrow(/tectonic request failed \(exit 7\): connection refused/);
  });

  it('throws with the server error body when the response is not a PDF', async () => {
    spawnSync.mockReturnValue({
      status: 0,
      stdout: Buffer.from('Tectonic compile error:\nUndefined control sequence.'),
      stderr: Buffer.from(''),
    });

    const { compilePDFViaTectonic } = await import('../services/texCompiler.js');

    expect(() => compilePDFViaTectonic('any source')).toThrow(/tectonic did not return a PDF: Tectonic compile error/);
  });

  it('throws when the response is too short to be a PDF', async () => {
    spawnSync.mockReturnValue({ status: 0, stdout: Buffer.from('nope'), stderr: Buffer.from('') });

    const { compilePDFViaTectonic } = await import('../services/texCompiler.js');

    expect(() => compilePDFViaTectonic('any source')).toThrow(/tectonic did not return a PDF/);
  });
});

describe('buildLatexFromStructured', () => {
  beforeEach(() => {
    existsSync.mockReset();
    mkdirSync.mockReset();
    writeFileSync.mockReset();
    spawnSync.mockReset();
    writeFileSync.mockImplementation(() => undefined);
  });

  function mockTectonicSuccess() {
    spawnSync.mockReturnValue({
      status: 0,
      stdout: Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(10, 'y')]),
      stderr: Buffer.from(''),
    });
  }

  it('writes resume.tex and resume.pdf into the provided sourceDir', async () => {
    existsSync.mockImplementation(() => true);
    mockTectonicSuccess();

    const { buildLatexFromStructured } = await import('./generate.js');
    const result = buildLatexFromStructured({}, false, '/tmp/opencode/job-folder');

    expect(result.texUrl).toBe('/jobs/job-folder/resume.tex');
    expect(result.pdfUrl).toBe('/jobs/job-folder/resume.pdf');
    expect(result.txtUrl).toBeUndefined();

    const writtenPaths = (writeFileSync as Mock).mock.calls.map((c) => c[0] as string);
    expect(writtenPaths).toContain('/tmp/opencode/job-folder/resume.tex');
    expect(writtenPaths).toContain('/tmp/opencode/job-folder/resume.pdf');
    expect(writtenPaths).not.toContain(expect.stringContaining('last-generated'));
  });

  it('falls back to last-generated when sourceDir is null', async () => {
    existsSync.mockImplementation(() => false);
    mockTectonicSuccess();

    const { buildLatexFromStructured } = await import('./generate.js');
    const result = buildLatexFromStructured({}, false, null);

    expect(result.texUrl).toBe('/jobs/last-generated/resume.tex');
    expect(result.pdfUrl).toBe('/jobs/last-generated/resume.pdf');

    const writtenPaths = (writeFileSync as Mock).mock.calls.map((c) => c[0] as string);
    expect(writtenPaths).toContain('/tmp/opencode/fake-project-root/jobs/last-generated/resume.tex');
    expect(mkdirSync).toHaveBeenCalledWith('/tmp/opencode/fake-project-root/jobs/last-generated', { recursive: true });
  });

  it('writes cover-letter files when isCoverLetter is true', async () => {
    existsSync.mockImplementation(() => true);
    mockTectonicSuccess();

    const { buildLatexFromStructured } = await import('./generate.js');
    const result = buildLatexFromStructured(
      {
        dateLine: '1 Jan 2026',
        recipientLine: 'Acme',
        subjectLine: 'Application',
        greeting: 'Hi',
        openingParagraph: 'Open',
        bodyParagraph: 'Body',
        closingParagraph: 'Close',
        signoff: 'Regards',
        fullName: 'Joel Joseph',
      },
      true,
      '/tmp/opencode/cover-folder'
    );

    expect(result.texUrl).toBe('/jobs/cover-folder/cover-letter.tex');
    expect(result.pdfUrl).toBe('/jobs/cover-folder/cover-letter.pdf');
    expect(result.txtUrl).toBe('/jobs/cover-folder/cover-letter.txt');

    const writtenNames = (writeFileSync as Mock).mock.calls.map((c) => path.basename(c[0] as string));
    expect(writtenNames).toEqual(expect.arrayContaining(['cover-letter.tex', 'cover-letter.pdf', 'cover-letter.txt']));
  });
});

describe('writeSessionInfo and appendJobFile helpers', () => {
  beforeEach(() => {
    existsSync.mockReset();
    mkdirSync.mockReset();
    writeFileSync.mockReset();
    appendFileSync.mockReset();
    readFileSync.mockReset();
    readdirSync.mockReset();
    statSync.mockReset();
    spawnSync.mockReset();
    writeFileSync.mockImplementation(() => undefined);
    appendFileSync.mockImplementation(() => undefined);
  });

  it('writeSessionInfo writes session-id, model, and timestamp; appendJobFile appends to other-input.txt', async () => {
    const { writeSessionInfo, appendJobFile } = await import('./generate.js');
    writeSessionInfo('/tmp/opencode/fake-project-root/jobs/test-folder', { sessionId: 'ses_abc', model: 'opencode/gpt-5-nano' });
    appendJobFile('/tmp/opencode/fake-project-root/jobs/test-folder', 'other-input.txt', '\nOpenCode Session ID: ses_abc\n');

    const sessionWrite = (writeFileSync as Mock).mock.calls.find((c) => (c[0] as string).endsWith('session-info.txt'));
    expect(sessionWrite).toBeDefined();
    expect(sessionWrite![0]).toBe('/tmp/opencode/fake-project-root/jobs/test-folder/session-info.txt');
    const sessionContent = sessionWrite![1] as string;
    expect(sessionContent).toContain('OpenCode Session ID: ses_abc');
    expect(sessionContent).toContain('Model: opencode/gpt-5-nano');
    expect(sessionContent).toMatch(/Generated At: \d{4}-\d{2}-\d{2}T/);

    const otherInputAppend = (appendFileSync as Mock).mock.calls.find((c) => (c[0] as string).endsWith('other-input.txt'));
    expect(otherInputAppend).toBeDefined();
    expect(otherInputAppend![0]).toBe('/tmp/opencode/fake-project-root/jobs/test-folder/other-input.txt');
    expect(otherInputAppend![1] as string).toContain('OpenCode Session ID: ses_abc');
  });

  it('writeSessionInfo includes Cover Letter Session ID only when it differs from the main session id', async () => {
    const { writeSessionInfo } = await import('./generate.js');
    writeSessionInfo('/tmp/opencode/fake-project-root/jobs/test-folder-2', {
      sessionId: 'ses_1',
      coverLetterSessionId: 'ses_2',
    });
    const sessionWrite = (writeFileSync as Mock).mock.calls.find((c) => (c[0] as string).endsWith('session-info.txt'));
    expect(sessionWrite).toBeDefined();
    const content = sessionWrite![1] as string;
    expect(content).toContain('OpenCode Session ID: ses_1');
    expect(content).toContain('Cover Letter Session ID: ses_2');

    writeFileSync.mockClear();
    writeSessionInfo('/tmp/opencode/fake-project-root/jobs/test-folder-3', {
      sessionId: 'ses_1',
      coverLetterSessionId: 'ses_1',
    });
    const sessionWrite2 = (writeFileSync as Mock).mock.calls.find((c) => (c[0] as string).endsWith('session-info.txt'));
    expect(sessionWrite2).toBeDefined();
    const content2 = sessionWrite2![1] as string;
    expect(content2).toContain('OpenCode Session ID: ses_1');
    expect(content2).not.toContain('Cover Letter Session ID:');
  });
});

describe('POST /generate/applySuggestions', () => {
  beforeEach(() => {
    existsSync.mockReset();
    mkdirSync.mockReset();
    writeFileSync.mockReset();
    readFileSync.mockReset();
    realpathSync.mockReset();
    realpathSync.mockImplementation((p: string) => p);
    applySuggestionsMock.mockReset();
  });

  it('returns 400 when jobDir is missing', async () => {
    const { default: router } = await import('./generate.js');
    const res = await invokeRoute(router, 'post', '/applySuggestions', { userSuggestions: 'tighten summary' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'jobDir is required' });
  });

  const baseJobDir = '/tmp/opencode/fake-project-root/jobs/shopify-swe';
  const baseResume = `${baseJobDir}/structured-output.json`;
  const baseRedacted = `${baseJobDir}/structured-output-redacted.json`;
  const stubShopifySweExists = (extra: string[] = []) => {
    existsSync.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s === baseJobDir) return true;
      if (s === baseResume) return true;
      if (s === baseRedacted) return true;
      return extra.includes(s);
    });
    statSync.mockImplementation((p: unknown) => ({
      isDirectory: () => p === baseJobDir,
      isFile: () => p !== baseJobDir,
    }));
  };

  it('returns 400 when userSuggestions is empty', async () => {
    stubShopifySweExists();

    const { default: router } = await import('./generate.js');
    const res = await invokeRoute(router, 'post', '/applySuggestions', { jobDir: 'shopify-swe', userSuggestions: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/userSuggestions is required/);
  });

  it('returns 400 when attachedFilePaths escape the job directory', async () => {
    stubShopifySweExists();

    const { default: router } = await import('./generate.js');
    const res = await invokeRoute(router, 'post', '/applySuggestions', {
      jobDir: 'shopify-swe',
      userSuggestions: 'do something',
      attachedFilePaths: ['/etc/passwd'],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Attached file escapes job directory/);
  });

  it('returns 400 when redacted resume is missing', async () => {
    existsSync.mockImplementation((p: unknown) => {
      const s = String(p);
      return s === baseJobDir || s === baseResume;
    });
    statSync.mockImplementation((p: unknown) => ({
      isDirectory: () => p === baseJobDir,
      isFile: () => p !== baseJobDir,
    }));

    const { default: router } = await import('./generate.js');
    const res = await invokeRoute(router, 'post', '/applySuggestions', {
      jobDir: 'shopify-swe',
      userSuggestions: 'do something',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/structured-output-redacted.json not found/);
  });

  it('returns a taskId and resolves to complete when the service succeeds', async () => {
    stubShopifySweExists([`${baseJobDir}/ats-analysis.md`]);

    applySuggestionsMock.mockResolvedValue({
      resume: { name: 'X', summary: 'y', skills: {}, experience: [], education: [], projects: [] },
      pdfUrl: '/jobs/shopify-swe/resume.pdf',
      sessionId: 'ses_apply_1',
      backup: { version: 1, backupDir: `${baseJobDir}/backups/v1`, files: [] },
    });

    const { default: router } = await import('./generate.js');
    const post = await invokeRoute(router, 'post', '/applySuggestions', {
      jobDir: 'shopify-swe',
      userSuggestions: 'tighten summary',
      attachedFilePaths: [`${baseJobDir}/ats-analysis.md`],
    });
    expect(post.status).toBe(200);
    expect(post.body.taskId).toMatch(/^task_/);

    const poll = await invokeRoute(router, 'get', `/task/${post.body.taskId}`);
    await new Promise((r) => setTimeout(r, 50));
    const poll2 = await invokeRoute(router, 'get', `/task/${post.body.taskId}`);
    expect(['pending', 'complete']).toContain(poll2.body.status);
    if (poll2.body.status === 'complete') {
      expect(poll2.body.result.pdfUrl).toBe('/jobs/shopify-swe/resume.pdf');
      expect(poll2.body.result.sessionId).toBe('ses_apply_1');
      expect(poll2.body.result.backupVersion).toBe(1);
    } else {
      await new Promise((r) => setTimeout(r, 200));
      const poll3 = await invokeRoute(router, 'get', `/task/${post.body.taskId}`);
      expect(poll3.body.status).toBe('complete');
      expect(poll3.body.result.sessionId).toBe('ses_apply_1');
    }
  });

  it('accepts bare filenames in attachedFilePaths by resolving them against the job dir', async () => {
    stubShopifySweExists([`${baseJobDir}/ats-analysis.md`]);

    applySuggestionsMock.mockResolvedValue({
      resume: { name: 'X', summary: 'y', skills: {}, experience: [], education: [], projects: [] },
      pdfUrl: '/jobs/shopify-swe/resume.pdf',
      sessionId: 'ses_apply_bare',
      backup: { version: 1, backupDir: `${baseJobDir}/backups/v1`, files: [] },
    });

    const { default: router } = await import('./generate.js');
    const post = await invokeRoute(router, 'post', '/applySuggestions', {
      jobDir: 'shopify-swe',
      userSuggestions: 'tighten summary',
      attachedFilePaths: ['ats-analysis.md'],
    });
    expect(post.status).toBe(200);
    await new Promise((r) => setTimeout(r, 200));
    const poll = await invokeRoute(router, 'get', `/task/${post.body.taskId}`);
    expect(poll.body.status).toBe('complete');
    expect(poll.body.result.sessionId).toBe('ses_apply_bare');
  });

  it('resolves to error+no-op when the service throws NoOpResultError', async () => {
    stubShopifySweExists();

    const { NoOpResultError } = await import('../services/fixSuggestionsService.js');
    applySuggestionsMock.mockRejectedValue(new (NoOpResultError as any)({ version: 1, backupDir: '/tmp/opencode/fake-project-root/jobs/shopify-swe/backups/v1', files: [] }));

    const { default: router } = await import('./generate.js');
    const post = await invokeRoute(router, 'post', '/applySuggestions', { jobDir: 'shopify-swe', userSuggestions: 'change stuff' });
    expect(post.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    const poll = await invokeRoute(router, 'get', `/task/${post.body.taskId}`);
    expect(poll.body.status).toBe('error');
    expect(poll.body.error).toBe('no-op');
    expect(poll.body.result.backupPath).toContain('backups/v1');
  });
});

describe('POST /generate/ensureRedactedResume', () => {
  beforeEach(() => {
    existsSync.mockReset();
    mkdirSync.mockReset();
    writeFileSync.mockReset();
    readFileSync.mockReset();
    realpathSync.mockReset();
    realpathSync.mockImplementation((p: string) => p);
  });

  it('returns the path of the written redacted file', async () => {
    const jobDir = '/tmp/opencode/fake-project-root/jobs/redact-folder';
    const resumePath = `${jobDir}/structured-output.json`;
    const redactedPath = `${jobDir}/structured-output-redacted.json`;
    const sample = { name: 'X', phone: '0400', email: 'x@y.z', linkedinUrl: '', linkedinDisplay: '', summary: 's', skills: {}, experience: [], education: [], projects: [] };
    existsSync.mockImplementation((p: unknown) => p === jobDir || p === resumePath);
    statSync.mockImplementation((p: unknown) => ({ isDirectory: () => p === jobDir, isFile: () => p !== jobDir }));
    readFileSync.mockImplementation((p: unknown) => {
      if (p === resumePath) return JSON.stringify(sample);
      return '';
    });

    const { default: router } = await import('./generate.js');
    const res = await invokeRoute(router, 'post', '/ensureRedactedResume', { jobDir: 'redact-folder' });
    expect(res.status).toBe(200);
    expect(res.body.path).toBe(redactedPath);
    expect(res.body.wroteFile).toBe(true);
    const written = (writeFileSync as Mock).mock.calls.find((c) => c[0] === redactedPath);
    expect(written).toBeDefined();
    const parsed = JSON.parse(written![1]);
    expect(parsed.name).toBe('');
    expect(parsed.email).toBe('');
    expect(parsed.phone).toBe('');
  });

  it('returns 400 when structured-output.json is missing', async () => {
    existsSync.mockImplementation((p: unknown) => p === '/tmp/opencode/fake-project-root/jobs/redact-folder');
    statSync.mockImplementation((p: unknown) => ({ isDirectory: () => p === '/tmp/opencode/fake-project-root/jobs/redact-folder', isFile: () => p !== '/tmp/opencode/fake-project-root/jobs/redact-folder' }));
    const { default: router } = await import('./generate.js');
    const res = await invokeRoute(router, 'post', '/ensureRedactedResume', { jobDir: 'redact-folder' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/structured-output.json not found/);
  });
});

async function invokeRoute(router: any, method: 'get' | 'post', routePath: string, body?: any) {
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json());
  app.use('/generate', router);
  const server = http.createServer(app).listen(0);
  const port = (server.address() as any).port;
  const url = `http://127.0.0.1:${port}/generate${routePath}`;
  try {
    const result = await new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req = http.request(url, {
        method: method === 'get' ? 'GET' : 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : {},
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed: any = {};
          try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      });
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
    return result;
  } finally {
    server.close();
  }
}

describe('GET /generate/diffResume', () => {
  const JOBS_ROOT = '/tmp/opencode/fake-project-root/jobs';
  const JOB_DIR = `${JOBS_ROOT}/shopify-swe`;
  const BACKUP_DIR = `${JOB_DIR}/backups/v1`;
  const BACKUP_FILE = `${BACKUP_DIR}/structured-output.json`;
  const CURRENT_FILE = `${JOB_DIR}/structured-output.json`;

  const BACKUP_JSON = { name: 'X', summary: 'Original', skills: {}, experience: [], education: [], projects: [] };
  const CURRENT_JSON = { name: 'X', summary: 'Updated', skills: {}, experience: [], education: [], projects: [] };

  beforeEach(() => {
    existsSync.mockReset();
    readFileSync.mockReset();
    realpathSync.mockReset();
    realpathSync.mockImplementation((p: string) => p);
    statSync.mockReset();
    statSync.mockImplementation((p: unknown) => ({ isDirectory: () => p === JOB_DIR, isFile: () => p !== JOB_DIR }));
    latestBackupVersionMock.mockReset();
  });

  function setupHappyPathFiles(): void {
    existsSync.mockImplementation((p: unknown) => p === JOB_DIR || p === BACKUP_DIR || p === BACKUP_FILE || p === CURRENT_FILE);
    readFileSync.mockImplementation((p: unknown) => {
      if (p === BACKUP_FILE) return JSON.stringify(BACKUP_JSON);
      if (p === CURRENT_FILE) return JSON.stringify(CURRENT_JSON);
      return '';
    });
  }

  function setupMissingBackup(): void {
    existsSync.mockImplementation((p: unknown) => p === JOB_DIR || p === CURRENT_FILE);
    readFileSync.mockImplementation((p: unknown) => (p === CURRENT_FILE ? JSON.stringify(CURRENT_JSON) : ''));
  }

  function setupMissingCurrent(): void {
    existsSync.mockImplementation((p: unknown) => p === JOB_DIR || p === BACKUP_DIR || p === BACKUP_FILE);
    readFileSync.mockImplementation((p: unknown) => (p === BACKUP_FILE ? JSON.stringify(BACKUP_JSON) : ''));
  }

  it('returns 200 with unifiedDiff and summary on the happy path', async () => {
    setupHappyPathFiles();
    const { default: router } = await import('./generate.js');
    const res = await invokeRoute(router, 'get', '/diffResume?jobDir=shopify-swe&version=v1');
    expect(res.status).toBe(200);
    expect(res.body.jobDir).toBe('shopify-swe');
    expect(res.body.backupVersion).toBe(1);
    expect(typeof res.body.unifiedDiff).toBe('string');
    expect(res.body.unifiedDiff).toContain('Original');
    expect(res.body.unifiedDiff).toContain('Updated');
    expect(Array.isArray(res.body.summary.changedPaths)).toBe(true);
    expect(res.body.summary.changedPaths).toContain('summary');
  });

  it('returns 404 with "Backup not found" when the backup is missing', async () => {
    setupMissingBackup();
    const { default: router } = await import('./generate.js');
    const res = await invokeRoute(router, 'get', '/diffResume?jobDir=shopify-swe&version=v1');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Backup not found');
    expect(res.body.jobDir).toBe('shopify-swe');
    expect(res.body.version).toBe('v1');
  });

  it('returns 404 with "Resume not found" when the current is missing', async () => {
    setupMissingCurrent();
    const { default: router } = await import('./generate.js');
    const res = await invokeRoute(router, 'get', '/diffResume?jobDir=shopify-swe&version=v1');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Resume not found');
    expect(res.body.jobDir).toBe('shopify-swe');
    expect(res.body.version).toBe('v1');
  });

  it('returns 400 with "jobDir required" when jobDir is missing', async () => {
    const { default: router } = await import('./generate.js');
    const res = await invokeRoute(router, 'get', '/diffResume?version=v1');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('jobDir required');
  });

  it('returns 400 with "invalid version" for v0, v-1, and vabc', async () => {
    const { default: router } = await import('./generate.js');
    for (const bad of ['v0', 'v-1', 'vabc']) {
      const res = await invokeRoute(router, 'get', `/diffResume?jobDir=shopify-swe&version=${bad}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid version');
    }
  });

  it('rejects path-traversal payloads via safeRealpath', async () => {
    realpathSync.mockImplementation((p: string) => {
      if (p === JOBS_ROOT) return JOBS_ROOT;
      return '/etc';
    });
    existsSync.mockImplementation(() => true);
    const { default: router } = await import('./generate.js');
    const res = await invokeRoute(router, 'get', '/diffResume?jobDir=../etc&version=v1');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('jobDir escapes jobs root');
  });

  it('defaults to latestBackupVersion when version is omitted', async () => {
    const v3BackupDir = `${JOB_DIR}/backups/v3`;
    const v3BackupFile = `${v3BackupDir}/structured-output.json`;
    existsSync.mockImplementation((p: unknown) => p === JOB_DIR || p === v3BackupDir || p === v3BackupFile || p === CURRENT_FILE);
    readFileSync.mockImplementation((p: unknown) => {
      if (p === v3BackupFile) return JSON.stringify(BACKUP_JSON);
      if (p === CURRENT_FILE) return JSON.stringify(CURRENT_JSON);
      return '';
    });
    latestBackupVersionMock.mockReturnValue(3);
    const { default: router } = await import('./generate.js');
    const res = await invokeRoute(router, 'get', '/diffResume?jobDir=shopify-swe');
    expect(latestBackupVersionMock).toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(res.body.backupVersion).toBe(3);
  });

  it('omits summary when format=unified', async () => {
    setupHappyPathFiles();
    const { default: router } = await import('./generate.js');
    const res = await invokeRoute(router, 'get', '/diffResume?jobDir=shopify-swe&version=v1&format=unified');
    expect(res.status).toBe(200);
    expect(typeof res.body.unifiedDiff).toBe('string');
    expect(res.body.unifiedDiff.length).toBeGreaterThan(0);
    expect(res.body.summary).toBeUndefined();
  });

  it('omits unifiedDiff when format=summary', async () => {
    setupHappyPathFiles();
    const { default: router } = await import('./generate.js');
    const res = await invokeRoute(router, 'get', '/diffResume?jobDir=shopify-swe&version=v1&format=summary');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.summary.changedPaths)).toBe(true);
    expect(res.body.unifiedDiff).toBeUndefined();
  });

  it('returns 400 for invalid format', async () => {
    setupHappyPathFiles();
    const { default: router } = await import('./generate.js');
    const res = await invokeRoute(router, 'get', '/diffResume?jobDir=shopify-swe&version=v1&format=garbage');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid format');
  });
});
