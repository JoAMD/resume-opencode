# External Integrations

**Analysis Date:** 2026-07-18

## APIs & External Services

**AI Inference — OpenCode SDK:**
- `createOpencodeClient({ baseUrl, headers, keepalive })` from `@opencode-ai/sdk` (dynamically imported in `services/ai.ts:35`).
  - Endpoint: `http://${OPENCODE_HOSTNAME}:${OPENCODE_PORT}` (default `http://localhost:4096`).
  - Auth: HTTP Basic with username `opencode` and password from `OPENCODE_SERVER_PASSWORD` (or fallback `OPENCODE_PASSWORD`). Header built in `services/ai.ts:43-46`.
  - Methods used: `client.session.create({ body: { path: { id: projectRoot }, config: { model } } })` (`services/ai.ts:605`), `client.session.prompt({ path: { id: sessionId }, body, signal })` (`services/ai.ts:834`), `client.session.delete({ path: { id: sessionId } })` (`services/ai.ts:624`).
  - Model routing: `parseModel(...)` splits `<providerID>/<modelID>` from `OPENCODE_MODEL`; falls back to `OPENCODE_MODEL_PROVIDER_ID` + `OPENCODE_MODEL_ID` env vars. Default model string is `opencode/gpt-5-nano` (`services/ai.ts:264`).
  - Structured output: when supported, prompts send `format: { type: "json_schema", schema: ... }` (`services/ai.ts:638-640`). When unsupported (e.g. qwen3, kimi-k2.6 — see `MODELS_WITHOUT_STRUCTURED_OUTPUT`), the server instructs the agent to `bash cat > <file> << JSONEOF ...` and polls the file (`services/ai.ts:586-597`).
  - Transport controls: `OPENCODE_CLIENT_KEEPALIVE` (default `false`) toggles the SDK's `keepalive` flag; `OPENCODE_CLIENT_ROTATE_AFTER` (default 50) forces a fresh client + undici agent after N requests; `OPENCODE_AI_PROMPT_TIMEOUT_MS` (default 600000) bounds the per-prompt fetch with an `AbortController` (`services/ai.ts:824-855`).

**LaTeX → PDF compiler — Tectonic HTTP service:**
- `POST ${TECTONIC_URL}` (default `http://localhost:4000/compile`) — accepts LaTeX body, returns `application/pdf`.
  - SDK caller: `services/texCompiler.ts:25` uses `spawnSync('curl', ['-sS', '-X', 'POST', '--data-binary', '@-', TECTONIC_URL], { input, timeout: 60000, maxBuffer: 50MB })`. (The axios-based `services/compiler.ts` is the older, still-imported path used by `routes/generate.ts:10` and `services/fixSuggestionsService.ts:6`.)
  - Server side: `tectonic-svc/tectonic-server.ts` is a 77-line Node `http` server that strips legacy `glyphtounicode` / `pdfgentounicode=1` lines, writes the body to a temp file, shells out to the `tectonic` binary (`execFile('tectonic', ['--outdir', workDir, texFile], { timeout: 55000 })`), and returns the PDF. Docker image: `tectonic-svc/Dockerfile.tectonic` (Alpine 3.19, Tectonic 0.15.0 binary, Node 22), orchestrated by `tectonic-svc/docker-compose.yml` (port 4000 → `tectonic-compile`).
  - LaTeX error logs are tailed via `readLatexLogTail` (`services/texCompiler.ts:11`).

**Local LaTeX fallback — pdflatex (TeX Live):**
- `execFileSync('pdflatex', ['-interaction=nonstopmode', '-halt-on-error', texPath], { cwd, timeout: 60000, stdio: ['ignore','ignore','pipe'] })` in `services/texCompiler.ts:50`. Selected when `TEX_COMPILER=pdflatex`.

## Data Storage

**Databases:**
- None. No SQL, NoSQL, or embedded store. All persistent state is on disk under the `jobs/` directory (gitignored) and the `logs/` directory (gitignored).

**File Storage:**
- Local filesystem only. Per-job folder layout (created in `services/jobDir.ts:18`):
  - `jobs/<company>-<role>-<date>-<time>-<model-slug>/`
    - `structured-output.json` — the generated resume JSON
    - `structured-output-redacted.json` — PII-stripped copy (see `services/redactResume.ts`)
    - `job-description.txt`, `full-jd.txt`, `other-input.txt` — inputs
    - `ats-analysis.json`, `ats-analysis.md` — ATS analysis output (`services/atsReport.ts`)
    - `resume.tex`, `resume.pdf` — LaTeX source + compiled PDF
    - `cover-letter.{json,tex,pdf,txt}` — optional cover letter artefacts
    - `link.txt` — original job URL (`services/applications.ts:225`)
    - `backups/v1/...`, `backups/v2/...` — versioned backups created by `services/backupService.ts`
    - `prompt-logs/<caller>/opencode-prompt-<ts>.txt` — every prompt written to disk (`services/ai.ts:599`)
    - `session-info.txt` — OpenCode session id + model + timestamp
  - `jobs/applications.csv` — the dedup'd applications ledger (`services/applications.ts`).
  - `templates/` — symlinked at the repo root to `../resume-tool/templates/` (i.e. owned by the parent monorepo; intentionally gitignored per `docs/IGNORED_FILES.md`).
  - `prompts/` — gitignored directory of plain-text system prompts (loaded by `services/ai.ts:483-491` and `services/atsAiService.ts:38-45`). Prompt list in `vitest.setup.ts:5-16`.

**Caching:**
- None (no Redis, Memcached, or in-memory shared cache). Per-model AI request queueing is in-process only (`aiQueues` / `aiInFlight` maps in `services/ai.ts:218-241`).
- Process-local lazy file cache: `readLazyFile(...)` (`services/ai.ts:473`, `services/atsAiService.ts:28`) caches the contents of system-prompt and template files after first read.

## Authentication & Identity

**Auth Provider:**
- Custom Basic Auth on the admin endpoints, hard-coded username `admin`:
  - `requireAdminAuth` middleware in `server.ts:40-52` — expects `Authorization: Basic base64(admin:<ADMIN_PASSWORD>)`. `ADMIN_PASSWORD` is read from env (`server.ts:19`).
  - Applied to `POST /api/config` (`server.ts:65`) and `PUT /api/edit` (`server.ts:139`).
- All non-admin routes (`/api/jobs`, `/api/files`, `/api/read`, `/api/browse`, `/api/stream`, `/api/download`, `/api/upload`, `/api/mkdir`, `/generate/*`) are unauthenticated by design — the README/AGENTS describe this as a local tool.

**OpenCode SDK Auth:**
- HTTP Basic: username literal `opencode`, password from `OPENCODE_SERVER_PASSWORD` (with `OPENCODE_PASSWORD` legacy fallback) — see `services/ai.ts:42-46`.

## Monitoring & Observability

**Error Tracking:**
- None (no Sentry, Datadog, OpenTelemetry, etc.). Errors are caught and logged to file + console.

**Logs:**
- File + stdout. `services/logger.ts` writes one line per call to both `console.log`/`console.error` and `<projectRoot>/logs/server-YYYY-MM-DD.log` (rotated by date). `logError` additionally stringifies `Error.stack`. The same module exposes `log` and `logError` and is used throughout `services/`, `routes/`, and `server.ts`.
- Unhandled exceptions / rejections are caught at process level in `server.ts:10-15` and routed through `logError`.

**Timing telemetry:**
- Console-only `[timing]` lines in `services/ai.ts` (`runOpenCode` pipeline, session create, prompt fetch, error diagnosis). No persistence.

## CI/CD & Deployment

**Hosting:**
- Local / self-hosted. The repo ships a tmux-based startup script (`scripts/opencode-resume-tmux-startup.sh`) that:
  1. Sources `.env` (`set -a; source .env; set +a`).
  2. Launches `opencode web` in tmux session `opencode-web` (binds to `OPENCODE_SERVER_PASSWORD` and `--hostname 100.68.164.48`).
  3. Launches the resume tool in tmux session `resume-opencode` via `npm run build && npm start`.
- Optional sidecar: `tectonic-svc/docker-compose.yml` runs the Tectonic compiler in Docker (`container_name: tectonic-compile`, port 4000).
- No cloud platform, container registry, or reverse-proxy config is checked in.

**CI Pipeline:**
- None detected. No `.github/`, `.gitlab-ci.yml`, `Jenkinsfile`, or `.circleci/`. Tests are run on demand via `npm test`.

**VS Code launch configs:**
- `.vscode/launch.json` defines three "type: node" launch configs: `Debug Server (tsx)`, `Debug Server (compiled)`, `Debug Current File`. `.vscode/settings.json` wires SonarLint to the `joamd` connection / `joamd_resume-opencode` project (a code-quality tool, not a build pipeline).

## Environment Configuration

**Required env vars:**
- `OPENCODE_HOSTNAME` — OpenCode server host (default `localhost`).
- `OPENCODE_PORT` — OpenCode server port (default `4096`).
- `OPENCODE_SERVER_PASSWORD` — OpenCode server password (used as Basic auth). Legacy alias: `OPENCODE_PASSWORD`.
- `TECTONIC_URL` — LaTeX→PDF endpoint (default `http://localhost:4000/compile`).
- `RESUME_NAME`, `RESUME_PHONE`, `RESUME_EMAIL`, `RESUME_LINKEDIN_URL`, `RESUME_LINKEDIN_DISPLAY`, `EDU1_*`, `EDU2_*` — candidate profile merged into every generated resume.
- `PORT` — Express port (default `3001`).
- `ADMIN_PASSWORD` — admin Basic Auth password (admin endpoints).
- `CS_ACCESS_TOKEN` — CodeScene MCP token (consumed by `opencode.json` mcp config; not used by the app code itself).

**Optional env vars (with defaults):**
- AI tuning: `OPENCODE_MODEL`, `OPENCODE_MODEL_PROVIDER_ID`, `OPENCODE_MODEL_ID`, `OPENCODE_AI_CONCURRENCY`, `OPENCODE_AI_QUEUE`, `OPENCODE_AI_PROMPT_TIMEOUT_MS`, `OPENCODE_CLIENT_KEEPALIVE`, `OPENCODE_CLIENT_ROTATE_AFTER`, `OPENCODE_KEEP_SESSION`, `OPENCODE_RESUME_TRIM_MAX_ATTEMPTS`, `OPENCODE_ATS_AI`, `OPENCODE_ATS_ANALYSIS_MODEL`, `ENABLE_DEBUG_ROUTES`, `OPENCODE_DEBUG_PROMPT_SLEEP_MS`.
- Compiler: `TEX_COMPILER` (`tectonic` | `pdflatex`).
- Filesystem: `JOBS_PATH`, `OPENCODE_PROMPTS_DIR`, `OPENCODE_TEMPLATES_DIR`.

**Secrets location:**
- All secrets live in `.env` (gitignored, `.gitignore:1`). The repository ships `.env.example` as the documented reference; the actual file is excluded from version control.
- The `CS_ACCESS_TOKEN` placeholder is documented in `scripts/.env.example`.
- No secrets in the code: there are no hard-coded API keys, and no use of `.npmrc` / credential files.

## Webhooks & Callbacks

**Incoming:**
- None. The Express server only accepts JSON / multipart HTTP requests; no third-party webhook endpoints are exposed.

**Outgoing:**
- None. The app does not register any webhooks with external services. The only "outgoing" requests are: HTTP POSTs to the OpenCode server (via the SDK) and HTTP POSTs of LaTeX to the Tectonic service (via `curl` / `axios`). Both are request/response with no callback semantics.

---

*Integration audit: 2026-07-18*
