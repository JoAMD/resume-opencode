import { describe, it, expect } from 'vitest';
import { filterATSKeywords } from './ai';

describe('filterATSKeywords', () => {
  it('keeps keywords present in JD (case-insensitive)', () => {
    const jd = 'We need a React developer with Node.js and PostgreSQL experience';
    expect(filterATSKeywords(['react', 'node.js', 'postgresql'], jd)).toEqual(['react', 'node.js', 'postgresql']);
  });

  it('removes keywords not in JD', () => {
    const jd = 'We need a React developer';
    expect(filterATSKeywords(['react', 'angular', 'vue'], jd)).toEqual(['react']);
  });

  it('handles empty keywords', () => {
    expect(filterATSKeywords([], 'some jd')).toEqual([]);
  });

  it('handles empty JD', () => {
    expect(filterATSKeywords(['react'], '')).toEqual([]);
  });

  it('matches case-insensitively', () => {
    const jd = 'Experience with AWS and Docker';
    expect(filterATSKeywords(['aws', 'Docker', 'KUBERNETES'], jd)).toEqual(['aws', 'Docker']);
  });
});
