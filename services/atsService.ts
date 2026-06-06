import { ResumeData } from './types';
import { analyzeATSKeywordsAgainstResume, extractATSKeywordsFromJDViaAI } from './ai';
import { loadStructuredJSONFromDir, loadATSAnalysisFromDir, loadJobDescriptionFromDir, saveJobFile } from './jobDir';
import { log } from './logger';

export interface ATSAnalysisResult {
  coveragePercent: number;
  extractedFromJD: string[];
  includedInResume: string[];
  missingFromResume: string[];
}

export interface ATSAnalysisInput {
  folderPath?: string;
  resumeJSON?: ResumeData;
  jobDescription?: string;
  atsKeywordsFromAI?: string[];
  lastGeneratedResumeJSON?: ResumeData | null;
}

export interface ATSAnalysisOutput {
  result: ATSAnalysisResult | null;
  error?: string;
}

export async function runATSAnalysis(input: ATSAnalysisInput): Promise<ATSAnalysisOutput> {
  let targetResume: ResumeData | undefined;
  let targetJobDescription = input.jobDescription;
  let extractedAtsKeywords: string[] | undefined;

  if (input.folderPath?.trim()) {
    const resolvedPath = resolveFolderPath(input.folderPath);
    log('Resolved path:', resolvedPath);

    targetResume = loadStructuredJSONFromDir(resolvedPath) as ResumeData | undefined;
    if (targetResume) {
      extractedAtsKeywords = (targetResume as any).atsKeywords;
    }

    const atsData = loadATSAnalysisFromDir(resolvedPath);
    if (atsData && !extractedAtsKeywords?.length && atsData.extractedFromJD?.length) {
      extractedAtsKeywords = atsData.extractedFromJD;
    }

    const jdFromFile = loadJobDescriptionFromDir(resolvedPath);
    if (jdFromFile) {
      targetJobDescription = jdFromFile;
    }
  } else {
    targetResume = input.resumeJSON ?? input.lastGeneratedResumeJSON;
  }

  log('targetResume found:', !!targetResume);

  if (!targetResume) {
    return { result: null, error: 'No resume JSON available. Provide folderPath with structured-output.json, or resumeJSON, or generate a resume first.' };
  }

  let atsKeywords: string[] = [];

  if (input.atsKeywordsFromAI && input.atsKeywordsFromAI.length > 0) {
    atsKeywords = input.atsKeywordsFromAI;
    log('Using provided atsKeywords:', atsKeywords.length);
  } else if (extractedAtsKeywords?.length) {
    atsKeywords = extractedAtsKeywords;
    log('Using extracted atsKeywords from saved files:', atsKeywords.length);
  } else if (targetJobDescription?.trim()) {
    log('Extracting atsKeywords from JD via AI');
    atsKeywords = await extractATSKeywordsFromJDViaAI(targetJobDescription);
  } else {
    return { result: null, error: 'No job description available. Provide atsKeywordsFromAI or ensure job-description.txt exists in folderPath.' };
  }

  if (!atsKeywords.length) {
    return {
      result: { coveragePercent: 0, extractedFromJD: [], includedInResume: [], missingFromResume: [] }
    };
  }

  const atsResult = analyzeATSKeywordsAgainstResume(atsKeywords, targetResume);
  log('ATS result:', atsResult.coveragePercent);

  if (input.folderPath?.trim()) {
    const resolvedPath = resolveFolderPath(input.folderPath);
    saveJobFile(resolvedPath, 'ats-analysis.json', JSON.stringify(atsResult, null, 2));
    log('Saved updated ats-analysis.json');
  }

  return { result: atsResult };
}

function resolveFolderPath(folderPath: string): string {
  const { getJobsDir } = require('./jobDir');
  if (!path.isAbsolute(folderPath)) {
    return path.join(getJobsDir(), folderPath);
  }
  return folderPath;
}

import path from 'path';