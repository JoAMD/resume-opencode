import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import generateRouter from './routes/generate';
import { findProjectRoot } from './services/paths';
import { log, logError } from './services/logger';

process.on('uncaughtException', (err) => {
  logError('Uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  logError('Unhandled rejection:', reason);
});

const app = express();
const PORT = process.env.PORT ?? 3001;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const projectRoot = findProjectRoot(__dirname);
const UI_DIST = '';
let JOBS_PATH = process.env.JOBS_PATH || path.join(projectRoot, 'jobs');

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use((req, _res, next) => {
  if (req.body) {
    req.body = req.body;
  }
  next();
});

const upload = multer({ dest: '/tmp/' });

app.use((req, _res, next) => {
  log(`${req.method} ${req.originalUrl}`);
  next();
});

function requireAdminAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return res.status(401).json({ error: 'Authorization required' });
  }
  const authValue = authHeader.slice(6);
  const credentials = Buffer.from(authValue, 'base64').toString('utf-8');
  const [username, password] = credentials.split(':');
  if (username !== 'admin' || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  next();
}

app.use(express.static(path.join(projectRoot, 'public')));
app.use('/jobs', express.static(path.join(projectRoot, 'jobs')));

app.use(express.static(path.join(projectRoot, 'dist')));
if (UI_DIST) {
  app.use(express.static(UI_DIST));
}
app.get('/api/config', (_req, res) => {
  res.json({ jobsPath: JOBS_PATH });
});

app.post('/api/config', requireAdminAuth, (req, res) => {
  const { jobsPath } = req.body;
  if (!jobsPath) {
    return res.status(400).json({ error: 'jobsPath required' });
  }
  if (!fs.existsSync(jobsPath) || !fs.statSync(jobsPath).isDirectory()) {
    return res.status(400).json({ error: 'Invalid path' });
  }
  JOBS_PATH = jobsPath;
  res.json({ jobsPath: JOBS_PATH });
});

app.get('/api/browse', (req, res) => {
  const dirPath = (req.query.path as string) || JOBS_PATH;
  try {
    if (!fs.existsSync(dirPath)) {
      return res.json({ error: 'Path not found' });
    }
    const stats = fs.statSync(dirPath);
    if (!stats.isDirectory()) {
      return res.json({ path: dirPath, isDirectory: false, name: path.basename(dirPath) });
    }
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const items = entries.map((e) => {
      const fullPath = path.join(dirPath, e.name);
      const itemStats = fs.statSync(fullPath);
      return {
        name: e.name,
        path: fullPath,
        isDirectory: e.isDirectory(),
        modifiedAt: itemStats.mtimeMs,
      };
    });
    res.json({ path: dirPath, isDirectory: true, items });
  } catch (e) {
    logError('Error browsing:', e);
    res.status(500).json({ error: 'Failed to browse' });
  }
});

function isPathAllowed(requestedPath: string): boolean {
  try {
    const realRequested = fs.realpathSync(requestedPath);
    const realRoot = fs.realpathSync(path.dirname(JOBS_PATH));
    return realRequested.startsWith(realRoot);
  } catch {
    return false;
  }
}

app.get('/api/read', (req, res) => {
  const filePath = req.query.path as string;
  if (!filePath) {
    return res.status(400).json({ error: 'path required' });
  }
  if (!isPathAllowed(filePath)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  try {
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
      return res.json({ isDirectory: true, items: [] });
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    res.json({ content, isDirectory: false });
  } catch (e) {
    logError('Error reading file:', e);
    res.status(500).json({ error: 'Failed to read file' });
  }
});

app.put('/api/edit', requireAdminAuth, (req, res) => {
  const { path: filePath, content } = req.body;
  if (!filePath || content === undefined) {
    return res.status(400).json({ error: 'path and content required' });
  }
  if (!isPathAllowed(filePath)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  try {
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
      return res.status(400).json({ error: 'Cannot edit directory' });
    }
    fs.writeFileSync(filePath, content, 'utf-8');
    res.json({ success: true });
  } catch (e) {
    logError('Error editing file:', e);
    res.status(500).json({ error: 'Failed to edit file' });
  }
});

app.put('/api/mkdir', (req, res) => {
  const { path: dirPath } = req.body;
  if (!dirPath) {
    return res.status(400).json({ error: 'path required' });
  }
  if (!isPathAllowed(dirPath)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  try {
    if (fs.existsSync(dirPath)) {
      log(`mkdir: path already exists: ${dirPath}`);
      return res.status(400).json({ error: 'Path already exists' });
    }
    log(`Creating directory: ${dirPath}`);
    fs.mkdirSync(dirPath, { recursive: true });
    res.json({ success: true });
  } catch (e) {
    logError('Error creating directory:', e);
    res.status(500).json({ error: 'Failed to create directory' });
  }
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const targetDir = (req.body.targetDir as string) || JOBS_PATH;
  if (!isPathAllowed(targetDir)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  try {
    const destPath = path.join(targetDir, req.file.originalname);
    log(`Uploading file to: ${destPath}`);
    fs.copyFileSync(req.file.path, destPath);
    fs.unlinkSync(req.file.path);
    res.json({ success: true, path: destPath });
  } catch (e) {
    logError('Error uploading file:', e);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

app.get('/api/jobs', (_req, res) => {
  try {
    if (!fs.existsSync(JOBS_PATH)) {
      return res.json([]);
    }
    const entries = fs.readdirSync(JOBS_PATH, { withFileTypes: true });
    const jobs = entries
      .filter((e) => e.isDirectory())
      .map((e) => ({
        name: e.name,
        path: path.join(JOBS_PATH, e.name),
      }));
    res.json(jobs);
  } catch (e) {
    logError('Error listing jobs:', e);
    res.status(500).json({ error: 'Failed to list jobs' });
  }
});

app.get('/api/files', (req, res) => {
  const jobPath = req.query.jobPath as string;
  if (!jobPath) {
    return res.status(400).json({ error: 'jobPath required' });
  }
  try {
    if (!fs.existsSync(jobPath)) {
      return res.json([]);
    }
    const entries = fs.readdirSync(jobPath, { withFileTypes: true });
    const files = entries.map((e) => {
      const fullPath = path.join(jobPath, e.name);
      const stats = fs.statSync(fullPath);
      return {
        name: e.name,
        path: fullPath,
        isDirectory: e.isDirectory(),
        modifiedAt: stats.mtimeMs,
      };
    });
    res.json(files);
  } catch (e) {
    logError('Error listing files:', e);
    res.status(500).json({ error: 'Failed to list files' });
  }
});

app.get('/api/read', (req, res) => {
  const filePath = req.query.path as string;
  if (!filePath) {
    return res.status(400).json({ error: 'path required' });
  }
  try {
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    res.json({ content });
  } catch (e) {
    logError('Error reading file:', e);
    res.status(500).json({ error: 'Failed to read file' });
  }
});

app.get('/api/download', (req, res) => {
  const filePath = req.query.path as string;
  if (!filePath) {
    return res.status(400).json({ error: 'path required' });
  }
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.download(filePath);
});

app.get('/api/stream', (req, res) => {
  const filePath = req.query.path as string;
  if (!filePath) {
    return res.status(400).json({ error: 'path required' });
  }
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  const ext = path.extname(filePath).toLowerCase();
  const contentTypes: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };
  res.setHeader('Content-Type', contentTypes[ext] || 'application/octet-stream');
  fs.createReadStream(filePath).pipe(res);
});

app.use('/generate', generateRouter);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logError('Unhandled error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  log(`Resume OpenCode tool running at http://localhost:${PORT}`);
});