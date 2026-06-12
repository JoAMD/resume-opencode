import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import path from 'path';

const spawnSync = vi.fn();
const existsSync = vi.fn();
const mkdirSync = vi.fn();
const writeFileSync = vi.fn();
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
    readFileSync: (...args: unknown[]) => readFileSync(...args),
    readdirSync: (...args: unknown[]) => readdirSync(...args),
    statSync: (...args: unknown[]) => statSync(...args),
    mkdtempSync: (...args: unknown[]) => mkdtempSync(...args),
    rmSync: (...args: unknown[]) => rmSync(...args),
  },
  existsSync: (...args: unknown[]) => existsSync(...args),
  mkdirSync: (...args: unknown[]) => mkdirSync(...args),
  writeFileSync: (...args: unknown[]) => writeFileSync(...args),
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
