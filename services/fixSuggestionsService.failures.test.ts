import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const runOpenCodeMock = vi.fn();
const buildLatexMock = vi.fn();
const compilePDFMock = vi.fn();
const ensureRedactedResumeFileMock = vi.fn();
const createVersionedBackupMock = vi.fn();

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
  createVersionedBackup: (...args: unknown[]) => createVersionedBackupMock(...args),
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-suggestions-fail-'));
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

async function expectApplySuggestionsRejects(
  fixture: { jobDir: string; resumePath: string; redactedPath: string },
  matcher: RegExp,
): Promise<void> {
  const { applySuggestions } = await import('./fixSuggestionsService.js');
  await expect(
    applySuggestions({
      jobDir: fixture.jobDir,
      userSuggestions: 'x',
      attachedFiles: [],
      resumePath: fixture.resumePath,
      redactedResumePath: fixture.redactedPath,
    }),
  ).rejects.toThrow(matcher);
}

describe('applySuggestions — failure modes', () => {
  beforeEach(() => {
    runOpenCodeMock.mockReset();
    buildLatexMock.mockReset();
    compilePDFMock.mockReset();
    ensureRedactedResumeFileMock.mockReset();
    createVersionedBackupMock.mockReset();
    buildLatexMock.mockReturnValue('\\documentclass{article}\\begin{document}updated\\end{document}');
    compilePDFMock.mockResolvedValue(Buffer.from('%PDF-1.4\nupdated'));
    ensureRedactedResumeFileMock.mockImplementation((jobDir: string, source: any) => {
      const redacted = JSON.parse(JSON.stringify(source));
      for (const f of ['name', 'phone', 'email', 'linkedinUrl', 'linkedinDisplay']) {
        redacted[f] = '';
      }
      const targetPath = path.join(jobDir, 'structured-output-redacted.json');
      fs.writeFileSync(targetPath, JSON.stringify(redacted, null, 2), 'utf8');
      return { path: targetPath, redacted, wroteFile: true };
    });
    createVersionedBackupMock.mockReturnValue({
      version: 1,
      backupDir: '/tmp/opencode/job-fake/backups/v1',
      files: ['structured-output.json', 'resume.pdf', 'resume.tex'],
    });
  });

  // ─── runModelAttempt (runOpenCode) failures ─────────────────────────────

  describe('first-try model failure', () => {
    it('throws when the first runOpenCode call rejects (no second attempt)', async () => {
      const fixture = makeFixture();
      runOpenCodeMock.mockRejectedValueOnce(new Error('synthetic network failure'));

      await expectApplySuggestionsRejects(fixture, /synthetic network failure/);
      expect(runOpenCodeMock).toHaveBeenCalledTimes(1);
      expect(fs.readFileSync(fixture.resumePath, 'utf8')).toContain('"summary": "Original summary"');
    });

    it('throws when the second runOpenCode call rejects after a no-op first attempt', async () => {
      const fixture = makeFixture();
      runOpenCodeMock
        .mockResolvedValueOnce({ sessionId: 'ses_first_ok' })
        .mockRejectedValueOnce(new Error('synthetic retry failure'));

      await expectApplySuggestionsRejects(fixture, /synthetic retry failure/);
      expect(runOpenCodeMock).toHaveBeenCalledTimes(2);
      expect(fs.readFileSync(fixture.resumePath, 'utf8')).toContain('"summary": "Original summary"');
    });

    it('retry user content includes the follow-up instruction when the first attempt is a no-op', async () => {
      const fixture = makeFixture();
      let callCount = 0;
      runOpenCodeMock.mockImplementation(async () => {
        callCount += 1;
        if (callCount === 1) return { sessionId: 'ses_first' };
        if (callCount === 2) {
          applyEditsToFile(fixture.resumePath, (r) => { r.summary = 'Edited on retry'; });
          return { sessionId: 'ses_second' };
        }
        return { sessionId: 'ses_extra' };
      });

      const { applySuggestions } = await import('./fixSuggestionsService.js');
      await applySuggestions({
        jobDir: fixture.jobDir,
        userSuggestions: 'Tighten the summary.',
        attachedFiles: [],
        resumePath: fixture.resumePath,
        redactedResumePath: fixture.redactedPath,
      });

      expect(callCount).toBe(2);
      const firstCall = runOpenCodeMock.mock.calls[0][0];
      const secondCall = runOpenCodeMock.mock.calls[1][0];
      expect(secondCall.userContent).toContain('FOLLOW-UP');
      expect(secondCall.userContent).toContain('Tighten the summary.');
      expect(secondCall.userContent.length).toBeGreaterThan(firstCall.userContent.length);
    });
  });

  // ─── Disk / filesystem failures before the model call ──────────────────────

  describe('disk failures', () => {
    it('throws when the backup cannot be created (no model call, file unchanged)', async () => {
      const fixture = makeFixture();
      createVersionedBackupMock.mockImplementation(() => {
        throw new Error('disk full while creating backup');
      });

      await expectApplySuggestionsRejects(fixture, /disk full/);
      expect(runOpenCodeMock).not.toHaveBeenCalled();
      expect(fs.readFileSync(fixture.resumePath, 'utf8')).toContain('"summary": "Original summary"');
    });

    it('throws when the promptLogDir cannot be created (no model call, file unchanged)', async () => {
      const fixture = makeFixture();
      const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(((p: fs.PathLike) => {
        if (String(p).includes('prompt-logs')) {
          throw new Error('permission denied on prompt-logs dir');
        }
        return undefined as never;
      }) as typeof fs.mkdirSync);

      try {
        await expectApplySuggestionsRejects(fixture, /permission denied/);
        expect(runOpenCodeMock).not.toHaveBeenCalled();
        expect(fs.readFileSync(fixture.resumePath, 'utf8')).toContain('"summary": "Original summary"');
      } finally {
        mkdirSpy.mockRestore();
      }
    });
  });

  // ─── writeOutputs failures after the model call ───────────────────────────

  describe('post-edit build failures', () => {
    it('throws when LaTeX/PDF build fails after a successful edit', async () => {
      const { jobDir, resumePath, redactedPath } = makeFixture();
      runOpenCodeMock.mockImplementationOnce(async () => {
        applyEditsToFile(resumePath, (r) => { r.summary = 'Edited by model'; });
        return { sessionId: 'ses_edit_ok' };
      });
      compilePDFMock.mockRejectedValueOnce(new Error('tectonic unavailable'));

      const { applySuggestions } = await import('./fixSuggestionsService.js');
      await expect(
        applySuggestions({
          jobDir,
          userSuggestions: 'x',
          attachedFiles: [],
          resumePath,
          redactedResumePath: redactedPath,
        })
      ).rejects.toThrow(/tectonic unavailable/);
      const onDisk = JSON.parse(fs.readFileSync(resumePath, 'utf8'));
      expect(onDisk.summary).toBe('Edited by model');
      expect(ensureRedactedResumeFileMock).not.toHaveBeenCalled();
    });

    it('throws when writing the new structured-output.json fails after a successful edit', async () => {
      const { jobDir, resumePath, redactedPath } = makeFixture();
      runOpenCodeMock.mockImplementationOnce(async () => {
        applyEditsToFile(resumePath, (r) => { r.summary = 'Edited by model'; });
        return { sessionId: 'ses_edit_ok' };
      });
      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(((
        p: fs.PathLike,
        data: any,
        _enc?: string | null,
      ) => {
        if (String(p).endsWith('structured-output.json') && String(data).includes('Edited by model')) {
          throw new Error('read-only filesystem');
        }
        return undefined as never;
      }) as typeof fs.writeFileSync);

      const { applySuggestions } = await import('./fixSuggestionsService.js');
      await expect(
        applySuggestions({
          jobDir,
          userSuggestions: 'x',
          attachedFiles: [],
          resumePath,
          redactedResumePath: redactedPath,
        })
      ).rejects.toThrow(/read-only filesystem/);
      expect(ensureRedactedResumeFileMock).not.toHaveBeenCalled();
      writeSpy.mockRestore();
    });
  });
});
