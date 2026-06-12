import { describe, it, expect, vi } from 'vitest';
import path from 'path';
import { buildCoverLetterLatex } from './latex';
import { normaliseBodyParagraph } from './ai';

vi.mock('./paths', () => ({
  findProjectRoot: () => path.join(__dirname, '..'),
}));

describe('buildCoverLetterLatex', () => {
  const baseCL = {
    fullName: 'Joel Joseph',
    email: 'joel@example.com',
    phone: '+61 400 000 000',
    linkedinUrl: 'https://linkedin.com/in/joel',
    dateLine: '17 June 2026',
    recipientLine: 'Hiring Manager',
    subjectLine: 'Application for SWE',
    greeting: 'Dear Hiring Manager,',
    openingParagraph: 'Opening paragraph.',
    closingParagraph: 'Closing paragraph.',
    signoff: 'Kind regards, Joel',
  };

  it('joins an array body with \\par between paragraphs', () => {
    const cl = {
      ...baseCL,
      bodyParagraph: ['First body paragraph.', 'Second body paragraph.', 'Third body paragraph.'],
    };
    const tex = buildCoverLetterLatex(cl);

    const bodyCommand = tex.match(/\\newcommand\{\\body\}\{([\s\S]*?)\}\s*\\newcommand\{\\closing\}/);
    expect(bodyCommand).not.toBeNull();
    const body = bodyCommand![1];
    expect(body).toContain('First body paragraph.');
    expect(body).toContain('\\par');
    expect(body).toContain('Second body paragraph.');
    expect(body).toContain('Third body paragraph.');
  });

  it('does not insert \\par for a single-element array body', () => {
    const cl = { ...baseCL, bodyParagraph: ['Only paragraph.'] };
    const tex = buildCoverLetterLatex(cl);
    const bodyCommand = tex.match(/\\newcommand\{\\body\}\{([\s\S]*?)\}\s*\\newcommand\{\\closing\}/);
    expect(bodyCommand).not.toBeNull();
    expect(bodyCommand![1]).not.toContain('\\par');
    expect(bodyCommand![1]).toContain('Only paragraph.');
  });

  it('normalises a legacy string body into separate paragraphs', () => {
    const cl = {
      ...baseCL,
      bodyParagraph: 'Legacy para one.\n\nLegacy para two.',
    };
    const tex = buildCoverLetterLatex(cl);
    const bodyCommand = tex.match(/\\newcommand\{\\body\}\{([\s\S]*?)\}\s*\\newcommand\{\\closing\}/);
    expect(bodyCommand).not.toBeNull();
    expect(bodyCommand![1]).toContain('Legacy para one.');
    expect(bodyCommand![1]).toContain('\\par');
    expect(bodyCommand![1]).toContain('Legacy para two.');
  });

  it('escapes LaTeX special characters inside body paragraphs', () => {
    const cl = {
      ...baseCL,
      bodyParagraph: ['Use & escape # chars.'],
    };
    const tex = buildCoverLetterLatex(cl);
    const bodyCommand = tex.match(/\\newcommand\{\\body\}\{([\s\S]*?)\}\s*\\newcommand\{\\closing\}/);
    expect(bodyCommand![1]).toContain('\\&');
    expect(bodyCommand![1]).toContain('\\#');
  });

  it('normaliser is exposed and behaves like the consumer expects', () => {
    expect(normaliseBodyParagraph('a\n\nb\n\nc')).toEqual(['a', 'b', 'c']);
  });
});
