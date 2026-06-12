import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

export type TexCompiler = 'tectonic' | 'pdflatex';

const TECTONIC_URL = process.env.TECTONIC_URL || 'http://localhost:4000/compile';
const PDF_MAGIC = Buffer.from('%PDF', 'utf8');

function readLatexLogTail(logPath: string): string {
  if (!fs.existsSync(logPath)) return '';
  return fs.readFileSync(logPath, 'utf8').split('\n').slice(-40).join('\n');
}

function reportLatexFailure(texPath: string, err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  const stderr = (err as { stderr?: Buffer | null })?.stderr?.toString() ?? '';
  const logTail = readLatexLogTail(texPath.replace(/\.tex$/i, '.log'));
  console.error(`[compilePDFViaPdflatex] pdflatex failed for ${texPath}\n${message}\n${stderr}\n--- log tail ---\n${logTail}`);
  throw new Error(`pdflatex failed for ${path.basename(texPath)}: ${message}`);
}

export function compilePDFViaTectonic(latexSource: string): Buffer {
  const result = spawnSync(
    'curl',
    ['-sS', '-X', 'POST', '--data-binary', '@-', TECTONIC_URL],
    {
      input: latexSource,
      timeout: 60000,
      maxBuffer: 50 * 1024 * 1024,
    }
  );
  if (result.status !== 0) {
    const stderr = result.stderr?.toString() ?? '';
    throw new Error(`tectonic request failed (exit ${result.status}): ${stderr}`);
  }
  const body = result.stdout ?? Buffer.from('');
  if (body.length < PDF_MAGIC.length || !body.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
    throw new Error(`tectonic did not return a PDF: ${body.toString('utf8').slice(0, 500)}`);
  }
  return body;
}

export function compilePDFViaPdflatex(latexSource: string): Buffer {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'latex-'));
  const texPath = path.join(tmpDir, 'doc.tex');
  fs.writeFileSync(texPath, latexSource, 'utf8');
  try {
    execFileSync(
      'pdflatex',
      ['-interaction=nonstopmode', '-halt-on-error', texPath],
      { cwd: tmpDir, timeout: 60000, stdio: ['ignore', 'ignore', 'pipe'] }
    );
    const pdfPath = texPath.replace(/\.tex$/i, '.pdf');
    if (!fs.existsSync(pdfPath)) {
      throw new Error(`pdflatex produced no PDF for ${path.basename(texPath)}`);
    }
    return fs.readFileSync(pdfPath);
  } catch (err) {
    reportLatexFailure(texPath, err);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export function compilePDF(latexSource: string, compiler?: TexCompiler): Buffer {
  const chosen = (compiler ?? (process.env.TEX_COMPILER as TexCompiler | undefined) ?? 'tectonic');
  return chosen === 'pdflatex' ? compilePDFViaPdflatex(latexSource) : compilePDFViaTectonic(latexSource);
}
