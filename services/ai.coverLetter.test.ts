import { describe, it, expect } from 'vitest';
import { normaliseBodyParagraph } from './ai';

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
