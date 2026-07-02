import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const sessionCalls: Array<{ method: string; sessionId?: string }> = [];
let sessionCounter = 0;
let mockClient: any;
let mockStructuredResponse: any = null;

function buildSmallResume(): any {
  return {
    name: 'Test User',
    phone: '0400000000',
    email: 'test@example.com',
    linkedinUrl: 'https://linkedin.com/in/test',
    linkedinDisplay: 'linkedin.com/in/test',
    summary: 'Short summary',
    skills: { languages: 'TS', frameworks: 'React', tools: 'Git', libraries: '' },
    experience: [
      { company: 'Co', title: 'SWE', location: 'Adelaide', dates: '2024', bullets: ['Did things.'] },
    ],
    education: [{ institution: 'Uni', location: 'Adelaide', degree: 'BS', dates: '2018-2020' }],
    projects: [],
  };
}

function buildOversizedResume(): any {
  const longBullet = 'Worked on ' + 'very detailed thing '.repeat(400) + 'and delivered outcomes.';
  return {
    name: 'Test User',
    phone: '0400000000',
    email: 'test@example.com',
    linkedinUrl: 'https://linkedin.com/in/test',
    linkedinDisplay: 'linkedin.com/in/test',
    summary: 'A summary. ' + 'More text. '.repeat(200),
    skills: {
      languages: 'TypeScript, JavaScript, Kotlin, Python, Java, C#, Bash, SQL, HTML5, CSS3',
      frameworks: 'React, Vue.js, Node.js, Express.js, Ktor, GraphQL, REST APIs, Apollo, Prisma, Next.js, ASP.NET MVC, .NET Core',
      tools: 'Docker, Kubernetes, Helm, Git, Bitbucket, Jira, Confluence, Azure App Service, AWS Lambda, Terraform, Bicep, Jenkins, Storybook, Playwright',
      libraries: 'TanStack React Query, Keycloak, Kafka, PostgreSQL, MySQL, SQL Server, OpenAPI/Swagger',
    },
    experience: Array.from({ length: 5 }).map((_, i) => ({
      company: `Company ${i}`,
      title: 'Software Engineer',
      location: 'Adelaide, SA',
      dates: '2024 – Present',
      bullets: Array.from({ length: 8 }).map(() => longBullet),
    })),
    education: [
      { institution: 'University of Adelaide', location: 'Adelaide, SA', degree: 'Bachelor of Computer Science', dates: '2020 – 2024' },
      { institution: 'University of Adelaide', location: 'Adelaide, SA', degree: 'Master of Business Administration', dates: '2024 – Present' },
    ],
    projects: Array.from({ length: 3 }).map((_, i) => ({
      name: `Project ${i}`,
      techStack: 'Docker, Kubernetes, Helm, WireGuard, Caddy, Borg, Pi-hole, CrowdSec, llama.cpp, Open-WebUI',
      bullets: Array.from({ length: 4 }).map(() => longBullet),
    })),
  };
}

vi.mock('@opencode-ai/sdk', () => ({ createOpencodeClient: vi.fn() }));

function buildMockClient() {
  const client: any = {
    session: {
      create: vi.fn(),
      prompt: vi.fn(),
      delete: vi.fn(),
    },
  };
  client.session.create.mockImplementation(async () => {
    sessionCounter++;
    const id = `sess-${sessionCounter}`;
    sessionCalls.push({ method: 'create', sessionId: id });
    return { data: { id }, error: undefined };
  });
  client.session.prompt.mockImplementation(async (opts: any) => {
    sessionCalls.push({ method: 'prompt', sessionId: opts?.path?.id });
    return {
      data: {
        info: {
          structured: mockStructuredResponse,
          parts: [],
          toolCalls: [],
          error: undefined,
        },
        parts: [],
      },
      error: undefined,
    };
  });
  client.session.delete.mockImplementation(async (opts: any) => {
    sessionCalls.push({ method: 'delete', sessionId: opts?.path?.id });
    return { data: { ok: true }, error: undefined };
  });
  return client;
}

async function loadModule(envOverrides: Record<string, string | undefined> = {}) {
  vi.resetModules();
  sessionCalls.length = 0;
  sessionCounter = 0;
  mockClient = undefined;
  mockStructuredResponse = null;
  for (const [k, v] of Object.entries(envOverrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const mod = await import('./ai.js');
  const { createOpencodeClient } = await import('@opencode-ai/sdk');
  mockClient = buildMockClient();
  (createOpencodeClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => mockClient);
  return mod;
}

describe('resume char-limit helpers', () => {
  it('getResumeCharCount returns 0 for null/undefined', async () => {
    const { getResumeCharCount } = await loadModule();
    expect(getResumeCharCount(null)).toBe(0);
    expect(getResumeCharCount(undefined)).toBe(0);
  });

  it('getResumeCharCount returns JSON.stringify length', async () => {
    const { getResumeCharCount } = await loadModule();
    const resume = buildSmallResume();
    expect(getResumeCharCount(resume)).toBe(JSON.stringify(resume).length);
  });

  it('applyResumeCharLimitFlag sets false when under limit', async () => {
    const { applyResumeCharLimitFlag, RESUME_CHAR_LIMIT } = await loadModule();
    const small = buildSmallResume();
    const result = applyResumeCharLimitFlag(small);
    expect(getResumeCharCountLocal(result)).toBeLessThanOrEqual(RESUME_CHAR_LIMIT);
    expect(result.characterCountTrimmed).toBe('false');
  });

  it('applyResumeCharLimitFlag sets true when over limit', async () => {
    const { applyResumeCharLimitFlag, RESUME_CHAR_LIMIT } = await loadModule();
    const big = buildOversizedResume();
    expect(getResumeCharCountLocal(big)).toBeGreaterThan(RESUME_CHAR_LIMIT);
    const result = applyResumeCharLimitFlag(big);
    expect(result.characterCountTrimmed).toBe('true');
  });
});

function getResumeCharCountLocal(resume: any): number {
  return JSON.stringify(resume).length;
}

describe('enforceResumeCharLimit', () => {
  let tmpLogDir: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    tmpLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-trim-'));
    savedEnv = {
      OPENCODE_MODEL: process.env.OPENCODE_MODEL,
      OPENCODE_MODEL_PROVIDER_ID: process.env.OPENCODE_MODEL_PROVIDER_ID,
      OPENCODE_MODEL_ID: process.env.OPENCODE_MODEL_ID,
      OPENCODE_AI_CONCURRENCY: process.env.OPENCODE_AI_CONCURRENCY,
      OPENCODE_AI_QUEUE: process.env.OPENCODE_AI_QUEUE,
      OPENCODE_AI_PROMPT_TIMEOUT_MS: process.env.OPENCODE_AI_PROMPT_TIMEOUT_MS,
      OPENCODE_CLIENT_KEEPALIVE: process.env.OPENCODE_CLIENT_KEEPALIVE,
      OPENCODE_CLIENT_ROTATE_AFTER: process.env.OPENCODE_CLIENT_ROTATE_AFTER,
      OPENCODE_KEEP_SESSION: process.env.OPENCODE_KEEP_SESSION,
      OPENCODE_RESUME_TRIM_MAX_ATTEMPTS: process.env.OPENCODE_RESUME_TRIM_MAX_ATTEMPTS,
    };
    process.env.OPENCODE_AI_CONCURRENCY = '1';
    process.env.OPENCODE_AI_QUEUE = 'false';
    process.env.OPENCODE_CLIENT_KEEPALIVE = 'false';
    process.env.OPENCODE_CLIENT_ROTATE_AFTER = '50';
    process.env.OPENCODE_KEEP_SESSION = 'false';
  });

  afterEach(() => {
    fs.rmSync(tmpLogDir, { recursive: true, force: true });
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('returns immediately with false when resume is under limit', async () => {
    const { enforceResumeCharLimit } = await loadModule();
    const small = buildSmallResume();
    const result = await enforceResumeCharLimit(small, 'opencode/gpt-5-nano', tmpLogDir);
    expect(result.characterCountTrimmed).toBe('false');
    expect(sessionCalls.filter((c) => c.method === 'prompt')).toHaveLength(0);
  });

  it('loops up to the configured max attempts and returns trimmed=true when model keeps overshooting', async () => {
    process.env.OPENCODE_RESUME_TRIM_MAX_ATTEMPTS = '2';
    const { enforceResumeCharLimit, RESUME_CHAR_LIMIT } = await loadModule();
    const result = await runTrimTestCase(enforceResumeCharLimit, buildOversizedResume(), RESUME_CHAR_LIMIT);
    expect(result.characterCountTrimmed).toBe('true');
    const prompts = sessionCalls.filter((c) => c.method === 'prompt');
    expect(prompts.length).toBeLessThanOrEqual(2);
    expect(getResumeCharCountLocal(result)).toBeGreaterThan(RESUME_CHAR_LIMIT);
  });

  it('returns trimmed=true and stops looping as soon as the trimmed result fits', async () => {
    process.env.OPENCODE_RESUME_TRIM_MAX_ATTEMPTS = '3';
    const { enforceResumeCharLimit, RESUME_CHAR_LIMIT } = await loadModule();
    const result = await runTrimTestCase(enforceResumeCharLimit, buildSmallResume(), RESUME_CHAR_LIMIT);
    expect(result.characterCountTrimmed).toBe('true');
    expect(getResumeCharCountLocal(result)).toBeLessThanOrEqual(RESUME_CHAR_LIMIT);
    const prompts = sessionCalls.filter((c) => c.method === 'prompt');
    expect(prompts).toHaveLength(1);
  });

  it('returns trimmed=true and stops on a non-object structured response', async () => {
    process.env.OPENCODE_RESUME_TRIM_MAX_ATTEMPTS = '3';
    const { enforceResumeCharLimit, RESUME_CHAR_LIMIT } = await loadModule();
    const result = await runTrimTestCase(enforceResumeCharLimit, 'not an object', RESUME_CHAR_LIMIT);
    expect(result.characterCountTrimmed).toBe('true');
    expect(getResumeCharCountLocal(result)).toBeGreaterThan(RESUME_CHAR_LIMIT);
    const prompts = sessionCalls.filter((c) => c.method === 'prompt');
    expect(prompts).toHaveLength(1);
  });

  it('reuses the provided session id for trim prompts and does not create or delete sessions', async () => {
    const { calls } = await runSessionLifecycleCase({ maxAttempts: 2, providedSessionId: 'ses-outer-abc', logDir: tmpLogDir });
    expect(calls.creates).toHaveLength(0);
    expect(calls.deletes).toHaveLength(0);
    expect(calls.prompts).toHaveLength(2);
    for (const p of calls.prompts) {
      expect(p.sessionId).toBe('ses-outer-abc');
    }
  });

  it('still creates a session for trims when no providedSessionId is supplied (and still does not delete it)', async () => {
    const { result, calls } = await runSessionLifecycleCase({ maxAttempts: 1, logDir: tmpLogDir });
    expect(result.characterCountTrimmed).toBe('true');
    expect(calls.creates).toHaveLength(1);
    expect(calls.deletes).toHaveLength(0);
    expect(calls.prompts).toHaveLength(1);
    expect(calls.creates[0].sessionId).toBe(calls.prompts[0].sessionId);
  });
});

async function runTrimTestCase(
  enforceResumeCharLimit: (resume: any, model: string, logDir: string) => Promise<any>,
  mockNextResponse: any,
  _limit: number
) {
  const big = buildOversizedResume();
  mockStructuredResponse = mockNextResponse;
  return enforceResumeCharLimit(big, 'opencode/gpt-5-nano', fs.mkdtempSync(path.join(os.tmpdir(), 'ai-trim-inner-')));
}

async function runSessionLifecycleCase(args: { maxAttempts: number; logDir: string; providedSessionId?: string }) {
  process.env.OPENCODE_KEEP_SESSION = 'false';
  process.env.OPENCODE_RESUME_TRIM_MAX_ATTEMPTS = String(args.maxAttempts);
  const { enforceResumeCharLimit, RESUME_CHAR_LIMIT } = await loadModule();
  mockStructuredResponse = buildOversizedResume();
  const result = await enforceResumeCharLimit(buildOversizedResume(), 'opencode/gpt-5-nano', args.logDir, args.providedSessionId);
  expect(result.characterCountTrimmed).toBe('true');
  expect(getResumeCharCountLocal(result)).toBeGreaterThan(RESUME_CHAR_LIMIT);
  return {
    result,
    calls: {
      creates: sessionCalls.filter((c) => c.method === 'create'),
      deletes: sessionCalls.filter((c) => c.method === 'delete'),
      prompts: sessionCalls.filter((c) => c.method === 'prompt'),
    },
  };
}
