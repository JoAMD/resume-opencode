import fs from 'fs';
import path from 'path';
import { ResumeData } from './types';

export const PII_FIELDS = [
  'name',
  'phone',
  'email',
  'linkedinUrl',
  'linkedinDisplay',
  'githubUrl',
  'githubDisplay',
] as const;

export type PiiField = (typeof PII_FIELDS)[number];

export const REDACTED_RESUME_FILENAME = 'structured-output-redacted.json';

export function redactResumeForExternalModel(resume: ResumeData): ResumeData {
  const redacted: ResumeData = JSON.parse(JSON.stringify(resume));
  for (const field of PII_FIELDS) {
    if (field in (redacted as unknown as Record<string, unknown>)) {
      (redacted as unknown as Record<string, string>)[field] = '';
    }
  }
  return redacted;
}

export function isRedactedResume(resume: ResumeData): boolean {
  for (const field of PII_FIELDS) {
    const value = (resume as unknown as Record<string, unknown>)[field];
    if (typeof value === 'string' && value.trim().length > 0) {
      return false;
    }
  }
  return true;
}

export function ensureRedactedResumeFile(jobDir: string, source: ResumeData): {
  path: string;
  redacted: ResumeData;
  wroteFile: boolean;
} {
  const redacted = redactResumeForExternalModel(source);
  const targetPath = path.join(jobDir, REDACTED_RESUME_FILENAME);
  const serialized = JSON.stringify(redacted, null, 2);

  if (fs.existsSync(targetPath)) {
    try {
      const existing = fs.readFileSync(targetPath, 'utf8');
      if (existing === serialized) {
        return { path: targetPath, redacted, wroteFile: false };
      }
    } catch {
      // fall through and rewrite
    }
  }

  fs.writeFileSync(targetPath, serialized, 'utf8');
  return { path: targetPath, redacted, wroteFile: true };
}

export function loadRedactedResumeFromDir(jobDir: string): ResumeData | null {
  const target = path.join(jobDir, REDACTED_RESUME_FILENAME);
  if (!fs.existsSync(target)) return null;
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8')) as ResumeData;
  } catch {
    return null;
  }
}
