import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ResumeData } from './types';

function buildSampleResume(): ResumeData {
  return {
    name: 'Jane Q Public',
    phone: '+61 400 111 222',
    email: 'jane@example.com',
    linkedinUrl: 'https://linkedin.com/in/janepublic',
    linkedinDisplay: 'linkedin.com/in/janepublic',
    githubUrl: 'https://github.com/janepublic',
    githubDisplay: 'github.com/janepublic',
    summary: 'Full-stack engineer with TypeScript and React experience.',
    skills: { languages: 'TypeScript, JavaScript', frameworks: 'React, Next.js', tools: 'Git, Docker', libraries: '' },
    experience: [
      {
        company: 'Acme Co',
        title: 'Senior Engineer',
        location: 'Sydney',
        dates: '2022-2025',
        bullets: ['Built React + TypeScript dashboards used by 5k users'],
      },
    ],
    education: [{ institution: 'University of Sydney', location: 'Sydney NSW', degree: 'BSc CS', dates: '2015-2018' }],
    projects: [{ name: 'Open Source Tool', techStack: 'Node.js, TypeScript', bullets: ['Processed 1M records/day'] }],
  };
}

const runOpenCodeMock = vi.fn();
const enqueueMock = vi.fn((_model: string, work: () => any) => work());
const extractKeywordsMock = vi.fn(async () => ['typescript', 'aws']);

vi.mock('./ai.js', async () => {
  const actual = await vi.importActual<any>('./ai.js');
  return {
    ...actual,
    runOpenCode: (...args: any[]) => (runOpenCodeMock as any)(...args),
    enqueueAIRequest: (model: string, work: () => any) => enqueueMock(model, work),
    extractATSKeywordsFromJDViaAI: (...args: any[]) => (extractKeywordsMock as any)(...args),
  };
});

async function loadModule() {
  vi.resetModules();
  runOpenCodeMock.mockReset();
  enqueueMock.mockReset();
  extractKeywordsMock.mockReset();
  extractKeywordsMock.mockResolvedValue(['typescript', 'aws']);
  enqueueMock.mockImplementation((_model: string, work: () => any) => work());
  process.env.OPENCODE_AI_QUEUE = 'false';
  process.env.OPENCODE_AI_CONCURRENCY = '1';
  const mod = await import('./atsAiService.js');
  return mod;
}

describe('runAtsAiAnalysis', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ats-ai-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends a redacted resume to the model (PII invariant)', async () => {
    process.env.OPENCODE_ATS_AI = 'true';
    const { runAtsAiAnalysis } = await loadModule();
    runOpenCodeMock.mockResolvedValueOnce({
      structured: {
        includedInResume: ['typescript', 'react'],
        missingFromResume: ['aws'],
        strengths: ['Strong React background'],
        gaps: [{ keyword: 'aws', why: 'Core requirement', suggestion: 'Add a bullet' }],
        recommendations: ['Add AWS bullet'],
        summaryMarkdown: '## Summary\n\nGood fit, gap on AWS.',
      },
      rawText: '',
      usedStructuredOutput: true,
    });

    const result = await runAtsAiAnalysis({
      jobDescription: 'Looking for a TypeScript + React engineer with AWS experience.',
      resume: buildSampleResume(),
      jdKeywords: ['typescript', 'react', 'aws'],
      jobDir: tmpDir,
    });

    expect(result.source).toBe('ai');
    expect(result.analysis.coveragePercent).toBe(67);
    expect(result.analysis.includedInResume).toEqual(['react', 'typescript']);
    expect(result.analysis.missingFromResume).toEqual(['aws']);
    expect(result.analysis.strengths).toEqual(['Strong React background']);
    expect(result.analysis.gaps?.[0]?.keyword).toBe('aws');
    expect(result.analysis.summaryMarkdown).toContain('Good fit');

    expect(runOpenCodeMock).toHaveBeenCalledTimes(1);
    const callArgs = runOpenCodeMock.mock.calls[0][0];
    expect(callArgs.jsonSchema).toBeTruthy();
    expect(callArgs.userContent).not.toContain('Jane Q Public');
    expect(callArgs.userContent).not.toContain('+61 400 111 222');
    expect(callArgs.userContent).not.toContain('jane@example.com');
    expect(callArgs.userContent).not.toContain('linkedin.com/in/janepublic');
    expect(callArgs.userContent).not.toContain('github.com/janepublic');
    expect(callArgs.userContent).not.toContain('janepublic');

    expect(result.redactedResumePath).toBe(path.join(tmpDir, 'structured-output-redacted.json'));
    expect(fs.existsSync(result.redactedResumePath!)).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(result.redactedResumePath!, 'utf8')) as ResumeData;
    expect(onDisk.name).toBe('');
    expect(onDisk.phone).toBe('');
    expect(onDisk.email).toBe('');
    expect(onDisk.linkedinUrl).toBe('');
    expect(onDisk.linkedinDisplay).toBe('');
    expect(onDisk.githubUrl).toBe('');
    expect(onDisk.githubDisplay).toBe('');
    expect(onDisk.summary).toContain('TypeScript');
  });

  it('falls back to regex coverage when runOpenCode throws', async () => {
    process.env.OPENCODE_ATS_AI = 'true';
    const { runAtsAiAnalysis } = await loadModule();
    runOpenCodeMock.mockRejectedValueOnce(new Error('session create failed'));

    const result = await runAtsAiAnalysis({
      jobDescription: 'Need a TypeScript + React engineer with AWS experience.',
      resume: buildSampleResume(),
      jdKeywords: ['typescript', 'react', 'aws'],
      jobDir: tmpDir,
    });

    expect(result.source).toBe('regex');
    expect(result.fallbackReason).toContain('session create failed');
    expect(result.analysis.coveragePercent).toBeDefined();
    expect(result.analysis.summaryMarkdown).toMatch(/unavailable|failed/i);
    expect(result.analysis.summaryMarkdown).toContain('session create failed');
  });

  it('falls back to regex when the model returns no structured response', async () => {
    process.env.OPENCODE_ATS_AI = 'true';
    const { runAtsAiAnalysis } = await loadModule();
    runOpenCodeMock.mockResolvedValueOnce({ structured: null, rawText: '', usedStructuredOutput: false });

    const result = await runAtsAiAnalysis({
      jobDescription: 'Need a TypeScript engineer.',
      resume: buildSampleResume(),
      jdKeywords: ['typescript', 'aws'],
      jobDir: tmpDir,
    });

    expect(result.source).toBe('regex');
    expect(result.fallbackReason).toMatch(/no structured response/i);
  });

  it('throws No ATS keywords when AI extraction returns empty and none supplied', async () => {
    process.env.OPENCODE_ATS_AI = 'true';
    const { runAtsAiAnalysis } = await loadModule();
    extractKeywordsMock.mockResolvedValueOnce([]);

    await expect(
      runAtsAiAnalysis({
        jobDescription: '...',
        resume: buildSampleResume(),
        jdKeywords: undefined,
        jobDir: tmpDir,
      }),
    ).rejects.toThrow(/No ATS keywords/i);
  });

  it('respects OPENCODE_ATS_AI=false (always regex, no runOpenCode call)', async () => {
    process.env.OPENCODE_ATS_AI = 'false';
    const { runAtsAiAnalysis } = await loadModule();

    const result = await runAtsAiAnalysis({
      jobDescription: 'Need a TypeScript engineer with AWS.',
      resume: buildSampleResume(),
      jdKeywords: ['typescript', 'aws'],
      jobDir: tmpDir,
    });

    expect(result.source).toBe('regex');
    expect(result.fallbackReason).toBe('OPENCODE_ATS_AI=false');
    expect(runOpenCodeMock).not.toHaveBeenCalled();
  });

  it('uses modelOverride for the AI call and reports it back on the outcome', async () => {
    process.env.OPENCODE_ATS_AI = 'true';
    delete process.env.OPENCODE_ATS_ANALYSIS_MODEL;
    const { runAtsAiAnalysis } = await loadModule();
    runOpenCodeMock.mockResolvedValueOnce({
      structured: {
        includedInResume: ['typescript'],
        missingFromResume: ['aws'],
      },
      rawText: '',
      usedStructuredOutput: true,
    });

    const result = await runAtsAiAnalysis({
      jobDescription: 'Need a TypeScript engineer with AWS.',
      resume: buildSampleResume(),
      jdKeywords: ['typescript', 'aws'],
      jobDir: tmpDir,
      modelOverride: 'opencode-go/minimax-m2.5',
    });

    expect(result.source).toBe('ai');
    expect(result.modelUsed).toBe('opencode-go/minimax-m2.5');
    expect(result.analysis.model).toBe('opencode-go/minimax-m2.5');
    expect(enqueueMock).toHaveBeenCalledWith('opencode-go/minimax-m2.5', expect.any(Function));
    const callArgs = runOpenCodeMock.mock.calls[0][0];
    expect(callArgs.model).toBe('opencode-go/minimax-m2.5');
  });
});
