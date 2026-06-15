import path from 'path';
import fs from 'fs';
import slugify from 'slugify';
import { findProjectRoot } from './paths';

export interface JobContext {
  companyName: string;
  roleName: string;
  jobDir: string;
  slug: string;
}

export function getJobsDir(): string {
  const projectRoot = findProjectRoot(__dirname);
  return path.join(projectRoot, 'jobs');
}

export function createJobDirectory(companyName: string, roleName: string, prefix = '', model?: string): JobContext {
  const jobsDir = getJobsDir();
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const time = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
  const modelSegment = model ? slugify(model, { lower: true, strict: true }) : '';
  const parts = [prefix, companyName, roleName, date, time, modelSegment].filter(Boolean);
  const baseSlug = slugify(parts.join('-'), { lower: true, strict: true });
  const jobDir = path.join(jobsDir, baseSlug);
  fs.mkdirSync(jobDir, { recursive: true });
  return { companyName, roleName, jobDir, slug: baseSlug };
}

export function resolveJobDir(input: string, fallbackDir?: string): string | null {
  const jobsDir = getJobsDir();
  let resolvedPath = input;
  if (!path.isAbsolute(input)) {
    resolvedPath = path.join(jobsDir, input);
  }
  if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
    return resolvedPath;
  }
  if (fallbackDir && fs.existsSync(fallbackDir) && fs.statSync(fallbackDir).isDirectory()) {
    return fallbackDir;
  }
  return null;
}

export function renameJobDir(targetDir: string, prefix: string): string | null {
  if (!fs.existsSync(targetDir)) return null;
  const folderName = path.basename(targetDir);
  if (folderName.startsWith(prefix)) return null;
  const parentDir = path.dirname(targetDir);
  const newDir = path.join(parentDir, `${prefix}${folderName}`);
  fs.renameSync(targetDir, newDir);
  return newDir;
}

export function loadStructuredJSONFromDir(dirPath: string): any | null {
  const structuredPath = path.join(dirPath, 'structured-output.json');
  if (fs.existsSync(structuredPath)) {
    try {
      return JSON.parse(fs.readFileSync(structuredPath, 'utf8'));
    } catch {
      return null;
    }
  }
  return null;
}

export function loadATSAnalysisFromDir(dirPath: string): any | null {
  const atsPath = path.join(dirPath, 'ats-analysis.json');
  if (fs.existsSync(atsPath)) {
    try {
      return JSON.parse(fs.readFileSync(atsPath, 'utf8'));
    } catch {
      return null;
    }
  }
  return null;
}

export function loadJobDescriptionFromDir(dirPath: string): string | null {
  const jdPath = path.join(dirPath, 'job-description.txt');
  if (fs.existsSync(jdPath)) {
    return fs.readFileSync(jdPath, 'utf8');
  }
  return null;
}

export function findLatestTexFile(jobsDir?: string): string | null {
  const dir = jobsDir ?? getJobsDir();
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.tex'));
  if (!files.length) return null;
  const filePaths = files.map(f => path.join(dir, f));
  filePaths.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return filePaths[0];
}

export function saveJobFile(jobDir: string, filename: string, content: string | Buffer): void {
  const filePath = path.join(jobDir, filename);
  if (Buffer.isBuffer(content)) {
    fs.writeFileSync(filePath, content);
  } else {
    fs.writeFileSync(filePath, content, 'utf8');
  }
}