import fs from 'fs';
import path from 'path';
import { findProjectRoot } from './paths';

export interface ApplicationRow {
  applied_at: string;
  company: string;
  role: string;
  link: string;
  status: string;
  notes: string;
  job_dir: string;
}

const CSV_HEADER = 'applied_at,company,role,link,status,notes,job_dir';
const CSV_FILENAME = 'applications.csv';

function getApplicationsPath(): string {
  const projectRoot = findProjectRoot(__dirname);
  return path.join(projectRoot, 'jobs', CSV_FILENAME);
}

export function formatLocalTimestamp(date: Date = new Date()): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

export function escapeCsvField(value: string): string {
  if (value === undefined || value === null) return '';
  const str = String(value);
  if (str === '') return '';
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

type ParserState = { fields: string[]; current: string; inQuotes: boolean };

function nextInQuotes(state: ParserState, ch: string, peek: string): boolean {
  if (ch === '"' && peek === '"') {
    state.current += '"';
    return false;
  }
  if (ch === '"') {
    state.inQuotes = false;
    return false;
  }
  state.current += ch;
  return false;
}

function nextOutOfQuotes(state: ParserState, ch: string): boolean {
  if (ch === ',') {
    state.fields.push(state.current);
    state.current = '';
    return false;
  }
  if (ch === '"' && state.current === '') {
    state.inQuotes = true;
    return false;
  }
  state.current += ch;
  return false;
}

function parseCsvLine(line: string): string[] {
  const state: ParserState = { fields: [], current: '', inQuotes: false };
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const handler = state.inQuotes ? nextInQuotes : nextOutOfQuotes;
    handler(state, ch, line[i + 1]);
  }
  state.fields.push(state.current);
  return state.fields;
}

export function readApplications(): ApplicationRow[] {
  const csvPath = getApplicationsPath();
  if (!fs.existsSync(csvPath)) return [];
  const content = fs.readFileSync(csvPath, 'utf8');
  const lines = content.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  if (header.join(',') !== CSV_HEADER) {
    return [];
  }
  const rows: ApplicationRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    rows.push({
      applied_at: fields[0] ?? '',
      company: fields[1] ?? '',
      role: fields[2] ?? '',
      link: fields[3] ?? '',
      status: fields[4] ?? '',
      notes: fields[5] ?? '',
      job_dir: fields[6] ?? '',
    });
  }
  return rows;
}

export interface AppendResult {
  appended: boolean;
  reason?: 'duplicate-job-dir' | 'no-job-dir';
  row: ApplicationRow;
}

export function appendApplication(input: {
  company: string;
  role: string;
  link: string;
  job_dir: string;
  status?: string;
  notes?: string;
  applied_at?: string;
}): AppendResult {
  const row: ApplicationRow = {
    applied_at: input.applied_at ?? formatLocalTimestamp(),
    company: input.company ?? '',
    role: input.role ?? '',
    link: input.link ?? '',
    status: input.status ?? 'applied',
    notes: input.notes ?? '',
    job_dir: input.job_dir ?? '',
  };

  if (!row.job_dir) {
    return { appended: false, reason: 'no-job-dir', row };
  }

  const csvPath = getApplicationsPath();
  const existing = readApplications();
  if (existing.some((r) => r.job_dir === row.job_dir)) {
    return { appended: false, reason: 'duplicate-job-dir', row };
  }

  const line = [
    escapeCsvField(row.applied_at),
    escapeCsvField(row.company),
    escapeCsvField(row.role),
    escapeCsvField(row.link),
    escapeCsvField(row.status),
    escapeCsvField(row.notes),
    escapeCsvField(row.job_dir),
  ].join(',');

  if (!fs.existsSync(csvPath)) {
    fs.writeFileSync(csvPath, CSV_HEADER + '\n' + line + '\n', 'utf8');
  } else {
    fs.appendFileSync(csvPath, line + '\n', 'utf8');
  }

  return { appended: true, row };
}

export interface FindInput {
  link?: string;
  company?: string;
  role?: string;
}

export interface FindResult {
  matchedBy: 'link' | 'company-role';
  row: ApplicationRow;
}

function matchByLink(rows: ApplicationRow[], link: string): ApplicationRow | null {
  return rows.find((r) => r.link.trim() === link) ?? null;
}

function matchByCompanyRole(rows: ApplicationRow[], company: string, role: string): ApplicationRow | null {
  const lcCompany = company.toLowerCase();
  const lcRole = role.toLowerCase();
  return rows.find((r) => r.company.trim().toLowerCase() === lcCompany && r.role.trim().toLowerCase() === lcRole) ?? null;
}

export function findApplications(input: FindInput): FindResult | null {
  const rows = readApplications();
  const link = input.link?.trim();
  if (link) {
    const match = matchByLink(rows, link);
    if (match) return { matchedBy: 'link', row: match };
  }
  const company = input.company?.trim();
  const role = input.role?.trim();
  if (!company || !role) return null;
  const match = matchByCompanyRole(rows, company, role);
  return match ? { matchedBy: 'company-role', row: match } : null;
}

export function writeLinkToJobDir(jobDirPath: string, link: string): void {
  if (!link) return;
  fs.writeFileSync(path.join(jobDirPath, 'link.txt'), link, 'utf8');
}
