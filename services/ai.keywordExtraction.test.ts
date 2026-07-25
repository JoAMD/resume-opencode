import { describe, it, expect } from 'vitest';
import { parseATSKeywordExtractionResponse } from './ai';

describe('parseATSKeywordExtractionResponse', () => {
  it('returns [] for null', () => {
    expect(parseATSKeywordExtractionResponse(null)).toEqual([]);
  });

  it('returns [] for undefined', () => {
    expect(parseATSKeywordExtractionResponse(undefined)).toEqual([]);
  });

  it('returns [] for an object that has no keywords array', () => {
    expect(parseATSKeywordExtractionResponse({ unrelated: ['x'] })).toEqual([]);
  });

  it('returns [] for a string', () => {
    expect(parseATSKeywordExtractionResponse('typescript' as unknown)).toEqual([]);
  });

  it('returns [] for a number', () => {
    expect(parseATSKeywordExtractionResponse(42 as unknown)).toEqual([]);
  });

  it('parses the { keywords: string[] } schema response into a sorted lowercase string[]', () => {
    expect(parseATSKeywordExtractionResponse({ keywords: ['Python', 'pytorch', 'AWS'] }))
      .toEqual(['aws', 'python', 'pytorch']);
  });

  it('still accepts a bare array response for backwards compatibility', () => {
    expect(parseATSKeywordExtractionResponse(['Python', 'pytorch']))
      .toEqual(['python', 'pytorch']);
  });

  it('returns [] when the keywords field is not an array', () => {
    expect(parseATSKeywordExtractionResponse({ keywords: 'typescript' })).toEqual([]);
    expect(parseATSKeywordExtractionResponse({ keywords: null })).toEqual([]);
    expect(parseATSKeywordExtractionResponse({ keywords: 42 })).toEqual([]);
  });

  it('returns [] when the keywords array is empty', () => {
    expect(parseATSKeywordExtractionResponse({ keywords: [] })).toEqual([]);
    expect(parseATSKeywordExtractionResponse([])).toEqual([]);
  });

  it('filters out non-string and empty entries before sorting', () => {
    expect(parseATSKeywordExtractionResponse({ keywords: ['  React  ', '', 42, null, 'AWS', 'Go'] }))
      .toEqual(['aws', 'go', 'react']);
  });

  it('returns [] when the keywords array contains only invalid entries', () => {
    expect(parseATSKeywordExtractionResponse({ keywords: ['', 42, null, undefined, '   '] })).toEqual([]);
  });
});
