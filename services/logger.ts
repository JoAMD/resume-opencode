import fs from 'fs';
import path from 'path';
import { findProjectRoot } from './paths';

const projectRoot = findProjectRoot(__dirname);
const logDir = path.join(projectRoot, 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const logFile = path.join(logDir, `server-${new Date().toISOString().slice(0, 10)}.log`);

function timestamp(): string {
  return new Date().toISOString();
}

function appendJsonl(entry: Record<string, unknown>): void {
  try {
    const line = JSON.stringify(entry) + '\n';
    const today = new Date().toISOString().slice(0, 10);
    fs.appendFileSync(path.join(logDir, `server-${today}.jsonl`), line);
  } catch { /* swallow — logging must not crash */ }
}

export function log(...args: unknown[]): void {
  const msg = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  const line = `[${timestamp()}] ${msg}`;
  console.log(line);
  appendJsonl({ ts: timestamp(), level: 'info', msg: line });
  try {
    fs.appendFileSync(logFile, line + '\n', 'utf8');
  } catch {
    // ignore file write errors
  }
}

export function logError(...args: unknown[]): void {
  const msg = args.map(a => (a instanceof Error ? a.stack ?? a.message : (typeof a === 'string' ? a : JSON.stringify(a)))).join(' ');
  const line = `[${timestamp()}] ERROR: ${msg}`;
  console.error(line);
  appendJsonl({ ts: timestamp(), level: 'error', msg: line });
  try {
    fs.appendFileSync(logFile, line + '\n', 'utf8');
  } catch {
    // ignore
  }
}
