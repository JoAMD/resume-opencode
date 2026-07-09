import { describe, it, expect } from 'vitest';
import { ResumeData } from './types';
import {
  PII_FIELDS,
  REDACTED_RESUME_FILENAME,
  ensureRedactedResumeFile,
  isRedactedResume,
  loadRedactedResumeFromDir,
  redactResumeForExternalModel,
} from './redactResume';
import fs from 'fs';
import os from 'os';
import path from 'path';

function buildSampleResume(): ResumeData {
  return {
    name: 'Jane Q Public',
    phone: '+61 400 111 222',
    email: 'jane@example.com',
    linkedinUrl: 'https://linkedin.com/in/janepublic',
    linkedinDisplay: 'linkedin.com/in/janepublic',
    githubUrl: 'https://github.com/janepublic',
    githubDisplay: 'github.com/janepublic',
    summary: 'Full-stack engineer with Node.js and TypeScript experience.',
    skills: {
      languages: 'TypeScript, JavaScript, Python',
      frameworks: 'React, Next.js, Express',
      tools: 'Docker, AWS, GitHub Actions',
      libraries: 'Lodash, Zod',
    },
    experience: [
      {
        company: 'Acme Co',
        title: 'Senior Engineer',
        location: 'Sydney',
        dates: '2022-2025',
        bullets: [
          'Built React + TypeScript dashboards used by 5k users',
          'Owned CI/CD pipelines in GitHub Actions and cut release time by 40%',
        ],
      },
    ],
    education: [
      { institution: 'University of Sydney', location: 'Sydney NSW', degree: 'BSc CS', dates: '2015-2018' },
    ],
    projects: [
      { name: 'Open Source Tool', techStack: 'Node.js, TypeScript', bullets: ['Processed 1M records/day'] },
    ],
    atsKeywords: ['typescript', 'react', 'ci/cd'],
  };
}

describe('redactResumeForExternalModel', () => {
  it('strips every PII field to empty string', () => {
    const input = buildSampleResume();
    const redacted = redactResumeForExternalModel(input);

    for (const field of PII_FIELDS) {
      const value = (redacted as unknown as Record<string, unknown>)[field];
      expect(value, `field ${field} should be empty`).toBe('');
    }
  });

  it('does not mutate the input resume', () => {
    const input = buildSampleResume();
    const snapshot = JSON.parse(JSON.stringify(input));
    redactResumeForExternalModel(input);
    expect(input).toEqual(snapshot);
  });

  it('preserves non-PII fields including bullets, skills, education institution', () => {
    const input = buildSampleResume();
    const redacted = redactResumeForExternalModel(input);

    expect(redacted.summary).toBe(input.summary);
    expect(redacted.skills).toEqual(input.skills);
    expect(redacted.experience).toEqual(input.experience);
    expect(redacted.education).toEqual(input.education);
    expect(redacted.projects).toEqual(input.projects);
    expect(redacted.atsKeywords).toEqual(input.atsKeywords);
  });

  it('deep-clones the resume (mutating the redacted copy does not affect source)', () => {
    const input = buildSampleResume();
    const redacted = redactResumeForExternalModel(input);
    (redacted.experience[0].bullets as string[]).push('FORGED');
    expect(input.experience[0].bullets).not.toContain('FORGED');
  });
});

describe('isRedactedResume', () => {
  it('returns true for a redacted resume', () => {
    expect(isRedactedResume(redactResumeForExternalModel(buildSampleResume()))).toBe(true);
  });

  it('returns false when any PII field is non-empty', () => {
    const r = buildSampleResume();
    expect(isRedactedResume(r)).toBe(false);
    r.name = '';
    expect(isRedactedResume(r)).toBe(false);
  });
});

describe('ensureRedactedResumeFile', () => {
  it('writes structured-output-redacted.json to the job folder', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'redact-resume-'));
    try {
      const input = buildSampleResume();
      const result = ensureRedactedResumeFile(dir, input);
      expect(result.wroteFile).toBe(true);
      expect(result.path).toBe(path.join(dir, REDACTED_RESUME_FILENAME));
      expect(fs.existsSync(result.path)).toBe(true);

      const onDisk = JSON.parse(fs.readFileSync(result.path, 'utf8')) as ResumeData;
      for (const field of PII_FIELDS) {
        const value = (onDisk as unknown as Record<string, unknown>)[field];
        expect(value, `on-disk field ${field}`).toBe('');
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips the write when the file already matches the redacted payload', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'redact-resume-'));
    try {
      const input = buildSampleResume();
      const first = ensureRedactedResumeFile(dir, input);
      const stat1 = fs.statSync(first.path);
      const beforeMtime = stat1.mtime.getTime();

      const second = ensureRedactedResumeFile(dir, input);
      expect(second.wroteFile).toBe(false);
      expect(second.path).toBe(first.path);
      const stat2 = fs.statSync(second.path);
      expect(Math.abs(stat2.mtime.getTime() - beforeMtime)).toBeLessThan(50);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rewrites the file when the source resume changes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'redact-resume-'));
    try {
      ensureRedactedResumeFile(dir, buildSampleResume());
      fs.utimesSync(path.join(dir, REDACTED_RESUME_FILENAME), new Date(0), new Date(0));

      const updated = buildSampleResume();
      updated.summary = 'New summary line';
      const second = ensureRedactedResumeFile(dir, updated);
      expect(second.wroteFile).toBe(true);
      const onDisk = JSON.parse(fs.readFileSync(second.path, 'utf8')) as ResumeData;
      expect(onDisk.summary).toBe('New summary line');
      expect(fs.statSync(second.path).mtimeMs).toBeGreaterThan(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('loadRedactedResumeFromDir', () => {
  it('returns null when the file does not exist', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'redact-resume-'));
    try {
      expect(loadRedactedResumeFromDir(dir)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns the parsed redacted resume when present', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'redact-resume-'));
    try {
      const redacted = redactResumeForExternalModel(buildSampleResume());
      fs.writeFileSync(path.join(dir, REDACTED_RESUME_FILENAME), JSON.stringify(redacted), 'utf8');
      const loaded = loadRedactedResumeFromDir(dir);
      expect(loaded).not.toBeNull();
      expect(loaded!.summary).toBe(redacted.summary);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null on parse error', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'redact-resume-'));
    try {
      fs.writeFileSync(path.join(dir, REDACTED_RESUME_FILENAME), '{ not json', 'utf8');
      expect(loadRedactedResumeFromDir(dir)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
