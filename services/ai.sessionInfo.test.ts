import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const sessionCalls: { method: string; sessionId?: string }[] = [];
let sessionCounter = 0;
let mockClient: any;

function buildMockResumeStructured() {
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

function buildMockCoverLetterStructured() {
  return {
    fullName: 'Test User',
    email: 'test@example.com',
    phone: '0400000000',
    linkedinUrl: 'https://linkedin.com/in/test',
    linkedinDisplay: 'linkedin.com/in/test',
    dateLine: '1 Jan 2026',
    recipientLine: 'Acme',
    subjectLine: 'Subject',
    greeting: 'Dear Hiring Manager,',
    openingParagraph: 'Open',
    bodyParagraph: 'Body',
    closingParagraph: 'Close',
    signoff: 'Sincerely,',
  };
}

function buildMockCombinedStructured() {
  return {
    atsKeywords: ['python', 'aws'],
    resume: buildMockResumeStructured(),
    coverLetter: buildMockCoverLetterStructured(),
  };
}

vi.mock('@opencode-ai/sdk', () => {
  return {
    createOpencodeClient: vi.fn(),
  };
});

function buildMockClient(opts: { promptResponse?: () => any } = {}) {
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
  const defaultPromptResponse = () => ({
    data: {
      info: {
        structured: buildMockResumeStructured(),
        parts: [],
        toolCalls: [],
        error: undefined,
      },
      parts: [],
    },
    error: undefined,
  });
  client.session.prompt.mockImplementation(async (opts: any) => {
    sessionCalls.push({ method: 'prompt', sessionId: opts?.path?.id });
    return (opts?.promptResponse || defaultPromptResponse)();
  });
  client.session.delete.mockImplementation(async () => ({ data: { ok: true }, error: undefined }));
  return client;
}

async function loadModule() {
  vi.resetModules();
  sessionCalls.length = 0;
  sessionCounter = 0;
  mockClient = undefined;
  process.env.OPENCODE_AI_CONCURRENCY = '1';
  process.env.OPENCODE_AI_QUEUE = 'false';
  process.env.OPENCODE_CLIENT_KEEPALIVE = 'false';
  process.env.OPENCODE_CLIENT_ROTATE_AFTER = '50';
  delete process.env.OPENCODE_KEEP_SESSION;
  const mod = await import('./ai.js');
  const { createOpencodeClient } = await import('@opencode-ai/sdk');
  mockClient = buildMockClient();
  (createOpencodeClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => mockClient);
  return { ...mod, mockClient };
}

describe('generateResumeJSON returns sessionId', () => {
  let tmpLogDir: string;

  beforeEach(() => {
    tmpLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-sessioninfo-'));
  });

  afterEach(() => {
    fs.rmSync(tmpLogDir, { recursive: true, force: true });
  });

  it('returns { resume, sessionId } with the id from client.session.create', async () => {
    const { generateResumeJSON } = await loadModule();
    const result = await generateResumeJSON(
      'Job desc',
      'extra notes',
      { companyName: 'Acme', roleName: 'SWE', promptLogDir: tmpLogDir },
      { modelSelect: 'opencode/gpt-5-nano' }
    );
    expect(result).toBeDefined();
    expect(result.resume).toBeDefined();
    expect(typeof result.resume.name).toBe('string');
    expect(result.resume.name.length).toBeGreaterThan(0);
    expect(result.sessionId).toBe('sess-1');
    expect(sessionCalls.filter(c => c.method === 'create').map(c => c.sessionId)).toEqual(['sess-1']);
    expect(sessionCalls.filter(c => c.method === 'delete')).toHaveLength(0);
  });
});

describe('generateCoverLetterJSON returns sessionId', () => {
  let tmpLogDir: string;

  beforeEach(() => {
    tmpLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-sessioninfo-cl-'));
  });

  afterEach(() => {
    fs.rmSync(tmpLogDir, { recursive: true, force: true });
  });

  it('returns { coverLetter, sessionId } with the id from client.session.create', async () => {
    const { generateCoverLetterJSON, mockClient } = await loadModule();
    mockClient.session.prompt.mockImplementation(async (opts: any) => {
      sessionCalls.push({ method: 'prompt', sessionId: opts?.path?.id });
      return {
        data: {
          info: {
            structured: buildMockCoverLetterStructured(),
            parts: [],
            toolCalls: [],
            error: undefined,
          },
          parts: [],
        },
        error: undefined,
      };
    });
    const resume = buildMockResumeStructured();
    const result = await generateCoverLetterJSON(
      resume,
      'Job desc',
      'extra notes',
      'Acme',
      'SWE',
      { modelSelect: 'opencode/gpt-5-nano' }
    );
    expect(result).toBeDefined();
    expect(result.coverLetter).toBeDefined();
    expect(typeof result.coverLetter.openingParagraph).toBe('string');
    expect(result.sessionId).toBe('sess-1');
  });
});

describe('generateCombinedJSON returns sessionId + coverLetterSessionId', () => {
  let tmpLogDir: string;

  beforeEach(() => {
    tmpLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-sessioninfo-combined-'));
  });

  afterEach(() => {
    fs.rmSync(tmpLogDir, { recursive: true, force: true });
  });

  it('returns sessionId and coverLetterSessionId for a valid combined structured response', async () => {
    const { generateCombinedJSON, mockClient } = await loadModule();
    mockClient.session.prompt.mockImplementation(async (opts: any) => {
      sessionCalls.push({ method: 'prompt', sessionId: opts?.path?.id });
      return {
        data: {
          info: {
            structured: buildMockCombinedStructured(),
            parts: [],
            toolCalls: [],
            error: undefined,
          },
          parts: [],
        },
        error: undefined,
      };
    });
    const result = await generateCombinedJSON(
      'Job desc',
      'extra notes',
      'Acme',
      'SWE',
      false,
      { modelSelect: 'opencode/gpt-5-nano', promptLogDir: tmpLogDir }
    );
    expect(result).toBeDefined();
    expect(result.resume).toBeDefined();
    expect(result.coverLetter).toBeDefined();
    expect(result.sessionId).toBe('sess-1');
    expect(result.coverLetterSessionId).toBe('sess-1');
    expect(result.atsKeywords).toEqual(['python', 'aws']);
  });

  it('throws an enriched Invalid response error including sessionId and rawModelOutput when resume.name is missing', async () => {
    const { generateCombinedJSON, mockClient } = await loadModule();
    mockClient.session.prompt.mockImplementation(async (opts: any) => {
      sessionCalls.push({ method: 'prompt', sessionId: opts?.path?.id });
      return {
        data: {
          info: {
            structured: { resume: { /* no name */ }, coverLetter: buildMockCoverLetterStructured() },
            parts: [{ type: 'text', text: 'partial model output' }],
            toolCalls: [],
            error: undefined,
          },
          parts: [],
        },
        error: undefined,
      };
    });
    await expect(
      generateCombinedJSON(
        'Job desc',
        'extra notes',
        'Acme',
        'SWE',
        false,
        { modelSelect: 'opencode/gpt-5-nano', promptLogDir: tmpLogDir }
      )
    ).rejects.toThrow(/Invalid response from OpenCode.*sessionId=sess-1/);
  });
});
