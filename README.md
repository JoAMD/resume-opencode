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

- **AI analysis** (`services/atsAiService.ts`) — semantically judges whether each JD keyword is actually present in the resume. Returns `includedInResume`, `missingFromResume`, `strengths`, `gaps[]` (with `why` + `suggestion`), `recommendations`, and a `summaryMarkdown`. Falls back to regex coverage if the call throws, returns a non-object, or `OPENCODE_ATS_AI=false` is set. Result is rendered to `ats-analysis.md` next to the resume.
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
- `findApplications({ link?, company?, role? })` is the duplicate lookup. Link match wins; if no link matches and both `company` and `role` are supplied, it falls back to case-insensitive `company+role` match.
- The UI now wires a **pre-generation duplicate check**: when a `link` is present (or both `company` and `role` are), the server returns `409` with the matched row, and the UI prompts the user to confirm or cancel. The original request can be retried with `force: true` to override.
- `GET /generate/checkDuplicate` remains available for ad-hoc lookups (e.g. a future "is this URL in my applications?" button).

### Per-model AI concurrency

`enqueueAIRequest` in `services/ai.ts` runs all AI calls (resume, cover letter, ATS analysis, trim reprompts) for the same model through a slot pool. By default the cap is `1` (strictly serial per model), preserving the original behavior. Set `OPENCODE_AI_CONCURRENCY=2` (or `3`) to allow that many calls per model to run in parallel; excess calls queue and wait. Raising it speeds up batch generation but can trigger upstream provider rate limits.

Set `OPENCODE_AI_QUEUE=false` to disable the queue entirely. Every call then runs immediately with no slot cap (`OPENCODE_AI_CONCURRENCY` is ignored). Use this when you want maximum throughput and trust upstream rate limits.

### OpenCode session lifecycle

`runOpenCode` in `services/ai.ts` is a thin wrapper around the SDK that:

- Creates a fresh session per call, **unless** the caller supplies a `providedSessionId`. Resume trim reprompts use this to reuse the original generation's session.
- Cleans up (deletes) the session in `finally`, **unless** `ownsSession: false` is set. The trim pass uses this so the outer generator owns the lifecycle.
- Honours `OPENCODE_CLIENT_KEEPALIVE`, `OPENCODE_CLIENT_ROTATE_AFTER`, and `OPENCODE_AI_PROMPT_TIMEOUT_MS` to avoid the "Headers Timeout Error" under load (see `docs/plans/AI_PROMPT_TIMEOUT_PLAN.md` and `docs/plans/OPENCODE_SESSION_KEEP_PLAN.md`).

### Security

- Input sanitization on job descriptions (Unicode, special chars)
- Path allowlisting for file operations
- PII redaction before any resume is sent to an AI call that judges the resume
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
