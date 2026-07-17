# Codebase Structure

**Analysis Date:** 2026-07-18

## Directory Layout

```
resume-opencode/
├── server.ts                        # Express bootstrap (entry point)
├── tsconfig.json                    # TypeScript config (NodeNext, ES2021, dist/)
├── vitest.config.ts                 # Vitest config (happy-dom, *.test.ts under public/services/routes)
├── vitest.setup.ts                  # Synthesises gitignored prompts/ and templates/ in a temp dir
├── package.json                     # npm scripts: dev (tsx watch), build (tsc), test (vitest)
├── opencode.json                    # opencode CLI config (default model, codescene MCP)
├── @opencode-ai-sdk.d.ts            # Local shim for @opencode-ai/sdk types
│
├── routes/                          # Express routers
│   └── generate.ts                  # /generate/* — resume/cover-letter/ATS/fix-suggestions endpoints
│
├── services/                        # Domain layer (no HTTP awareness)
│   ├── ai.ts                        # OpenCode SDK wrapper, schemas, queue, char-limit, sanitize
│   ├── ai.test.ts                  # Service-level tests for the AI layer
│   ├── ai.concurrency.test.ts
│   ├── ai.coverLetter.test.ts
│   ├── ai.privacy.test.ts
│   ├── ai.resumeCharLimit.test.ts
│   ├── ai.sanitize.test.ts
│   ├── ai.sessionInfo.test.ts
│   ├── ai.sessionLifecycle.test.ts
│   ├── applications.ts              # jobs/applications.csv read/write/duplicate detection
│   ├── applications.test.ts
│   ├── atsAiService.ts              # AI-driven ATS analysis with PII redaction + regex fallback
│   ├── atsAiService.test.ts
│   ├── atsReport.ts                 # ATSAnalysisResult → markdown
│   ├── atsReport.test.ts
│   ├── atsService.ts                # Orchestrator: load folder ctx → run AI → persist
│   ├── backupService.ts             # backups/v1|2|3 versioning
│   ├── backupService.test.ts
│   ├── compiler.ts                  # ⚠ Tectonic-only axios POST (superseded by texCompiler.ts)
│   ├── env.ts                       # DEFAULT_PROFILE, env-var parser
│   ├── fixSuggestionsService.ts     # Backup → enqueue → diff → no-op retry → write outputs
│   ├── fixSuggestionsService.test.ts
│   ├── fixSuggestionsService.failures.test.ts
│   ├── jobDescriptionSearch.ts      # Scan jobs/*/{job-description,full-jd}.txt
│   ├── jobDescriptionSearch.test.ts
│   ├── jobDir.ts                    # Slug creation, structured-JSON loaders, latest .tex finder
│   ├── latex.ts                     # buildLatex, buildCoverLetterLatex (template substitution)
│   ├── latex.coverLetter.test.ts
│   ├── loadEnv.ts                   # Idempotent dotenv loader
│   ├── logger.ts                    # console + logs/server-YYYY-MM-DD.log
│   ├── paths.ts                     # findProjectRoot(__dirname)
│   ├── redactResume.ts              # PII_FIELDS, structured-output-redacted.json
│   ├── redactResume.test.ts
│   ├── texCompiler.ts               # compilePDF() with TECTONIC_URL or pdflatex fallback
│   └── types.ts                     # ResumeData, CoverLetterJSON, ATSAnalysisResult
│
├── public/                          # Static UI (vanilla HTML/CSS/TS/JS — no framework)
│   ├── index.html                   # Main form: SEEK auto-fill, model select, all action buttons
│   ├── style.css                    # Single stylesheet
│   ├── utils.ts                     # parseSeekInput, buildFolderPath (browser-side helpers)
│   ├── utils.test.ts                # happy-dom tests
│   ├── suggestions.html             # <template> + popover for the apply-suggestions panel
│   ├── suggestions.js               # Wires the panel, polls /generate/task/:taskId
│   └── generate.test.ts             # happy-dom tests for client-side helpers
│
├── tectonic-svc/                    # Standalone Tectonic Docker service (separate process)
│   ├── tectonic-server.ts           # http.createServer on :4000, POST /compile
│   ├── Dockerfile.tectonic          # Alpine + Tectonic 0.15.0 + Node
│   ├── docker-compose.yml           # Exposes port 4000
│   └── README.md
│
├── scripts/                         # Local-only startup scripts (gitignored)
│   └── opencode-resume-tmux-startup.sh
│
├── docs/                            # User-facing docs (committed)
│   ├── FEATURES.md                  # What the app does today
│   ├── IGNORED_FILES.md             # Why prompts/, templates, jobs/ are gitignored
│   └── plans/                       # Design docs / deferred work
│
├── jobs/                            # ⚠ Gitignored — per-generation artifacts
│   └── applications.csv             # Append-only CSV: applied_at,company,role,link,status,notes,job_dir
│
├── logs/                            # ⚠ Gitignored — server-YYYY-MM-DD.log files
│
├── dist/                            # ⚠ Build output (tsc → dist/server.js etc.)
│
├── prompts/                         # ⚠ Gitignored, symlinked from parent monorepo
│   ├── resume-system-prompt.txt
│   ├── resume-role-only-system-prompt.txt
│   ├── combined-system-prompt.txt
│   ├── cover-letter-system-prompt.txt
│   ├── cover-letter-star-system-prompt.txt
│   ├── ats-keyword-extraction-prompt.txt
│   ├── ats-analysis-prompt.txt
│   ├── govt-star-method-prompt.txt
│   ├── trim-resume-prompt.txt
│   └── fix-suggestions-prompt.txt
│
├── templates -> ../resume-tool/templates   # ⚠ Symlink to sibling monorepo
│
├── .env                             # ⚠ Gitignored (RESUME_*, OPENCODE_*, etc.)
├── .env.example                     # Documented env-var keys
└── .opencode/                       # ⚠ OpenCode CLI state (worktree, ocx.jsonc, plugins)
```

## Directory Purposes

**`/` (project root):**
- Purpose: Configuration + the single process entry point.
- Contains: `server.ts` (HTTP entry), `tsconfig.json`, `vitest.config.ts`, `vitest.setup.ts`, `package.json`, `opencode.json`, `@opencode-ai-sdk.d.ts`.
- Key files: `server.ts` is the only TS file at the root. Build output goes to `dist/`.

**`routes/`:**
- Purpose: HTTP request → response adapters. The only folder that imports `express`.
- Contains: `generate.ts` and its test (`generate.test.ts`).
- Key files: `routes/generate.ts` — owns the in-process `taskMap` for async polling, the `lastGenerated*` module-level "memory" used by cover-letter/compile endpoints, and the validation chain for every `/generate/*` route.

**`services/`:**
- Purpose: Domain logic. No Express. Plain TypeScript modules. Every concern is in its own file with a co-located `*.test.ts`.
- Contains: AI orchestration, LaTeX rendering, PDF compilation, PII redaction, ATS analysis, applications CSV, job-folder IO, JD search, env parsing, logging, paths.
- Key files: `services/ai.ts` (largest file at 1,454 lines; see ARCHITECTURE.md anti-pattern §5), `services/texCompiler.ts` (the canonical PDF compiler), `services/redactResume.ts` (PII safety boundary), `services/fixSuggestionsService.ts` (the most complex workflow), `services/jobDir.ts` (file-IO helpers that `routes/` should be using).

**`public/`:**
- Purpose: Browser-side assets served as static files. No build step.
- Contains: `index.html` (single-page form), `style.css` (one stylesheet), `utils.ts` (SEEK auto-fill regex), `utils.test.ts`, `suggestions.html` (template + popover), `suggestions.js` (apply-suggestions panel), `generate.test.ts` (browser-helper tests).
- Key files: `public/index.html` (entry point for the browser), `public/suggestions.{html,js}` (the "apply suggestions to existing resume" panel — wires `GET /generate/listJobFiles`, `POST /generate/applySuggestions`, and the `/generate/task/:taskId` poll).

**`tectonic-svc/`:**
- Purpose: A separate process / Docker image that compiles LaTeX → PDF. Reached over HTTP by the Express app.
- Contains: `tectonic-server.ts` (Node http server), `Dockerfile.tectonic` (Alpine + Tectonic 0.15), `docker-compose.yml`, `README.md`.
- Key files: `tectonic-server.ts` — listens on :4000, accepts LaTeX source as `text/plain`, returns the compiled PDF bytes, 55-second timeout.

**`scripts/`:**
- Purpose: Local-only operational scripts. Gitignored because they reference a specific host's IP (100.68.164.48) and tmux session names.
- Contains: `opencode-resume-tmux-startup.sh` (sources `.env`, launches `opencode web` + this app in two tmux sessions), `copy-of-opencode-resume-tmux-startup.sh` (older copy), `trimmed_resume.json` (artifact), `scripts/.env`, `scripts/.env.example`.
- Key files: `scripts/opencode-resume-tmux-startup.sh` is the de-facto "how to run this app" recipe on the host.

**`docs/`:**
- Purpose: User-facing documentation. Committed.
- Contains: `FEATURES.md` (the live feature catalog), `IGNORED_FILES.md` (rationale for `prompts/`, `templates`, `jobs/`), `plans/` (design docs for deferred work — AI timeout, session keep, JD content search, page-limit UI).

**`jobs/`:**
- Purpose: Per-generation artifacts. **Gitignored.** One subfolder per application attempt.
- Contains: `jobs/applications.csv` (the only committed shape — schema is `applied_at,company,role,link,status,notes,job_dir`), and one folder per application (often with a `(applied) ` or `previous/` prefix indicating state).

**`logs/`:**
- Purpose: Per-day rolling log file written by `services/logger.ts`. **Gitignored.** `logs/server-YYYY-MM-DD.log`.

**`dist/`:**
- Purpose: `tsc` build output. **Gitignored** (and listed in `.gitignore`). `npm start` runs `node dist/server.js` after `npm run build`.

**`prompts/`:**
- Purpose: System prompts consumed by `services/ai.ts` and `services/atsAiService.ts`. **Gitignored** — owned by the parent monorepo and brought in via copy or symlink.

**`templates/`:**
- Purpose: LaTeX templates and base-resume text templates. **Symlink** (`templates -> ../resume-tool/templates`) to the parent monorepo. All file IO is gated through `OPENCODE_TEMPLATES_DIR` so tests can override it.

## Key File Locations

**Entry Points:**
- `server.ts` — Express HTTP entry. Boots on `PORT` (default 3001).
- `tectonic-svc/tectonic-server.ts` — Tectonic microservice entry. Listens on port 4000.
- `vitest.config.ts` + `vitest.setup.ts` — Test entry.

**Configuration:**
- `tsconfig.json` — TypeScript settings (NodeNext modules, ES2021 target, `dist/` output, no strict).
- `vitest.config.ts` — Test runner (happy-dom, three test glob roots, `vitest.setup.ts`).
- `vitest.setup.ts` — Synthesises `prompts/` and `templates/` under `os.tmpdir()` and exports them as `OPENCODE_PROMPTS_DIR` / `OPENCODE_TEMPLATES_DIR` so tests are hermetic.
- `opencode.json` — opencode CLI config (default model, codescene MCP wiring).
- `@opencode-ai-sdk.d.ts` — Local shim declaring the surface used from `@opencode-ai/sdk`.
- `.env.example` — Documents every env var (`OPENCODE_HOSTNAME`, `OPENCODE_PORT`, `OPENCODE_MODEL`, `OPENCODE_PASSWORD`, `OPENCODE_AI_CONCURRENCY`, `OPENCODE_AI_QUEUE`, `OPENCODE_AI_PROMPT_TIMEOUT_MS`, `OPENCODE_RESUME_TRIM_MAX_ATTEMPTS`, `OPENCODE_CLIENT_KEEPALIVE`, `OPENCODE_CLIENT_ROTATE_AFTER`, `OPENCODE_KEEP_SESSION`, `OPENCODE_ATS_AI`, `OPENCODE_ATS_ANALYSIS_MODEL`, `OPENCODE_PROMPTS_DIR`, `OPENCODE_TEMPLATES_DIR`, `OPENCODE_DEBUG_PROMPT_SLEEP_MS`, `TEX_COMPILER`, `TECTONIC_URL`, `RESUME_NAME`/`RESUME_PHONE`/etc., `EDU1_*`/`EDU2_*`, `ADMIN_PASSWORD`, `PORT`, `JOBS_PATH`, `ENABLE_DEBUG_ROUTES`).

**Core Logic:**
- `services/ai.ts` — OpenCode wrapper, JSON schemas, AI queue, char-limit enforcement, ATS regex, PII sanitisation.
- `routes/generate.ts` — All `/generate/*` endpoints, taskMap, generation orchestrator.
- `services/fixSuggestionsService.ts` — "Apply suggestions" workflow.
- `services/atsAiService.ts` — AI ATS analysis with PII redaction and regex fallback.
- `services/texCompiler.ts` — Tectonic (HTTP) + pdflatex (subprocess) selection.

**Testing:**
- `vitest.config.ts:9` — Test globs: `public/**/*.test.ts`, `services/**/*.test.ts`, `routes/**/*.test.ts`.
- `vitest.setup.ts` — Runs before every test file, creates ephemeral `prompts/` and `templates/` under `os.tmpdir()`.
- Test naming: every `*.ts` in `services/`, `public/`, `routes/` has a co-located `*.test.ts` (e.g. `ai.ts` → `ai.test.ts`, `ai.concurrency.test.ts`, `ai.coverLetter.test.ts`, `ai.privacy.test.ts`, `ai.resumeCharLimit.test.ts`, `ai.sanitize.test.ts`, `ai.sessionInfo.test.ts`, `ai.sessionLifecycle.test.ts`).

## Naming Conventions

**Files:**
- Domain modules: `kebab-case.ts` (e.g. `fixSuggestionsService.ts`, `jobDescriptionSearch.ts`).
- Single-word modules: lowercase (e.g. `ai.ts`, `latex.ts`, `paths.ts`, `logger.ts`).
- Tests: `<module>.test.ts` co-located with the source.
- Multi-aspect tests: `<module>.<aspect>.test.ts` (e.g. `ai.concurrency.test.ts`, `fixSuggestionsService.failures.test.ts`).
- Types-only files: `types.ts`.
- HTML templates: `<name>.html` (e.g. `suggestions.html`).
- Browser scripts: `<name>.js` (e.g. `suggestions.js`).
- Browser TS helpers: `<name>.ts` (e.g. `utils.ts`).
- Local TypeScript shims: `@<package>.d.ts` (e.g. `@opencode-ai-sdk.d.ts`).

**Directories:**
- `routes/` — Plural, route-layer convention.
- `services/` — Plural, service-layer convention.
- `public/` — Singular, static-assets convention.
- `docs/` — Plural, documentation.
- `tectonic-svc/` — Singular with `-svc` suffix (operates as a separate service).

**Slug format (`jobs/<slug>/`):**
- Pattern: `<prefix?>-<company>-<role>-<YYYY-MM-DD>-<HH-MM-SS-mmm>-<model-slug>` slugified with `slugify({ lower: true, strict: true })`.
- Example: `(applied) qantas-software-engineer-2026-07-09-21-05-47-825-opencode-gominimax-m27`
- Prefixes observed in the wild: `(applied) `, `(already applied - repost) `, `(applied - but wrong resume - reached out to adzuna support) `, `(applied - with other folder) `, `(applied - other) `, `APPLIED-`, `(applied earlier apparently) `, `(expired) `, `(sent email) `, `(applied on linkedin) `, `(job - closed) `, `(test) `, `(cant apply) `, `(can be better) `, `(resume issue) `, `(mixed up) `, `previous/`. The route layer only treats `(applied) ` as a stable marker (see `routes/generate.ts:534`).

**Env-var prefixes:**
- `OPENCODE_*` — OpenCode SDK / model behaviour.
- `RESUME_*` / `EDU1_*` / `EDU2_*` — Candidate profile (consumed by `services/env.ts`).
- `TECTONIC_URL` / `TEX_COMPILER` — LaTeX compilation.
- `ADMIN_PASSWORD` / `PORT` / `JOBS_PATH` — Server config.

## Where to Add New Code

**New AI endpoint (e.g. an "extract references from a job ad" service):**
- Add the function in `services/ai.ts` next to `generateResumeJSON` / `generateCombinedJSON` (e.g. `generateReferencesJSON(...)`).
- Add the JSON schema in the same file alongside `RESUME_JSON_SCHEMA`.
- Add the system prompt file under `prompts/` (in the parent monorepo) and load it via `readLazyFile(path.join(PROMPTS_DIR, 'your-new-prompt.txt'))`.
- Wire the route in `routes/generate.ts` next to `router.post('/', ...)`. Use the same taskMap / background-IIFE pattern for long-running work.
- Add a co-located test (`*.test.ts`) following the existing pattern.
- Update `vitest.setup.ts` to include the new prompt filename in `PROMPT_FILES`.

**New "side panel" UI (like the suggestions panel):**
- Add `<name>.html` containing a `<template>` block plus any popovers.
- Add `<name>.js` (ES module) that fetches its template, injects it into the DOM, and wires form behaviour.
- Reference `<name>.js` from `public/index.html` and `<name>.html` from the `.js`.
- Add co-located happy-dom tests in `public/`.

**New LaTeX output mode (e.g. a "two-column CV" template):**
- Add the `.tex.template` under `templates/` (in the parent monorepo).
- Add a new `buildLatex<Name>(json)` function in `services/latex.ts` next to `buildLatex` and `buildCoverLetterLatex`.
- Wire a route or new field in `routes/generate.ts` that calls it.
- Extend the `resumeType` enum (currently `'software' | 'qa'`) if you need to switch at runtime.

**New job-folder helper (e.g. "find the most-recent cover letter"):**
- Add the helper in `services/jobDir.ts` next to `findLatestTexFile` / `loadStructuredJSONFromDir`.
- Replace the equivalent inline helper in `routes/generate.ts` (see ARCHITECTURE.md anti-pattern §2).

**New ATS source (e.g. a third-party keyword extractor):**
- Add a new service file like `services/atsXyzService.ts` modeled on `services/atsAiService.ts`.
- Have it return an `ATSAnalysisResult` so `services/atsService.ts` doesn't need to change.
- Add a co-located test.

**New PDF compiler (e.g. `lualatex`):**
- Add a `compilePDFViaLualatex(latexSource)` function in `services/texCompiler.ts` mirroring `compilePDFViaPdflatex`.
- Extend the `TexCompiler` type union and the `compilePDF` switch.

**New env-var config:**
- Add a documented entry in `.env.example`.
- Read it in the relevant service file (e.g. AI options in `services/ai.ts`, UI in `public/index.html`).
- For prompts/templates paths, also update `vitest.setup.ts` if a new file needs to be synthesised.

**New public route shape (admin-only operation):**
- Add the route in `server.ts` near the other admin endpoints, wrapped in `requireAdminAuth`.
- Add a path-allowlist check (`isPathAllowed`-style) if it touches the filesystem.

**New structured JSON schema:**
- Add the schema constant in `services/ai.ts` (or the relevant service).
- Add a new `generateXxxJSON()` function returning a typed result.
- Add a co-located test that asserts the schema passes OpenCode's validator.

## Special Directories

**`dist/`:**
- Purpose: TypeScript build output (`npm run build` → `tsc -p tsconfig.json`).
- Generated: Yes (by `tsc`).
- Committed: No (`dist/` in `.gitignore`).

**`logs/`:**
- Purpose: Per-day rolling log file written by `services/logger.ts` (`logs/server-YYYY-MM-DD.log`).
- Generated: Yes (at runtime).
- Committed: No (`logs/` in `.gitignore`).

**`jobs/`:**
- Purpose: Per-generation artifacts and the canonical `applications.csv`.
- Generated: Yes (at runtime).
- Committed: No (`jobs/` in `.gitignore`).

**`prompts/`:**
- Purpose: System prompts consumed at startup.
- Generated: No — owned by the parent monorepo and symlinked/copied in.
- Committed: No (`prompts/` in `.gitignore`).

**`templates/`:**
- Purpose: LaTeX + base-resume text templates.
- Generated: No — symlink to `../resume-tool/templates`.
- Committed: No (`templates`, `templates/` in `.gitignore`).

**`node_modules/`:**
- Purpose: npm dependencies.
- Generated: Yes (`npm install`).
- Committed: No.

**`.opencode/`:**
- Purpose: opencode CLI state — `worktree.jsonc`, `ocx.jsonc`, `plugins/`, `package.json`.
- Generated: Yes (by opencode CLI).
- Committed: No (worktree + plugins are per-clone).

**`.planning/`:**
- Purpose: GSD planning artifacts (roadmap, phases, codebase mapping, plans).
- Generated: Partially — `codebase/` is the output of `/gsd-map-codebase`.
- Committed: Generally not.

**`public/`:**
- Purpose: Browser-served static assets.
- Generated: No.
- Committed: Yes.

**`docs/`:**
- Purpose: User-facing documentation.
- Generated: No.
- Committed: Yes.

---

*Structure analysis: 2026-07-18*
