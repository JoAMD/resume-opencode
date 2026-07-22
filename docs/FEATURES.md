# Features

This document tracks **what the app does today**, in the order a user meets the
features. Deferred or design-only ideas live in `docs/plans/`.

It is updated whenever a new user-facing capability ships, so a reader can
understand the current surface without reading the source or the git log.

---

## Resume generation

- AI rewrites and selects bullets from a base resume, given a job description.
- Output is structured JSON (`RESUME_JSON_SCHEMA`); LaTeX is built on the server
  and compiled to PDF.
- Page-limit enforcement: the server measures `JSON.stringify(resume).length`
  and, if over `RESUME_CHAR_LIMIT` (7784), runs a server-side trim reprompt up
  to `OPENCODE_RESUME_TRIM_MAX_ATTEMPTS` (default 3) times, reusing the same
  OpenCode session. If all attempts fail the result is returned with
  `characterCountTrimmed: "true"`.
- The trim prompt is told the absolute path of the current job folder and
  instructed to restrict all file reads and writes (including any scratch file
  used for the `count-characters` tool) to that folder. `/tmp` and other paths
  are explicitly forbidden in the system prompt.
- **Permalink URL**: After any successful generation the URL hash updates to
  `#job=<slug>` and a `permalink.txt` file is written to the job folder. The
  user can copy the URL and re-open the folder from any browser tab. The
  permalink is rendered as a monospace code-style anchor with a small Copy
  button next to it.
- **Form prefill**: Loading a permalink or typing a folder path prefills the
  form from `job-description.txt`, `other-input.txt`, and `full-jd.txt`. A
  confirm dialog appears if the form is already non-empty.
- **Result block**: After generation (or permalink load) the result block lists
  `resume.pdf`, `cover-letter.pdf`, `cover-letter.txt`, and `ats-analysis.md`
  as clickable links with copy buttons. **Open all PDFs** opens both PDFs in
  new tabs. **Compare with latest backup** reuses the diff modal to show what
  changed since the last saved version.
- **Generation status**: While the auto-chain (generate → apply suggestions →
  ATS analysis) runs, each `taskId` is recorded in
  `sessionStorage['taskId_<slug>']` (and the chain in
  `sessionStorage['taskChain_<slug>']`, capped at 4 entries). Loading the
  permalink for a folder with an active chain shows a 4-step status indicator
  with descriptive labels and inline spinners next to pending artifacts. When
  the chain completes, the status panel closes and the result block is
  shown. If the server restarts mid-chain, the panel detects the 404, clears
  the chain, and shows a "Server restarted — chain lost" toast.

## Cover letter generation

- Generated alongside the resume (`useCombinedGeneration: true`, default) or on
  demand via `POST /generate/coverLetter`.
- `coverOutput` accepts `pdf`, `txt`, `both`, or `none`. Default is `both`,
  which always writes the `.tex` source plus PDF and plain-text renders.

## ATS analysis

- Two flavours, both routed through the per-model AI queue:
  - **AI** (`services/atsAiService.ts`) — semantically judges whether each JD
    keyword is actually present. Returns `includedInResume`,
    `missingFromResume`, `strengths`, `gaps[]` (`keyword` + `why` +
    `suggestion`), `recommendations`, and a `summaryMarkdown`. Falls back to
    regex on any error or when `OPENCODE_ATS_AI=false`. Rendered to
    `ats-analysis.md`.
  - **Regex** (`analyzeATSKeywordsAgainstResume`) — fast keyword-string match;
    the default fallback path.
- The model used for AI ATS analysis honours the **Model** dropdown in the UI
  (`modelSelect` from the request body). When the request omits it, the
  server falls back to `OPENCODE_ATS_ANALYSIS_MODEL` → `OPENCODE_MODEL` →
  `opencode-go/minimax-m3`. This applies both to the post-generation analysis
  and to the standalone `POST /generate/runATSAnalysis` route, so picking a
  model in the UI and then clicking **Run ATS Analysis** uses that same model.

## PII redaction (for AI ATS analysis)

- `services/redactResume.ts` strips seven PII fields (`name`, `phone`, `email`,
  `linkedinUrl`, `linkedinDisplay`, `githubUrl`, `githubDisplay`) from the
  resume before it is sent to the AI ATS analyser.
- A pre-call guard refuses the call if any PII field is non-empty after
  redaction.
- Persists `structured-output-redacted.json` next to the on-disk resume so the
  redacted payload is reproducible and inspectable.

## Job applications tracking

- `jobs/applications.csv` is the single editable spreadsheet of every job the
  user has applied to.
- Schema: `applied_at,company,role,link,status,notes,job_dir`.
- `applied_at` is local time (`YYYY-MM-DD HH:MM:SS`, host TZ) so the file is
  human-friendly when opened in a spreadsheet.
- `appendApplication` is idempotent on `job_dir` — re-clicking "mark applied"
  does not double-append.
- A posted job link is written to `link.txt` in the generated job folder and
  captured in `other-input.txt`.

## Duplicate guard

- `findApplications({ link?, company?, role? })` runs three independent
  checks in priority order: exact `link`, then case-insensitive
  `company+role`, then `company` alone. Link and `company+role` matches are
  exact duplicates; a `company`-only match is reported as a **partial match**
  (`matchedBy: 'company'`, `partialMatch: true`) because it likely indicates
  a different role at the same company.
- `POST /generate` returns `409` with the matched row on any duplicate
  signal (including partial). The UI prompts the user with
  "this looks like a possible duplicate (partial match)" wording for partial
  hits, and the request can be retried with `force: true` to override either
  kind of conflict.
- `GET /generate/checkDuplicate?link=…&company=…&role=…` remains available
  for ad-hoc lookups and also returns `partialMatch` in its response.

## Content search across past JDs

A separate, content-based duplicate lookup. Reads the actual JD text
(`job-description.txt`, plus `full-jd.txt` when present) from every
`jobs/<slug>/` folder and returns matching folders with a small context
snippet. This is **separate from** the metadata-based duplicate guard
above — it is an ad-hoc tool, not part of the `POST /generate` gate.

- `GET /generate/searchByDescription?text=…&mode=all-words-AND|exact-substring&limit=50`
  - `text` is required (trimmed). Empty text returns `{ matches: [] }`.
  - `mode` is optional; defaults to `all-words-AND`. Unknown values → `400`.
  - `limit` is optional; defaults to `50`, clamped to `[1, 200]`.
- Always case-insensitive.
- Modes:
  - `all-words-AND` — splits `text` on whitespace and requires every token
    to appear in the file. Mirrors the `rg "software"` workflow: paste a
    few words, find every past JD that mentions all of them.
  - `exact-substring` (default) — treats `text` as one literal phrase and
    matches if it appears verbatim. Use this for "I remember seeing this
    exact sentence" lookups.
- Files scanned per folder: `job-description.txt` and `full-jd.txt` (only
  the ones that exist). A single folder can produce up to two hits, one
  per file, so the UI can show both.
- Folder discovery recurses **one level** into `jobs/<group>/<slug>/` so
  archived subtrees like `jobs/previous/` are searchable too. A top-level
  entry is only treated as a "group" (and recursed into) when it has no
  JD files at its root — folders that *do* have JD files are job folders
  themselves, and their children are ignored. Each hit's `rootName`
  carries the group name (e.g. `previous`) so the UI can show
  `previous/(applied) ...` and link to the right path. Recursion is
  bounded at depth 1, so `jobs/<a>/<b>/<c>/` stays invisible.
- Each hit includes `jobDir`, `matchedFile`, a ~120-char `snippet` centred
  on the first match, and `mtimeMs` (used for "newer first" sort).
- Results are sorted by mtimeMs descending (most recent first) and capped
  at `limit`.
- The UI has a "Search past JDs" panel below the main form: text input,
  mode select, search button, and a list of matching folders that link
  straight to the matched file.
- **Future work (deferred):** wiring the JD content check into the
  `POST /generate` flow so a near-duplicate JD surfaces as an additional
  warning alongside the metadata-based 409; a CLI helper; per-folder
  "applied" metadata on each hit; token-level highlighting in the
  snippet. See [`docs/plans/JD_CONTENT_SEARCH_PLAN.md`](plans/JD_CONTENT_SEARCH_PLAN.md)
  for the full design and rationale.

## OpenCode session reuse (for trim reprompts)

- `runOpenCode` accepts a `providedSessionId` and `ownsSession: false`. When
  both are set, the call joins the existing session and skips the `finally`
  cleanup. The resume trim loop uses this so each trim attempt sees the prior
  conversation as context.

## Apply suggestions to an existing resume

A second-generation edit flow. After a resume is generated and stored in
`jobs/<slug>/structured-output.json`, the user can attach files from that
folder, write free-text suggestions, and have the model revise the resume
JSON in place. The cover letter is **not** touched by this flow.

- **UI** — a new panel below the existing buttons in `public/index.html`,
  implemented as a self-contained ES module in `public/suggestions.js` that
  loads its template from `public/suggestions.html`. Hidden until the current
  tab has a `lastJobDir` (i.e. a generation has completed).
- **Attached files** — auto-attached by default: `ats-analysis.md`,
  `job-description.txt`, `other-input.txt`. The original
  `structured-output.json` is always referenced by absolute path in the
  prompt (its pill is non-removable, labelled "Original resume JSON"). A
  search-driven "+ Add file from this job folder" button opens a popover
  backed by `GET /generate/listJobFiles?jobDir=<slug>`, which lists every
  non-recursive file inside the job directory. Every attached path is
  checked server-side to make sure its realpath stays inside the job
  directory.
- **Backup** — before any AI call, the current `structured-output.json`,
  `resume.pdf`, and `resume.tex` are copied to
  `jobs/<slug>/backups/v1/` (auto-incrementing). The backup path is shown
  in the result block. Cover letter files are not backed up by this flow.
- **Diff check** — after the model returns, the new `structured-output.json`
  is canonicalised (deep-equal via sorted-key JSON) and compared to the
  on-disk version that was just backed up. A no-op result triggers one
  retry with a follow-up instruction that tells the model it didn't change
  anything. A second no-op surfaces a recoverable error to the UI with the
  backup path so the user can manually revert.
- **New opencode session** — every apply-suggestions call creates a fresh
  opencode session (no `providedSessionId`), so each iteration has a clean
  conversation. The session id is returned to the UI alongside an
  "Open in OpenCode web" deep link (built from `OPENCODE_HOSTNAME` and
  `OPENCODE_PORT`).
- **Async** — the endpoint is `POST /generate/applySuggestions` and returns
  `{ taskId, jobDir }` immediately; the UI polls
  `GET /generate/task/:taskId` every 5s. On `complete` the result includes
  `pdfUrl`, `sessionId`, `webLink`, `backupPath`, and `backupVersion`. On a
  no-op-after-retry, the task resolves to `status: 'error'` with
  `error: 'no-op'` and `result: { backupPath, backupVersion }` so the UI
  can recover.
- **Files written on success** — `structured-output.json`, `resume.tex`,
  `resume.pdf` in the job directory (cover letter files are not
  overwritten).
- **Compare with backup** — after apply completes, click **Compare with
  backup v1** in the suggestions panel to see a modal showing the unified
  diff and a `summary.changedPaths` bullet list between the pre-edit backup
  and the on-disk `structured-output.json`. The same data is available as
  JSON via
  `GET /generate/diffResume?jobDir=<slug>&version=v1&format=unified|summary|both`
  (default `format=both`). The route is path-allowlisted
  (`safeRealpath` + `ensureJobsRootRealpath`) and 404s with a named error
  when the backup or current file is missing. See
  [the apply-suggestions section in the README](../README.md#apply-suggestions-to-an-existing-resume)
  for the user-facing flow.

## OpenCode client lifecycle

- `OPENCODE_AI_PROMPT_TIMEOUT_MS` (default 600000) caps a single
  `client.session.prompt` fetch with an `AbortController` and surfaces a clean
  timeout error.
- `OPENCODE_CLIENT_KEEPALIVE` (default `false`) controls TCP socket reuse.
- `OPENCODE_CLIENT_ROTATE_AFTER` (default 50) forces a fresh SDK client every N
  requests to release accumulated keep-alive sockets.

See `docs/plans/AI_PROMPT_TIMEOUT_PLAN.md` and
`docs/plans/OPENCODE_SESSION_KEEP_PLAN.md` for the motivation and measurements.

## Per-model AI concurrency

- `enqueueAIRequest` runs all AI calls (resume, cover letter, ATS analysis,
  trim reprompts) for the same model through a slot pool.
- `OPENCODE_AI_CONCURRENCY` (default `1`) — max parallel AI calls per model.
- `OPENCODE_AI_QUEUE` (default `true`) — when `false`, every call runs
  immediately with no slot cap; `OPENCODE_AI_CONCURRENCY` is ignored.

## Failure sound

- A descending sawtooth tone (E5 → G4 → C4) plays on every client-side
  failure path: generate, cover-letter, compile-last-tex, compile-folder-tex,
  latex-from-structured, run-ATS-analysis, and mark-applied.

## Filesystem / template overrides

- `OPENCODE_PROMPTS_DIR` and `OPENCODE_TEMPLATES_DIR` override the default
  locations of the gitignored `prompts/` and `templates/` directories (used
  for monorepo layouts — see `docs/IGNORED_FILES.md`).
- `JOBS_PATH` overrides the `jobs/` root.

## Tectonic LaTeX service in Docker (optional)

- `tectonic-svc/` runs a standalone Tectonic compiler exposing
  `POST /compile` on port 4000.
- Set `TECTONIC_URL=http://localhost:4000/compile` to route PDF compilation
  through it instead of a local `pdflatex`.
