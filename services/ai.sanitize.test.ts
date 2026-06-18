import { describe, it, expect } from 'vitest';
import { sanitizeJobDescription } from './ai';

describe('sanitizeJobDescription', () => {
  it('returns falsy input unchanged', () => {
    expect(sanitizeJobDescription('')).toBe('');
    expect(sanitizeJobDescription(undefined as unknown as string)).toBeUndefined();
    expect(sanitizeJobDescription(null as unknown as string)).toBeNull();
  });

  it('strips a single emoji glyph', () => {
    const result = sanitizeJobDescription('Hello 📍 world');
    expect(result).toBe('Hello world');
  });

  it('strips multiple emoji including pointing finger', () => {
    const result = sanitizeJobDescription('Role summary 👉 with details 👉 here');
    expect(result).toBe('Role summary with details here');
  });

  it('strips emoji that use variation selector-16 (FE0F)', () => {
    const result = sanitizeJobDescription('Job ☎️ details');
    expect(result).toBe('Job details');
  });

  it('strips skin-toned emoji and ZWJ sequences', () => {
    const zwjWomanTech = '\u{1F469}\u{1F3FD}\u200D\u{1F4BB}';
    const result = sanitizeJobDescription(`Lead ${zwjWomanTech} engineer`);
    expect(result).toBe('Lead engineer');
  });

  it('collapses double spaces left behind after emoji removal', () => {
    const result = sanitizeJobDescription('Senior 📍 Engineer');
    expect(result).toBe('Senior Engineer');
    expect(result).not.toMatch(/  /);
  });

  it('trims leading/trailing whitespace from each line after emoji removal', () => {
    const input = '📍 line one\n   line two   \nline three';
    const result = sanitizeJobDescription(input);
    expect(result).toBe('line one\nline two\nline three');
  });

  it('collapses runs of three or more blank lines down to two', () => {
    const input = 'Para one\n\n\n\n\nPara two';
    expect(sanitizeJobDescription(input)).toBe('Para one\n\nPara two');
  });

  it('preserves text that has no emoji', () => {
    const input = 'Plain text only, nothing fancy here.';
    expect(sanitizeJobDescription(input)).toBe(input);
  });

  it('still applies existing replacements (dashes, pipes, brackets, ellipsis)', () => {
    const input = 'Use \u201Cbest practices\u201D \u2013 not \u2014 hacks | or {shortcuts}\u2026';
    const result = sanitizeJobDescription(input);
    expect(result).toBe('Use \u201Cbest practices\u201D - not - hacks or (shortcuts)...');
  });

  it('handles emoji-adjacent punctuation without leaving dangling whitespace', () => {
    const result = sanitizeJobDescription('Sydney, NSW 📍 Australia');
    expect(result).toBe('Sydney, NSW Australia');
  });
});
