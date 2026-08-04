import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const sessionCalls: Array<{ method: string; sessionId?: string }> = [];
const promptBodies: Array<{ sessionId?: string; body: any }> = [];
let sessionCounter = 0;
let mockClient: any;
let mockFileMutator: ((resumePath: string) => void) | null = null;

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
    promptBodies.push({ sessionId: opts?.path?.id, body: opts?.body });

    // For tool-edit mode: extract file path from user content and apply mutator
    if (mockFileMutator) {
      const userText: string = opts?.body?.parts?.[0]?.text || '';
      const pathMatch = userText.match(/REAL RESUME FILE TO EDIT IN PLACE:\s*(\S+)/);
      if (pathMatch) {
        mockFileMutator(pathMatch[1]);
      }
    }

    return {
      data: {
        info: {
          structured: undefined,
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
  promptBodies.length = 0;
  sessionCounter = 0;
  mockClient = undefined;
  mockFileMutator = null;
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

function applyEditsToFile(resumePath: string, mutator: (resume: any) => void) {
  const current = JSON.parse(fs.readFileSync(resumePath, 'utf8'));
  mutator(current);
  fs.writeFileSync(resumePath, JSON.stringify(current, null, 2), 'utf8');
}

function makeJobDirWithResume(resume: any): string {
  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-trim-job-'));
  fs.writeFileSync(path.join(jobDir, 'structured-output.json'), JSON.stringify(resume, null, 2), 'utf8');
  return jobDir;
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
    const result = await enforceResumeCharLimit(small, 'opencode-go/minimax-m2.7', { promptLogDir: tmpLogDir });
    expect(result.resume.characterCountTrimmed).toBe('false');
    expect(result.backup).toBeUndefined();
    expect(sessionCalls.filter((c) => c.method === 'prompt')).toHaveLength(0);
  });

  it('edits structured-output.json on disk and returns trimmed result', async () => {
    process.env.OPENCODE_RESUME_TRIM_MAX_ATTEMPTS = '1';
    const jobDir = makeJobDirWithResume(buildOversizedResume());
    try {
      const { enforceResumeCharLimit, RESUME_CHAR_LIMIT } = await loadModule();
      mockFileMutator = (rp) => {
        applyEditsToFile(rp, (r) => {
          r.summary = 'Short summary.';
          r.experience = [{ company: 'Co', title: 'SWE', location: 'Adelaide', dates: '2024', bullets: ['Short.'] }];
          r.projects = [];
        });
      };
      const result = await enforceResumeCharLimit(buildOversizedResume(), 'opencode-go/minimax-m2.7', { promptLogDir: tmpLogDir, jobDir });
      expect(result.resume.characterCountTrimmed).toBe('true');
      expect(getResumeCharCountLocal(result.resume)).toBeLessThanOrEqual(RESUME_CHAR_LIMIT);
      const prompts = sessionCalls.filter((c) => c.method === 'prompt');
      expect(prompts).toHaveLength(1);
    } finally {
      fs.rmSync(jobDir, { recursive: true, force: true });
    }
  });

  it('loops up to the configured max attempts when model keeps overshooting', async () => {
    process.env.OPENCODE_RESUME_TRIM_MAX_ATTEMPTS = '2';
    const jobDir = makeJobDirWithResume(buildOversizedResume());
    try {
      const { enforceResumeCharLimit, RESUME_CHAR_LIMIT } = await loadModule();
      // Mutator always writes something still over limit
      mockFileMutator = (rp) => {
        applyEditsToFile(rp, (r) => {
          r.summary = r.summary.slice(0, 50);
        });
      };
      const result = await enforceResumeCharLimit(buildOversizedResume(), 'opencode-go/minimax-m2.7', { promptLogDir: tmpLogDir, jobDir });
      expect(result.resume.characterCountTrimmed).toBe('true');
      expect(getResumeCharCountLocal(result.resume)).toBeGreaterThan(RESUME_CHAR_LIMIT);
      const prompts = sessionCalls.filter((c) => c.method === 'prompt');
      expect(prompts.length).toBeLessThanOrEqual(2);
    } finally {
      fs.rmSync(jobDir, { recursive: true, force: true });
    }
  });

  it('stops looping as soon as the trimmed result fits', async () => {
    process.env.OPENCODE_RESUME_TRIM_MAX_ATTEMPTS = '3';
    const jobDir = makeJobDirWithResume(buildOversizedResume());
    try {
      const { enforceResumeCharLimit, RESUME_CHAR_LIMIT } = await loadModule();
      mockFileMutator = (rp) => {
        applyEditsToFile(rp, (r) => {
          r.summary = 'Short summary.';
          r.experience = [{ company: 'Co', title: 'SWE', location: 'Adelaide', dates: '2024', bullets: ['Short.'] }];
          r.projects = [];
        });
      };
      const result = await enforceResumeCharLimit(buildOversizedResume(), 'opencode-go/minimax-m2.7', { promptLogDir: tmpLogDir, jobDir });
      expect(result.resume.characterCountTrimmed).toBe('true');
      expect(getResumeCharCountLocal(result.resume)).toBeLessThanOrEqual(RESUME_CHAR_LIMIT);
      const prompts = sessionCalls.filter((c) => c.method === 'prompt');
      expect(prompts).toHaveLength(1);
    } finally {
      fs.rmSync(jobDir, { recursive: true, force: true });
    }
  });

  it('retries when file is unchanged (no-op)', async () => {
    process.env.OPENCODE_RESUME_TRIM_MAX_ATTEMPTS = '3';
    const jobDir = makeJobDirWithResume(buildOversizedResume());
    try {
      const { enforceResumeCharLimit, RESUME_CHAR_LIMIT } = await loadModule();
      let attemptCount = 0;
      mockFileMutator = (rp) => {
        attemptCount++;
        if (attemptCount === 1) return; // no-op on first attempt
        applyEditsToFile(rp, (r) => {
          r.summary = 'Short summary.';
          r.experience = [{ company: 'Co', title: 'SWE', location: 'Adelaide', dates: '2024', bullets: ['Short.'] }];
          r.projects = [];
        });
      };
      const result = await enforceResumeCharLimit(buildOversizedResume(), 'opencode-go/minimax-m2.7', { promptLogDir: tmpLogDir, jobDir });
      expect(result.resume.characterCountTrimmed).toBe('true');
      expect(getResumeCharCountLocal(result.resume)).toBeLessThanOrEqual(RESUME_CHAR_LIMIT);
      const prompts = sessionCalls.filter((c) => c.method === 'prompt');
      expect(prompts).toHaveLength(2);
    } finally {
      fs.rmSync(jobDir, { recursive: true, force: true });
    }
  });

  it('retries when file contains malformed JSON', async () => {
    process.env.OPENCODE_RESUME_TRIM_MAX_ATTEMPTS = '3';
    const jobDir = makeJobDirWithResume(buildOversizedResume());
    try {
      const { enforceResumeCharLimit, RESUME_CHAR_LIMIT } = await loadModule();
      let attemptCount = 0;
      mockFileMutator = (rp) => {
        attemptCount++;
        if (attemptCount === 1) {
          // Write malformed JSON
          fs.writeFileSync(rp, '{ invalid json }}}', 'utf8');
          return;
        }
        // On retry, write valid trimmed resume directly (file may be malformed)
        fs.writeFileSync(rp, JSON.stringify({
          ...buildOversizedResume(),
          summary: 'Short summary.',
          experience: [{ company: 'Co', title: 'SWE', location: 'Adelaide', dates: '2024', bullets: ['Short.'] }],
          projects: [],
        }, null, 2), 'utf8');
      };
      const result = await enforceResumeCharLimit(buildOversizedResume(), 'opencode-go/minimax-m2.7', { promptLogDir: tmpLogDir, jobDir });
      expect(result.resume.characterCountTrimmed).toBe('true');
      expect(getResumeCharCountLocal(result.resume)).toBeLessThanOrEqual(RESUME_CHAR_LIMIT);
      const prompts = sessionCalls.filter((c) => c.method === 'prompt');
      expect(prompts).toHaveLength(2);
    } finally {
      fs.rmSync(jobDir, { recursive: true, force: true });
    }
  });

  it('applies PII overrides after model edit', async () => {
    process.env.OPENCODE_RESUME_TRIM_MAX_ATTEMPTS = '1';
    const jobDir = makeJobDirWithResume(buildOversizedResume());
    try {
      const { enforceResumeCharLimit } = await loadModule();
      mockFileMutator = (rp) => {
        applyEditsToFile(rp, (r) => {
          r.name = 'HACKED NAME';
          r.email = 'hacked@evil.com';
          r.summary = 'Short summary.';
          r.experience = [{ company: 'Co', title: 'SWE', location: 'Adelaide', dates: '2024', bullets: ['Short.'] }];
          r.projects = [];
        });
      };
      const result = await enforceResumeCharLimit(buildOversizedResume(), 'opencode-go/minimax-m2.7', { promptLogDir: tmpLogDir, jobDir });
      // PII should be overridden by applyProfileOverrides (env profile values)
      expect(result.resume.name).not.toBe('HACKED NAME');
      expect(result.resume.email).not.toBe('hacked@evil.com');
    } finally {
      fs.rmSync(jobDir, { recursive: true, force: true });
    }
  });

  it('does not pass jsonSchema to runOpenCode', async () => {
    process.env.OPENCODE_RESUME_TRIM_MAX_ATTEMPTS = '1';
    const jobDir = makeJobDirWithResume(buildOversizedResume());
    try {
      const { enforceResumeCharLimit } = await loadModule();
      mockFileMutator = (rp) => {
        applyEditsToFile(rp, (r) => {
          r.summary = 'Short summary.';
          r.experience = [{ company: 'Co', title: 'SWE', location: 'Adelaide', dates: '2024', bullets: ['Short.'] }];
          r.projects = [];
        });
      };
      await enforceResumeCharLimit(buildOversizedResume(), 'opencode-go/minimax-m2.7', { promptLogDir: tmpLogDir, jobDir });
      const prompts = promptBodies.filter((p) => p.body?.parts?.[0]?.text);
      expect(prompts).toHaveLength(1);
      // Verify no jsonSchema in the prompt body
      expect(prompts[0].body).not.toHaveProperty('jsonSchema');
    } finally {
      fs.rmSync(jobDir, { recursive: true, force: true });
    }
  });

  it('passes the file path and job folder into the trim user content', async () => {
    process.env.OPENCODE_RESUME_TRIM_MAX_ATTEMPTS = '1';
    const jobDir = makeJobDirWithResume(buildOversizedResume());
    try {
      const { enforceResumeCharLimit } = await loadModule();
      mockFileMutator = (rp) => {
        applyEditsToFile(rp, (r) => {
          r.summary = 'Short summary.';
          r.experience = [{ company: 'Co', title: 'SWE', location: 'Adelaide', dates: '2024', bullets: ['Short.'] }];
          r.projects = [];
        });
      };
      await enforceResumeCharLimit(buildOversizedResume(), 'opencode-go/minimax-m2.7', { promptLogDir: tmpLogDir, jobDir });
      const prompts = promptBodies.filter((p) => p.body?.parts?.[0]?.text);
      expect(prompts).toHaveLength(1);
      const fullPrompt = prompts[0].body.parts[0].text;
      expect(fullPrompt).toContain(`REAL RESUME FILE TO EDIT IN PLACE: ${path.join(jobDir, 'structured-output.json')}`);
      expect(fullPrompt).toContain(`JOB FOLDER (only directory you may read from or write to): ${jobDir}`);
    } finally {
      fs.rmSync(jobDir, { recursive: true, force: true });
    }
  });

  it('omits the JOB FOLDER line when jobDir is not provided', async () => {
    process.env.OPENCODE_RESUME_TRIM_MAX_ATTEMPTS = '1';
    const { enforceResumeCharLimit } = await loadModule();
    mockFileMutator = () => {};
    await enforceResumeCharLimit(buildOversizedResume(), 'opencode-go/minimax-m2.7', { promptLogDir: tmpLogDir });
    const prompts = promptBodies.filter((p) => p.body?.parts?.[0]?.text);
    expect(prompts).toHaveLength(1);
    const fullPrompt = prompts[0].body.parts[0].text;
    expect(fullPrompt).not.toContain('JOB FOLDER (only directory you may read from or write to):');
  });

  it('creates a pre-trim backup v1 when the resume is over the limit and jobDir is provided', async () => {
    process.env.OPENCODE_RESUME_TRIM_MAX_ATTEMPTS = '1';
    const jobDir = makeJobDirWithResume(buildOversizedResume());
    try {
      const { enforceResumeCharLimit } = await loadModule();
      mockFileMutator = (rp) => {
        applyEditsToFile(rp, (r) => {
          r.summary = 'Short summary.';
          r.experience = [{ company: 'Co', title: 'SWE', location: 'Adelaide', dates: '2024', bullets: ['Short.'] }];
          r.projects = [];
        });
      };
      const result = await enforceResumeCharLimit(buildOversizedResume(), 'opencode-go/minimax-m2.7', { promptLogDir: tmpLogDir, jobDir });
      expect(result.resume.characterCountTrimmed).toBe('true');
      expect(result.backup).toBeDefined();
      expect(result.backup?.version).toBe(1);
      expect(result.backup?.files).toContain('structured-output.json');
      const backed = JSON.parse(fs.readFileSync(path.join(result.backup!.backupDir, 'structured-output.json'), 'utf8'));
      expect(backed.name).toBe(buildOversizedResume().name);
    } finally {
      fs.rmSync(jobDir, { recursive: true, force: true });
    }
  });

  it('does not create a backup when the resume is already under the limit', async () => {
    const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-trim-nobackup-'));
    try {
      const { enforceResumeCharLimit } = await loadModule();
      const small = buildSmallResume();
      const result = await enforceResumeCharLimit(small, 'opencode-go/minimax-m2.7', { promptLogDir: tmpLogDir, jobDir });
      expect(result.resume.characterCountTrimmed).toBe('false');
      expect(result.backup).toBeUndefined();
      expect(fs.existsSync(path.join(jobDir, 'backups'))).toBe(false);
    } finally {
      fs.rmSync(jobDir, { recursive: true, force: true });
    }
  });

  it('omits the backup when jobDir is not provided even if the resume is over the limit', async () => {
    process.env.OPENCODE_RESUME_TRIM_MAX_ATTEMPTS = '1';
    const { enforceResumeCharLimit } = await loadModule();
    mockFileMutator = () => {};
    const result = await enforceResumeCharLimit(buildOversizedResume(), 'opencode-go/minimax-m2.7', { promptLogDir: tmpLogDir });
    expect(result.resume.characterCountTrimmed).toBe('true');
    expect(result.backup).toBeUndefined();
  });

  it('reuses the provided session id for trim prompts and does not create or delete sessions', async () => {
    process.env.OPENCODE_RESUME_TRIM_MAX_ATTEMPTS = '2';
    const jobDir = makeJobDirWithResume(buildOversizedResume());
    try {
      const { calls } = await runSessionLifecycleCase({ maxAttempts: 2, providedSessionId: 'ses-outer-abc', logDir: tmpLogDir, jobDir });
      expect(calls.creates).toHaveLength(0);
      expect(calls.deletes).toHaveLength(0);
      expect(calls.prompts).toHaveLength(2);
      for (const p of calls.prompts) {
        expect(p.sessionId).toBe('ses-outer-abc');
      }
    } finally {
      fs.rmSync(jobDir, { recursive: true, force: true });
    }
  });

  it('still creates a session for trims when no providedSessionId is supplied (and still does not delete it)', async () => {
    const jobDir = makeJobDirWithResume(buildOversizedResume());
    try {
      const { result, calls } = await runSessionLifecycleCase({ maxAttempts: 1, logDir: tmpLogDir, jobDir });
      expect(result.resume.characterCountTrimmed).toBe('true');
      expect(calls.creates).toHaveLength(1);
      expect(calls.deletes).toHaveLength(0);
      expect(calls.prompts).toHaveLength(1);
      expect(calls.creates[0].sessionId).toBe(calls.prompts[0].sessionId);
    } finally {
      fs.rmSync(jobDir, { recursive: true, force: true });
    }
  });
});

describe('trim-resume-prompt.txt system prompt', () => {
  it('forbids /tmp and other paths and confines file access to the current job folder', () => {
    const promptPath = path.resolve(__dirname, '..', 'prompts', 'trim-resume-prompt.txt');
    const content = fs.readFileSync(promptPath, 'utf8');
    expect(content).toContain('Do not access `/tmp`');
    expect(content).toContain('ONLY directory you may read from or write to');
    expect(content).toMatch(/current job folder/);
    expect(content).toContain('count-characters');
  });
});

async function runSessionLifecycleCase(args: { maxAttempts: number; logDir: string; providedSessionId?: string; jobDir: string }) {
  process.env.OPENCODE_KEEP_SESSION = 'false';
  process.env.OPENCODE_RESUME_TRIM_MAX_ATTEMPTS = String(args.maxAttempts);
  const { enforceResumeCharLimit, RESUME_CHAR_LIMIT } = await loadModule();
  let sessionAttempt = 0;
  mockFileMutator = (rp) => {
    sessionAttempt++;
    // On last allowed attempt, make it fit; otherwise still over limit
    if (sessionAttempt >= args.maxAttempts) {
      fs.writeFileSync(rp, JSON.stringify({
        name: 'Test User', phone: '0400000000', email: 'test@example.com',
        linkedinUrl: '', linkedinDisplay: '', summary: 'Short.',
        skills: { languages: 'TS', frameworks: 'React', tools: 'Git', libraries: '' },
        experience: [{ company: 'Co', title: 'SWE', location: 'Adelaide', dates: '2024', bullets: ['Short.'] }],
        education: [{ institution: 'Uni', location: 'Adelaide', degree: 'BS', dates: '2018-2020' }],
        projects: [],
      }, null, 2), 'utf8');
    } else {
      // Still over limit — truncate summary slightly
      applyEditsToFile(rp, (r) => { r.summary = r.summary.slice(0, 100); });
    }
  };
  const result = await enforceResumeCharLimit(buildOversizedResume(), 'opencode-go/minimax-m2.7', { promptLogDir: args.logDir, providedSessionId: args.providedSessionId, jobDir: args.jobDir });
  expect(result.resume.characterCountTrimmed).toBe('true');
  return {
    result,
    calls: {
      creates: sessionCalls.filter((c) => c.method === 'create'),
      deletes: sessionCalls.filter((c) => c.method === 'delete'),
      prompts: sessionCalls.filter((c) => c.method === 'prompt'),
    },
  };
}
