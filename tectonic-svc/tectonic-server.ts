import http from 'http';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

const PORT = 4000;

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/compile') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  let body = '';
  req.on('data', (chunk: Buffer) => {
    body += chunk.toString('utf8');
  });

  req.on('end', () => {
    // Strip legacy unicode directives that can break Tectonic in older templates.
    const sanitized = body
      .replace(/^\s*\\input\{glyphtounicode\}\s*$/gm, '')
      .replace(/^\s*\\pdfgentounicode\s*=\s*1\s*$/gm, '');

    const id = crypto.randomBytes(8).toString('hex');
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `tectonic-${id}-`));
    const texFile = path.join(workDir, 'resume.tex');
    const pdfFile = path.join(workDir, 'resume.pdf');

    fs.writeFileSync(texFile, sanitized, 'utf8');

    execFile('tectonic', ['--outdir', workDir, texFile], { timeout: 55000 }, (err, _stdout, stderr) => {
      if (err) {
        console.error('Tectonic error:', stderr || err.message);
        try {
          fs.rmSync(workDir, { recursive: true });
        } catch {
          // ignore cleanup failures
        }
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Tectonic compile error:\n${stderr || err.message}`);
        return;
      }

      if (!fs.existsSync(pdfFile)) {
        try {
          fs.rmSync(workDir, { recursive: true });
        } catch {
          // ignore cleanup failures
        }
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('PDF not produced by Tectonic');
        return;
      }

      const pdf = fs.readFileSync(pdfFile);
      try {
        fs.rmSync(workDir, { recursive: true });
      } catch {
        // ignore cleanup failures
      }

      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Length': pdf.length,
      });
      res.end(pdf);
    });
  });
});

server.listen(PORT, () => {
  console.log(`Tectonic compile service listening on port ${PORT}`);
});
