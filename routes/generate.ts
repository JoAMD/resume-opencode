import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import slugify from 'slugify';
import { generateResumeJSON, generateCoverLetterJSON, generateCombinedJSON, CoverLetterJSON, analyzeATSKeywordsAgainstResume, extractATSKeywordsFromJDViaAI } from '../services/ai';
import { ResumeData } from '../services/types';
import { log, logError } from '../services/logger';
import { buildLatex, buildCoverLetterLatex } from '../services/latex';
import { compilePDF } from '../services/compiler';
import { findProjectRoot } from '../services/paths';

const router = Router();
const projectRoot = findProjectRoot(__dirname);
const jobsDir = path.join(projectRoot, 'jobs');

router.use((req, _res, next) => {
  log(`${req.method} /generate${req.path}`);
  next();
});

type GenerateRequestBody = {
  jobDescription?: string;
  companyName?: string;
  roleName?: string;
  extraNotes?: string;
  generateWithoutJD?: boolean;
  coverOutput?: 'pdf' | 'txt' | 'none';
  lowTokenMode?: boolean;
  modelSelect?: string;
  useStarMethodForGovtRoles?: boolean;
  resumeType?: 'software' | 'qa';
  useCombinedGeneration?: boolean;
};

let lastGeneratedResumeJSON: any = null;
let lastGeneratedTexPath: string | null = null;
let lastGeneratedCoverLetterJSON: CoverLetterJSON | null = null;

type TaskStatus = 'pending' | 'complete' | 'error';
type TaskResult = {
  status: TaskStatus;
  result?: any;
  error?: string;
};

const taskMap = new Map<string, TaskResult & { startedAt: number }>();

function createTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function findLatestTexFile(): string | null {
  if (!fs.existsSync(jobsDir)) return null;
  const files = fs.readdirSync(jobsDir).filter(f => f.endsWith('.tex'));
  if (!files.length) return null;
  const filePaths = files.map(f => path.join(jobsDir, f));
  filePaths.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return filePaths[0];
}

async function compileTexFile(texPath: string): Promise<Buffer> {
  const latexSource = fs.readFileSync(texPath, 'utf8');
  return await compilePDF(latexSource);
}

router.get('/task/:taskId', (req, res) => {
  const { taskId } = req.params;
  const task = taskMap.get(taskId);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  res.json({
    status: task.status,
    result: task.result,
    error: task.error,
    startedAt: task.startedAt,
  });
});

router.post('/', async (req, res) => {
  const { jobDescription, companyName, roleName, extraNotes, generateWithoutJD, coverOutput, lowTokenMode, useCombinedGeneration } = req.body as GenerateRequestBody;

  if (!companyName || !roleName) {
    res.status(400).json({ error: 'companyName and roleName are required.' });
    return;
  }

  if (!generateWithoutJD && !jobDescription?.trim()) {
    res.status(400).json({ error: 'jobDescription is required unless generateWithoutJD is true.' });
    return;
  }

  try {
    const date = new Date().toISOString().slice(0, 10);
    const slug = slugify(`${companyName}-${roleName}-${date}`, { lower: true, strict: true });
    const jobDir = path.join(jobsDir, slug);
    fs.mkdirSync(jobDir, { recursive: true });

    const context = { companyName, roleName, generateWithoutJD, promptLogDir: jobDir };
    const options = { lowTokenMode: Boolean(lowTokenMode), modelSelect: req.body.modelSelect, promptLogDir: jobDir, useStarMethodForGovtRoles: Boolean(req.body.useStarMethodForGovtRoles), resumeType: req.body.resumeType as 'software' | 'qa' | undefined };
    log(`Request: company=${companyName}, role=${roleName}, noJD=${generateWithoutJD}, lowToken=${lowTokenMode}, coverOutput=${coverOutput}, model=${req.body.modelSelect}, starMethod=${req.body.useStarMethodForGovtRoles}, resumeType=${req.body.resumeType}`);

    fs.writeFileSync(path.join(jobDir, 'job-description.txt'), jobDescription ?? '', 'utf8');

    const taskId = createTaskId();
    taskMap.set(taskId, { status: 'pending', startedAt: Date.now() });

    res.json({ taskId, jobDir: slug });

    (async () => {
      try {
        let resumeJSON: ResumeData;
        let coverLetterJSON: CoverLetterJSON | undefined;
        let atsKeywords: string[] = [];

        if (useCombinedGeneration !== false && coverOutput && coverOutput !== 'none') {
          const combined = await generateCombinedJSON(jobDescription ?? '', extraNotes ?? '', companyName, roleName, generateWithoutJD, options);
          resumeJSON = combined.resume;
          coverLetterJSON = combined.coverLetter;
          atsKeywords = combined.atsKeywords ?? [];
        } else {
          resumeJSON = await generateResumeJSON(jobDescription ?? '', extraNotes ?? '', context, options);
        }

        lastGeneratedResumeJSON = resumeJSON;
        log('Resume JSON received');

        const latexSource = buildLatex(resumeJSON, req.body.resumeType);
        const pdfBuffer = await compilePDF(latexSource);

        fs.writeFileSync(path.join(jobDir, 'resume.tex'), latexSource, 'utf8');
        fs.writeFileSync(path.join(jobDir, 'resume.pdf'), pdfBuffer);
        const texPath = path.join(jobDir, 'resume.tex');
        lastGeneratedTexPath = texPath;

        fs.writeFileSync(path.join(jobDir, 'structured-output.json'), JSON.stringify(resumeJSON, null, 2), 'utf8');

        let coverPdfUrl: string | undefined;
        let coverTxtUrl: string | undefined;

        if (coverLetterJSON) {
          lastGeneratedCoverLetterJSON = coverLetterJSON;
          fs.writeFileSync(path.join(jobDir, 'cover-letter.json'), JSON.stringify(coverLetterJSON, null, 2), 'utf8');

          const coverLatex = buildCoverLetterLatex(coverLetterJSON);
          fs.writeFileSync(path.join(jobDir, 'cover-letter.tex'), coverLatex, 'utf8');

          if (coverOutput === 'txt') {
            const txtContent = formatCoverLetterText(coverLetterJSON);
            const txtPath = path.join(jobDir, 'cover-letter.txt');
            fs.writeFileSync(txtPath, txtContent, 'utf8');
            coverTxtUrl = `/jobs/${slug}/cover-letter.txt`;
          } else if (coverOutput === 'pdf') {
            const coverPdfBuffer = await compilePDF(coverLatex);
            fs.writeFileSync(path.join(jobDir, 'cover-letter.pdf'), coverPdfBuffer);
            coverPdfUrl = `/jobs/${slug}/cover-letter.pdf`;
          }
        }

        let atsResult = null;
        let atsCoverage: number | undefined;
        if (atsKeywords.length > 0) {
          atsResult = analyzeATSKeywordsAgainstResume(atsKeywords, resumeJSON);
          atsCoverage = atsResult.coveragePercent;
          fs.writeFileSync(path.join(jobDir, 'ats-analysis.json'), JSON.stringify(atsResult, null, 2), 'utf8');
          log(`ATS analysis: ${atsCoverage}% coverage, ${atsKeywords.length} keywords`);
        }

        const result = {
          pdfUrl: `/jobs/${slug}/resume.pdf`,
          jobDir: slug,
          ...(coverPdfUrl && { coverPdfUrl }),
          ...(coverTxtUrl && { coverTxtUrl }),
          ...(atsCoverage !== undefined && { atsCoverage }),
          ...(atsKeywords.length > 0 && { atsKeywords }),
        };

        taskMap.set(taskId, { status: 'complete', result, startedAt: Date.now() });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Internal server error';
        logError('Background generation error:', err);
        taskMap.set(taskId, { status: 'error', error: message, startedAt: Date.now() });
      }
    })();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    logError('Generation error:', err);
    res.status(500).json({ error: message });
  }
});

router.post('/coverLetter', async (req, res) => {
  const { companyName, roleName, jobDescription, extraNotes, coverOutput, modelSelect, useStarMethodForGovtRoles, folderPath } = req.body as GenerateRequestBody & { folderPath?: string };
  if (!companyName || !roleName) {
    res.status(400).json({ error: 'companyName and roleName are required.' });
    return;
  }

  let resumeJSON = lastGeneratedResumeJSON;

  if (!resumeJSON && folderPath?.trim()) {
    let resolvedPath = folderPath;
    if (!path.isAbsolute(folderPath)) {
      resolvedPath = path.join(jobsDir, folderPath);
    }
    const structuredPath = path.join(resolvedPath, 'structured-output.json');
    if (fs.existsSync(structuredPath)) {
      try {
        resumeJSON = JSON.parse(fs.readFileSync(structuredPath, 'utf8'));
        log('Loaded resume JSON from folder:', structuredPath);
      } catch (e) {
        logError('Failed to parse structured-output.json:', e);
      }
    }
  }

  if (!resumeJSON) {
    res.status(400).json({ error: 'No resume JSON available. Generate a resume first, or provide a folderPath with structured-output.json.' });
    return;
  }

  try {
    const coverLetterJSON = await generateCoverLetterJSON(
      resumeJSON,
      jobDescription ?? '',
      extraNotes ?? '',
      companyName,
      roleName,
      { modelSelect, useStarMethodForGovtRoles }
    );
    lastGeneratedCoverLetterJSON = coverLetterJSON;

    let jobDir = jobsDir;
    if (lastGeneratedTexPath) {
      jobDir = path.dirname(lastGeneratedTexPath);
    } else {
      const date = new Date().toISOString().slice(0, 10);
      const slug = slugify(`cover-letter-${companyName}-${roleName}-${date}`, { lower: true, strict: true });
      jobDir = path.join(jobsDir, slug);
      fs.mkdirSync(jobDir, { recursive: true });
    }

    fs.writeFileSync(path.join(jobDir, 'cover-letter.json'), JSON.stringify(coverLetterJSON, null, 2), 'utf8');

    const latexSource = buildCoverLetterLatex(coverLetterJSON);
    fs.writeFileSync(path.join(jobDir, 'cover-letter.tex'), latexSource, 'utf8');

    if (coverOutput === 'txt') {
      const txtContent = formatCoverLetterText(coverLetterJSON);
      const txtPath = path.join(jobDir, 'cover-letter.txt');
      fs.writeFileSync(txtPath, txtContent, 'utf8');
      res.json({ txtUrl: `/jobs/${path.basename(jobDir)}/cover-letter.txt` });
    } else {
      const pdfBuffer = await compilePDF(latexSource);
      const pdfPath = path.join(jobDir, 'cover-letter.pdf');
      fs.writeFileSync(pdfPath, pdfBuffer);
      res.json({ pdfUrl: `/jobs/${path.basename(jobDir)}/cover-letter.pdf` });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    logError('Cover letter error:', err);
    res.status(500).json({ error: message });
  }
});

router.post('/compileLastTex', async (req, res) => {
  try {
    const texPath = lastGeneratedTexPath ?? findLatestTexFile();
    if (!texPath) {
      res.status(400).json({ error: 'No .tex file found. Generate a resume first.' });
      return;
    }
    if (!fs.existsSync(texPath)) {
      res.status(400).json({ error: `File not found: ${texPath}` });
      return;
    }
    const pdfBuffer = await compileTexFile(texPath);
    const pdfPath = texPath.replace(/\.tex$/i, '.pdf');
    fs.writeFileSync(pdfPath, pdfBuffer);
    const pdfUrl = `/jobs/${path.basename(path.dirname(texPath))}/${path.basename(pdfPath)}`;
    res.json({ pdfUrl });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    logError('Compile last tex error:', err);
    res.status(500).json({ error: message });
  }
});

router.post('/compileFolderTex', async (req, res) => {
  try {
    const { folderPath } = req.body as { folderPath?: string };
    let targetDir = jobsDir;
    if (folderPath && fs.existsSync(folderPath)) {
      if (fs.statSync(folderPath).isDirectory()) {
        targetDir = folderPath;
      } else if (folderPath.toLowerCase().endsWith('.tex') && fs.existsSync(folderPath)) {
        const pdfBuffer = await compileTexFile(folderPath);
        const pdfPath = folderPath.replace(/\.tex$/i, '.pdf');
        fs.writeFileSync(pdfPath, pdfBuffer);
        res.json({ count: 1 });
        return;
      }
    }
    if (!fs.existsSync(targetDir)) {
      res.status(400).json({ error: 'Directory does not exist.' });
      return;
    }
    let count = 0;
    const texFiles = fs.readdirSync(targetDir).filter(f => f.toLowerCase().endsWith('.tex'));
    for (const texFile of texFiles) {
      const texPath = path.join(targetDir, texFile);
      try {
        const pdfBuffer = await compileTexFile(texPath);
        const pdfPath = texPath.replace(/\.tex$/i, '.pdf');
        fs.writeFileSync(pdfPath, pdfBuffer);
        count++;
      } catch (e) {
        logError(`Failed to compile ${texPath}:`, e);
      }
    }
    res.json({ count });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    logError('Compile folder error:', err);
    res.status(500).json({ error: message });
  }
});

router.post('/latexFromStructured', async (req, res) => {
  try {
    const { structuredJSON, structuredPath } = req.body as { structuredJSON?: any; structuredPath?: string };
    let targetJSON = structuredJSON;
    let isCoverLetter = false;

    if (structuredPath && fs.existsSync(structuredPath)) {
      const stat = fs.statSync(structuredPath);
      let jsonPath = structuredPath;

      if (stat.isDirectory()) {
        const resumeCandidate = path.join(structuredPath, 'structured-output.json');
        const coverLetterCandidate = path.join(structuredPath, 'cover-letter-structured-output.json');

        if (fs.existsSync(resumeCandidate)) {
          jsonPath = resumeCandidate;
          isCoverLetter = false;
        } else if (fs.existsSync(coverLetterCandidate)) {
          jsonPath = coverLetterCandidate;
          isCoverLetter = true;
        } else {
          res.status(400).json({ error: 'No structured-output.json or cover-letter-structured-output.json found in the directory.' });
          return;
        }
      } else if (structuredPath.toLowerCase().includes('cover-letter')) {
        isCoverLetter = true;
      }

      const raw = fs.readFileSync(jsonPath, 'utf8');
      targetJSON = JSON.parse(raw);
    }

    if (!targetJSON) {
      res.status(400).json({ error: 'structuredJSON is required (or provide a valid structuredPath).' });
      return;
    }

    const sourceDir = structuredPath && fs.existsSync(structuredPath) && fs.statSync(structuredPath).isDirectory() 
      ? structuredPath 
      : (structuredPath ? path.dirname(structuredPath) : null);

    const latexSource = isCoverLetter ? buildCoverLetterLatex(targetJSON) : buildLatex(targetJSON);
    const date = new Date().toISOString().slice(0, 10);
    const tmpDir = path.join(jobsDir, `structured-${date}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const texFilename = isCoverLetter ? 'cover-letter.tex' : 'resume.tex';
    const texPath = path.join(tmpDir, texFilename);
    fs.writeFileSync(texPath, latexSource, 'utf8');
    const pdfBuffer = await compilePDF(latexSource);
    const pdfFilename = isCoverLetter ? 'cover-letter.pdf' : 'resume.pdf';
    const pdfPath = path.join(tmpDir, pdfFilename);
    fs.writeFileSync(pdfPath, pdfBuffer);

    const response: { texUrl: string; pdfUrl: string; txtUrl?: string } = { texUrl: `/jobs/${path.basename(tmpDir)}/${texFilename}`, pdfUrl: `/jobs/${path.basename(tmpDir)}/${pdfFilename}` };

    if (isCoverLetter) {
      const txtContent = [
        targetJSON.dateLine,
        targetJSON.recipientLine,
        targetJSON.subjectLine,
        '',
        targetJSON.greeting,
        '',
        targetJSON.openingParagraph,
        '',
        targetJSON.bodyParagraph,
        '',
        targetJSON.closingParagraph,
        '',
        targetJSON.signoff,
        targetJSON.fullName,
      ].filter(Boolean).join('\n');
      const txtPath = path.join(tmpDir, 'cover-letter.txt');
      fs.writeFileSync(txtPath, txtContent, 'utf8');
      response.txtUrl = `/jobs/${path.basename(tmpDir)}/cover-letter.txt`;

      if (sourceDir && fs.existsSync(sourceDir)) {
        const sourceTxtPath = path.join(sourceDir, 'cover-letter.txt');
        fs.writeFileSync(sourceTxtPath, txtContent, 'utf8');
      }
    }

    res.json(response);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    logError('Latex from structured error:', err);
    res.status(500).json({ error: message });
  }
});

router.post('/markApplied', async (req, res) => {
  try {
    const { folderPath, taskId } = req.body as { folderPath?: string; taskId?: string };
    log(`markApplied called: folderPath="${folderPath}", taskId="${taskId}"`);

    let targetDir = jobsDir;

    if (folderPath?.trim()) {
      log(`Using folderPath: ${folderPath}`);
      let resolvedPath = folderPath;
      if (!path.isAbsolute(folderPath)) {
        resolvedPath = path.join(jobsDir, folderPath);
      }
      log(`Resolved path: ${resolvedPath}, exists: ${fs.existsSync(resolvedPath)}`);
      if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
        targetDir = resolvedPath;
      } else {
        res.status(400).json({ error: 'Invalid folder path' });
        return;
      }
    } else if (taskId) {
      log(`Using taskId: ${taskId}`);
      const task = taskMap.get(taskId);
      log(`Task found: ${!!task}, status: ${task?.status}, jobDir: ${task?.result?.jobDir}`);
      if (!task || task.status !== 'complete' || !task.result?.jobDir) {
        res.status(400).json({ error: 'Invalid or incomplete taskId' });
        return;
      }
      targetDir = path.join(jobsDir, task.result.jobDir);
      log(`Target dir from task: ${targetDir}, exists: ${fs.existsSync(targetDir)}`);
      if (!fs.existsSync(targetDir)) {
        res.status(400).json({ error: 'Task folder no longer exists' });
        return;
      }
    } else if (lastGeneratedTexPath) {
      log(`Using lastGeneratedTexPath: ${lastGeneratedTexPath}`);
      targetDir = path.dirname(lastGeneratedTexPath);
    } else {
      res.status(400).json({ error: 'No folder path provided and no recently generated resume found' });
      return;
    }

    log(`Final targetDir: ${targetDir}`);

    const folderName = path.basename(targetDir);
    if (folderName.startsWith('(applied) ')) {
      res.status(400).json({ error: 'Folder is already marked as applied' });
      return;
    }

    const parentDir = path.dirname(targetDir);
    const newFolderName = `(applied) ${folderName}`;
    const newDir = path.join(parentDir, newFolderName);

    fs.renameSync(targetDir, newDir);
    log(`Marked folder as applied: ${folderName} -> ${newFolderName}`);

    res.json({ success: true, oldPath: targetDir, newPath: newDir });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    logError('Mark applied error:', err);
    res.status(500).json({ error: message });
  }
});

router.post('/runATSAnalysis', async (req, res) => {
  try {
    log('runATSAnalysis called');
    const { jobDescription, resumeJSON, atsKeywordsFromAI, folderPath } = req.body as {
      jobDescription?: string;
      resumeJSON?: ResumeData;
      atsKeywordsFromAI?: string[];
      folderPath?: string;
    };

    log('folderPath:', folderPath);

    let targetResume: ResumeData | undefined;
    let targetJobDescription = jobDescription;
    let extractedAtsKeywords: string[] | undefined;

    if (folderPath?.trim()) {
      let resolvedPath = folderPath;
      if (!path.isAbsolute(folderPath)) {
        resolvedPath = path.join(jobsDir, folderPath);
      }
      log('Resolved path:', resolvedPath);

      const resumePath = path.join(resolvedPath, 'structured-output.json');
      log('Resume path exists:', fs.existsSync(resumePath));
      if (fs.existsSync(resumePath)) {
        const resumeData = fs.readFileSync(resumePath, 'utf8');
        targetResume = JSON.parse(resumeData);
        extractedAtsKeywords = targetResume.atsKeywords;
      }

      const atsPath = path.join(resolvedPath, 'ats-analysis.json');
      if (fs.existsSync(atsPath)) {
        const atsData = JSON.parse(fs.readFileSync(atsPath, 'utf8'));
        if (!extractedAtsKeywords?.length && atsData.extractedFromJD?.length) {
          extractedAtsKeywords = atsData.extractedFromJD;
        }
      }

      const jdPath = path.join(resolvedPath, 'job-description.txt');
      if (fs.existsSync(jdPath)) {
        targetJobDescription = fs.readFileSync(jdPath, 'utf8');
      }
    } else {
      targetResume = resumeJSON ?? lastGeneratedResumeJSON;
    }

    log('targetResume found:', !!targetResume);

    if (!targetResume) {
      res.status(400).json({ error: 'No resume JSON available. Provide folderPath with structured-output.json, or resumeJSON, or generate a resume first.' });
      return;
    }

    let atsKeywords: string[] = [];

    if (atsKeywordsFromAI && atsKeywordsFromAI.length > 0) {
      atsKeywords = atsKeywordsFromAI;
      log('Using provided atsKeywords:', atsKeywords.length);
    } else if (extractedAtsKeywords?.length) {
      atsKeywords = extractedAtsKeywords;
      log('Using extracted atsKeywords from saved files:', atsKeywords.length);
    } else if (targetJobDescription?.trim()) {
      log('Extracting atsKeywords from JD via AI');
      atsKeywords = await extractATSKeywordsFromJDViaAI(targetJobDescription);
    } else {
      res.status(400).json({ error: 'No job description available. Provide atsKeywordsFromAI or ensure job-description.txt exists in folderPath.' });
      return;
    }

    if (!atsKeywords.length) {
      res.json({ coveragePercent: 0, extractedFromJD: [], includedInResume: [], missingFromResume: [] });
      return;
    }

    const atsResult = analyzeATSKeywordsAgainstResume(atsKeywords, targetResume);
    log('ATS result:', atsResult.coveragePercent);

    if (folderPath?.trim()) {
      let resolvedPath = folderPath;
      if (!path.isAbsolute(folderPath)) {
        resolvedPath = path.join(jobsDir, folderPath);
      }
      fs.writeFileSync(path.join(resolvedPath, 'ats-analysis.json'), JSON.stringify(atsResult, null, 2), 'utf8');
      log('Saved updated ats-analysis.json');
    }

    res.json(atsResult);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    logError('ATS analysis error:', err);
    res.status(500).json({ error: message });
  }
});

function formatCoverLetterText(cl: CoverLetterJSON): string {
  return [
    cl.dateLine,
    cl.recipientLine,
    cl.subjectLine,
    '',
    cl.greeting,
    '',
    cl.openingParagraph,
    '',
    cl.bodyParagraph,
    '',
    cl.closingParagraph,
    '',
    cl.signoff,
  ].filter(Boolean).join('\n');
}

export default router;