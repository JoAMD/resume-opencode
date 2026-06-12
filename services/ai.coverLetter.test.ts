import { describe, it, expect } from 'vitest';
import { applyCoverLetterOverrides, normaliseBodyParagraph } from './ai';
import { DEFAULT_PROFILE } from './env';

describe('normaliseBodyParagraph', () => {
  it('returns an empty array for undefined', () => {
    expect(normaliseBodyParagraph(undefined)).toEqual([]);
  });

  it('returns an empty array for null', () => {
    expect(normaliseBodyParagraph(null)).toEqual([]);
  });

  it('returns an empty array for non-string/array values', () => {
    expect(normaliseBodyParagraph(42)).toEqual([]);
    expect(normaliseBodyParagraph({ foo: 'bar' })).toEqual([]);
    expect(normaliseBodyParagraph(true)).toEqual([]);
  });

  it('preserves a string array and trims/drops empty entries', () => {
    const result = normaliseBodyParagraph(['  First paragraph.  ', '', '  ', 'Second.']);
    expect(result).toEqual(['First paragraph.', 'Second.']);
  });

  it('splits a single string on blank-line separators', () => {
    const input = 'First paragraph here.\n\nSecond paragraph here.\n\nThird paragraph.';
    expect(normaliseBodyParagraph(input)).toEqual([
      'First paragraph here.',
      'Second paragraph here.',
      'Third paragraph.',
    ]);
  });

  it('tolerates extra whitespace and newlines around paragraph breaks', () => {
    const input = 'First paragraph.\n   \n\n   \nSecond paragraph.';
    expect(normaliseBodyParagraph(input)).toEqual(['First paragraph.', 'Second paragraph.']);
  });

  it('returns a single-element array for a string with no blank lines', () => {
    expect(normaliseBodyParagraph('Just one paragraph with no breaks.')).toEqual([
      'Just one paragraph with no breaks.',
    ]);
  });

  it('returns an empty array for a whitespace-only string', () => {
    expect(normaliseBodyParagraph('   \n\n  \n  ')).toEqual([]);
  });

  it('returns an empty array for a string of just empty entries', () => {
    expect(normaliseBodyParagraph(['', '   ', null, undefined])).toEqual([]);
  });
});

describe('applyCoverLetterOverrides', () => {
  const baseCL = {
    dateLine: '17 June 2026',
    recipientLine: 'Hiring Manager',
    subjectLine: 'Application for SWE',
    greeting: 'Dear Hiring Manager,',
    openingParagraph: 'Opening paragraph.',
    bodyParagraph: ['Body paragraph one.', 'Body paragraph two.'],
    closingParagraph: 'Thank you for your consideration.',
    signoff: 'Kind regards,',
  };

  it('replaces {{FULL_NAME}} placeholders in the signoff and closingParagraph', () => {
    const result = applyCoverLetterOverrides({
      ...baseCL,
      signoff: 'Yours sincerely, {{FULL_NAME}}',
      closingParagraph: 'Thanks, {{FULL_NAME}}',
    });

    expect(result.signoff).not.toContain('{{FULL_NAME}}');
    expect(result.signoff).toContain(DEFAULT_PROFILE.fullName);
    expect(result.closingParagraph).not.toContain('{{FULL_NAME}}');
    expect(result.closingParagraph).toContain(DEFAULT_PROFILE.fullName);
  });

  it('still scrubs placeholders from earlier fields after the change', () => {
    const result = applyCoverLetterOverrides({
      ...baseCL,
      dateLine: 'Today ({{DATE}})',
      greeting: 'Hello {{FULL_NAME}}-fan,',
    });

    expect(result.dateLine).not.toContain('{{DATE}}');
    expect(result.greeting).not.toContain('{{FULL_NAME}}');
  });

  it('tolerates missing closingParagraph and signoff', () => {
    const result = applyCoverLetterOverrides({
      dateLine: baseCL.dateLine,
      recipientLine: baseCL.recipientLine,
      subjectLine: baseCL.subjectLine,
      greeting: baseCL.greeting,
      openingParagraph: baseCL.openingParagraph,
      bodyParagraph: baseCL.bodyParagraph,
    });

    expect(result.signoff).toBeUndefined();
    expect(result.closingParagraph).toBeUndefined();
    expect(result.fullName).toBe(DEFAULT_PROFILE.fullName);
  });
});
