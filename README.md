# resume-opencode

An AI-powered resume tailoring tool that uses [opencode](https://opencode.ai) to rewrite and select resume bullets based on a job description.

## What it does

Given a base resume and a job description, the tool:
1. Extracts ATS keywords from the JD via AI
2. Calls an opencode agent with the base resume + JD
3. The agent rewrites and selects resume bullets to align with the JD using structured JSON output
4. Generates a tailored LaTeX resume (and optional cover letter)
5. Runs AI-driven ATS analysis (semantic keyword coverage) against the generated resume, with a regex fallback
6. Server-side enforces a resume page-limit and, if exceeded, asks the model to trim itself (reusing the same session)
7. Tracks each generation in `jobs/applications.csv` and guards against re-generating the same job twice

## Architecture

```
User Request → Express Server → opencode-sdk → opencode agent
                                      ↓
                                Agent reads base resume + JD
                                Rewrites bullets with structured output
                                      ↓
                                Server polls for output file
                                      ↓
                          ATS AI analysis (PII-redacted) + PDF
                                      ↓
                    Page-limit guard → trim reprompt loop (same session)
                                      ↓
                   applications.csv updated / duplicate check
```

## Tech stack

- **Runtime**: Node.js, TypeScript, Express
- **AI**: `@opencode-ai/sdk` — calls opencode agent with structured JSON schemas. Resume, cover letter, and ATS analysis all share the same per-model request queue.
- **Output handling**: File polling for non-structured-output models
- **PDF**: LaTeX compilation via [`pdflatex`](https://tug.org/texlive/) locally, or a Tectonic compiler running in Docker — see [`tectonic-svc/`](tectonic-svc/)
- **UI**: Vanilla HTML/CSS/JS (served as static files under `public/`)
- **Tests**: `vitest` with a hermetic `vitest.setup.ts` that synthesises the gitignored `prompts/` and `templates/` directories

## Key implementation details

### Structured outputs

Uses JSON schemas for resume, cover letter, and ATS analysis to enforce consistent, type-safe responses:

- `RESUME_JSON_SCHEMA` — resume structure
- `COVER_LETTER_JSON_SCHEMA` — cover letter structure
- `COMBINED_JSON_SCHEMA` — resume + cover letter in a single call
- `ATS_ANALYSIS_JSON_SCHEMA` — used by the AI ATS analyser

Models that don't support structured output write JSON to a file; server polls for it.

### ATS analysis (AI + regex fallback)

Two flavours of coverage check, both routed through the same per-model AI queue:

- **AI analysis** (`services/atsAiService.ts`) — semantically judges whether each JD keyword is actually present in the resume. Returns `includedInResume`, `missingFromResume`, `strengths`, `gaps[]` (with `why` + `suggestion`), `recommendations`, and a `summaryMarkdown`. Falls back to regex coverage if the call throws, returns a non-object, or `OPENCODE_ATS_AI=false` is set. Result is rendered to `ats-analysis.md` next to the resume. The model used is the one selected in the UI's **Model** dropdown (`modelSelect` from the request body), falling back to `OPENCODE_ATS_ANALYSIS_MODEL` → `OPENCODE_MODEL` → `opencode-go/minimax-m3`. This applies to both the post-generation analysis and the standalone `Run ATS Analysis` button.
- **Regex analysis** (`analyzeATSKeywordsAgainstResume`) — fast string-match coverage used as the default fallback.

### PII redaction for AI ATS calls

The AI ATS analyser is the only AI call that sees a representation of the user's full resume. To prevent leaking PII to the model, the redacted payload is constructed separately from the on-disk resume:

- `services/redactResume.ts` strips seven PII fields (`name`, `phone`, `email`, `linkedinUrl`, `linkedinDisplay`, `githubUrl`, `githubDisplay`) and persists `structured-output-redacted.json` next to the on-disk resume.
- A pre-call guard refuses to send the payload if any PII field is non-empty after redaction.
- The keyword list itself is the only other model input — no full JD or personal details are sent unless the user includes them in the JD text, which is sanitised first.

### Resume page-limit enforcement

`RESUME_CHAR_LIMIT` (7784) and a server-side trim loop replace the model's old self-verification with `count-characters`:

- `getResumeCharCount()` measures `JSON.stringify(resume).length` authoritatively on the server.
- `enforceResumeCharLimit()` in `services/ai.ts` calls the model up to `OPENCODE_RESUME_TRIM_MAX_ATTEMPTS` (default 3) times with `prompts/trim-resume-prompt.txt`, **reusing the same OpenCode session id** as the original generation so each trim attempt sees the prior conversation.
- The trim prompt is told the absolute path of the current job folder and instructed to restrict all file reads and writes (including any scratch file used for the `count-characters` tool) to that folder. `/tmp` and other paths are explicitly forbidden in the system prompt.
- If the resume is still over the limit after all attempts, the result is returned with `characterCountTrimmed: "true"` so downstream consumers (or a future UI banner — see `docs/plans/RESUME_PAGE_LIMIT_UI_PLAN.md`) can react.

### Cover letter output modes

The cover letter endpoint accepts `coverOutput: 'pdf' | 'txt' | 'both' | 'none'`. The default is `'both'`, which writes:

- `cover-letter.tex` — always
- `cover-letter.pdf` — compiled via the configured compiler
- `cover-letter.txt` — plain-text render for pasting into web forms

### Job applications tracking + duplicate guard

`jobs/applications.csv` is the single editable spreadsheet of every job the user has applied to. Schema:

```
applied_at,company,role,link,status,notes,job_dir
```

- `applied_at` is local time (`YYYY-MM-DD HH:MM:SS`, host TZ) so the file is human-friendly when opened in a spreadsheet.
- `appendApplication` is idempotent on `job_dir` — re-clicking "mark applied" does not double-append.
- `findApplications({ link?, company?, role? })` is the duplicate lookup. It runs link, then `company+role`, then `company`-alone checks independently. Link and `company+role` matches are exact duplicates; a `company`-only match is a **partial match** (`matchedBy: 'company'`, `partialMatch: true`) — likely a different role at the same company.
- The UI now wires a **pre-generation duplicate check**: when a `link` is present, or a `company` is supplied, the server returns `409` with the matched row, and the UI prompts the user to confirm or cancel. The alert text says "partial match" when only the company matched. The original request can be retried with `force: true` to override.
- `GET /generate/checkDuplicate` remains available for ad-hoc lookups (e.g. a future "is this URL in my applications?" button).

For **content-based** duplicate lookups — i.e. "have I already applied to a role whose JD mentioned `senior software engineer adelaide`?" — `GET /generate/searchByDescription?text=…&mode=exact-substring|all-words-AND&limit=50` scans every `jobs/<slug>/job-description.txt` (and `full-jd.txt` when present) and returns matching folders with a small context snippet. Default mode is `exact-substring` (treat the input as one literal phrase). This is the server-side equivalent of the ad-hoc `rg --no-ignore-vcs "software" -g "**/jobs/**/structured-output.json"` you might have run by hand, but it searches the JD files (not the generated resume) and is case-insensitive. A "Search past JDs" panel in the main page wires this up; results link straight to the matched file. See [`docs/plans/JD_CONTENT_SEARCH_PLAN.md`](docs/plans/JD_CONTENT_SEARCH_PLAN.md) for the design and what's intentionally still on the deferred list.

### Per-model AI concurrency

`enqueueAIRequest` in `services/ai.ts` runs all AI calls (resume, cover letter, ATS analysis, trim reprompts) for the same model through a slot pool. By default the cap is `1` (strictly serial per model), preserving the original behavior. Set `OPENCODE_AI_CONCURRENCY=2` (or `3`) to allow that many calls per model to run in parallel; excess calls queue and wait. Raising it speeds up batch generation but can trigger upstream provider rate limits.

Set `OPENCODE_AI_QUEUE=false` to disable the queue entirely. Every call then runs immediately with no slot cap (`OPENCODE_AI_CONCURRENCY` is ignored). Use this when you want maximum throughput and trust upstream rate limits.

### OpenCode session lifecycle

`runOpenCode` in `services/ai.ts` is a thin wrapper around the SDK that:

- Creates a fresh session per call, **unless** the caller supplies a `providedSessionId`. Resume trim reprompts use this to reuse the original generation's session.
- Cleans up (deletes) the session in `finally`, **unless** `ownsSession: false` is set. The trim pass uses this so the outer generator owns the lifecycle.
- Honours `OPENCODE_CLIENT_KEEPALIVE`, `OPENCODE_CLIENT_ROTATE_AFTER`, and `OPENCODE_AI_PROMPT_TIMEOUT_MS` to avoid the "Headers Timeout Error" under load (see `docs/plans/AI_PROMPT_TIMEOUT_PLAN.md` and `docs/plans/OPENCODE_SESSION_KEEP_PLAN.md`).

### Apply suggestions to an existing resume

A second-generation edit flow for refining an already-generated resume. After
a generation completes, a new panel below the existing buttons in the UI
(`public/suggestions.js` + `public/suggestions.html`) lets the user:

- See which job folder is selected (read-only display, with a "Change" button
  as an escape hatch).
- See a list of attached file pills — `ats-analysis.md`,
  `job-description.txt`, and `other-input.txt` are auto-attached; the
  original `structured-output.json` is always sent as a path (non-removable
  pill).
- Add more files from the job folder via a search-driven popover backed by
  `GET /generate/listJobFiles`.
- Type free-text suggestions (max 4000 chars).
- Click **Apply suggestions** to POST `/generate/applySuggestions` and
  poll the task until complete.

### Permalink URLs and form prefill

Each successful resume generation produces a stable shareable URL of the form
`http://host:port/#job=<slug>`. The server writes a `permalink.txt` file into
the job folder so any later API consumer can read the canonical URL back
from disk. Loading the URL in a browser tab prefills the form fields
(`#jobDescription`, `#extraNotes`, `#companyName`, `#roleName`, `#link-input`,
`#seek-input`) from the job folder's `job-description.txt`, `other-input.txt`,
and `full-jd.txt`. The same flow fires when a user types or pastes a folder
path into `#folderPath` and blurs the field.

- The endpoint backing the prefill is `POST /generate/prefill` with body
  `{ folderPath: string }`. It returns
  `{ jobDescription, extraNotes, companyName, roleName, link, fullJD, slug, folderPath }`.
- A file path (e.g. `…/jobs/foo/structured-output.json`) is resolved to its
  parent directory before prefill.
- If the form already has non-empty values when prefill is triggered, a
  `confirm()` dialog lets the user choose between keeping existing values
  or replacing them with the loaded ones.
- Path traversal is rejected with `400 folderPath escapes jobs root`.

The result block (visible after generation **or** on permalink load) shows
the four key artifacts as clickable links with copy buttons:
`/jobs/<slug>/resume.pdf`, `/jobs/<slug>/cover-letter.pdf`,
`/jobs/<slug>/cover-letter.txt`, and `/jobs/<slug>/ats-analysis.md`. A
**Open all PDFs** button opens both PDFs in new tabs. A **Compare with
latest backup** button reuses the existing diff modal.

### Generation status on permalink load

When a permalink is loaded for a folder where generation is still in flight
(or the auto-chain is firing), a 4-step status indicator surfaces the
current step. Each background `taskId` is recorded in
`sessionStorage['taskId_<slug>']` (the most recent) and a chain of up to
four `taskId`s in `sessionStorage['taskChain_<slug>']`, so a refresh
reattaches to the same chain without losing progress.

The status panel polls each recorded `taskId` via the existing
`GET /generate/task/:taskId` endpoint — no new endpoint was introduced.
The step number and a human-readable label are returned by the polling
endpoint (`step: 1..4`, `stepLabel: 'Generating resume + cover letter' |
'Running ATS analysis' | 'Applying ATS suggestions' | 'Final ATS
analysis'`). When the chain reaches step 4 and all tasks are complete,
the status panel closes and the result block takes over. If the server
restarts mid-chain (the in-memory `taskMap` is lost), the panel detects
the 404, clears the chain, and toasts `Server restarted — chain lost`.

The server (`services/fixSuggestionsService.ts` + `services/backupService.ts`):

1. Creates a `jobs/<slug>/backups/v1/` backup of the current resume files
   (auto-incrementing; the existing resume is **not** touched before the
   backup succeeds).
2. Calls `runOpenCode` once with `prompts/fix-suggestions-prompt.txt` and
   the user's suggestions + attached file contents + the absolute path to
   the original `structured-output.json`. This creates a **fresh** opencode
   session (no `providedSessionId`).
3. Diffs the returned JSON against the on-disk version using a sorted-key
   canonicalised deep-equal (`resumesAreEqual`). On a no-op, retries once
   with a follow-up instruction. A second no-op surfaces a recoverable
   error to the UI naming the backup path.
4. On success, writes `structured-output.json`, regenerates `resume.tex`
   and `resume.pdf` via `buildLatex` + `compilePDF`, and returns the new
   opencode session id + an "Open in OpenCode web" link
   (`http://${OPENCODE_HOSTNAME}:${OPENCODE_PORT}/session/<id>`).

Cover letter files are **not** modified by this flow.

After apply runs, click **Compare with backup v1** (or the latest version) in the suggestions panel to see a modal with the unified diff between the pre-edit backup and the on-disk `structured-output.json`, plus a `summary.changedPaths` bullet list. The same data is available as JSON via `GET /generate/diffResume?jobDir=<slug>&version=v1&format=unified|summary|both` (default `both`) — useful for scripting or sharing the diff. The diffResume route reuses the same `safeRealpath` + `ensureJobsRootRealpath` allowlist as `/generate/applySuggestions`, so path-traversal payloads are rejected.

To script the diff from the terminal, the same data is reachable via `GET /generate/diffResume?jobDir=<slug>&version=v<N>&format=unified|summary|both`; `format=unified` returns only the unified diff, `format=summary` returns only the `summary.changedPaths` list, and `format=both` (the default) returns both. The endpoint 404s with a named error (`Backup not found` or `Resume not found`) when either file is missing.

### Security

- Input sanitization on job descriptions (Unicode, special chars)
- Path allowlisting for file operations
- PII redaction before any resume is sent to an AI call that judges the resume
- `attachedFilePaths` in `applySuggestions` are checked with `realpathSync`
  to ensure the resolved path stays inside the target job directory
- No sensitive data sent to third-party APIs (uses local opencode + self-hosted when possible)
- Basic auth on admin endpoints

## Scripts

```bash
npm run dev    # Development with hot reload (tsx watch)
npm run build  # Compile TypeScript
npm start      # Build and run production server
npm test       # Run vitest (hermetic — no prompts/ or templates/ needed)
```

## Optional: Tectonic LaTeX service in Docker

A standalone Tectonic compiler is bundled under [`tectonic-svc/`](tectonic-svc/).
It runs as a Docker container exposing `POST /compile` on port 4000 and returns
the compiled PDF. To use it instead of a local `pdflatex`:

```bash
cd tectonic-svc
npm init -y && npm i -D typescript @types/node
npx tsc tectonic-server.ts
docker compose up -d --build
```

Then set `TECTONIC_URL=http://localhost:4000/compile` in your environment. See
[`tectonic-svc/README.md`](tectonic-svc/README.md) for the full API and config.

## See also

- [`docs/IGNORED_FILES.md`](docs/IGNORED_FILES.md) — why `prompts/` and `templates/` are gitignored
- [`docs/plans/AI_PROMPT_TIMEOUT_PLAN.md`](docs/plans/AI_PROMPT_TIMEOUT_PLAN.md) — the 10-minute prompt timeout + debug route
- [`docs/plans/OPENCODE_SESSION_KEEP_PLAN.md`](docs/plans/OPENCODE_SESSION_KEEP_PLAN.md) — session reuse and the `Headers Timeout Error`
- [`docs/plans/RESUME_PAGE_LIMIT_UI_PLAN.md`](docs/plans/RESUME_PAGE_LIMIT_UI_PLAN.md) — deferred UI surfacing for `characterCountTrimmed`
