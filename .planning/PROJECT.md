# resume-opencode

## What This Is

`resume-opencode` is an AI-powered resume tailoring tool. Given a base resume and a job description, it rewrites and selects resume bullets via an OpenCode agent, generates a tailored LaTeX resume (and optional cover letter), and runs an AI-driven ATS analysis against the result. The Express server hosts both a vanilla HTML/CSS/JS UI and a JSON API; every generation is a self-contained folder under `jobs/<slug>/` containing the structured output, LaTeX sources, compiled PDFs, ATS analysis, and per-generation backups.

The user is a single individual running the tool locally to manage their own job search pipeline.

## Core Value

**The generated resume must be correctly tailored to the job description — semantically, not just by keyword stuffing.** If the bullets don't actually reflect the JD's themes, every downstream artefact (PDF, cover letter, ATS score) is worthless. Everything else (PDF fidelity, ATS analysis, PII redaction, duplicate guard) exists to make this single capability safe and repeatable.

## Business Context

This is a single-user local tool — not a monetized product. There is no "customer" beyond the user themselves. The success metric is operational: time-to-applicable-resume per job posting, and ATS match rate on the jobs the user does apply to.

## Context

- **Existing codebase.** A comprehensive codebase map is in `.planning/codebase/` (ARCHITECTURE, STACK, STRUCTURE, CONVENTIONS, TESTING, INTEGRATIONS, CONCERNS). The project has been in active development; recent commits include the apply-suggestions flow, JD content search, and ATS analysis hardening. Code Health concerns are catalogued in `.planning/codebase/CONCERNS.md`.
- **Tech stack.** TypeScript 5.7 + Express 4 + `@opencode-ai/sdk` 1.14. LaTeX via Tectonic (Docker) or local `pdflatex`. Vanilla HTML/CSS/JS in `public/`. Vitest with happy-dom for tests. PII redaction layer (`services/redactResume.ts`) before any AI sees the full resume.
- **Workflow shape.** The "apply suggestions" flow (`POST /generate/applySuggestions`) already creates a versioned backup (`backups/v1/`, `v2/`, …) before any model edit, and surfaces the backup path in the result. The current UI shows the path as read-only text — the user has to manually open a terminal to compare.
- **Existing plan.** `docs/plans/RESUME_DIFF_VIEWER_PLAN.md` describes the in-app diff viewer in detail (steps 1–5: shared diffUtil, `GET /generate/diffResume`, UI modal, docs sync, safeguard). It is **draft, not started**. Three open questions in the plan are intentionally deferred to plan-phase.
- **Deferred work visible in `docs/plans/`.** Sibling plans: `RESUME_PAGE_LIMIT_UI_PLAN.md` (UI surfacing of `characterCountTrimmed`), `LLM_PROVIDER_ABSTRACTION_PLAN-unrefined.md` (early-stage abstraction sketch), `AI_PROMPT_TIMEOUT_PLAN.md` and `OPENCODE_SESSION_KEEP_PLAN.md` (already shipped, kept for context), `JD_CONTENT_SEARCH_PLAN.md` (shipped, plan kept for deferred items).

## Constraints

- **Tech stack**: TypeScript + Express + vitest. Prefer built-ins and hand-rolled solutions for trivial cases; use well-tested libraries for complex problems — don't reinvent common things.
- **Node.js runtime**: target ES2021 (per `tsconfig.json`). Project tracks Node 20+; `node:diff` is **not** a real built-in (proposal, not landed) — the local fallback is the only viable path.
- **No new UI framework**: vanilla HTML/CSS/TS/JS in `public/`. The diff modal reuses the existing popover backdrop pattern.
- **Security**: admin endpoints stay behind basic auth. New `GET /generate/diffResume` route is read-only and reuses the existing `safeRealpath` + `ensureJobsRootRealpath` allow-list.
- **Code Health**: every AI-touched or AI-modified file is reviewed via `code_health_review` before commit (per `AGENTS.md` §1). Phase gate: `pre_commit_code_health_safeguard` clean.

## Requirements

### Validated

These capabilities are shipped and have proven valuable during the user's job search work. Inferred from the codebase map (`.planning/codebase/ARCHITECTURE.md`, `STACK.md`) and `docs/FEATURES.md`.

- ✓ AI rewrites and selects resume bullets from a base resume, given a job description — `services/ai.ts` + `routes/generate.ts`.
- ✓ Output is structured JSON with a fixed schema; LaTeX is built on the server and compiled to PDF.
- ✓ Server-side page-limit enforcement: trims the resume up to `OPENCODE_RESUME_TRIM_MAX_ATTEMPTS` (default 3) times, reusing the same OpenCode session, and flags `characterCountTrimmed: "true"` on persistent failure.
- ✓ Cover letter generation alongside the resume (`coverOutput: pdf | txt | both | none`).
- ✓ AI-driven ATS analysis with PII redaction (seven PII fields stripped; pre-call guard refuses to send if any PII field is non-empty after redaction). Falls back to regex coverage on any error.
- ✓ Job applications tracking in `jobs/applications.csv` (`applied_at, company, role, link, status, notes, job_dir`) with idempotent append and three-tier duplicate detection (link → company+role → company).
- ✓ Pre-generation duplicate check returns `409` to the UI for exact or partial (`company`-only) matches; force-override is supported.
- ✓ Content-based duplicate lookup across past JDs: `GET /generate/searchByDescription?text=…&mode=all-words-AND|exact-substring`.
- ✓ Per-model AI concurrency (`OPENCODE_AI_CONCURRENCY`, default 1) and queue toggle (`OPENCODE_AI_QUEUE=false`).
- ✓ OpenCode session lifecycle: `OPENCODE_AI_PROMPT_TIMEOUT_MS`, `OPENCODE_CLIENT_KEEPALIVE`, `OPENCODE_CLIENT_ROTATE_AFTER` — see `docs/plans/AI_PROMPT_TIMEOUT_PLAN.md` and `docs/plans/OPENCODE_SESSION_KEEP_PLAN.md`.
- ✓ Apply suggestions to an existing resume (backup → enqueue → diff → no-op retry → write outputs).
- ✓ Tectonic LaTeX service in Docker (`tectonic-svc/`) for the PDF path, with `pdflatex` fallback.
- ✓ Vanilla HTML/CSS/TS/JS UI in `public/`, including a "Search past JDs" panel.
- ✓ Vitest test suite with hermetic `vitest.setup.ts` (synthesises gitignored `prompts/` and `templates/` in a temp dir).
- ✓ Client-side failure sound (descending sawtooth E5 → G4 → C4) on every failure path.

### Active

The current milestone. Scope is the in-app resume JSON diff viewer, per `docs/plans/RESUME_DIFF_VIEWER_PLAN.md` steps 1–5. Deferred plan items (`RESUME_PAGE_LIMIT_UI_PLAN.md`, `LLM_PROVIDER_ABSTRACTION_PLAN-unrefined.md`, JD content search gating) and the broader tech-debt backlog in `.planning/codebase/CONCERNS.md` are explicitly out of scope for this milestone — they belong to future milestones.

- [ ] **DIFF-01**: After `applySuggestions` completes, the user can click "Compare with backup v1" in the suggestions panel and see the unified diff + a `summary.changedPaths` bullet list in a modal.
- [ ] **DIFF-02**: `GET /generate/diffResume?jobDir=…&version=…&format=unified|summary|both` returns the same data as JSON (default `format=both`), reachable via `curl` for scripting/log sharing.
- [ ] **DIFF-03**: The new route is read-only, basic-auth-gated, and path-allowlisted (reuses `safeRealpath` + `ensureJobsRootRealpath`). Path-traversal payloads are rejected.
- [ ] **DIFF-04**: Backup version is selectable; defaulting to the latest (`vN`) when omitted. `v0`, negative, or non-numeric values are rejected with 400.
- [ ] **DIFF-05**: New shared `services/diffUtil.ts` exposes `canonicalize`, `resumesAreEqual`, `unifiedDiffText` (local fallback — `node:diff` is not a real built-in, see `.planning/research/DIFF_LIBRARY_NOTE.md`), and `summariseJsonDiff`. `fixSuggestionsService.ts` is updated to import `resumesAreEqual` from the new module; the local copy is deleted.
- [ ] **DIFF-06**: `latestBackupVersion(backupsRoot): number | null` helper added to `services/backupService.ts` (no behaviour change to `nextBackupVersion`).
- [ ] **DIFF-07**: `services/diffUtil.test.ts` and updated `routes/generate.test.ts` cover happy path, 404s (backup missing, current missing), 400s (missing `jobDir`, bad `version`, path-traversal), and `format` variants.
- [ ] **DIFF-08**: Modal scaffolding reuses the existing popover backdrop class and the close-on-outside-click pattern at `public/suggestions.js:235-237`. No new CSS framework.
- [ ] **DIFF-09**: `README.md` and `docs/FEATURES.md` are updated in the same commit as the feature, per `AGENTS.md` §3.

### Out of Scope

- ✗ Side-by-side field-level diff with colour-coded JSON. **Why:** keeps the milestone tight; the plan defers it.
- ✗ Diffing `resume.pdf` / `resume.tex` / `cover-letter.json`. **Why:** only `structured-output.json` is the source of truth; the other artefacts are derived.
- ✗ Comparing two arbitrary backup versions (e.g. v1 vs v3) without a "current". **Why:** the "what did apply just change" use case dominates; v-vs-v adds UI surface for marginal value.
- ✗ Auto-running the diff after every successful `applySuggestions`. **Why:** user is in flow; explicit click keeps the surface calm.
- ✗ Live / streaming / incremental diff. **Why:** resume JSONs are <50 KB; the cost is negligible.
- ✗ Caching the diff response on the server. **Why:** see above.
- ✗ The three open questions in `RESUME_DIFF_VIEWER_PLAN.md` (modal vs inline panel, `format=summary` first-class, cap on backup version list). **Why:** deferred to plan-phase per user's decision; the plan's recommendations stand as defaults.
- ✗ Any tech-debt item from `.planning/codebase/CONCERNS.md` (duplicate `/api/read`, `UI_DIST` dead code, `ADMIN_PASSWORD` fail-closed, `RESUME_CHAR_LIMIT` env-var promotion, `strict: false`, etc.). **Why:** out of scope for this milestone; tracked for future milestones.
- ✗ `RESUME_PAGE_LIMIT_UI_PLAN.md` (UI surfacing of `characterCountTrimmed`). **Why:** sibling plan, distinct feature, separate milestone.
- ✗ `LLM_PROVIDER_ABSTRACTION_PLAN-unrefined.md`. **Why:** early-stage, unrefined; needs its own scoping.
- ✗ Wiring the JD content search into the `POST /generate` flow (deferred item in `docs/FEATURES.md`). **Why:** separate concern.
- ✗ New runtime dependencies without evaluation. **Why:** well-tested libraries for complex problems (diff, JSON path, etc.) are preferred over hand-rolling; trivial cases should still use built-ins.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Brownfield add-on milestone, not full reinitialize | The project is actively shipping; existing codebase map, FEATURES.md, and 100+ commits in `jobs/` are the source of truth. | — Pending |
| Scope = diff viewer only | User's choice; smallest shippable increment that exercises the new `diffUtil` and the new route end-to-end. | — Pending |
| Skip the four-agent domain research sweep | The codebase map is comprehensive; the milestone is small and well-scoped; research would be redundant. | ✓ Good |
| Targeted research on the diff library only | Resolves the one open question the plan got wrong (`node:diff` is not a real built-in); captured in `.planning/research/DIFF_LIBRARY_NOTE.md`. | ✓ Good |
| Defer the three open questions in `RESUME_DIFF_VIEWER_PLAN.md` to plan-phase | User's choice; the plan's recommendations (modal, format=summary, latest-only) stand as defaults. | — Pending |
| `model_profile: inherit` | The active session model (`opencode-go/minimax-m3`) is the right tool for this small milestone; adaptive/quality profiles would burn cost without changing the output. | ✓ Good |
| Coarse granularity (3-5 phases, 1-3 plans each) | Single feature, one milestone, single phase expected. | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Business Context check (if present) — customer, revenue model, success metric still accurate?
4. Audit Out of Scope — reasons still valid?
5. Update Context with current state (users, feedback, metrics)

---
*Last updated: 2026-07-18 after brownfield add-on milestone initialization*
