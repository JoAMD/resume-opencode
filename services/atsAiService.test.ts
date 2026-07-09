import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ResumeData } from './types';

vi.mock('@opencode-ai/sdk', () => ({
  createOpencodeClient: vi.fn(),
}));

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

function buildMockClient(respondWith: () => any) {
  return {
    chat: {
      completions: {
        create: vi.fn().mockImplementation(async () => respondWith()),
      },
    },
  };
}

async function loadModule() {
  vi.resetModules();
  process.env.OPENCODE_AI_QUEUE = 'false';
  process.env.OPENCODE_AI_CONCURRENCY = '1';
  const sdkModule = await import('@opencode-ai/sdk');
  const { createOpencodeClient } = sdkModule as unknown as { createOpencodeClient: any };
  const mod = await import('./atsAiService.js');
  return { ...mod, createOpencodeClient: createOpencodeClient as unknown as ReturnType<typeof vi.fn> };
}

describe('runAtsAiAnalysis', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ats-ai-'));
  });

  it('sends a redacted resume to the model (PII invariant)', async () => {
    process.env.OPENCODE_ATS_AI = 'true';
    const { runAtsAiAnalysis, createOpencodeClient } = await loadModule();
    const mockClient = buildMockClient(() => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              includedInResume: ['typescript', 'react'],
              missingFromResume: ['aws'],
              strengths: ['Strong React background'],
              gaps: [{ keyword: 'aws', why: 'Core requirement', suggestion: 'Add a bullet' }],
              recommendations: ['Add AWS bullet'],
              summaryMarkdown: '## Summary\n\nGood fit, gap on AWS.',
            }),
          },
        },
      ],
    }));
    (createOpencodeClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => mockClient);

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

    const createCall = mockClient.chat.completions.create.mock.calls[0][0];
    const userContent: string = createCall.messages[1].content;
    expect(userContent).not.toContain('Jane Q Public');
    expect(userContent).not.toContain('+61 400 111 222');
    expect(userContent).not.toContain('jane@example.com');
    expect(userContent).not.toContain('linkedin.com/in/janepublic');
    expect(userContent).not.toContain('github.com/janepublic');
    expect(userContent).not.toContain('janepublic');

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

  it('falls back to regex coverage when the AI call throws', async () => {
    process.env.OPENCODE_ATS_AI = 'true';
    const { runAtsAiAnalysis, createOpencodeClient } = await loadModule();
    const mockClient = buildMockClient(() => {
      throw new Error('network down');
    });
    (createOpencodeClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => mockClient);

    const result = await runAtsAiAnalysis({
      jobDescription: 'Need a TypeScript + React engineer with AWS experience.',
      resume: buildSampleResume(),
      jdKeywords: ['typescript', 'react', 'aws'],
      jobDir: tmpDir,
    });

    expect(result.source).toBe('regex');
    expect(result.fallbackReason).toContain('network down');
    expect(result.analysis.coveragePercent).toBeDefined();
    expect(result.analysis.summaryMarkdown).toMatch(/unavailable|failed/i);
    expect(result.analysis.summaryMarkdown).toContain('network down');
  });

  it('falls back to regex when the AI returns invalid JSON', async () => {
    process.env.OPENCODE_ATS_AI = 'true';
    const { runAtsAiAnalysis, createOpencodeClient } = await loadModule();
    const mockClient = buildMockClient(() => ({
      choices: [{ message: { content: 'not valid json' } }],
    }));
    (createOpencodeClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => mockClient);

    const result = await runAtsAiAnalysis({
      jobDescription: 'Need a TypeScript engineer.',
      resume: buildSampleResume(),
      jdKeywords: ['typescript', 'aws'],
      jobDir: tmpDir,
    });

    expect(result.source).toBe('regex');
    expect(result.analysis.coveragePercent).toBeDefined();
  });

  it('returns 100% coverage with empty arrays when jdKeywords is empty after sanitisation', async () => {
    process.env.OPENCODE_ATS_AI = 'true';
    const { runAtsAiAnalysis, createOpencodeClient } = await loadModule();
    const mockClient = buildMockClient(() => ({ choices: [{ message: { content: '{}' } }] }));
    (createOpencodeClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => mockClient);

    await expect(
      runAtsAiAnalysis({
        jobDescription: '...',
        resume: buildSampleResume(),
        jdKeywords: [],
        jobDir: tmpDir,
      }),
    ).rejects.toThrow(/No ATS keywords/i);
  });

  it('respects OPENCODE_ATS_AI=false (always regex, no API call)', async () => {
    process.env.OPENCODE_ATS_AI = 'false';
    const { runAtsAiAnalysis, createOpencodeClient } = await loadModule();
    const mockClient = buildMockClient(() => {
      throw new Error('should not be called');
    });
    (createOpencodeClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => mockClient);

    const result = await runAtsAiAnalysis({
      jobDescription: 'Need a TypeScript engineer with AWS.',
      resume: buildSampleResume(),
      jdKeywords: ['typescript', 'aws'],
      jobDir: tmpDir,
    });

    expect(result.source).toBe('regex');
    expect(result.fallbackReason).toBe('OPENCODE_ATS_AI=false');
    expect(mockClient.chat.completions.create).not.toHaveBeenCalled();
  });

  it('extracts JD keywords via AI when none are provided', async () => {
    process.env.OPENCODE_ATS_AI = 'true';
    const { runAtsAiAnalysis, createOpencodeClient } = await loadModule();
    const mockClient = buildMockClient((() => {
      let call = 0;
      return () => {
        call++;
        if (call === 1) {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify(['typescript', 'aws']),
                },
              },
            ],
          };
        }
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  includedInResume: ['typescript', 'aws'],
                  missingFromResume: [],
                }),
              },
            },
          ],
        };
      };
    })());
    (createOpencodeClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => mockClient);

    const result = await runAtsAiAnalysis({
      jobDescription: 'Need a TypeScript engineer with AWS.',
      resume: buildSampleResume(),
      jdKeywords: undefined,
      jobDir: tmpDir,
    });

    expect(result.source).toBe('ai');
    expect(mockClient.chat.completions.create).toHaveBeenCalledTimes(2);
  });
});
