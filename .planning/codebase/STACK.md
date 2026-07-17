# Technology Stack

**Analysis Date:** 2026-07-18

## Languages

**Primary:**
- TypeScript ^5.7.2 — All source files in `server.ts`, `routes/`, `services/`, `public/utils.ts`, and `tectonic-svc/tectonic-server.ts`.

**Secondary:**
- JavaScript (Node.js runtime) — emitted to `dist/` by `tsc`; no hand-written JS sources.
- Bash — startup glue (`scripts/opencode-resume-tmux-startup.sh`, `scripts/copy-of-opencode-resume-tmux-startup.sh`).
- LaTeX — `templates/resume.tex.template`, `templates/resume-qa.tex.template`, `templates/cover-letter.tex.template`; consumed by Tectonic / pdflatex for PDF rendering.
- HTML / CSS / vanilla JS — UI served from `public/` (`public/index.html`, `public/suggestions.html`, `public/style.css`, `public/suggestions.js`).

## Runtime

**Environment:**
- Node.js (target ES2021, per `tsconfig.json`). `@types/node` ^22.10.2 is the only Node typings dep; no specific engine pin in `package.json`.
- Module system: NodeNext (`module: "NodeNext"`, `moduleResolution: "node16"`).

**Package Manager:**
- npm — `package.json` + `package-lock.json` present (`package-lock.json` is 122.4K).
- No `.npmrc` / `yarn.lock` / `pnpm-lock.yaml` present.
- No `.nvmrc` / `.python-version` files.

## Frameworks

**Core:**
- Express ^4.19.2 — HTTP server in `server.ts` (multer file uploads, basic auth, static file serving, JSON endpoints).
- `@types/express` ^4.17.21 — typings only.
- `multer` ^1.4.5-lts.1 + `@types/multer` ^1.4.12 — multipart upload middleware (`server.ts:33`).

**AI / SDK:**
- `@opencode-ai/sdk` ^1.14.31 — the actual AI backbone. Loaded dynamically (`await import('@opencode-ai/sdk')` in `services/ai.ts:35`) and the `createOpencodeClient({ baseUrl, headers, keepalive })` factory is used. Local type shim for the SDK lives in `@opencode-ai-sdk.d.ts`.

**Testing:**
- vitest ^3.2.6 — runner (config in `vitest.config.ts`, hermetic setup in `vitest.setup.ts`).
- `@vitest/ui` ^3.2.6 — UI mode (not used in scripts).
- happy-dom ^20.10.1 — test DOM environment (per `vitest.config.ts`).

**Build / Dev:**
- typescript ^5.7.2 — compiler (`tsc -p tsconfig.json` in `npm run build`).
- tsx ^4.19.2 — TypeScript runner used by `npm run dev` (`tsx watch server.ts`) and the VS Code "Debug Server (tsx)" launch config.

## Key Dependencies

**Critical (runtime):**
- `express` ^4.19.2 — HTTP layer for `/api/*` and `/generate/*` routes.
- `@opencode-ai/sdk` ^1.14.31 — all AI calls (resume, cover letter, ATS analysis, trim reprompts, fix suggestions). Calls go to `http://${OPENCODE_HOSTNAME}:${OPENCODE_PORT}` (default `localhost:4096`) with HTTP Basic auth (`opencode:<OPENCODE_SERVER_PASSWORD>`).
- `axios` ^1.7.2 — only used by `services/compiler.ts` to POST LaTeX to the Tectonic service. `services/texCompiler.ts` is the preferred path and uses Node's `spawnSync('curl', …)` instead.
- `multer` ^1.4.5-lts.1 — file uploads to `/api/upload`.
- `slugify` ^1.6.6 — used by `services/jobDir.ts` to build job-folder names and by `routes/generate.ts`.
- `dotenv` ^16.4.5 — env loading (`server.ts:1` `import 'dotenv/config'`, and `services/loadEnv.ts`).

**Infrastructure / subprocess:**
- `tectonic` (system binary) — invoked by `tectonic-svc/tectonic-server.ts:35` via `child_process.execFile`. Tectonic 0.15.0 is the version installed in the Docker image (`tectonic-svc/Dockerfile.tectonic:13`).
- `pdflatex` (TeX Live) — invoked synchronously by `services/texCompiler.ts:50` (`execFileSync('pdflatex', …)`) when `TEX_COMPILER=pdflatex` is set; otherwise the request is proxied to the Tectonic service.
- `curl` — invoked by `services/texCompiler.ts:25` (`spawnSync('curl', …)`) to POST LaTeX to `TECTONIC_URL`.
- Docker (`docker compose`) — runs the optional Tectonic service via `tectonic-svc/docker-compose.yml`.

## Configuration

**Environment:**
- All config is `.env`-driven via `dotenv`. `.env` is gitignored (`.gitignore:1`); `.env.example` is the canonical reference (94 lines).
- `services/loadEnv.ts` explicitly loads `<projectRoot>/.env`; `services/ai.ts` additionally loads the parent directory's `.env` to read profile data.
- Required vars (per `.env.example`):
  - `OPENCODE_HOSTNAME`, `OPENCODE_PORT` (default `localhost:4096`) — OpenCode server.
  - `OPENCODE_SERVER_PASSWORD` — used as Basic auth password for the OpenCode SDK.
  - `TECTONIC_URL` (default `http://localhost:4000/compile`) — LaTeX→PDF service.
  - `PORT` (default `3001`) — Express port.
  - `RESUME_NAME`, `RESUME_PHONE`, `RESUME_EMAIL`, `RESUME_LINKEDIN_URL`, `RESUME_LINKEDIN_DISPLAY`, `EDU{1,2}_*` — candidate profile baked into the resume.
- Optional tuning vars (full list in `.env.example` lines 30–94): `OPENCODE_MODEL`, `OPENCODE_MODEL_PROVIDER_ID`, `OPENCODE_MODEL_ID`, `OPENCODE_AI_CONCURRENCY`, `OPENCODE_AI_QUEUE`, `OPENCODE_AI_PROMPT_TIMEOUT_MS`, `OPENCODE_CLIENT_KEEPALIVE`, `OPENCODE_CLIENT_ROTATE_AFTER`, `OPENCODE_ATS_AI`, `OPENCODE_ATS_ANALYSIS_MODEL`, `OPENCODE_RESUME_TRIM_MAX_ATTEMPTS`, `OPENCODE_KEEP_SESSION`, `TEX_COMPILER`, `ENABLE_DEBUG_ROUTES`, `OPENCODE_DEBUG_PROMPT_SLEEP_MS`, `OPENCODE_PROMPTS_DIR`, `OPENCODE_TEMPLATES_DIR`, `JOBS_PATH`, `ADMIN_PASSWORD`, `CS_ACCESS_TOKEN`.

**Build:**
- `tsconfig.json` — `target: ES2021`, `module: NodeNext`, `moduleResolution: node16`, `outDir: dist`, `rootDir: .`, `strict: false`, `esModuleInterop: true`, `forceConsistentCasingInFileNames: true`, `skipLibCheck: true`. Includes `server.ts`, `routes/**/*.ts`, `services/**/*.ts`; excludes `node_modules` and `dist`.

**Runtime / Launcher:**
- npm scripts (`package.json:6-12`):
  - `build` → `tsc -p tsconfig.json`
  - `start` → `npm run build && node dist/server.js`
  - `dev` → `tsx watch server.ts`
  - `test` → `vitest run`
  - `test:watch` → `vitest`
- `scripts/opencode-resume-tmux-startup.sh` — sources `.env` then launches `opencode web` (in tmux) and the resume tool (`npm run build && npm start`).

## Platform Requirements

**Development:**
- Node.js 20+ (TS target ES2021, `@types/node` v22).
- A reachable OpenCode server (`@opencode-ai/sdk` requires `opencode web` running, or an equivalent OpenCode-compatible server). Default endpoint: `http://localhost:4096`.
- For the Tectonic path: a running Tectonic service (locally or via `tectonic-svc/docker-compose.yml` on port 4000). The Tectonic Docker image is Alpine 3.19 + Node.js + Tectonic 0.15.0.
- For the pdflatex path: a TeX Live install with `pdflatex` on `PATH` (compiled by `services/texCompiler.ts:50`).
- The `prompts/` and `templates/` directories are gitignored. They are not present in the working tree (the `templates` symlink in the repo root points at `../resume-tool/templates`). The hermetic `vitest.setup.ts` synthesises them on disk for tests; real runs need them supplied (`OPENCODE_PROMPTS_DIR` / `OPENCODE_TEMPLATES_DIR` or the actual directories).

**Production:**
- Single Node.js process on `PORT` (default 3001) plus a sibling OpenCode server. Optionally the Tectonic Docker container on port 4000.
- No database — `jobs/` is the on-disk store (JSON files + LaTeX + PDF + `applications.csv`); `logs/server-YYYY-MM-DD.log` is the file-based log target.
- File uploads land in `/tmp/` (`multer({ dest: '/tmp/' })`) before being moved into the configured jobs directory.

---

*Stack analysis: 2026-07-18*
