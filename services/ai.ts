import { ResumeData } from './types';
import { log, logError } from './logger';
import { DEFAULT_PROFILE, parseDotEnvContent, buildProfileFromEnvVars, EnvResumeProfile, normalizeEnvProfile } from './env';
import fs from 'fs';
import path from 'path';
import { findProjectRoot } from './paths';

const projectRoot = findProjectRoot(__dirname);

function sanitizeJobDescription(text: string): string {
  if (!text) return text;
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013]/g, '-')
    .replace(/[\u2014]/g, '-')
    .replace(/[\u2026]/g, '...')
    .replace(/[\u00A0]/g, ' ')
    .replaceAll('|', ' ')
    .replaceAll('`', "'")
    .replaceAll('\\', ' ')
    .replaceAll('[', '(')
    .replaceAll(']', ')')
    .replaceAll('{', '(')
    .replaceAll('}', ')')
    .trim();
}

let opencodeSdk: any = null;

async function getSdk() {
  if (!opencodeSdk) {
    opencodeSdk = await import('@opencode-ai/sdk');
  }
  return opencodeSdk;
}

let opencodeClient: any = null;

const OPENCODE_PASSWORD = process.env.OPENCODE_SERVER_PASSWORD || process.env.OPENCODE_PASSWORD || '';
function getAuthHeader() {
    const credentials = Buffer.from(`opencode:${OPENCODE_PASSWORD}`).toString('base64');
    return `Basic ${credentials}`;
}

async function getOpencodeClient() {
  if (!opencodeClient) {
    const sdk = await getSdk();
    opencodeClient = sdk.createOpencodeClient({
      baseUrl: `http://${process.env.OPENCODE_HOSTNAME || 'localhost'}:${process.env.OPENCODE_PORT || '4096'}`,
      headers: {
        'Authorization': getAuthHeader(),
      },
    });
  }
  return opencodeClient;
}

const aiQueues: Map<string, Promise<unknown>> = new Map();

function enqueueAIRequest<T>(model: string, work: () => Promise<T>): Promise<T> {
  let aiQueue = aiQueues.get(model);
  if (!aiQueue) {
    aiQueue = Promise.resolve();
    aiQueues.set(model, aiQueue);
  }
  const promise = aiQueue.then(() => work());
  aiQueues.set(model, promise.catch(() => {}));
  return promise;
}

function loadEnvProfile(): EnvResumeProfile {
  const envPath = path.resolve(projectRoot, '..', '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    const vars = parseDotEnvContent(content);
    return buildProfileFromEnvVars(vars);
  }
  return normalizeEnvProfile();
}

function loadColleagueFeedback(): string {
  if (fs.existsSync(COLLEAGUE_FEEDBACK_FILE)) {
    const content = fs.readFileSync(COLLEAGUE_FEEDBACK_FILE, 'utf8').trim();
    if (content) {
      return content;
    }
  }
  return '';
}

const ENV_PROFILE = loadEnvProfile();
const OPENCODE_MODEL = process.env.OPENCODE_MODEL || 'opencode/gpt-5-nano';
const MODEL_PROVIDER_ID = process.env.OPENCODE_MODEL_PROVIDER_ID || '';
const MODEL_ID = process.env.OPENCODE_MODEL_ID || '';

const MODELS_WITHOUT_STRUCTURED_OUTPUT = [
  'qwen3.6-plus',
  'qwen3.6',
  'qwen3',
  'qwen2.5',
  'kimi-k2.6'
];

function modelSupportsStructuredOutput(model?: string): boolean {
  if (!model) return true;
  const lowerModel = model.toLowerCase();
  for (const unsupported of MODELS_WITHOUT_STRUCTURED_OUTPUT) {
    if (lowerModel.includes(unsupported)) {
      return false;
    }
  }
  return true;
}

function parseModel(modelStr: string): { providerID?: string; modelID?: string } {
  if (!modelStr?.includes('/')) return {};
  const [providerID, modelID] = modelStr.split('/');
  return { providerID, modelID };
}

const RESUME_JSON_SCHEMA = {
  type: "object",
  properties: {
    atsKeywords: { type: "array", items: { type: "string" }, description: "All ATS keywords extracted from the JD (lowercase)" },
    characterCountTrimmed: "string",
    name: { type: "string", description: "Candidate full name" },
    phone: { type: "string", description: "Phone number" },
    email: { type: "string", description: "Email address" },
    linkedinUrl: { type: "string", description: "LinkedIn URL" },
    linkedinDisplay: { type: "string", description: "LinkedIn display name" },
    // githubUrl: { type: "string", description: "GitHub URL" },
    // githubDisplay: { type: "string", description: "GitHub display name" },
    summary: { type: "string", description: "2-3 sentence tailored objective" },
    skills: {
      type: "object",
      properties: {
        languages: { type: "string", description: "Programming languages (comma-separated)" },
        frameworks: { type: "string", description: "Frameworks (comma-separated)" },
        tools: { type: "string", description: "Tools (comma-separated)" },
        libraries: { type: "string", description: "Libraries (comma-separated or empty)" }
      }
    },
    experience: {
      type: "array",
      items: {
        type: "object",
        properties: {
          company: { type: "string" },
          title: { type: "string" },
          location: { type: "string" },
          dates: { type: "string" },
          bullets: { type: "array", items: { type: "string" } }
        }
      }
    },
    education: {
      type: "array",
      items: {
        type: "object",
        properties: {
          institution: { type: "string" },
          location: { type: "string" },
          degree: { type: "string" },
          dates: { type: "string" }
        }
      }
    },
    projects: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          techStack: { type: "string", description: "Technologies used in the project (comma-separated, e.g. 'Python, FastAPI, Notion MCP')" },
          bullets: { type: "array", items: { type: "string" } }
        }
      }
    }
  },
  required: ["name", "phone", "email", "summary", "skills", "experience", "education", "projects"]
};

const COVER_LETTER_JSON_SCHEMA = {
  type: "object",
  properties: {
    fullName: { type: "string", description: "Candidate full name" },
    email: { type: "string", description: "Email address" },
    phone: { type: "string", description: "Phone number" },
    linkedinUrl: { type: "string", description: "LinkedIn URL" },
    linkedinDisplay: { type: "string", description: "LinkedIn display name" },
    dateLine: { type: "string", description: "Date line (e.g., 'May 4, 2026')" },
    recipientLine: { type: "string", description: "Recipient line (e.g., 'Hiring Manager')" },
    subjectLine: { type: "string", description: "Email subject line" },
    greeting: { type: "string", description: "Salutation (e.g., 'Dear Hiring Manager,')" },
    openingParagraph: { type: "string", description: "Opening paragraph" },
    bodyParagraph: { type: "string", description: "Body paragraph with key points" },
    closingParagraph: { type: "string", description: "Closing paragraph" },
    signoff: { type: "string", description: "Sign-off (e.g., 'Sincerely,')" }
  },
  required: ["fullName", "email", "phone", "openingParagraph", "bodyParagraph", "closingParagraph"]
};

const COMBINED_JSON_SCHEMA = {
  type: "object",
  properties: {
    atsKeywords: { type: "array", items: { type: "string" }, description: "All ATS keywords from JD" },
    resume: {
      type: "object",
      properties: {
        characterCountTrimmed: "string",
        name: { type: "string", description: "Candidate full name" },
        phone: { type: "string", description: "Phone number" },
        email: { type: "string", description: "Email address" },
        linkedinUrl: { type: "string", description: "LinkedIn URL" },
        linkedinDisplay: { type: "string", description: "LinkedIn display name" },
        // githubUrl: { type: "string", description: "GitHub URL" },
        // githubDisplay: { type: "string", description: "GitHub display name" },
        summary: { type: "string", description: "Tailored objective" },
        skills: {
          type: "object",
          properties: {
            languages: { type: "string" },
            frameworks: { type: "string" },
            tools: { type: "string" },
            libraries: { type: "string" }
          }
        },
        experience: {
          type: "array",
          items: {
            type: "object",
            properties: {
              company: { type: "string" },
              title: { type: "string" },
              location: { type: "string" },
              dates: { type: "string" },
              bullets: { type: "array", items: { type: "string" } }
            }
          }
        },
        education: {
          type: "array",
          items: {
            type: "object",
            properties: {
              institution: { type: "string" },
              location: { type: "string" },
              degree: { type: "string" },
              dates: { type: "string" }
            }
          }
        },
        projects: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              techStack: { type: "string", description: "Technologies used in the project (comma-separated)" },
              bullets: { type: "array", items: { type: "string" } }
            }
          }
        }
      },
      required: ["name", "summary", "skills", "experience", "education"]
    },
    coverLetter: {
      type: "object",
      properties: {
        fullName: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        dateLine: { type: "string" },
        recipientLine: { type: "string" },
        subjectLine: { type: "string" },
        greeting: { type: "string" },
        openingParagraph: { type: "string" },
        bodyParagraph: { type: "string" },
        closingParagraph: { type: "string" },
        signoff: { type: "string" }
      },
      required: ["openingParagraph", "bodyParagraph", "closingParagraph"]
    }
  },
  required: ["resume", "coverLetter"]
};

const PROMPTS_DIR = path.join(projectRoot, 'prompts');
const TEMPLATES_DIR = path.join(projectRoot, '..', 'templates');

const SYSTEM_PROMPT = fs.readFileSync(path.join(PROMPTS_DIR, 'resume-system-prompt.txt'), 'utf8');
const SYSTEM_PROMPT_ROLE_ONLY = fs.readFileSync(path.join(PROMPTS_DIR, 'resume-role-only-system-prompt.txt'), 'utf8');
const COMBINED_SYSTEM_PROMPT = fs.readFileSync(path.join(PROMPTS_DIR, 'combined-system-prompt.txt'), 'utf8');
const COVER_LETTER_SYSTEM_PROMPT_STAR = fs.readFileSync(path.join(PROMPTS_DIR, 'cover-letter-star-system-prompt.txt'), 'utf8');
const ATS_KEYWORD_EXTRACTION_PROMPT = fs.readFileSync(path.join(PROMPTS_DIR, 'ats-keyword-extraction-prompt.txt'), 'utf8');
const GOVT_STAR_METHOD_PROMPT_APPENDIX = fs.readFileSync(path.join(PROMPTS_DIR, 'govt-star-method-prompt.txt'), 'utf8');

const BASE_RESUME_TEMPLATE = fs.readFileSync(path.join(TEMPLATES_DIR, 'base-resume.txt.template'), 'utf8');
const BASE_RESUME_TEMPLATE_MINIMAL = fs.readFileSync(path.join(TEMPLATES_DIR, 'base-resume-minimal.txt.template'), 'utf8');
const BASE_RESUME_TEMPLATE_QA = fs.readFileSync(path.join(TEMPLATES_DIR, 'base-resume-qa.txt.template'), 'utf8');
const COLLEAGUE_FEEDBACK_FILE = path.join(TEMPLATES_DIR, 'colleague-feedback.txt');

function formatEducationLine(entry: { institution: string; location: string; degree: string; dates: string }): string {
  return `${entry.institution}, ${entry.location} | ${entry.degree} | ${entry.dates}`;
}

function buildBaseResume(useMinimal = false, resumeType?: 'software' | 'qa'): string {
  let template = useMinimal ? BASE_RESUME_TEMPLATE_MINIMAL : BASE_RESUME_TEMPLATE;
  if (resumeType === 'qa' && !useMinimal) {
    template = BASE_RESUME_TEMPLATE_QA;
  }
  return template
    // .replace('{{FULL_NAME}}', ENV_PROFILE.fullName)
    // .replace('{{PHONE}}', ENV_PROFILE.phone)
    // .replace('{{EMAIL}}', ENV_PROFILE.email)
    // .replace('{{LINKEDIN_URL}}', ENV_PROFILE.linkedinUrl)
    // // .replace('{{GITHUB_URL}}', ENV_PROFILE.linkedinUrl.replace('linkedin', 'github'))
    // .replace('{{EDUCATION_1}}', formatEducationLine(ENV_PROFILE.education[0]))
    // .replace('{{EDUCATION_2}}', formatEducationLine(ENV_PROFILE.education[1]));
}

function parseJSONFromResponse(text: string): any {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {}
    }
    return {};
  }
}

interface RunOpenCodeOptions {
  systemPrompt: string;
  userContent: string;
  model?: string;
  promptLogDir?: string;
  jsonSchema?: object;
}

interface RunOpenCodeResult {
  structured: any;
  rawText: string;
  usedStructuredOutput: boolean;
}

async function waitForOutputFile(filepath: string, timeoutMs = 120000, intervalMs = 2000): Promise<string | null> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (fs.existsSync(filepath)) {
      const content = fs.readFileSync(filepath, 'utf8');
      if (content.trim().length > 0) {
        return content;
      }
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  return null;
}

function runOpenCode(opts: RunOpenCodeOptions): Promise<RunOpenCodeResult> {
  return new Promise(async (resolve, reject) => {
    const { systemPrompt, userContent, model, promptLogDir, jsonSchema } = opts;
    const logDir = promptLogDir || '/tmp';
    const promptFile = path.join(logDir, `opencode-prompt-${Date.now()}.txt`);

    const modelToUse = model || OPENCODE_MODEL;
    const useStructuredOutput = modelSupportsStructuredOutput(modelToUse);
    const outputFilePath = (!useStructuredOutput && jsonSchema && logDir !== '/tmp')
      ? path.join(logDir, `structured-output-${Date.now()}.json`)
      : null;
    const fileOutputInstruction = outputFilePath
      ? `\n\nIMPORTANT: After generating the JSON, write it to this exact file path using bash: ${outputFilePath}\nUse this format: bash cat > ${outputFilePath} << 'JSONEOF'\n<your complete valid json here>\nJSONEOF\nWrite the file BEFORE you finish responding.`
      : '';

    const fullPrompt = `${systemPrompt}\n\n${userContent}${fileOutputInstruction}`;

    try {
      fs.writeFileSync(promptFile, fullPrompt, 'utf8');
      console.log('Prompt file written:', promptFile);
    } catch (err) {
      console.error('Failed to write prompt file:', err);
      reject(err);
      return;
    }

    console.log('\n========== OPENCODE STARTING ==========');
    console.log('Model:', modelToUse);
    console.log('Structured output:', useStructuredOutput ? 'yes' : 'no');
    console.log('Prompt file:', promptFile);
    console.log('=====================================\n');

    try {
      const client = await getOpencodeClient();
      console.log('Creating session in:', projectRoot);
      const session = await client.session.create({
        body: {
          path: {
            id: projectRoot
          },
          config: {
            model: modelToUse
          }
        }
      });

      if (session.error) {
        throw new Error(`Session creation error: ${JSON.stringify(session.error)}`);
      }

      console.log('Session created:', JSON.stringify(session).slice(0, 500));
      const sessionId = session.data?.id || session.id;

      const promptBody: any = {
        parts: [{ type: "text", text: fullPrompt }]
      };

      if (jsonSchema && useStructuredOutput) {
        promptBody.format = { type: "json_schema", schema: jsonSchema };
      }

      const userModel = parseModel(model || '');
      if (userModel.providerID && userModel.modelID) {
        promptBody.model = { providerID: userModel.providerID, modelID: userModel.modelID };
      } else if (MODEL_PROVIDER_ID && MODEL_ID) {
        promptBody.model = { providerID: MODEL_PROVIDER_ID, modelID: MODEL_ID };
      }

      console.log("prompt body model details", promptBody.model)

      const result = await client.session.prompt({
        path: { id: sessionId },
        body: promptBody
      });

      if (result.error) {
        throw new Error(`Prompt error: ${JSON.stringify(result.error)}`);
      }

      console.log("opencode prompt result = ", JSON.stringify(result, null, 2).slice(0, 2000))

      if (jsonSchema && useStructuredOutput && result.data?.info?.structured) {
        console.log('\n========== OPENCODE DONE (structured) ==========\n');
        resolve({
          structured: result.data.info.structured,
          rawText: '',
          usedStructuredOutput: true
        });
        return;
      }

      if (jsonSchema && result.data?.info?.error?.name === "StructuredOutputError") {
        console.error("Failed to produce structured output:", result.data.info.error.message);
        console.error("Attempts:", result.data.info.error.retries);
      }

      const allParts = result.data?.info?.parts || result.data?.parts || [];
      const resultText = allParts.find((p: any) => p.type === "text")?.text
        || result.data?.content
        || '';

      let parsed: any = null;
      for (const part of allParts) {
        if (part.type !== "text") continue;
        const text = part.text || "";
        if (!text.trim()) continue;

        parsed = parseJSONFromResponse(text);
        if (parsed && Object.keys(parsed).length > 0) {
          console.log("Successfully parsed JSON from text part");
          resolve({
            structured: parsed,
            rawText: text,
            usedStructuredOutput: false
          });
          return;
        }
      }

      const info = result.data?.info;
      if (jsonSchema && !info?.structured && info?.toolCalls) {
        console.log("Model used tool calls instead of text output, checking tool results...");
        const toolCalls = info.toolCalls;
        for (const toolCall of toolCalls) {
          if (toolCall.type === 'tool-call' && toolCall.name === 'bash') {
            const args = typeof toolCall.arguments === 'string' ? JSON.parse(toolCall.arguments) : toolCall.arguments;
            if (args.command && args.command.includes('JSONEOF')) {
              const jsonMatch = args.command.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                try {
                  const parsed = JSON.parse(jsonMatch[0]);
                  console.log("Successfully extracted JSON from bash tool call");
                  resolve({
                    structured: parsed,
                    rawText: JSON.stringify(parsed, null, 2),
                    usedStructuredOutput: false
                  });
                  return;
                } catch (e) {
                  console.error("Failed to parse JSON from tool call:", e);
                }
              }
            }
          }
        }
      }

      if (outputFilePath) {
        console.log(`Polling for output file: ${outputFilePath}`);
        const fileContent = await waitForOutputFile(outputFilePath, 120000, 2000);
        if (fileContent) {
          const parsed = parseJSONFromResponse(fileContent);
          if (parsed && Object.keys(parsed).length > 0) {
            console.log("Successfully read JSON from output file");
            resolve({
              structured: parsed,
              rawText: fileContent,
              usedStructuredOutput: false
            });
            return;
          }
        } else {
          console.error(`Output file not found or empty after timeout: ${outputFilePath}`);
        }
      }

      console.log('\n========== OPENCODE DONE ==========\n');
      resolve({
        structured: resultText,
        rawText: resultText,
        usedStructuredOutput: false
      });
    } catch (err) {
      console.log('[AI ERROR]', err);
      reject(err);
    }
  });
}

export type CoverLetterJSON = {
  fullName: string;
  email: string;
  phone: string;
  linkedinUrl: string;
  linkedinDisplay: string;
  dateLine: string;
  recipientLine: string;
  subjectLine: string;
  greeting: string;
  openingParagraph: string;
  bodyParagraph: string;
  closingParagraph: string;
  signoff: string;
};

function applyProfileOverrides(json: any): ResumeData {
  const updated = { ...json };
  updated.name = ENV_PROFILE.fullName;
  updated.email = ENV_PROFILE.email;
  updated.phone = ENV_PROFILE.phone;
  updated.linkedinUrl = ENV_PROFILE.linkedinUrl;
  updated.linkedinDisplay = ENV_PROFILE.linkedinDisplay;
  
  if (updated.education && updated.education.length >= 0) {
    updated.education[0] = { ...updated.education[0], ...ENV_PROFILE.education[0] };
    if (updated.education[1]) {
      updated.education[1] = { ...updated.education[1], ...ENV_PROFILE.education[1] };
    }
  }
  
  return updated;
}

export async function generateResumeJSON(
  jobDescription: string,
  extraNotes: string,
  context?: { companyName?: string; roleName?: string; generateWithoutJD?: boolean; promptLogDir?: string },
  options?: { lowTokenMode?: boolean; modelSelect?: string; resumeType?: 'software' | 'qa' }
): Promise<ResumeData> {
  log('generateResumeJSON (opencode) called, lowTokenMode:', options?.lowTokenMode, 'model:', options?.modelSelect, 'resumeType:', options?.resumeType);
  
  try {
    const sanitizedJD = sanitizeJobDescription(jobDescription);
    const model = options?.modelSelect || OPENCODE_MODEL;
    const baseResume = buildBaseResume(options?.lowTokenMode, options?.resumeType);
    const companyLine = context?.companyName?.trim() || '[not provided]';
    const roleLine = context?.roleName?.trim() || '[not provided]';
    const generateWithoutJD = Boolean(context?.generateWithoutJD);
    
    let userContent: string;
    let systemPrompt: string;
    
    if (generateWithoutJD) {
      systemPrompt = SYSTEM_PROMPT_ROLE_ONLY;
      userContent = `BASE RESUME:\n${baseResume}\n\nTARGET ROLE:\n${roleLine}\n\nEXTRA NOTES:\n${extraNotes}`;
    } else {
      systemPrompt = SYSTEM_PROMPT;
      userContent = `BASE RESUME:\n${baseResume}\n\nJOB DESCRIPTION:\n${sanitizedJD}\n\nEXTRA NOTES:\n${extraNotes}`;
    }
    
    const result = await enqueueAIRequest(model, () => runOpenCode({ systemPrompt, userContent, model, promptLogDir: context?.promptLogDir, jsonSchema: RESUME_JSON_SCHEMA }));
    return applyProfileOverrides(result.structured);
  } catch (err) {
    logError('OpenCode generation error:', err);
    throw err;
  }
}

export async function generateCoverLetterJSON(
  structuredResume: ResumeData,
  jobDescription: string,
  extraNotes: string,
  companyName: string,
  roleName: string,
  options?: { modelSelect?: string; promptLogDir?: string; useStarMethodForGovtRoles?: boolean }
): Promise<CoverLetterJSON> {
  log('generateCoverLetterJSON (opencode) called, model:', options?.modelSelect, 'starMethod:', options?.useStarMethodForGovtRoles);
  
  try {
    const model = options?.modelSelect || OPENCODE_MODEL;
    const sanitizedJD = sanitizeJobDescription(jobDescription);
    
    const COVER_LETTER_SYSTEM_PROMPT = fs.readFileSync(path.join(PROMPTS_DIR, 'cover-letter-system-prompt.txt'), 'utf8');
    const useStar = options?.useStarMethodForGovtRoles ?? false;
    const coverPrompt = useStar ? COVER_LETTER_SYSTEM_PROMPT_STAR : COVER_LETTER_SYSTEM_PROMPT;
    const colleagueFeedback = loadColleagueFeedback();
    const privacySafeResume = sanitizeResumeForExternalCoverLetterModel(structuredResume);
    const userContent = `COMPANY:\n${companyName}\n\nROLE:\n${roleName}\n\nJOB DESCRIPTION:\n${sanitizedJD}\n\nEXTRA NOTES:\n${extraNotes}\n\n${colleagueFeedback ? 'COLLEAGUE FEEDBACK:\n' + colleagueFeedback : ''}\n\nRESUME:\n${JSON.stringify(privacySafeResume, null, 2)}`;

    const result = await enqueueAIRequest(model, () => runOpenCode({ systemPrompt: coverPrompt, userContent, model, promptLogDir: options?.promptLogDir, jsonSchema: COVER_LETTER_JSON_SCHEMA }));
    return result.structured;
  } catch (err) {
    logError('OpenCode cover letter error:', err);
    throw err;
  }
}

export interface CombinedGenerationJSON {
  atsKeywords?: string[];
  resume: ResumeData;
  coverLetter: CoverLetterJSON;
}

export async function generateCombinedJSON(
  jobDescription: string,
  extraNotes: string,
  companyName: string,
  roleName: string,
  generateWithoutJD?: boolean,
  options?: { lowTokenMode?: boolean; modelSelect?: string; promptLogDir?: string; useStarMethodForGovtRoles?: boolean; resumeType?: 'software' | 'qa' }
): Promise<CombinedGenerationJSON> {
  log('generateCombinedJSON (opencode) called, model:', options?.modelSelect, 'lowTokenMode:', options?.lowTokenMode, 'starMethod:', options?.useStarMethodForGovtRoles, 'resumeType:', options?.resumeType);
  
  try {
    const model = options?.modelSelect || OPENCODE_MODEL;
    const sanitizedJD = sanitizeJobDescription(jobDescription);
    const baseResume = buildBaseResume(options?.lowTokenMode, options?.resumeType);
    const targetContext = generateWithoutJD
      ? `TARGET ROLE:\n${roleName || 'General technical role'}`
      : `JOB DESCRIPTION:\n${sanitizedJD}`;
    
    const colleagueFeedback = loadColleagueFeedback();
    const userContent = `BASE RESUME:\n${baseResume}\n\nCOMPANY:\n${companyName}\n\nROLE:\n${roleName}\n\n${targetContext}\n\nEXTRA NOTES:\n${extraNotes}\n\n${colleagueFeedback ? 'COLLEAGUE FEEDBACK:\n' + colleagueFeedback : ''}`;
    
    const useStar = options?.useStarMethodForGovtRoles ?? false;
    const systemPrompt = useStar
      ? `${COMBINED_SYSTEM_PROMPT}\n\nFor the coverLetter output, also apply this mode:\n${GOVT_STAR_METHOD_PROMPT_APPENDIX}`
      : COMBINED_SYSTEM_PROMPT;
    
    const result = await enqueueAIRequest(model, () => runOpenCode({ systemPrompt, userContent, model, promptLogDir: options?.promptLogDir, jsonSchema: COMBINED_JSON_SCHEMA }));

    if (!result.structured?.resume?.name || typeof result.structured.resume.name !== 'string') {
      throw new Error('Invalid response from OpenCode');
    }

    const resume = applyProfileOverrides(result.structured.resume);
    return {
      atsKeywords: result.structured?.atsKeywords ?? result.structured?.resume?.atsKeywords ?? [],
      resume,
      coverLetter: result.structured.coverLetter,
    };
  } catch (err) {
    logError('OpenCode combined generation error:', err);
    throw err;
  }
}

export type ATSKeywordMatchResult = {
  extractedFromJD: string[];
  includedInResume: string[];
  missingFromResume: string[];
  coveragePercent: number;
};

function normalizeKeywordText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\r/g, '\n')
    .replaceAll('(', ' ')
    .replaceAll(')', ' ')
    .replaceAll('[', ' ')
    .replaceAll(']', ' ')
    .replaceAll('{', ' ')
    .replaceAll('}', ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function keywordToRegexFragment(keyword: string): string {
  return keyword
    .toLowerCase()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replaceAll('.', '\\$&')
    .replaceAll('*', '\\$&')
    .replaceAll('+', '\\$&')
    .replaceAll('?', '\\$&')
    .replaceAll('^', '\\$&')
    .replaceAll('$', '\\$&')
    .replaceAll('{', '\\$&')
    .replaceAll('}', '\\$&')
    .replaceAll('(', '\\$&')
    .replaceAll(')', '\\$&')
    .replaceAll('|', '\\$&')
    .replaceAll('[', '\\$&')
    .replaceAll(']', '\\$&')
    .replaceAll('\\', '\\$&')
    .replace(/\s+/g, '[\\s\\-/]*')
    .replace(/\\\./g, '[\\.]?')
    .replace(/\\\//g, '[\\/]?');
}

function hasKeyword(text: string, keyword: string): boolean {
  const fragment = keywordToRegexFragment(keyword);
  const regex = new RegExp(`(^|[^a-z0-9+#])${fragment}([^a-z0-9+#]|$)`, 'i');
  return regex.test(text);
}

function buildResumeSearchText(resume: ResumeData): string {
  const educationText = (resume.education || [])
    .map((e) => `${e.institution} ${e.location} ${e.degree} ${e.dates}`)
    .join(' ');
  const experienceText = (resume.experience || [])
    .map((e) => `${e.company} ${e.title} ${e.location} ${e.dates} ${e.bullets.join(' ')}`)
    .join(' ');
  const projectText = (resume.projects || [])
    .map((p) => `${p.name} ${p.bullets.join(' ')}`)
    .join(' ');

  return normalizeKeywordText([
    resume.name,
    resume.summary,
    resume.skills?.languages,
    resume.skills?.frameworks,
    resume.skills?.tools,
    resume.skills?.libraries,
    educationText,
    experienceText,
    projectText,
  ].filter(Boolean).join(' '));
}

export async function extractATSKeywordsFromJDViaAI(
  jobDescription: string
): Promise<string[]> {
  log('extractATSKeywordsFromJDViaAI called');
  const sanitizedJD = sanitizeJobDescription(jobDescription);
  if (!sanitizedJD.trim()) {
    return [];
  }

  try {
    const sdk = await getSdk();
    const client = sdk.createOpencodeClient({
      serverUrl: process.env.OPENCODE_SERVER_URL || 'https://api.opencode.ai',
      auth: getAuthHeader(),
    });

    const result = await client.chat.completions.create({
      model: 'openai/gpt-4o',
      temperature: 0.3,
      messages: [
        { role: 'system', content: ATS_KEYWORD_EXTRACTION_PROMPT },
        { role: 'user', content: `JOB DESCRIPTION:\n${sanitizedJD}` },
      ],
    });

    const raw = result.choices[0]?.message?.content?.trim() ?? '';
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((k: unknown) => typeof k === 'string' && k.trim().length > 0)
      .map((k: string) => k.trim().toLowerCase())
      .sort((a: string, b: string) => a.localeCompare(b));
  } catch {
    return [];
  }
}

export function analyzeATSKeywordsAgainstResume(
  extractedFromJD: string[],
  resume: ResumeData
): ATSKeywordMatchResult {
  const resumeText = buildResumeSearchText(resume);

  const includedInResume = extractedFromJD
    .filter((keyword) => hasKeyword(resumeText, keyword))
    .sort((a, b) => a.localeCompare(b));

  const missingFromResume = extractedFromJD
    .filter((keyword) => !hasKeyword(resumeText, keyword))
    .sort((a, b) => a.localeCompare(b));

  const coveragePercent = extractedFromJD.length
    ? Math.round((includedInResume.length / extractedFromJD.length) * 100)
    : 100;

  return {
    extractedFromJD,
    includedInResume,
    missingFromResume,
    coveragePercent,
  };
}

export function buildPrivacySafeBaseResumeForExternalModel(): string {
  const template = BASE_RESUME_TEMPLATE;
  const formatEducationLine = (entry: { institution: string; location: string; degree: string; dates: string }) =>
    `${entry.institution}, ${entry.location} | ${entry.degree} | ${entry.dates}`;

  return template
    .replace('{{FULL_NAME}}', DEFAULT_PROFILE.fullName)
    .replace('{{PHONE}}', DEFAULT_PROFILE.phone)
    .replace('{{EMAIL}}', DEFAULT_PROFILE.email)
    .replace('{{LINKEDIN_URL}}', DEFAULT_PROFILE.linkedinUrl)
    // .replace('{{GITHUB_URL}}', DEFAULT_PROFILE.linkedinUrl.replace('linkedin', 'github'))
    .replace('{{EDUCATION_1}}', formatEducationLine(DEFAULT_PROFILE.education[0]))
    .replace('{{EDUCATION_2}}', formatEducationLine(DEFAULT_PROFILE.education[1]));
}

export function buildPrivacyPlaceholderEducationEntry(index: number) {
  const fallback = DEFAULT_PROFILE.education[Math.min(index, DEFAULT_PROFILE.education.length - 1)];
  return {
    institution: fallback.institution,
    location: fallback.location,
    degree: fallback.degree,
    dates: fallback.dates,
  };
}

export function sanitizeResumeForExternalCoverLetterModel(structuredResume: ResumeData): ResumeData {
  return {
    ...structuredResume,
    name: DEFAULT_PROFILE.fullName,
    phone: DEFAULT_PROFILE.phone,
    email: DEFAULT_PROFILE.email,
    linkedinUrl: DEFAULT_PROFILE.linkedinUrl,
    linkedinDisplay: DEFAULT_PROFILE.linkedinDisplay,
    education: structuredResume.education.map((_, index) => buildPrivacyPlaceholderEducationEntry(index)),
  };
}