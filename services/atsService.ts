import path from 'path';
import { ATSAnalysisResult, ResumeData } from './types';
import { extractATSKeywordsFromJDViaAI } from './ai';
import { runAtsAiAnalysis, buildAtsAnalysisMarkdown } from './atsAiService';
import { loadStructuredJSONFromDir, loadATSAnalysisFromDir, loadJobDescriptionFromDir, saveJobFile, getJobsDir } from './jobDir';
import { log } from './logger';

export interface ATSAnalysisInput {
  folderPath?: string;
  resumeJSON?: ResumeData;
  jobDescription?: string;
  atsKeywordsFromAI?: string[];
  lastGeneratedResumeJSON?: ResumeData | null;
  modelSelect?: string;
}

export interface ATSAnalysisOutput {
  result: ATSAnalysisResult | null;
  error?: string;
}

interface ResumeContext {
  resume: ResumeData;
  jobDescription?: string;
  keywordsFromResume?: string[];
  keywordsFromPriorAnalysis?: string[];
  resolvedPath?: string;
}

function resolveFolderPath(folderPath: string): string {
  if (!path.isAbsolute(folderPath)) {
    return path.join(getJobsDir(), folderPath);
  }
  return folderPath;
}

function readFolderContext(folderPath: string): ResumeContext {
  const resolvedPath = resolveFolderPath(folderPath);
  log('Resolved path:', resolvedPath);

  const resume = loadStructuredJSONFromDir(resolvedPath) as ResumeData | undefined;
  const atsData = loadATSAnalysisFromDir(resolvedPath);
  const jdFromFile = loadJobDescriptionFromDir(resolvedPath);

  return {
    resume,
    jobDescription: jdFromFile ?? undefined,
    keywordsFromResume: resume ? (resume as any).atsKeywords : undefined,
    keywordsFromPriorAnalysis: atsData?.extractedFromJD,
    resolvedPath,
  };
}

function pickResume(input: ATSAnalysisInput, folderCtx: ResumeContext | null): ResumeData | undefined {
  if (folderCtx?.resume) return folderCtx.resume;
  return input.resumeJSON ?? input.lastGeneratedResumeJSON ?? undefined;
}

function firstNonEmpty(...candidates: (string[] | undefined)[]): string[] {
  for (const c of candidates) {
    if (c && c.length) return c;
  }
  return [];
}

function pickKeywords(input: ATSAnalysisInput, folderCtx: ResumeContext | null): string[] {
  return firstNonEmpty(
    input.atsKeywordsFromAI,
    folderCtx?.keywordsFromResume,
    folderCtx?.keywordsFromPriorAnalysis,
  );
}

async function extractKeywordsIfMissing(jd: string | undefined): Promise<string[]> {
  if (!jd?.trim()) return [];
  return extractATSKeywordsFromJDViaAI(jd);
}

function buildEmptyResult(resolvedPath: string | undefined): ATSAnalysisResult {
  const empty: ATSAnalysisResult = {
    coveragePercent: 0,
    extractedFromJD: [],
    includedInResume: [],
    missingFromResume: [],
    source: 'regex',
  };
  if (resolvedPath) {
    saveJobFile(resolvedPath, 'ats-analysis.json', JSON.stringify(empty, null, 2));
    saveJobFile(resolvedPath, 'ats-analysis.md', buildAtsAnalysisMarkdown(empty));
  }
  return empty;
}

function persistAnalysis(resolvedPath: string | undefined, analysis: ATSAnalysisResult): void {
  if (!resolvedPath) return;
  saveJobFile(resolvedPath, 'ats-analysis.json', JSON.stringify(analysis, null, 2));
  saveJobFile(resolvedPath, 'ats-analysis.md', buildAtsAnalysisMarkdown(analysis));
  log(`Saved ats-analysis.json + ats-analysis.md (source=${analysis.source ?? 'unknown'})`);
}

async function runAiWithRegexFallback(args: {
  jobDescription: string;
  resume: ResumeData;
  jdKeywords: string[];
  resolvedPath: string | undefined;
  modelSelect?: string;
}): Promise<ATSAnalysisResult> {
  try {
    const outcome = await runAtsAiAnalysis({
      jobDescription: args.jobDescription,
      resume: args.resume,
      jdKeywords: args.jdKeywords,
      jobDir: args.resolvedPath,
      modelOverride: args.modelSelect,
    });
    return outcome.analysis;
  } catch (err) {
    log('AI ATS analysis errored, falling back to regex:', err instanceof Error ? err.message : err);
    const { analyzeATSKeywordsAgainstResume } = await import('./ai.js');
    const base = analyzeATSKeywordsAgainstResume(args.jdKeywords, args.resume);
    return {
      ...base,
      source: 'regex',
      summaryMarkdown: `_AI analysis failed (${err instanceof Error ? err.message : 'unknown'}). Falling back to regex keyword coverage._\n`,
    };
  }
}

async function resolveFinalKeywords(args: {
  input: ATSAnalysisInput;
  folderCtx: ResumeContext | null;
  jobDescription: string | undefined;
}): Promise<{ keywords: string[]; missingJd: boolean }> {
  const fromSources = pickKeywords(args.input, args.folderCtx);
  if (fromSources.length) return { keywords: fromSources, missingJd: false };
  log('Extracting atsKeywords from JD via AI');
  const fromJD = await extractKeywordsIfMissing(args.jobDescription);
  return { keywords: fromJD, missingJd: !args.jobDescription?.trim() };
}

export async function runATSAnalysis(input: ATSAnalysisInput): Promise<ATSAnalysisOutput> {
  const folderCtx = input.folderPath?.trim() ? readFolderContext(input.folderPath) : null;
  const targetResume = pickResume(input, folderCtx ?? null);
  log('targetResume found:', !!targetResume);

  if (!targetResume) {
    return { result: null, error: 'No resume JSON available. Provide folderPath with structured-output.json, or resumeJSON, or generate a resume first.' };
  }

  const targetJobDescription = input.jobDescription ?? folderCtx?.jobDescription;
  const { keywords: atsKeywords, missingJd } = await resolveFinalKeywords({
    input,
    folderCtx,
    jobDescription: targetJobDescription,
  });

  if (!atsKeywords.length) {
    if (missingJd) {
      return { result: null, error: 'No job description available. Provide atsKeywordsFromAI or ensure job-description.txt exists in folderPath.' };
    }
    return { result: buildEmptyResult(folderCtx?.resolvedPath) };
  }

  const analysis = await runAiWithRegexFallback({
    jobDescription: targetJobDescription ?? '',
    resume: targetResume,
    jdKeywords: atsKeywords,
    resolvedPath: folderCtx?.resolvedPath,
    modelSelect: input.modelSelect,
  });

  persistAnalysis(folderCtx?.resolvedPath, analysis);
  return { result: analysis };
}
