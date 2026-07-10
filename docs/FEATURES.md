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

- `findApplications({ link?, company?, role? })` — link match wins; if no link
  matches and both `company` and `role` are supplied, it falls back to
  case-insensitive `company+role` match.
- `POST /generate` returns `409` with the matched row when a duplicate is
  found; the UI prompts the user to confirm or cancel, and the request can be
  retried with `force: true` to override.
- `GET /generate/checkDuplicate?link=…&company=…&role=…` remains available for
  ad-hoc lookups.

## OpenCode session reuse (for trim reprompts)

- `runOpenCode` accepts a `providedSessionId` and `ownsSession: false`. When
  both are set, the call joins the existing session and skips the `finally`
  cleanup. The resume trim loop uses this so each trim attempt sees the prior
  conversation as context.

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
