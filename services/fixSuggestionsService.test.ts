import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const runOpenCodeMock = vi.fn();
const buildLatexMock = vi.fn();
const compilePDFMock = vi.fn();

vi.mock('./ai', () => ({
  runOpenCode: (...args: unknown[]) => runOpenCodeMock(...args),
  enqueueAIRequest: <T>(_model: string, work: () => Promise<T>) => work(),
  FIX_SUGGESTIONS_PROMPT: () => 'TEST_FIX_PROMPT',
}));

vi.mock('./latex', () => ({
  buildLatex: (...args: unknown[]) => buildLatexMock(...args),
  buildCoverLetterLatex: () => '',
}));

vi.mock('./compiler', () => ({
  compilePDF: (...args: unknown[]) => compilePDFMock(...args),
}));

vi.mock('./backupService', () => ({
  createVersionedBackup: vi.fn().mockReturnValue({ version: 1, backupDir: '/tmp/opencode/job-fake/backups/v1', files: ['structured-output.json', 'resume.pdf', 'resume.tex'] }),
}));

vi.mock('./logger', () => ({
  log: vi.fn(),
  logError: vi.fn(),
}));

const RESUME_BASE = {
  name: 'Test User',
  phone: '0400000000',
  email: 'test@example.com',
  linkedinUrl: '',
  linkedinDisplay: '',
  summary: 'Original summary',
  skills: { languages: 'TypeScript', frameworks: 'Express', tools: 'Git', libraries: '' },
  experience: [
    { company: 'Acme', title: 'SWE', location: 'Remote', dates: '2020-2024', bullets: ['Did X.'] },
  ],
  education: [
    { institution: 'Uni', location: 'City', degree: 'BS', dates: '2016-2019' },
  ],
  projects: [],
};

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-suggestions-'));
  const jobDir = path.join(root, 'shopify-senior-swe');
  fs.mkdirSync(jobDir, { recursive: true });
  const resumePath = path.join(jobDir, 'structured-output.json');
  fs.writeFileSync(resumePath, JSON.stringify(RESUME_BASE, null, 2));
  fs.writeFileSync(path.join(jobDir, 'ats-analysis.md'), '# ATS analysis\n');
  fs.writeFileSync(path.join(jobDir, 'job-description.txt'), 'Build cool stuff.');
  fs.writeFileSync(path.join(jobDir, 'other-input.txt'), 'Company: Shopify\nRole: Senior SWE\n');
  return { root, jobDir, resumePath };
}

describe('resumesAreEqual', () => {
  it('returns true for identical objects regardless of key order', async () => {
    const { resumesAreEqual } = await import('./fixSuggestionsService.js');
    const a = { x: 1, y: { z: 2, w: 3 }, arr: [1, 2, 3] };
    const b = { y: { w: 3, z: 2 }, x: 1, arr: [1, 2, 3] };
    expect(resumesAreEqual(a, b)).toBe(true);
  });

  it('returns false when one field differs', async () => {
    const { resumesAreEqual } = await import('./fixSuggestionsService.js');
    const a = { x: 1, y: 2 };
    const b = { x: 1, y: 3 };
    expect(resumesAreEqual(a, b)).toBe(false);
  });

  it('returns false when array order differs', async () => {
    const { resumesAreEqual } = await import('./fixSuggestionsService.js');
    expect(resumesAreEqual({ arr: [1, 2, 3] }, { arr: [3, 2, 1] })).toBe(false);
  });
});

describe('applySuggestions', () => {
  beforeEach(() => {
    runOpenCodeMock.mockReset();
    buildLatexMock.mockReset();
    compilePDFMock.mockReset();
    buildLatexMock.mockReturnValue('\\documentclass{article}\\begin{document}updated\\end{document}');
    compilePDFMock.mockResolvedValue(Buffer.from('%PDF-1.4\nupdated'));
  });

  it('writes structured-output.json + resume.tex + resume.pdf on success', async () => {
    const { jobDir, resumePath } = makeFixture();
    const updated = JSON.parse(JSON.stringify(RESUME_BASE));
    updated.summary = 'Tightened summary mentioning Kafka and Terraform';
    updated.skills.frameworks = 'Express, Kafka';
    runOpenCodeMock.mockResolvedValueOnce({ structured: updated, sessionId: 'ses_new_1' });

    const { applySuggestions } = await import('./fixSuggestionsService.js');
    const result = await applySuggestions({
      jobDir,
      userSuggestions: 'Tighten the summary. Add Kafka to skills.',
      attachedFiles: [
        { name: 'ats-analysis.md', path: path.join(jobDir, 'ats-analysis.md') },
        { name: 'job-description.txt', path: path.join(jobDir, 'job-description.txt') },
        { name: 'other-input.txt', path: path.join(jobDir, 'other-input.txt') },
      ],
      resumePath,
    });

    expect(result.sessionId).toBe('ses_new_1');
    expect(result.pdfUrl).toBe(`/jobs/${path.basename(jobDir)}/resume.pdf`);
    expect(JSON.parse(fs.readFileSync(resumePath, 'utf8')).summary).toContain('Tightened');
    expect(fs.existsSync(path.join(jobDir, 'resume.tex'))).toBe(true);
    expect(fs.existsSync(path.join(jobDir, 'resume.pdf'))).toBe(true);
    expect(runOpenCodeMock).toHaveBeenCalledTimes(1);
  });

  it('retries once on no-op and returns success when retry changes the resume', async () => {
    const { jobDir, resumePath } = makeFixture();
    const unchanged = JSON.parse(JSON.stringify(RESUME_BASE));
    const updated = JSON.parse(JSON.stringify(RESUME_BASE));
    updated.skills.libraries = 'Jest';
    runOpenCodeMock
      .mockResolvedValueOnce({ structured: unchanged, sessionId: 'ses_attempt1' })
      .mockResolvedValueOnce({ structured: updated, sessionId: 'ses_attempt2' });

    const { applySuggestions } = await import('./fixSuggestionsService.js');
    const result = await applySuggestions({
      jobDir,
      userSuggestions: 'Add Jest to libraries.',
      attachedFiles: [],
      resumePath,
    });

    expect(runOpenCodeMock).toHaveBeenCalledTimes(2);
    expect(result.sessionId).toBe('ses_attempt2');
    expect(JSON.parse(fs.readFileSync(resumePath, 'utf8')).skills.libraries).toBe('Jest');
  });

  it('throws NoOpResultError when both attempts return identical JSON', async () => {
    const { jobDir, resumePath } = makeFixture();
    const unchanged = JSON.parse(JSON.stringify(RESUME_BASE));
    runOpenCodeMock
      .mockResolvedValueOnce({ structured: unchanged, sessionId: 'ses_a' })
      .mockResolvedValueOnce({ structured: unchanged, sessionId: 'ses_b' });

    const { applySuggestions, NoOpResultError } = await import('./fixSuggestionsService.js');
    await expect(
      applySuggestions({
        jobDir,
        userSuggestions: 'Try to change the resume.',
        attachedFiles: [],
        resumePath,
      })
    ).rejects.toBeInstanceOf(NoOpResultError);
    expect(runOpenCodeMock).toHaveBeenCalledTimes(2);
    expect(fs.readFileSync(resumePath, 'utf8')).toContain('"summary": "Original summary"');
  });

  it('creates the promptLogDir under the job folder before calling runOpenCode', async () => {
    const { jobDir, resumePath } = makeFixture();
    const updated = JSON.parse(JSON.stringify(RESUME_BASE));
    updated.skills.libraries = 'Jest';
    runOpenCodeMock.mockResolvedValueOnce({ structured: updated, sessionId: 'ses_logdir' });

    const { applySuggestions } = await import('./fixSuggestionsService.js');
    await applySuggestions({
      jobDir,
      userSuggestions: 'x',
      attachedFiles: [],
      resumePath,
    });

    const expectedDir = path.join(jobDir, 'prompt-logs', 'fix-suggestions');
    expect(fs.existsSync(expectedDir)).toBe(true);
    expect(runOpenCodeMock).toHaveBeenCalled();
    const callOpts = runOpenCodeMock.mock.calls[0][0];
    expect(callOpts.promptLogDir).toBe(expectedDir);
  });

  it('throws InvalidResponseError when the model returns garbage', async () => {
    const { jobDir, resumePath } = makeFixture();
    runOpenCodeMock.mockResolvedValueOnce({ structured: null, sessionId: 'ses_bad' });

    const { applySuggestions, InvalidResponseError } = await import('./fixSuggestionsService.js');
    await expect(
      applySuggestions({
        jobDir,
        userSuggestions: 'Anything',
        attachedFiles: [],
        resumePath,
      })
    ).rejects.toBeInstanceOf(InvalidResponseError);
  });

  it('rejects when jobDir does not exist', async () => {
    const { resumePath } = makeFixture();
    await expectApplySuggestionsRejects(
      { jobDir: '/tmp/opencode/does-not-exist', userSuggestions: 'x', attachedFiles: [], resumePath },
      /jobDir does not exist/
    );
  });

  it('rejects when resumePath does not exist', async () => {
    const { jobDir } = makeFixture();
    await expectApplySuggestionsRejects(
      { jobDir, userSuggestions: 'x', attachedFiles: [], resumePath: path.join(jobDir, 'nope.json') },
      /resumePath does not exist/
    );
  });

  it('rejects when userSuggestions is empty', async () => {
    const { jobDir, resumePath } = makeFixture();
    await expectApplySuggestionsRejects(
      { jobDir, userSuggestions: '   ', attachedFiles: [], resumePath },
      /userSuggestions is required/
    );
  });
});

async function expectApplySuggestionsRejects(input: Record<string, unknown>, matcher: RegExp) {
  const { applySuggestions } = await import('./fixSuggestionsService.js');
  await expect(applySuggestions(input as any)).rejects.toThrow(matcher);
}
