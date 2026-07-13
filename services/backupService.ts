import fs from 'fs';
import path from 'path';
import { log } from './logger';

export type BackupKind = 'resume' | 'cover-letter' | 'both';

export interface BackupResult {
  version: number;
  backupDir: string;
  files: string[];
}

export function nextBackupVersion(backupsRoot: string): number {
  if (!fs.existsSync(backupsRoot)) return 1;
  const entries = fs.readdirSync(backupsRoot);
  let max = 0;
  for (const entry of entries) {
    const match = entry.match(/^v(\d+)$/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return max + 1;
}

export function createVersionedBackup(jobDir: string, kind: BackupKind = 'resume'): BackupResult {
  if (!fs.existsSync(jobDir) || !fs.statSync(jobDir).isDirectory()) {
    throw new Error(`Cannot create backup: job directory does not exist: ${jobDir}`);
  }

  const backupsRoot = path.join(jobDir, 'backups');
  fs.mkdirSync(backupsRoot, { recursive: true });

  const version = nextBackupVersion(backupsRoot);
  const backupDir = path.join(backupsRoot, `v${version}`);
  fs.mkdirSync(backupDir, { recursive: true });

  const files: string[] = [];
  const copyIfExists = (filename: string) => {
    const src = path.join(jobDir, filename);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(backupDir, filename));
      files.push(filename);
    }
  };

  if (kind === 'resume' || kind === 'both') {
    copyIfExists('structured-output.json');
    copyIfExists('resume.pdf');
    copyIfExists('resume.tex');
  }
  if (kind === 'cover-letter' || kind === 'both') {
    copyIfExists('cover-letter.json');
    copyIfExists('cover-letter.pdf');
    copyIfExists('cover-letter.tex');
  }

  log(`Backup created at ${backupDir} (version v${version}, ${files.length} files)`);
  return { version, backupDir, files };
}
