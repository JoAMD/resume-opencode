import fs from 'fs';
import path from 'path';
import { findProjectRoot } from './paths';
import { ResumeData, ResumeEducation, ResumeExperience, ResumeProject } from './types';

const projectRoot = findProjectRoot(__dirname);
const TEMPLATE_PATH = path.join(projectRoot, 'templates', 'resume.tex.template');

function toText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => toText(item)).filter((item) => item.length > 0).join(', ');
  }
  return '';
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  return {};
}

function esc(value: unknown): string {
  const str = toText(value);
  return str
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/\$/g, '\\$')
    .replace(/#/g, '\\#')
    .replace(/_/g, '\\_')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

function buildEducationEntries(education: unknown): string {
  return asArray<ResumeEducation>(education)
    .map(
      (entry) => `
    \\resumeSubheading
      {${esc(entry.institution)}}{${esc(entry.location)}}
      {${esc(entry.degree)}}{${esc(entry.dates)}}`,
    )
    .join('\n');
}

function buildExperienceEntries(experience: unknown): string {
  return asArray<ResumeExperience>(experience)
    .map((entry) => {
      const bullets = asArray<string>(entry.bullets).map((bullet) => `        \\resumeItem{${esc(bullet)}}`).join('\n');
      return `
    \\resumeSubheading
      {${esc(entry.title)}}{${esc(entry.dates)}}
      {${esc(entry.company)}}{${esc(entry.location)}}
      \\resumeItemListStart
${bullets}
      \\resumeItemListEnd`;
    })
    .join('\n');
}

function buildProjectEntries(projects: unknown): string {
  const items = asArray<ResumeProject>(projects);

  if (!items.length) {
    return '';
  }

return items
    .map((project) => {
      const bullets = asArray<string>(project.bullets).map((bullet) => `        \\resumeItem{${esc(bullet)}}`).join('\n');
      return `
    \\resumeSubheading
      {\\textbf{${esc(project.name)}}}{}
      {${esc(project.techStack)}}{}
      \\resumeItemListStart
${bullets}
      \\resumeItemListEnd`;
    })
    .join('\n');
}

function removeSectionIfEmpty(template: string, sectionTitle: string, hasContent: boolean): string {
  if (hasContent) {
    return template;
  }

  const escapedTitle = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const upperTitle = escapedTitle.toUpperCase();

  const emptyListBlockRegex = new RegExp(
    `%-----------${upperTitle}-----------\\r?\\n\\s*\\\\section\\{${escapedTitle}\\}\\r?\\n\\s*\\\\resumeSubHeadingListStart\\s*\\r?\\n\\s*\\\\resumeSubHeadingListEnd\\s*\\r?\\n?`,
    'm',
  );
  let updated = template.replace(emptyListBlockRegex, '');

  const sectionRegex = new RegExp(
    `%-----------${upperTitle}-----------\\r?\\n[\\s\\S]*?\\\\section\\{${escapedTitle}\\}[\\s\\S]*?(?=\\r?\\n%-----------|\\r?\\n%-------------------------------------------|$)`,
    'm',
  );

  updated = updated.replace(sectionRegex, '');

  return updated;
}

export function buildLatex(json: ResumeData, resumeType?: 'software' | 'qa'): string {
  const templateName = resumeType === 'qa' ? 'resume-qa.tex.template' : 'resume.tex.template';
  const templatePath = path.join(projectRoot, 'templates', templateName);
  let template = fs.readFileSync(templatePath, 'utf8');
  const data = asRecord(json);
  const skills = asRecord(data.skills);
  const educationEntries = buildEducationEntries(data.education);
  const experienceEntries = buildExperienceEntries(data.experience);
  const projectsEntries = buildProjectEntries(data.projects);

  template = template
    .replaceAll('{{FULL_NAME}}', esc(data.name))
    .replaceAll('{{PHONE}}', esc(data.phone))
    .replaceAll('{{EMAIL}}', esc(data.email))
    .replaceAll('{{LINKEDIN_URL}}', esc(data.linkedinUrl))
    .replaceAll('{{LINKEDIN_DISPLAY}}', esc(data.linkedinDisplay))
    .replaceAll('{{GITHUB_URL}}', esc(data.githubUrl))
    .replaceAll('{{GITHUB_DISPLAY}}', esc(data.githubDisplay))
    .replaceAll('{{SUMMARY}}', esc(data.summary))
    .replaceAll('{{SKILLS_LANGUAGES}}', esc(skills.languages))
    .replaceAll('{{SKILLS_FRAMEWORKS}}', esc(skills.frameworks))
    .replaceAll('{{SKILLS_TOOLS}}', esc(skills.tools))
    .replaceAll('{{SKILLS_LIBRARIES}}', esc(skills.libraries))
    .replaceAll('{{EDUCATION_ENTRIES}}', educationEntries)
    .replaceAll('{{EXPERIENCE_ENTRIES}}', experienceEntries)
    .replaceAll('{{PROJECTS_ENTRIES}}', projectsEntries);

  template = removeSectionIfEmpty(template, 'Summary', Boolean(toText(data.summary).trim()));
  template = removeSectionIfEmpty(template, 'Education', Boolean(educationEntries.trim()));
  template = removeSectionIfEmpty(template, 'Experience', Boolean(experienceEntries.trim()));
  template = removeSectionIfEmpty(template, 'Projects', Boolean(projectsEntries.trim()));

  return template;
}

export function buildCoverLetterLatex(cl: {
  fullName: string;
  email: string;
  phone: string;
  linkedinUrl: string;
  dateLine: string;
  recipientLine: string;
  subjectLine: string;
  greeting: string;
  openingParagraph: string;
  bodyParagraph: string;
  closingParagraph: string;
  signoff: string;
}): string {
  const templatePath = path.join(projectRoot, 'templates', 'cover-letter.tex.template');
  let template = fs.readFileSync(templatePath, 'utf8');

  const replace = (ph: string, value: string) =>
    template = template.replace(new RegExp(`\\{\\{\\{${ph}\\}\\}\\}`, 'g'), esc(value));

  replace('FULL_NAME', cl.fullName);
  replace('EMAIL', cl.email);
  replace('PHONE', cl.phone);
  replace('LINKEDIN_URL', cl.linkedinUrl);
  replace('DATE_LINE', cl.dateLine);
  replace('RECIPIENT_LINE', cl.recipientLine);
  replace('SUBJECT_LINE', cl.subjectLine);
  replace('GREETING', cl.greeting);
  replace('OPENING_PARAGRAPH', cl.openingParagraph);
  replace('BODY_PARAGRAPH', cl.bodyParagraph);
  replace('CLOSING_PARAGRAPH', cl.closingParagraph);
  replace('SIGNOFF', cl.signoff);

  return template;
}
