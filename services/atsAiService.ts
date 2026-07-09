import fs from 'fs';
import path from 'path';
import { findProjectRoot } from './paths';
import { loadEnv } from './loadEnv';
import { ATSAnalysisResult, ResumeData } from './types';
import {
  analyzeATSKeywordsAgainstResume,
  enqueueAIRequest,
  extractATSKeywordsFromJDViaAI,
  runOpenCode,
  sanitizeJobDescription,
} from './ai';
import {
  ensureRedactedResumeFile,
  isRedactedResume,
  PII_FIELDS,
  redactResumeForExternalModel,
} from './redactResume';
import { renderAtsAnalysisMarkdown } from './atsReport';
import { log, logError } from './logger';

loadEnv();
const projectRoot = findProjectRoot(__dirname);

const PROMPTS_DIR = process.env.OPENCODE_PROMPTS_DIR || path.join(projectRoot, 'prompts');
const ATS_ANALYSIS_PROMPT_FILE = path.join(PROMPTS_DIR, 'ats-analysis-prompt.txt');

function readLazyFile(filePath: string): () => string {
  let cached: string | undefined;
  return () => {
    if (cached === undefined) {
      cached = fs.readFileSync(filePath, 'utf8');
    }
    return cached;
  };
}

const ATS_ANALYSIS_PROMPT = (() => {
  try {
    return readLazyFile(ATS_ANALYSIS_PROMPT_FILE);
  } catch (err) {
    logError('Failed to load ats-analysis-prompt.txt; AI analysis will be unavailable:', err);
    return () => '';
  }
})();

const ATS_ANALYSIS_MODEL = process.env.OPENCODE_ATS_ANALYSIS_MODEL || process.env.OPENCODE_MODEL || 'opencode-go/minimax-m3';
const ATS_AI_ENABLED = (process.env.OPENCODE_ATS_AI ?? 'true').toLowerCase() !== 'false';

const ATS_ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    includedInResume: { type: 'array', items: { type: 'string' } },
    missingFromResume: { type: 'array', items: { type: 'string' } },
    strengths: { type: 'array', items: { type: 'string' } },
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          keyword: { type: 'string' },
          why: { type: 'string' },
          suggestion: { type: 'string' },
        },
        required: ['keyword', 'why', 'suggestion'],
      },
    },
    recommendations: { type: 'array', items: { type: 'string' } },
    summaryMarkdown: { type: 'string' },
  },
  required: ['includedInResume', 'missingFromResume'],
};

export interface ATSAiAnalysisInput {
  jobDescription: string;
  resume: ResumeData;
  jdKeywords?: string[];
  jobDir?: string;
  modelOverride?: string;
  promptLogDir?: string;
}

export interface ATSAiAnalysisOutcome {
  analysis: ATSAnalysisResult;
  source: 'ai' | 'regex';
  redactedResumePath?: string;
  modelUsed: string;
  fallbackReason?: string;
}

function normaliseKeywordList(input: string[] | undefined | null): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((k) => typeof k === 'string' && k.trim().length > 0)
    .map((k) => k.trim().toLowerCase())
    .sort((a, b) => a.localeCompare(b));
}

function computeCoverage(extractedFromJD: string[], included: string[]): number {
  if (!extractedFromJD.length) return 100;
  return Math.round((included.length / extractedFromJD.length) * 100);
}

function summariseFailure(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function buildRegexFallback(reason: string): Pick<ATSAnalysisResult, 'summaryMarkdown' | 'source' | 'strengths' | 'gaps' | 'recommendations'> {
  return {
    source: 'regex',
    summaryMarkdown: `_AI analysis unavailable (${reason}). Falling back to regex keyword coverage._\n`,
    strengths: [],
    gaps: [],
    recommendations: [],
  };
}

function reconcileKeywordCoverage(
  parsed: any,
  extractedFromJD: string[],
): { included: string[]; missing: string[] } {
  const known = new Set(extractedFromJD);
  const aiIncluded = normaliseKeywordList(Array.isArray(parsed?.includedInResume) ? parsed.includedInResume : []);
  const aiMissing = normaliseKeywordList(Array.isArray(parsed?.missingFromResume) ? parsed.missingFromResume : []);

  const includedFiltered = aiIncluded.filter((k) => known.has(k));
  const seen = new Set(includedFiltered);

  const missingFiltered = aiMissing.filter((k) => known.has(k) && !seen.has(k));
  for (const k of extractedFromJD) {
    if (!seen.has(k)) {
      seen.add(k);
      missingFiltered.push(k);
    }
  }

  return {
    included: includedFiltered.sort((a, b) => a.localeCompare(b)),
    missing: Array.from(new Set(missingFiltered)).sort((a, b) => a.localeCompare(b)),
  };
}

function extractAiStrengths(parsed: any): string[] {
  if (!Array.isArray(parsed?.strengths)) return [];
  return parsed.strengths
    .filter((s: unknown) => typeof s === 'string' && s.trim().length > 0)
    .map((s: string) => s.trim());
}

function extractAiGaps(parsed: any): ATSAnalysisResult['gaps'] {
  if (!Array.isArray(parsed?.gaps)) return [];
  return parsed.gaps
    .filter((g: any) => g && typeof g.keyword === 'string')
    .map((g: any) => ({
      keyword: String(g.keyword).toLowerCase().trim(),
      why: typeof g.why === 'string' ? g.why.trim() : '',
      suggestion: typeof g.suggestion === 'string' ? g.suggestion.trim() : '',
    }));
}

function extractAiRecommendations(parsed: any): string[] {
  if (!Array.isArray(parsed?.recommendations)) return [];
  return parsed.recommendations
    .filter((s: unknown) => typeof s === 'string' && s.trim().length > 0)
    .map((s: string) => s.trim());
}

function extractAiSummary(parsed: any): string {
  return typeof parsed?.summaryMarkdown === 'string' ? parsed.summaryMarkdown.trim() : '';
}

interface ParsedAiResponse {
  included: string[];
  missing: string[];
  strengths: string[];
  gaps: ATSAnalysisResult['gaps'];
  recommendations: string[];
  summaryMarkdown: string;
}

export function parseAiResponse(parsed: any, extractedFromJD: string[]): ParsedAiResponse {
  const coverage = reconcileKeywordCoverage(parsed, extractedFromJD);
  return {
    ...coverage,
    strengths: extractAiStrengths(parsed),
    gaps: extractAiGaps(parsed),
    recommendations: extractAiRecommendations(parsed),
    summaryMarkdown: extractAiSummary(parsed),
  };
}

export function buildAtsUserContent(args: {
  sanitizedJD: string;
  jdKeywords: string[];
  redactedResume: ResumeData;
}): string {
  return [
    'JOB DESCRIPTION:',
    args.sanitizedJD,
    '',
    'ATS KEYWORDS EXTRACTED FROM JD (lowercase, may include multi-word phrases):',
    JSON.stringify(args.jdKeywords),
    '',
    'REDACTED RESUME (PII stripped: name, phone, email, linkedinUrl, linkedinDisplay, githubUrl, githubDisplay are empty strings):',
    JSON.stringify(args.redactedResume, null, 2),
  ].join('\n');
}

function assertRedactionHolds(redacted: ResumeData, context: string): void {
  if (isRedactedResume(redacted)) return;
  for (const field of PII_FIELDS) {
    const value = (redacted as unknown as Record<string, unknown>)[field];
    if (typeof value === 'string' && value.trim().length > 0) {
      logError(`Refusing AI ATS analysis: redaction failed for field "${field}" (${context})`);
      throw new Error(`Refusing to send PII to ATS AI: field "${field}" is non-empty`);
    }
  }
}

function resolveRedactedResume(resume: ResumeData, jobDir?: string): { redacted: ResumeData; redactedPath?: string } {
  if (jobDir?.trim()) {
    const ensured = ensureRedactedResumeFile(jobDir, resume);
    return { redacted: ensured.redacted, redactedPath: ensured.path };
  }
  return { redacted: redactResumeForExternalModel(resume) };
}

async function extractKeywordsFromJD(jd: string, supplied: string[] | undefined): Promise<string[]> {
  const fromInput = normaliseKeywordList(supplied);
  if (fromInput.length) return fromInput;
  if (!jd.trim()) throw new Error('No job description provided and no keywords supplied');
  const fromAI = normaliseKeywordList(await extractATSKeywordsFromJDViaAI(sanitizeJobDescription(jd)));
  if (!fromAI.length) throw new Error('No ATS keywords could be extracted from the job description');
  return fromAI;
}

function buildAiAnalysisResult(
  parsed: any,
  extractedFromJD: string[],
  model: string,
  redactedPath: string | undefined,
): ATSAnalysisResult {
  const normalised = parseAiResponse(parsed, extractedFromJD);
  return {
    extractedFromJD,
    includedInResume: normalised.included,
    missingFromResume: normalised.missing,
    coveragePercent: computeCoverage(extractedFromJD, normalised.included),
    source: 'ai',
    model,
    strengths: normalised.strengths,
    gaps: normalised.gaps,
    recommendations: normalised.recommendations,
    summaryMarkdown: normalised.summaryMarkdown,
    redactedResumePath: redactedPath,
  };
}

function buildRegexFallbackResult(
  extractedFromJD: string[],
  resume: ResumeData,
  reason: string,
  redactedPath: string | undefined,
): ATSAnalysisResult {
  const base = analyzeATSKeywordsAgainstResume(extractedFromJD, resume);
  return {
    ...base,
    ...buildRegexFallback(reason),
    redactedResumePath: redactedPath,
  };
}

export async function callAtsAnalysisModel(args: {
  model: string;
  sanitizedJD: string;
  jdKeywords: string[];
  redactedResume: ResumeData;
  promptLogDir?: string;
}): Promise<any> {
  const systemPrompt = ATS_ANALYSIS_PROMPT();
  if (!systemPrompt.trim()) {
    throw new Error('ats-analysis-prompt.txt is empty or missing');
  }
  const userContent = buildAtsUserContent({
    sanitizedJD: args.sanitizedJD,
    jdKeywords: args.jdKeywords,
    redactedResume: args.redactedResume,
  });

  const result = await enqueueAIRequest(args.model, () =>
    runOpenCode({
      systemPrompt,
      userContent,
      model: args.model,
      promptLogDir: args.promptLogDir,
      jsonSchema: ATS_ANALYSIS_JSON_SCHEMA,
    }),
  );

  if (!result?.structured || typeof result.structured !== 'object') {
    throw new Error(
      `ATS AI call returned no structured response (usedStructuredOutput=${result?.usedStructuredOutput})`,
    );
  }
  return result.structured;
}

export async function runAtsAiAnalysis(input: ATSAiAnalysisInput): Promise<ATSAiAnalysisOutcome> {
  const sanitizedJD = sanitizeJobDescription(input.jobDescription || '');
  const extractedFromJD = await extractKeywordsFromJD(sanitizedJD, input.jdKeywords);
  const regexResult = analyzeATSKeywordsAgainstResume(extractedFromJD, input.resume);

  if (!ATS_AI_ENABLED) {
    return {
      analysis: {
        ...regexResult,
        ...buildRegexFallback('OPENCODE_ATS_AI=false'),
      },
      source: 'regex',
      modelUsed: 'regex',
      fallbackReason: 'OPENCODE_ATS_AI=false',
    };
  }

  const { redacted, redactedPath } = resolveRedactedResume(input.resume, input.jobDir);
  assertRedactionHolds(redacted, 'pre-call');

  const model = input.modelOverride || ATS_ANALYSIS_MODEL;
  try {
    const parsed = await callAtsAnalysisModel({
      model,
      sanitizedJD,
      jdKeywords: extractedFromJD,
      redactedResume: redacted,
      promptLogDir: input.promptLogDir,
    });
    return {
      analysis: buildAiAnalysisResult(parsed, extractedFromJD, model, redactedPath),
      source: 'ai',
      redactedResumePath: redactedPath,
      modelUsed: model,
    };
  } catch (err) {
    logError('ATS AI call failed; falling back to regex coverage:', err);
    return {
      analysis: buildRegexFallbackResult(extractedFromJD, input.resume, summariseFailure(err), redactedPath),
      source: 'regex',
      redactedResumePath: redactedPath,
      modelUsed: 'regex',
      fallbackReason: summariseFailure(err),
    };
  }
}

export function buildAtsAnalysisMarkdown(analysis: ATSAnalysisResult): string {
  return renderAtsAnalysisMarkdown(analysis);
}
