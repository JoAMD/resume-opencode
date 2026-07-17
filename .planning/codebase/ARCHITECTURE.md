<!-- refreshed: 2026-07-18 -->
# Architecture

**Analysis Date:** 2026-07-18

## System Overview

```text
┌──────────────────────────────────────────────────────────────────────────┐
│                          Browser (public/)                                │
│   index.html (form) + style.css + utils.ts + suggestions.{html,js}     │
│   Vanilla HTML/CSS/TS/JS — no framework, served as static files          │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │ HTTP (XHR/fetch)
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│              Express Server  (server.ts  —  port 3001)                    │
│  Body parsers · request logger · Basic-auth admin guard · static mounts   │
│  /api/*   (file/jobs/config/browse/read/edit/mkdir/upload/stream/health) │
│  /generate/* (mounted in routes/generate.ts)                              │
│  /jobs/* (static) · /health                                              │
└──────┬────────────────────────────────────────────────────┬──────────────┘
       │                                                    │
       ▼                                                    ▼
┌──────────────────────────────┐               ┌─────────────────────────────┐
│  routes/generate.ts          │               │   services/* (domain)       │
│  Resume/CoverLetter/ATS/     │──────────────▶│  ai · latex · compiler ·    │
│  SearchByDescription/        │               │  atsAiService · atsService ·│
│  MarkApplied/ApplySuggest.   │               │  applications · jobDir ·    │
│  Plus taskMap (async task    │               │  fixSuggestions · backup ·  │
│  poller) + debug routes      │               │  redactResume · jobDesc.    │
└─────────────┬────────────────┘               │  search · atsReport ·       │
              │                                │  env · logger · paths · …   │
              │                                └──────┬──────────────────────┘
              │                                       │
              ▼                                       ▼
┌──────────────────────────────┐       ┌────────────────────────────────────┐
│  Local FS (jobs/)            │       │  OpenCode SDK  (@opencode-ai/sdk)  │
│  jobs/<slug>/                │       │  createOpencodeClient(...)         │
│   structured-output.json     │       │  HTTP @ OPENCODE_HOSTNAME:4096     │
│   resume.tex / resume.pdf    │       └────────────┬───────────────────────┘
│   cover-letter.{tex,pdf,txt} │                    │
│   ats-analysis.{json,md}     │                    ▼
│   backups/v1/ · v2/ · …      │       ┌────────────────────────────────────┐
│   job-description.txt, etc.  │       │  opencode agent (upstream)         │
│  jobs/applications.csv       │       │  structured JSON / text / tools    │
└──────────────────────────────┘       └────────────────────────────────────┘
              │
              ▼
┌──────────────────────────────┐       ┌────────────────────────────────────┐
│  Tectonic Compiler           │       │  pdflatex (local)                  │
│  HTTP POST /compile @ :4000  │       │  execFileSync, services/texCompiler│
│  tectonic-svc/ in Docker     │       │  TEX_COMPILER=pdflatex fallback    │
└──────────────────────────────┘       └────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Express bootstrap | Process-level exception handlers, body parsers, request log, static mounts, /api/* routes, listen on PORT (3001) | `server.ts` |
| Generate router | Async task creation (taskMap), job-dir slug, AI call orchestration, duplicate detection, file persistence, background polling | `routes/generate.ts` |
| AI service | OpenCode SDK wrapper, structured-output parsing, per-model queue, char-limit enforcement, JSON schemas, prompt loading | `services/ai.ts` |
| LaTeX builder | Resume & cover-letter template rendering, LaTeX escaping, empty-section removal | `services/latex.ts` |
| Compiler facade | Tectonic (HTTP) and pdflatex (exec) selection via `TEX_COMPILER` env | `services/texCompiler.ts`, `services/compiler.ts` |
| ATS service (orchestrator) | Loads resume/JD/keywords from disk, delegates to AI, persists results | `services/atsService.ts` |
| ATS AI service | Redacts PII, calls model with structured schema, regex fallback, markdown rendering | `services/atsAiService.ts` |
| Applications tracking | Read/write `jobs/applications.csv` with idempotent `job_dir` check; link/company+role/company duplicate detection | `services/applications.ts` |
| Fix-suggestions service | Backup → enqueue prompt → no-op retry → write outputs → refresh redacted | `services/fixSuggestionsService.ts` |
| Backup service | Versioned `backups/v1|2|3` of resume/cover-letter files | `services/backupService.ts` |
| Redact resume | Strips 7 PII fields to empty strings; idempotent file write of `structured-output-redacted.json` | `services/redactResume.ts` |
| Job description search | Walk `jobs/*/`, scan `job-description.txt` + `full-jd.txt` for substring or all-AND matches | `services/jobDescriptionSearch.ts` |
| Job dir utils | Slug creation, file IO helpers, structured JSON loaders, latest `.tex` finder | `services/jobDir.ts` |
| Env profile | `RESUME_*` env-var parsing, `DEFAULT_PROFILE`, education line formatter | `services/env.ts` |
| Paths util | Walks parent directories until `package.json` is found | `services/paths.ts` |
| Logger | Dual sink: `console.log` + `logs/server-YYYY-MM-DD.log` | `services/logger.ts` |
| ATS report renderer | ATS result → human-readable markdown | `services/atsReport.ts` |
| Load env | `dotenv` wrapper, idempotent | `services/loadEnv.ts` |
| Types | `ResumeData`, `CoverLetterJSON`, `ATSAnalysisResult`, etc. | `services/types.ts` |
| Static UI | `index.html`, `style.css`, `utils.ts` (SEEK auto-fill), `suggestions.{html,js}` (apply-suggestions panel) | `public/*` |
| Tectonic microservice | Standalone HTTP `POST /compile` returning PDF; runs in Docker | `tectonic-svc/tectonic-server.ts` |
| Test bootstrap | Synthesises gitignored `prompts/` and `templates/` in a temp dir so the suite is hermetic | `vitest.setup.ts` |

## Pattern Overview

**Overall:** Layered Express application with a synchronous route → service → IO path for filesystem endpoints, and an **async-task poller** path for AI jobs.

**Key Characteristics:**
- **Single entry point:** `server.ts` mounts the `routes/generate` sub-router under `/generate` and inline `/api/*` routes directly on the app.
- **Service-oriented domain layer:** `services/*` are pure, side-effecty-but-IO-only modules. No class hierarchy; mostly namespaced functions.
- **File-driven job model:** Each generation creates a per-job folder under `jobs/<slug>/`. The slug is the *address* of the job for the rest of the app — every subsequent operation (compile, ATS, fix-suggestions, mark-applied) resolves back to a job folder by slug or absolute path.
- **Async-task with polling:** Long-running AI jobs are fire-and-forget; clients get a `taskId` and poll `GET /generate/task/:taskId`. The in-process `taskMap: Map<string, TaskResult & { startedAt: number }>` is the source of truth.
- **Structured-output-first AI:** The OpenCode agent is asked for JSON conforming to a schema; results are typed into `ResumeData` / `CoverLetterJSON` before any LaTeX work begins. For models that don't support structured output, the prompt asks the agent to write JSON to a file which the server then polls.
- **Model-scoped concurrency:** `enqueueAIRequest(model, work)` is a serial queue per model, default cap 1, tunable via `OPENCODE_AI_CONCURRENCY`. Resume + cover-letter + ATS + trim all share the same queue when targeting the same model.
- **PDF compilation as a separate concern:** The Express app POSTs LaTeX source to `TECTONIC_URL` (default `http://localhost:4000/compile`) — the actual `tectonic` binary lives in a sibling Docker container under `tectonic-svc/`. `pdflatex` is available as a fallback via `TEX_COMPILER=pdflatex`.

## Layers

**Express bootstrap layer:**
- Purpose: Boot the HTTP server, wire middleware, mount routers, handle 404/500.
- Location: `server.ts`
- Contains: process signal handlers, JSON/urlencoded body parsers, request log, Basic-auth admin guard, static file mounts (`public/`, `jobs/`, `dist/`), inline `/api/*` routes for filesystem ops, `/generate` sub-router, `/health` probe.
- Depends on: `services/paths`, `services/logger`, `routes/generate`.
- Used by: Node process entry.

**Routes layer:**
- Purpose: Translate HTTP requests to domain operations; own the request/response shape; gatekeep with validation.
- Location: `routes/generate.ts`
- Contains: Validation helpers, `taskMap` poller, slug creators, request-body types, file-IO helpers (`saveJobFile`, `appendJobFile`), `executeGeneration` orchestrator, debug routes (behind `ENABLE_DEBUG_ROUTES=true`).
- Depends on: every service in `services/`.
- Used by: `server.ts`.

**Service layer:**
- Purpose: All non-HTTP domain logic — AI calls, LaTeX rendering, PDF compilation, CSV tracking, file IO, PII redaction, search.
- Location: `services/`
- Contains: One concern per file (see Component table).
- Depends on: Node stdlib (`fs`, `path`, `child_process`), `axios`, `dotenv`, `slugify`, `@opencode-ai/sdk`, `express` (for `Request` type only).
- Used by: `routes/`, `server.ts`, and each other (services freely cross-import).

**External layer:**
- Purpose: Out-of-process dependencies.
- Location: `@opencode-ai/sdk` (npm), the `tectonic-svc/` Docker image, optional `pdflatex` binary, optional `OPENCODE_*` env vars.
- Contains: HTTP clients + subprocess spawns.
- Depends on: nothing in this repo.
- Used by: `services/ai.ts` (`createOpencodeClient`), `services/texCompiler.ts` (`curl` to Tectonic / `execFileSync` pdflatex).

## Data Flow

### Primary Request Path — `/generate` (resume + cover letter)

1. `server.ts:300` mounts `routes/generate.ts` at `/generate`.
2. `routes/generate.ts:262 router.post('/')` — validates body, runs `findApplications()` (duplicate check), creates a job directory via `createJobDir()` (`routes/generate.ts:876`), writes `job-description.txt`, `other-input.txt`, optional `link.txt`, returns `{ taskId, jobDir: slug }` immediately.
3. Background IIFE (`routes/generate.ts:299`) calls `executeGeneration()` which:
   - If cover letter desired → `services/ai.ts:1208 generateCombinedJSON()` (single OpenCode call returning `resume + coverLetter + atsKeywords`).
   - Else → `services/ai.ts:1120 generateResumeJSON()`.
4. Each AI entry point calls `services/ai.ts:857 runOpenCode()` which acquires a client (`getOpencodeClient`), creates/uses a session, sends the prompt with `RESUME_JSON_SCHEMA` / `COMBINED_JSON_SCHEMA` / `COVER_LETTER_JSON_SCHEMA`, parses the result, deletes the session in `finally`.
5. The resume is then run through `services/ai.ts:166 enforceResumeCharLimit()` — a server-side trim loop reusing the same session id.
6. `services/latex.ts:133 buildLatex()` substitutes `{{TOKEN}}` placeholders in `templates/resume.tex.template` (escaping LaTeX specials).
7. `services/texCompiler.ts:67 compilePDF()` POSTs the LaTeX source to `TECTONIC_URL` (or spawns `pdflatex`). PDF bytes are saved next to the `.tex`.
8. Post-generation: AI ATS analysis (`services/atsAiService.ts:308 runAtsAiAnalysis`) runs on the redacted resume; result persisted as `ats-analysis.{json,md}`.
9. `taskMap.set(taskId, { status: 'complete', result, sessionId, ... })` is written; the client polls `GET /generate/task/:taskId` (`routes/generate.ts:224`).

### Secondary Path — Apply suggestions to an existing resume

1. `POST /generate/applySuggestions` validates the body (`routes/generate.ts:659 validateApplySuggestionsRequest`), checks `attachedFilePaths` stay inside the job dir via `realpathSync` (`routes/generate.ts:691`).
2. Returns `{ taskId, jobDir }`, then `routes/generate.ts:798 runApplySuggestionsBackground` runs:
   - `services/backupService.ts:48 createVersionedBackup()` → `backups/v1/`
   - `services/fixSuggestionsService.ts:218 applySuggestions()` → enqueues a model call with the `fix-suggestions-prompt.txt` system prompt; diffs `structured-output.json` before/after; retries once with a follow-up if the model didn't change the file; throws `NoOpResultError` on the second no-op.
   - On success, regenerates `resume.tex` + `resume.pdf` and refreshes `structured-output-redacted.json`.

### File-system API Path — `/api/*`

All handled inline in `server.ts`:
- `GET /api/jobs` lists job folders.
- `GET /api/files?jobPath=…` lists files inside a job.
- `GET /api/browse?path=…` recursive directory listing.
- `GET /api/read?path=…` reads a file (path allowlisted to `realpath(JOBS_PATH)`).
- `PUT /api/edit` admin-only file write.
- `PUT /api/mkdir` create directory (allowlisted).
- `POST /api/upload` `multer.single('file')` → copy to `targetDir`.
- `GET /api/stream` returns images/PDFs with correct Content-Type.
- `GET /api/download` file download.
- `GET/POST /api/config` reads/updates `JOBS_PATH` (POST admin-gated).
- `GET /health` returns `{ status: 'ok' }`.

**State Management:**
- No database. All persistent state is in files (`jobs/<slug>/structured-output.json`, `jobs/applications.csv`, `jobs/<slug>/ats-analysis.json`, `logs/server-YYYY-MM-DD.log`).
- In-process state: `taskMap` (route-level), `lastGeneratedResumeJSON` / `lastGeneratedTexPath` / `lastGeneratedCoverLetterJSON` (module-level in `routes/generate.ts`), `aiQueues` + `aiInFlight` (`services/ai.ts`), `opencodeClient` + `opencodeClientRequestCount` (`services/ai.ts`).
- The route module's "last generated" globals are how `POST /generate/coverLetter` and `POST /generate/compileLastTex` find the resume to operate on when no folder path is supplied.

## Key Abstractions

**Job folder (slug):**
- Purpose: Atomic unit of work. All artifacts for one application live together.
- Examples: `jobs/(applied) qantas-software-engineer-2026-07-09-21-05-47-825-opencode-gominimax-m27/`
- Pattern: `slugify(prefix + company + role + YYYY-MM-DD + HH-MM-SS-mmm + model)` (see `routes/generate.ts:876`).
- File contents: `structured-output.json`, `structured-output-redacted.json`, `resume.tex`, `resume.pdf`, `cover-letter.{json,tex,pdf,txt}`, `ats-analysis.{json,md}`, `job-description.txt`, `full-jd.txt`, `other-input.txt`, `link.txt`, `session-info.txt`, `backups/vN/`, `prompt-logs/fix-suggestions/`.
- Status is encoded as a folder-name prefix: `(applied) `, `(already applied - repost) `, `APPLIED-`, etc. The literal `'(applied) '` prefix is a stable marker used by `routes/generate.ts:534` to refuse re-marking.

**Resume JSON schema:**
- Purpose: Type-safe contract between the OpenCode agent and the rest of the server.
- Examples: `services/ai.ts:293 RESUME_JSON_SCHEMA`, `:354 COVER_LETTER_JSON_SCHEMA`, `:380 COMBINED_JSON_SCHEMA`, `:107 RESUME_TRIM_JSON_SCHEMA`, `:1357 ATS_KEYWORD_EXTRACTION_JSON_SCHEMA`, `services/atsAiService.ts:50 ATS_ANALYSIS_JSON_SCHEMA`.
- Pattern: Plain JSON Schema 2020-12 objects; passed to OpenCode as `promptBody.format = { type: "json_schema", schema }`.

**AI request queue:**
- Purpose: Serialise AI calls per model to avoid upstream rate limits and keep results deterministic.
- Examples: `services/ai.ts:218 aiQueues`, `:219 aiInFlight`, `:233 enqueueAIRequest`, `:221 runWithConcurrency`.
- Pattern: Promise-chain per model key. `OPENCODE_AI_CONCURRENCY` (default 1) controls slot count; `OPENCODE_AI_QUEUE=false` disables.

**PII redaction:**
- Purpose: Send a PII-stripped copy of the resume to ATS AI without leaking `name`/`phone`/`email`/etc.
- Examples: `services/redactResume.ts:5 PII_FIELDS`, `:19 redactResumeForExternalModel`, `:39 ensureRedactedResumeFile`.
- Pattern: `PII_FIELDS = [name, phone, email, linkedinUrl, linkedinDisplay, githubUrl, githubDisplay]` set to `''`. A pre-call guard (`services/atsAiService.ts:209 assertRedactionHolds`) refuses to send the payload if any field is non-empty after redaction.

**Cover-letter PII placeholder:**
- Purpose: Cover-letter AI sees a resume with profile-name placeholders so the cover letter reads naturally without leaking real PII to the model.
- Examples: `services/ai.ts:1444 sanitizeResumeForExternalCoverLetterModel`.
- Pattern: Real PII fields replaced with `DEFAULT_PROFILE.*`, education replaced with placeholder entries of the same shape.

**Backup version:**
- Purpose: Safety net before mutating a generated resume via "Apply suggestions".
- Examples: `services/backupService.ts:48 createVersionedBackup`.
- Pattern: `jobDir/backups/v1|2|3/{structured-output.json, resume.pdf, resume.tex}`. Increment-on-write.

## Entry Points

**`server.ts` (HTTP entry):**
- Location: `server.ts:1` — top-level. `package.json:8` `start` runs `npm run build && node dist/server.js`; `dev` runs `tsx watch server.ts`.
- Triggers: Node process startup; `scripts/opencode-resume-tmux-startup.sh` spawns it in tmux.
- Responsibilities: Wire Express, mount routers, start listening on `PORT` (default 3001), register `process.on('uncaughtException')` and `unhandledRejection` handlers.

**`tectonic-svc/tectonic-server.ts` (Tectonic HTTP entry):**
- Location: `tectonic-svc/tectonic-server.ts:10` — `http.createServer` listening on port 4000.
- Triggers: `POST /compile` with `text/plain` body (LaTeX source). Started via `tectonic-svc/docker-compose.yml`.
- Responsibilities: Sanitise legacy unicode directives, write source to a temp dir, run `tectonic --outdir`, stream the PDF back. 55-second timeout. Auto-cleans the work dir.

**Test runner (`vitest`):**
- Location: `vitest.config.ts:1`, `vitest.setup.ts:1`.
- Triggers: `npm test` or `npm run test:watch`.
- Responsibilities: Boot a happy-dom environment, synthesise `prompts/` and `templates/` under a temp dir, run `*.test.ts` from `public/`, `services/`, `routes/`.

## Architectural Constraints

- **Threading:** Single Node.js event loop. Long-running AI work is structured as `async`/`await` + in-memory polling (`taskMap`). No worker threads. `pdflatex` and `tectonic` are external subprocesses; `Tectonic` is reached over HTTP.
- **Global state:** Multiple module-level singletons:
  - `services/ai.ts:31 opencodeSdk` (lazy SDK import), `:40 opencodeClient` + `:50 opencodeClientRequestCount` (rotating HTTP client, `OPENCODE_CLIENT_ROTATE_AFTER` requests).
  - `services/ai.ts:218 aiQueues` / `:219 aiInFlight` (per-model serial queues).
  - `services/ai.ts:483-498` lazy file readers for every prompt + template.
  - `services/ai.ts:263 ENV_PROFILE` (loaded once at module init from `../.env`).
  - `routes/generate.ts:51 lastGeneratedResumeJSON`, `:52 lastGeneratedTexPath`, `:53 lastGeneratedCoverLetterJSON`, `:64 taskMap`.
  - `services/compiler.ts:3 TECTONIC_URL` (re-evaluated per call from `process.env`).
- **Circular imports:** The services cross-import freely (e.g. `services/atsAiService.ts` imports from `./ai`, `services/fixSuggestionsService.ts` imports from `./ai`, `./latex`, `./compiler`, `./backupService`, `./redactResume`). No circular cycles are present, but the graph is dense — `services/ai.ts` is the centre of gravity.
- **Configuration boundary:** `process.env` is read eagerly at module top in `services/ai.ts` (e.g. `OPENCODE_MODEL`, `OPENCODE_PROMPTS_DIR`). `dotenv` is loaded both in `server.ts:1 import 'dotenv/config'` and via `services/loadEnv.ts` (called from `services/ai.ts:9` and `services/atsAiService.ts:22`).
- **Trust boundary:** Path-based endpoints (`/api/read`, `/api/edit`, `/api/mkdir`, `/api/upload`, `/generate/applySuggestions`'s `attachedFilePaths`) all resolve real paths through `fs.realpathSync` and verify they live under the configured `JOBS_PATH` (or the specific job dir) before acting. Admin endpoints (`PUT /api/edit`, `POST /api/config`) require HTTP Basic auth with `username=admin` and `password=ADMIN_PASSWORD`.
- **File system as the database:** No transactional integrity between `structured-output.json` and `resume.pdf`; each is written independently. Mitigations: write `.tex` before `.pdf`; backup before `applySuggestions` mutates; idempotent CSV append on `job_dir`.

## Anti-Patterns

### 1. `services/compiler.ts` is dead code

**What happens:** `services/compiler.ts` defines `compilePDF(latexSource)` that POSTs to `TECTONIC_URL` over axios. `routes/generate.ts:6` imports it as `compilePDF` and `services/fixSuggestionsService.ts:6` does the same.
**Why it's wrong:** `services/texCompiler.ts:67 compilePDF(latexSource, compiler?)` is a superset that also honours `TEX_COMPILER=pdflatex`. The compiler-selector logic lives only in `texCompiler.ts`. `routes/generate.ts` uses the wrong shim, which means `pdflatex` fallback never fires from those two callers.
**Do this instead:** Always import `compilePDF` from `./texCompiler` (or rename one of them and have `compiler.ts` re-export). Update `routes/generate.ts:6,10` and `services/fixSuggestionsService.ts:6` to use `services/texCompiler.ts`.

### 2. Two slug/folder-resolution implementations

**What happens:** `services/jobDir.ts:18 createJobDirectory()` and `routes/generate.ts:876 createJobDir()` both build job slugs, but they diverge on prefix handling. `jobDir.ts:46 renameJobDir()` and `routes/generate.ts:1162 renameJobDir()` are also separate. `services/jobDir.ts:88 findLatestTexFile()` and `routes/generate.ts:70 findLatestTexFile()` are separate too.
**Why it's wrong:** Two copies of the same logic means only one set is exercised by tests; behaviour can drift.
**Do this instead:** Have `routes/generate.ts` import from `services/jobDir.ts` (the service is the source of truth) and delete the local copies. The route layer should not own IO helpers.

### 3. Two `RESUME_CHAR_LIMIT` definitions

**What happens:** `services/ai.ts:81` defines `RESUME_CHAR_LIMIT = 7784`. `services/atsAiService.ts` and `services/fixSuggestionsService.ts` re-derive length using the same formula (`JSON.stringify(resume).length`) but inline it.
**Why it's wrong:** Inconsistent measurement (whitespace, ordering) could produce different "trimmed" answers depending on which path computed it.
**Do this instead:** Export `getResumeCharCount` from `services/ai.ts` and use it everywhere a length is needed.

### 4. Module-level `lastGenerated*` mutation

**What happens:** `routes/generate.ts:51-53` mutates three module-level variables from request handlers. Cover-letter and compile endpoints rely on these.
**Why it's wrong:** Two simultaneous generations on the same Node process stomp on each other's "last" values. Race conditions, lost results.
**Do this instead:** Resolve the target folder explicitly per request (already required by the validation in `applySuggestions`); make `lastGenerated*` a best-effort fallback only and never the primary source of truth.

### 5. `services/ai.ts` is 1,454 lines

**What happens:** Prompt templates, JSON schemas, queue, session lifecycle, char-limit enforcement, ATS regex, PII sanitisation, prompt-log file writing, error-diagnosis helpers, and the `OpenCode` client are all in one file.
**Why it's wrong:** Code health risk; hard to test in isolation; many small reusable pieces (e.g. `loadLazyFile`, `keywordToRegexFragment`, `sanitizeResumeForExternalCoverLetterModel`) belong in their own modules.
**Do this instead:** Split into `services/ai/{client,queue,schemas,prompts,resume,coverLetter,ats,privacy}.ts` (or analogous). Move regex-only ATS analysis into `services/atsRegexService.ts` so `services/ai.ts` is purely the OpenCode wrapper.

## Error Handling

**Strategy:** Try/catch around each route handler returns a JSON `{ error: message }` with an appropriate status code. Async work is logged via `services/logger.ts:27 logError()` which writes to both `console.error` and `logs/server-YYYY-MM-DD.log`.

**Patterns:**
- **Validation errors:** `routes/generate.ts:865 validateGenerateRequest` returns a 400 with a string error. `validateApplySuggestionsRequest` (`routes/generate.ts:659`) returns a `ValidationFailure | ValidationSuccess<T>` discriminated union consumed by `isFailure()`.
- **Path security:** `routes/generate.ts:609 safeRealpath` + `:617 pathIsInsideDir` — every file path is checked against the resolved real jobs root. Same pattern in `server.ts:105 isPathAllowed`.
- **AI failures:** `routes/generate.ts:1004-1009` ATS AI error → `analyzeATSKeywordsAgainstResume` regex fallback. `services/atsAiService.ts:343` same pattern with `fallbackReason`. `services/ai.ts:194-198` trim attempt error → return with `characterCountTrimmed: 'true'`. `services/ai.ts:810 diagnosePromptError` translates `UND_ERR_HEADERS_TIMEOUT` / abort / generic into human-readable diagnoses.
- **Async task errors:** IIFEs in `routes/generate.ts:299` and `:798` catch every error and write `taskMap.set(taskId, { status: 'error', error: message, ... })`. The HTTP response has already been sent; the client learns about the error via polling.
- **Process-level:** `server.ts:10-15` registers `uncaughtException` and `unhandledRejection` handlers that just log (does not exit). Errors during a single request are caught at the route boundary.
- **Recoverable no-op:** `services/fixSuggestionsService.ts:30 NoOpResultError` is a typed error carrying the backup; the route handler at `routes/generate.ts:816` converts it into a 200 response with `{ status: 'error', error: 'no-op', result: { backupPath, backupVersion } }`.

## Cross-Cutting Concerns

**Logging:** `services/logger.ts` — `log()` and `logError()` append to a per-day file under `logs/`. Every service that needs to surface info uses these helpers. `services/ai.ts` additionally uses raw `console.log`/`console.error` for `[timing]` traces and raw model JSON dumps.

**Validation:** Local to the route layer. `validateGenerateRequest` checks `companyName` + `roleName` + `jobDescription` (or `generateWithoutJD`). `validateApplySuggestionsRequest` uses a typed `ValidationFailure | ValidationSuccess<T>` discriminated union (`routes/generate.ts:642-657`). `validateAttachedFilePaths` (`routes/generate.ts:691`) ensures every attached file resolves under the real job dir.

**Authentication:** Only on admin endpoints — `server.ts:40 requireAdminAuth` checks HTTP Basic with `username='admin'`, `password=ADMIN_PASSWORD`. Used by `PUT /api/edit` and `POST /api/config`. The `/generate` and other `/api/*` routes are not authenticated.

**Privacy/PII:** `services/redactResume.ts` strips seven fields for the AI ATS call. `services/ai.ts:1444 sanitizeResumeForExternalCoverLetterModel` replaces cover-letter-bound resume fields with `DEFAULT_PROFILE` placeholders. `services/atsAiService.ts:209 assertRedactionHolds` is a belt-and-braces pre-send check.

**Model selection:** The UI's `#model-select` value flows through `body.modelSelect` to every AI entry point. Resolution order: `modelSelect` → `OPENCODE_MODEL` env var → `'opencode/gpt-5-nano'` (default in `services/ai.ts:264`). ATS analysis prefers `OPENCODE_ATS_ANALYSIS_MODEL` → `OPENCODE_MODEL` → `'opencode-go/minimax-m3'` (`services/atsAiService.ts:47`).

**Job-tracking CSV:** `jobs/applications.csv` is the canonical "have I applied" ledger. Schema (`services/applications.ts:15`): `applied_at,company,role,link,status,notes,job_dir`. `appendApplication` is idempotent on `job_dir` (`services/applications.ts:138`). `findApplications` matches `link` first, then `company+role`, then `company` alone (`services/applications.ts:208`).

**Job-folder naming convention:** Folder name is a slug built at generation time and is the immutable address for the job across the app's lifetime. Status is signalled by a stable string prefix (`(applied) `, `(already applied - repost) `, `APPLIED-`, `previous/`, etc.) — not by a metadata file.

---

*Architecture analysis: 2026-07-18*
