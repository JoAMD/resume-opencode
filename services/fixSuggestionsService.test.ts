import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const runOpenCodeMock = vi.fn();
const buildLatexMock = vi.fn();
const compilePDFMock = vi.fn();
const ensureRedactedResumeFileMock = vi.fn();

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

vi.mock('./redactResume', async () => {
  const actual = await vi.importActual<typeof import('./redactResume.js')>('./redactResume.js');
  return {
    ...actual,
    ensureRedactedResumeFile: (...args: unknown[]) => ensureRedactedResumeFileMock(...args),
  };
});

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
  const redactedPath = path.join(jobDir, 'structured-output-redacted.json');
  fs.writeFileSync(resumePath, JSON.stringify(RESUME_BASE, null, 2));
  const redacted = JSON.parse(JSON.stringify(RESUME_BASE));
  for (const f of ['name', 'phone', 'email', 'linkedinUrl', 'linkedinDisplay']) {
    redacted[f] = '';
  }
  fs.writeFileSync(redactedPath, JSON.stringify(redacted, null, 2));
  fs.writeFileSync(path.join(jobDir, 'ats-analysis.md'), '# ATS analysis\n');
  fs.writeFileSync(path.join(jobDir, 'job-description.txt'), 'Build cool stuff.');
  fs.writeFileSync(path.join(jobDir, 'other-input.txt'), 'Company: Shopify\nRole: Senior SWE\n');
  return { root, jobDir, resumePath, redactedPath };
}

function applyEditsToFile(resumePath: string, mutator: (resume: any) => void) {
  const current = JSON.parse(fs.readFileSync(resumePath, 'utf8'));
  mutator(current);
  fs.writeFileSync(resumePath, JSON.stringify(current, null, 2), 'utf8');
}

describe('resumesAreEqual', () => {
  it('returns true for identical objects regardless of key order', async () => {
    const { resumesAreEqual } = await import('./diffUtil.js');
    const a = { x: 1, y: { z: 2, w: 3 }, arr: [1, 2, 3] };
    const b = { y: { w: 3, z: 2 }, x: 1, arr: [1, 2, 3] };
    expect(resumesAreEqual(a, b)).toBe(true);
  });

  it('returns false when one field differs', async () => {
    const { resumesAreEqual } = await import('./diffUtil.js');
    const a = { x: 1, y: 2 };
    const b = { x: 1, y: 3 };
    expect(resumesAreEqual(a, b)).toBe(false);
  });

  it('returns false when array order differs', async () => {
    const { resumesAreEqual } = await import('./diffUtil.js');
    expect(resumesAreEqual({ arr: [1, 2, 3] }, { arr: [3, 2, 1] })).toBe(false);
  });
});

describe('applySuggestions', () => {
  beforeEach(() => {
    runOpenCodeMock.mockReset();
    buildLatexMock.mockReset();
    compilePDFMock.mockReset();
    ensureRedactedResumeFileMock.mockReset();
    buildLatexMock.mockReturnValue('\\documentclass{article}\\begin{document}updated\\end{document}');
    compilePDFMock.mockResolvedValue(Buffer.from('%PDF-1.4\nupdated'));
    ensureRedactedResumeFileMock.mockImplementation((jobDir: string, source: { name: string; email: string; phone: string; linkedinUrl: string; linkedinDisplay: string; [k: string]: unknown }) => {
      const redacted = JSON.parse(JSON.stringify(source));
      for (const f of ['name', 'phone', 'email', 'linkedinUrl', 'linkedinDisplay']) {
        redacted[f] = '';
      }
      const targetPath = path.join(jobDir, 'structured-output-redacted.json');
      fs.writeFileSync(targetPath, JSON.stringify(redacted, null, 2), 'utf8');
      return { path: targetPath, redacted, wroteFile: true };
    });
  });

  it('writes structured-output.json + resume.tex + resume.pdf on success', async () => {
    const { jobDir, resumePath, redactedPath } = makeFixture();
    runOpenCodeMock.mockImplementationOnce(async () => {
      applyEditsToFile(resumePath, (r) => {
        r.summary = 'Tightened summary mentioning Kafka and Terraform';
        r.skills.frameworks = 'Express, Kafka';
      });
      return { sessionId: 'ses_new_1' };
    });

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
      redactedResumePath: redactedPath,
    });

    expect(result.sessionId).toBe('ses_new_1');
    expect(result.pdfUrl).toBe(`/jobs/${path.basename(jobDir)}/resume.pdf`);
    const updated = JSON.parse(fs.readFileSync(resumePath, 'utf8'));
    expect(updated.summary).toContain('Tightened');
    expect(updated.name).toBe('Test User');
    expect(updated.email).toBe('test@example.com');
    expect(updated.skills.frameworks).toContain('Kafka');
    expect(fs.existsSync(path.join(jobDir, 'resume.tex'))).toBe(true);
    expect(fs.existsSync(path.join(jobDir, 'resume.pdf'))).toBe(true);
    expect(runOpenCodeMock).toHaveBeenCalledTimes(1);
  });

  it('retries once on no-op and returns success when retry changes the resume on disk', async () => {
    const { jobDir, resumePath, redactedPath } = makeFixture();
    runOpenCodeMock
      .mockImplementationOnce(async () => ({ sessionId: 'ses_attempt1' }))
      .mockImplementationOnce(async () => {
        applyEditsToFile(resumePath, (r) => { r.skills.libraries = 'Jest'; });
        return { sessionId: 'ses_attempt2' };
      });

    const { applySuggestions } = await import('./fixSuggestionsService.js');
    const result = await applySuggestions({
      jobDir,
      userSuggestions: 'Add Jest to libraries.',
      attachedFiles: [],
      resumePath,
      redactedResumePath: redactedPath,
    });

    expect(runOpenCodeMock).toHaveBeenCalledTimes(2);
    expect(result.sessionId).toBe('ses_attempt2');
    expect(JSON.parse(fs.readFileSync(resumePath, 'utf8')).skills.libraries).toBe('Jest');
  });

  it('throws NoOpResultError when both attempts leave the file unchanged', async () => {
    const { jobDir, resumePath, redactedPath } = makeFixture();
    runOpenCodeMock
      .mockResolvedValueOnce({ sessionId: 'ses_a' })
      .mockResolvedValueOnce({ sessionId: 'ses_b' });

    const { applySuggestions, NoOpResultError } = await import('./fixSuggestionsService.js');
    await expect(
      applySuggestions({
        jobDir,
        userSuggestions: 'Try to change the resume.',
        attachedFiles: [],
        resumePath,
        redactedResumePath: redactedPath,
      })
    ).rejects.toBeInstanceOf(NoOpResultError);
    expect(runOpenCodeMock).toHaveBeenCalledTimes(2);
    expect(fs.readFileSync(resumePath, 'utf8')).toContain('"summary": "Original summary"');
  });

  it('preserves PII fields when the model edits the file on disk', async () => {
    const { jobDir, resumePath, redactedPath } = makeFixture();
    const originalContent = fs.readFileSync(resumePath, 'utf8');
    runOpenCodeMock.mockImplementationOnce(async () => {
      applyEditsToFile(resumePath, (r) => {
        r.summary = 'Updated summary.';
      });
      return { sessionId: 'ses_pii' };
    });

    const { applySuggestions } = await import('./fixSuggestionsService.js');
    await applySuggestions({
      jobDir,
      userSuggestions: 'Update summary only.',
      attachedFiles: [],
      resumePath,
      redactedResumePath: redactedPath,
    });

    const after = JSON.parse(fs.readFileSync(resumePath, 'utf8'));
    expect(after.name).toBe('Test User');
    expect(after.email).toBe('test@example.com');
    expect(after.phone).toBe('0400000000');
    expect(after.summary).toBe('Updated summary.');
    expect(after.education[0].institution).toBe('Uni');
    expect(originalContent).not.toBe(fs.readFileSync(resumePath, 'utf8'));
  });

  it('creates the promptLogDir under the job folder before calling runOpenCode', async () => {
    const { jobDir, resumePath, redactedPath } = makeFixture();
    runOpenCodeMock.mockImplementationOnce(async () => {
      applyEditsToFile(resumePath, (r) => { r.skills.libraries = 'Jest'; });
      return { sessionId: 'ses_logdir' };
    });

    const { applySuggestions } = await import('./fixSuggestionsService.js');
    await applySuggestions({
      jobDir,
      userSuggestions: 'x',
      attachedFiles: [],
      resumePath,
      redactedResumePath: redactedPath,
    });

    const expectedDir = path.join(jobDir, 'prompt-logs', 'fix-suggestions');
    expect(fs.existsSync(expectedDir)).toBe(true);
    expect(runOpenCodeMock).toHaveBeenCalled();
    const callOpts = runOpenCodeMock.mock.calls[0][0];
    expect(callOpts.promptLogDir).toBe(expectedDir);
    expect(callOpts.jsonSchema).toBeUndefined();
  });

  it('rejects when jobDir does not exist', async () => {
    const { resumePath, redactedPath } = makeFixture();
    await expectApplySuggestionsRejects(
      { jobDir: '/tmp/opencode/does-not-exist', userSuggestions: 'x', attachedFiles: [], resumePath, redactedResumePath: redactedPath },
      /jobDir does not exist/
    );
  });

  it('rejects when resumePath does not exist', async () => {
    const { jobDir, redactedPath } = makeFixture();
    await expectApplySuggestionsRejects(
      { jobDir, userSuggestions: 'x', attachedFiles: [], resumePath: path.join(jobDir, 'nope.json'), redactedResumePath: redactedPath },
      /resumePath does not exist/
    );
  });

  it('rejects when redactedResumePath does not exist', async () => {
    const { jobDir, resumePath } = makeFixture();
    await expectApplySuggestionsRejects(
      { jobDir, userSuggestions: 'x', attachedFiles: [], resumePath, redactedResumePath: path.join(jobDir, 'nope.json') },
      /redactedResumePath does not exist/
    );
  });

  it('rejects when userSuggestions is empty', async () => {
    const { jobDir, resumePath, redactedPath } = makeFixture();
    await expectApplySuggestionsRejects(
      { jobDir, userSuggestions: '   ', attachedFiles: [], resumePath, redactedResumePath: redactedPath },
      /userSuggestions is required/
    );
  });

  it('regenerates structured-output-redacted.json after a successful edit', async () => {
    const { jobDir, resumePath, redactedPath } = makeFixture();
    runOpenCodeMock.mockImplementationOnce(async () => {
      applyEditsToFile(resumePath, (r) => {
        r.summary = 'Tightened summary mentioning Kafka';
        r.skills.frameworks = 'Express, Kafka';
      });
      return { sessionId: 'ses_regen' };
    });

    const { applySuggestions } = await import('./fixSuggestionsService.js');
    await applySuggestions({
      jobDir,
      userSuggestions: 'Tighten the summary. Add Kafka.',
      attachedFiles: [],
      resumePath,
      redactedResumePath: redactedPath,
    });

    expect(fs.existsSync(redactedPath)).toBe(true);
    const redacted = JSON.parse(fs.readFileSync(redactedPath, 'utf8'));
    expect(redacted.summary).toBe('Tightened summary mentioning Kafka');
    expect(redacted.skills.frameworks).toBe('Express, Kafka');
    expect(redacted.name).toBe('');
    expect(redacted.email).toBe('');
    expect(redacted.phone).toBe('');
    expect(redacted.education[0].institution).toBe('Uni');
  });

  it('continues when ensureRedactedResumeFile throws (redacted file is stale until next call)', async () => {
    const { jobDir, resumePath, redactedPath } = makeFixture();
    runOpenCodeMock.mockImplementationOnce(async () => {
      applyEditsToFile(resumePath, (r) => { r.summary = 'Updated'; });
      return { sessionId: 'ses_throw' };
    });
    ensureRedactedResumeFileMock.mockImplementation(() => { throw new Error('synthetic redact failure'); });

    const { applySuggestions } = await import('./fixSuggestionsService.js');
    const result = await applySuggestions({
      jobDir,
      userSuggestions: 'x',
      attachedFiles: [],
      resumePath,
      redactedResumePath: redactedPath,
    });

    expect(result.sessionId).toBe('ses_throw');
    const real = JSON.parse(fs.readFileSync(resumePath, 'utf8'));
    expect(real.summary).toBe('Updated');
  });
});

async function expectApplySuggestionsRejects(input: Record<string, unknown>, matcher: RegExp) {
  const { applySuggestions } = await import('./fixSuggestionsService.js');
  await expect(applySuggestions(input as any)).rejects.toThrow(matcher);
}
