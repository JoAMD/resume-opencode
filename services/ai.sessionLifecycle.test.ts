import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

type SessionCall = { method: string; sessionId?: string };

const sessionCalls: SessionCall[] = [];
let sessionCounter = 0;
let mockClient: any;

function buildMockStructured() {
  return {
    name: 'Test User',
    phone: '0400000000',
    email: 'test@example.com',
    linkedinUrl: 'https://linkedin.com/in/test',
    linkedinDisplay: 'linkedin.com/in/test',
    summary: 'A summary',
    skills: { languages: 'TS', frameworks: 'None', tools: 'None', libraries: '' },
    experience: [],
    education: [
      { institution: 'Uni', location: 'City', degree: 'BS', dates: '2018-2020' },
    ],
    projects: [],
  };
}

function buildMockPromptResponse() {
  return {
    data: {
      info: {
        structured: buildMockStructured(),
        parts: [],
        toolCalls: [],
        error: undefined,
      },
      parts: [],
    },
    error: undefined,
  };
}

vi.mock('@opencode-ai/sdk', () => {
  return {
    createOpencodeClient: vi.fn(),
  };
});

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
    return buildMockPromptResponse();
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

describe('runOpenCode session lifecycle', () => {
  let tmpLogDir: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    tmpLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-lifecycle-'));
    savedEnv = {
      OPENCODE_MODEL: process.env.OPENCODE_MODEL,
      OPENCODE_MODEL_PROVIDER_ID: process.env.OPENCODE_MODEL_PROVIDER_ID,
      OPENCODE_MODEL_ID: process.env.OPENCODE_MODEL_ID,
      OPENCODE_AI_CONCURRENCY: process.env.OPENCODE_AI_CONCURRENCY,
      OPENCODE_AI_QUEUE: process.env.OPENCODE_AI_QUEUE,
      OPENCODE_AI_PROMPT_TIMEOUT_MS: process.env.OPENCODE_AI_PROMPT_TIMEOUT_MS,
      OPENCODE_CLIENT_KEEPALIVE: process.env.OPENCODE_CLIENT_KEEPALIVE,
      OPENCODE_CLIENT_ROTATE_AFTER: process.env.OPENCODE_CLIENT_ROTATE_AFTER,
    };
    process.env.OPENCODE_AI_CONCURRENCY = '1';
    process.env.OPENCODE_AI_QUEUE = 'false';
    process.env.OPENCODE_CLIENT_KEEPALIVE = 'false';
    process.env.OPENCODE_CLIENT_ROTATE_AFTER = '50';
  });

  afterEach(() => {
    fs.rmSync(tmpLogDir, { recursive: true, force: true });
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('deletes the session after a successful resume generation', async () => {
    const { generateResumeJSON } = await loadModule();
    await generateResumeJSON(
      'Job desc',
      'extra notes',
      { companyName: 'Acme', roleName: 'SWE', promptLogDir: tmpLogDir },
      { modelSelect: 'opencode/gpt-5-nano' }
    );
    const creates = sessionCalls.filter(c => c.method === 'create');
    const deletes = sessionCalls.filter(c => c.method === 'delete');
    const prompts = sessionCalls.filter(c => c.method === 'prompt');
    expect(creates).toHaveLength(1);
    expect(prompts).toHaveLength(1);
    expect(deletes).toHaveLength(1);
    expect(creates[0].sessionId).toBe(prompts[0].sessionId);
    expect(prompts[0].sessionId).toBe(deletes[0].sessionId);
  });

  it('still calls session.delete when the prompt throws', async () => {
    const { generateResumeJSON } = await loadModule();
    mockClient.session.prompt.mockImplementationOnce(async (opts: any) => {
      sessionCalls.push({ method: 'prompt', sessionId: opts?.path?.id });
      throw new Error('simulated prompt failure');
    });
    await expect(
      generateResumeJSON(
        'Job desc',
        'extra notes',
        { companyName: 'Acme', roleName: 'SWE', promptLogDir: tmpLogDir },
        { modelSelect: 'opencode/gpt-5-nano' }
      )
    ).rejects.toThrow('simulated prompt failure');
    const deletes = sessionCalls.filter(c => c.method === 'delete');
    expect(deletes).toHaveLength(1);
  });

  it('does not call session.delete if session creation itself failed', async () => {
    const { generateResumeJSON } = await loadModule();
    mockClient.session.create.mockImplementationOnce(async () => {
      sessionCalls.push({ method: 'create' });
      return { data: undefined, error: { message: 'create failed' } };
    });
    await expect(
      generateResumeJSON(
        'Job desc',
        'extra notes',
        { companyName: 'Acme', roleName: 'SWE', promptLogDir: tmpLogDir },
        { modelSelect: 'opencode/gpt-5-nano' }
      )
    ).rejects.toThrow(/Session creation error/);
    expect(sessionCalls.some(c => c.method === 'delete')).toBe(false);
  });

  it('rotation: rotates the client after OPENCODE_CLIENT_ROTATE_AFTER requests and reuses session.delete', async () => {
    const sdkModule = await import('@opencode-ai/sdk');
    const { generateResumeJSON } = await loadModule({ OPENCODE_CLIENT_ROTATE_AFTER: '2' });
    const createOpencodeClient = sdkModule.createOpencodeClient as unknown as ReturnType<typeof vi.fn>;

    for (let i = 0; i < 4; i++) {
      sessionCalls.length = 0;
      await generateResumeJSON(
        'Job desc',
        'extra notes',
        { companyName: 'Acme', roleName: 'SWE', promptLogDir: tmpLogDir },
        { modelSelect: `m-${i}` }
      );
      const deletes = sessionCalls.filter(c => c.method === 'delete');
      expect(deletes).toHaveLength(1);
    }

    expect(createOpencodeClient.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
