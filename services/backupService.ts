import fs from 'fs';
import path from 'path';
import { log } from './logger';

export type BackupKind = 'resume' | 'cover-letter' | 'both';

export interface BackupResult {
  version: number;
  backupDir: string;
  files: string[];
}

const RESUME_BACKUP_FILES = ['structured-output.json', 'resume.pdf', 'resume.tex'] as const;
const COVER_LETTER_BACKUP_FILES = ['cover-letter.json', 'cover-letter.pdf', 'cover-letter.tex'] as const;

const BACKUP_FILES_BY_KIND: Record<BackupKind, readonly string[]> = {
  resume: RESUME_BACKUP_FILES,
  'cover-letter': COVER_LETTER_BACKUP_FILES,
  both: [...RESUME_BACKUP_FILES, ...COVER_LETTER_BACKUP_FILES],
};

export function nextBackupVersion(backupsRoot: string): number {
  if (!fs.existsSync(backupsRoot)) return 1;
  const entries = fs.readdirSync(backupsRoot);
  let max = 0;
  for (const entry of entries) {
    const match = entry.match(/^v(\d+)$/);
    if (!match) continue;
    const n = parseInt(match[1], 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

export function latestBackupVersion(backupsRoot: string): number | null {
  if (!fs.existsSync(backupsRoot)) return null;
  const entries = fs.readdirSync(backupsRoot);
  let max = 0;
  let found = false;
  for (const entry of entries) {
    const match = entry.match(/^v(\d+)$/);
    if (!match) continue;
    const n = parseInt(match[1], 10);
    if (Number.isFinite(n) && n > max) {
      max = n;
      found = true;
    }
  }
  return found ? max : null;
}

function ensureJobDir(jobDir: string): void {
  if (!fs.existsSync(jobDir) || !fs.statSync(jobDir).isDirectory()) {
    throw new Error(`Cannot create backup: job directory does not exist: ${jobDir}`);
  }
}

function copyIfExists(jobDir: string, backupDir: string, filename: string): boolean {
  const src = path.join(jobDir, filename);
  if (!fs.existsSync(src)) return false;
  fs.copyFileSync(src, path.join(backupDir, filename));
  return true;
}

export function createVersionedBackup(jobDir: string, kind: BackupKind = 'resume'): BackupResult {
  ensureJobDir(jobDir);

  const backupsRoot = path.join(jobDir, 'backups');
  fs.mkdirSync(backupsRoot, { recursive: true });

  const version = nextBackupVersion(backupsRoot);
  const backupDir = path.join(backupsRoot, `v${version}`);
  fs.mkdirSync(backupDir, { recursive: true });

  const files: string[] = [];
  for (const filename of BACKUP_FILES_BY_KIND[kind]) {
    if (copyIfExists(jobDir, backupDir, filename)) {
      files.push(filename);
    }
  }

  log(`Backup created at ${backupDir} (version v${version}, ${files.length} files)`);
  return { version, backupDir, files };
}
