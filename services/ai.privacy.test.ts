import { describe, it, expect } from 'vitest';
import type { ResumeData } from './types';
import { DEFAULT_PROFILE } from './env';
import {
  buildPrivacyPlaceholderEducationEntry,
  sanitizeResumeForExternalCoverLetterModel,
  buildPrivacySafeBaseResumeForExternalModel,
} from './ai';

describe('Privacy helpers', () => {
  describe('buildPrivacyPlaceholderEducationEntry', () => {
    it('returns placeholder education entry for index 0', () => {
      const result = buildPrivacyPlaceholderEducationEntry(0);
      expect(result).toEqual({
        institution: DEFAULT_PROFILE.education[0].institution,
        location: DEFAULT_PROFILE.education[0].location,
        degree: DEFAULT_PROFILE.education[0].degree,
        dates: DEFAULT_PROFILE.education[0].dates,
      });
    });

    it('returns placeholder education entry for index 1', () => {
      const result = buildPrivacyPlaceholderEducationEntry(1);
      expect(result).toEqual({
        institution: DEFAULT_PROFILE.education[1].institution,
        location: DEFAULT_PROFILE.education[1].location,
        degree: DEFAULT_PROFILE.education[1].degree,
        dates: DEFAULT_PROFILE.education[1].dates,
      });
    });

    it('falls back to last education entry for out-of-range index', () => {
      const result = buildPrivacyPlaceholderEducationEntry(10);
      const lastEdu = DEFAULT_PROFILE.education[DEFAULT_PROFILE.education.length - 1];
      expect(result).toEqual({
        institution: lastEdu.institution,
        location: lastEdu.location,
        degree: lastEdu.degree,
        dates: lastEdu.dates,
      });
    });
  });

  describe('sanitizeResumeForExternalCoverLetterModel', () => {
    it('replaces personal info with DEFAULT_PROFILE placeholders', () => {
      const inputResume: ResumeData = {
        name: 'John Doe',
        phone: '0400123456',
        email: 'john@example.com',
        linkedinUrl: 'https://linkedin.com/in/johndoe',
        linkedinDisplay: 'linkedin.com/in/johndoe',
        summary: 'Experienced engineer',
        skills: { languages: 'JS', frameworks: 'React', tools: 'Git', libraries: '' },
        experience: [
          { company: 'Acme', title: 'Dev', location: 'Sydney', dates: '2020-2023', bullets: ['Built things'] },
        ],
        education: [
          { institution: 'Real University', location: 'Sydney NSW', degree: 'BS', dates: '2016-2020' },
        ],
        projects: [{ name: 'My Project', bullets: ['Did stuff'] }],
      };

      const result = sanitizeResumeForExternalCoverLetterModel(inputResume);

      expect(result.name).toBe(DEFAULT_PROFILE.fullName);
      expect(result.phone).toBe(DEFAULT_PROFILE.phone);
      expect(result.email).toBe(DEFAULT_PROFILE.email);
      expect(result.linkedinUrl).toBe(DEFAULT_PROFILE.linkedinUrl);
      expect(result.linkedinDisplay).toBe(DEFAULT_PROFILE.linkedinDisplay);
    });

    it('replaces education with placeholder entries', () => {
      const inputResume: ResumeData = {
        name: 'John Doe',
        phone: '0400123456',
        email: 'john@example.com',
        linkedinUrl: 'https://linkedin.com/in/johndoe',
        linkedinDisplay: 'linkedin.com/in/johndoe',
        summary: 'Experienced engineer',
        skills: { languages: 'JS', frameworks: 'React', tools: 'Git', libraries: '' },
        experience: [],
        education: [
          { institution: 'Real University', location: 'Sydney NSW', degree: 'BS', dates: '2016-2020' },
          { institution: 'Another Uni', location: 'Melbourne VIC', degree: 'MS', dates: '2021-2023' },
        ],
        projects: [],
      };

      const result = sanitizeResumeForExternalCoverLetterModel(inputResume);

      expect(result.education).toHaveLength(2);
      expect(result.education[0]).toEqual({
        institution: DEFAULT_PROFILE.education[0].institution,
        location: DEFAULT_PROFILE.education[0].location,
        degree: DEFAULT_PROFILE.education[0].degree,
        dates: DEFAULT_PROFILE.education[0].dates,
      });
      expect(result.education[1]).toEqual({
        institution: DEFAULT_PROFILE.education[1].institution,
        location: DEFAULT_PROFILE.education[1].location,
        degree: DEFAULT_PROFILE.education[1].degree,
        dates: DEFAULT_PROFILE.education[1].dates,
      });
    });

    it('preserves non-personal fields', () => {
      const inputResume: ResumeData = {
        name: 'John Doe',
        phone: '0400123456',
        email: 'john@example.com',
        linkedinUrl: 'https://linkedin.com/in/johndoe',
        linkedinDisplay: 'linkedin.com/in/johndoe',
        summary: 'Experienced engineer',
        skills: { languages: 'JS', frameworks: 'React', tools: 'Git', libraries: 'Lodash' },
        experience: [
          { company: 'Acme', title: 'Dev', location: 'Sydney', dates: '2020-2023', bullets: ['Built things', 'Shipped features'] },
        ],
        education: [
          { institution: 'Real University', location: 'Sydney NSW', degree: 'BS', dates: '2016-2020' },
        ],
        projects: [{ name: 'My Project', techStack: 'Node.js', bullets: ['Did stuff'] }],
      };

      const result = sanitizeResumeForExternalCoverLetterModel(inputResume);

      expect(result.summary).toBe('Experienced engineer');
      expect(result.skills.languages).toBe('JS');
      expect(result.skills.frameworks).toBe('React');
      expect(result.experience).toEqual(inputResume.experience);
      expect(result.projects).toEqual(inputResume.projects);
    });
  });

  describe('buildPrivacySafeBaseResumeForExternalModel', () => {
    it('returns a string', () => {
      const result = buildPrivacySafeBaseResumeForExternalModel();
      expect(typeof result).toBe('string');
    });

    it('contains DEFAULT_PROFILE name', () => {
      const result = buildPrivacySafeBaseResumeForExternalModel();
      expect(result).toContain(DEFAULT_PROFILE.fullName);
    });

    it('does not contain actual user data from .env', () => {
      const result = buildPrivacySafeBaseResumeForExternalModel();
      // These are Joel's actual values from .env - should NOT be present
      expect(result).not.toContain('Joel Joseph');
    });

    it('does not contain personal data like "John Doe" from test inputs', () => {
      const result = buildPrivacySafeBaseResumeForExternalModel();
      expect(result).not.toContain('John Doe');
      expect(result).not.toContain('0400123456');
      expect(result).not.toContain('john@example.com');
    });
  });
});

import { redactResumeForExternalModel, PII_FIELDS } from './redactResume';

describe('ATS AI redaction guard', () => {
  it('redactResumeForExternalModel never leaves any PII field non-empty', () => {
    const dirty: ResumeData = {
      name: 'John Q Public',
      phone: '0400000000',
      email: 'john@example.com',
      linkedinUrl: 'https://linkedin.com/in/john',
      linkedinDisplay: 'linkedin.com/in/john',
      githubUrl: 'https://github.com/john',
      githubDisplay: 'github.com/john',
      summary: 'Engineer',
      skills: { languages: 'TS', frameworks: '', tools: '', libraries: '' },
      experience: [],
      education: [],
      projects: [],
    };

    const redacted = redactResumeForExternalModel(dirty);

    for (const field of PII_FIELDS) {
      const value = (redacted as unknown as Record<string, unknown>)[field];
      expect(value, `field ${field} should be empty`).toBe('');
    }
  });
});