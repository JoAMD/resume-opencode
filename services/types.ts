export type ResumeSkills = {
  languages: string;
  frameworks: string;
  tools: string;
  libraries: string;
};

export type ResumeExperience = {
  company: string;
  title: string;
  location: string;
  dates: string;
  bullets: string[];
};

export type ResumeEducation = {
  institution: string;
  location: string;
  degree: string;
  dates: string;
};

export type ResumeProject = {
  name: string;
  techStack?: string;
  bullets: string[];
};

export type ResumeData = {
  name: string;
  phone: string;
  email: string;
  linkedinUrl: string;
  linkedinDisplay: string;
  githubUrl?: string;
  githubDisplay?: string;
  summary: string;
  skills: ResumeSkills;
  experience: ResumeExperience[];
  education: ResumeEducation[];
  projects: ResumeProject[];
  atsKeywords?: string[];
  characterCountTrimmed?: string;
};

export type ATSAnalysisGap = {
  keyword: string;
  why: string;
  suggestion: string;
};

export type ATSAnalysisResult = {
  extractedFromJD: string[];
  includedInResume: string[];
  missingFromResume: string[];
  coveragePercent: number;
  source?: 'ai' | 'regex';
  model?: string;
  strengths?: string[];
  gaps?: ATSAnalysisGap[];
  recommendations?: string[];
  summaryMarkdown?: string;
  redactedResumePath?: string;
  error?: string;
};
