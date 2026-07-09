import fs from 'fs';
import os from 'os';
import path from 'path';

const PROMPT_FILES = [
  'resume-system-prompt.txt',
  'resume-role-only-system-prompt.txt',
  'combined-system-prompt.txt',
  'cover-letter-star-system-prompt.txt',
  'cover-letter-system-prompt.txt',
  'ats-keyword-extraction-prompt.txt',
  'ats-analysis-prompt.txt',
  'govt-star-method-prompt.txt',
  'trim-resume-prompt.txt',
];

const TEMPLATE_FILES = [
  'base-resume.txt.template',
  'base-resume-minimal.txt.template',
  'base-resume-qa.txt.template',
  'colleague-feedback.txt',
  'resume.tex.template',
  'resume-qa.tex.template',
  'cover-letter.tex.template',
];

const BASE_RESUME_TEMPLATE = [
  '{{FULL_NAME}}',
  '{{PHONE}} | {{EMAIL}}',
  '{{LINKEDIN_URL}}',
  '',
  'EDUCATION',
  '{{EDUCATION_1}}',
  '{{EDUCATION_2}}',
  '',
  'SUMMARY',
  '[Summary section]',
  '',
  'EXPERIENCE',
  '[Experience section]',
  '',
  'PROJECTS',
  '[Projects section]',
].join('\n');

const RESUME_LATEX_TEMPLATE = [
  '\\documentclass{article}',
  '\\newcommand{\\summary}{[Summary]}',
  '\\newcommand{\\body}{[Body]}',
  '\\newcommand{\\closing}{[Closing]}',
].join('\n');

const COVER_LETTER_LATEX_TEMPLATE = [
  '\\documentclass{letter}',
  '\\newcommand{\\body}{{{{BODY_PARAGRAPH}}}}',
  '\\newcommand{\\closing}{[Closing paragraph]}',
  '{{{FULL_NAME}}}',
  '{{{EMAIL}}}',
].join('\n');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-opencode-test-'));
const promptsDir = path.join(dir, 'prompts');
const templatesDir = path.join(dir, 'templates');
fs.mkdirSync(promptsDir, { recursive: true });
fs.mkdirSync(templatesDir, { recursive: true });

for (const name of PROMPT_FILES) {
  fs.writeFileSync(path.join(promptsDir, name), `TEST_PROMPT ${name}\n`);
}
fs.writeFileSync(path.join(templatesDir, 'base-resume.txt.template'), BASE_RESUME_TEMPLATE + '\n');
fs.writeFileSync(path.join(templatesDir, 'base-resume-minimal.txt.template'), BASE_RESUME_TEMPLATE + '\n');
fs.writeFileSync(path.join(templatesDir, 'base-resume-qa.txt.template'), BASE_RESUME_TEMPLATE + '\n');
fs.writeFileSync(path.join(templatesDir, 'colleague-feedback.txt'), '');
fs.writeFileSync(path.join(templatesDir, 'resume.tex.template'), RESUME_LATEX_TEMPLATE + '\n');
fs.writeFileSync(path.join(templatesDir, 'resume-qa.tex.template'), RESUME_LATEX_TEMPLATE + '\n');
fs.writeFileSync(path.join(templatesDir, 'cover-letter.tex.template'), COVER_LETTER_LATEX_TEMPLATE + '\n');

process.env.OPENCODE_PROMPTS_DIR = promptsDir;
process.env.OPENCODE_TEMPLATES_DIR = templatesDir;
