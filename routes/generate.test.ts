import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import path from 'path';

const spawnSync = vi.fn();
const existsSync = vi.fn();
const mkdirSync = vi.fn();
const writeFileSync = vi.fn();
const appendFileSync = vi.fn();
const readdirSync = vi.fn();
const statSync = vi.fn();
const readFileSync = vi.fn();
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
