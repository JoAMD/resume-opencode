# Project State: resume-opencode — Diff Viewer Milestone (M1)

**Initialized:** 2026-07-18
**Project root:** /home/adf_home_joel/src/copilot/resume-opencode
**Active milestone:** In-app resume JSON diff viewer (M1)

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-07-18)

**Core value:** The generated resume must be correctly tailored to the job description — semantically, not just by keyword stuffing.
**Current focus:** Phase 1 — Resume JSON diff viewer (per `docs/plans/RESUME_DIFF_VIEWER_PLAN.md`).

## Current Position

- **Phase:** 1 of 1 (single-feature milestone)
- **Plan:** TBD — `/gsd-plan-phase 1` to begin planning
- **Status:** Ready for planning. Requirements and roadmap are committed; the project instruction file is generated.

## Decisions Log

See `.planning/PROJECT.md` ## Key Decisions for the full table. Highlights:

- **Brownfield add-on milestone**, not full reinitialize. The codebase map (`/.planning/codebase/`) and the active commit history (most recent: `670a46d docs: map existing codebase`) are the source of truth.
- **Scope = diff viewer only.** Sibling plans and tech-debt items are deferred to future milestones.
- **YOLO mode, coarse granularity, `model_profile: inherit`.** The active session model is the right tool for this small milestone.
- **Targeted research on the diff library only.** `node:diff` is not a real Node built-in (proposal, not landed); the local fallback is the only viable path. Captured in `.planning/research/DIFF_LIBRARY_NOTE.md`.
- **Three open questions in `RESUME_DIFF_VIEWER_PLAN.md` deferred to plan-phase** per user decision; the plan's recommendations (modal, `format=summary`, latest-only) stand as defaults.

## Accumulated Context

### Codebase map
Comprehensive: `ARCHITECTURE.md`, `STACK.md`, `STRUCTURE.md`, `CONVENTIONS.md`, `TESTING.md`, `INTEGRATIONS.md`, `CONCERNS.md` in `.planning/codebase/`. Refreshed 2026-07-18.

### Plans and deferred work
- `docs/plans/RESUME_DIFF_VIEWER_PLAN.md` — **in scope for this milestone** (Phase 1 source plan).
- `docs/plans/RESUME_PAGE_LIMIT_UI_PLAN.md` — out of scope (sibling plan).
- `docs/plans/LLM_PROVIDER_ABSTRACTION_PLAN-unrefined.md` — out of scope (early-stage).
- `docs/plans/JD_CONTENT_SEARCH_PLAN.md` — shipped, kept for deferred items (out of scope).
- `docs/plans/AI_PROMPT_TIMEOUT_PLAN.md` and `docs/plans/OPENCODE_SESSION_KEEP_PLAN.md` — shipped, kept for context.

### Test approach (per `.planning/codebase/TESTING.md`)
- Vitest 3.2.6 with happy-dom. Co-located `*.test.ts` next to source.
- For `services/ai.ts`, tests are split per feature (`ai.privacy.test.ts`, etc.).
- Hermetic `vitest.setup.ts` synthesises gitignored `prompts/` and `templates/`.
- No coverage runner configured; `vitest run --coverage` would fail without `@vitest/coverage-v8`.

### Conventions (per `.planning/codebase/CONVENTIONS.md`)
- TypeScript ES2021, NodeNext, `strict: false` (planned tech-debt, out of scope this milestone).
- Service modules are pure, side-effecty-but-IO-only. No class hierarchy; mostly namespaced functions.
- New admin routes go behind basic auth and reuse `safeRealpath` + `ensureJobsRootRealpath`.
- Tests live next to source; vitest is the runner.

### Security / redaction
- AI ATS analyser is the only AI call that sees a representation of the full resume; it is preceded by PII redaction (`services/redactResume.ts` strips seven PII fields).
- The new diff viewer route does **not** need redaction — the response is served to the user themselves over a basic-auth-gated, path-allowlisted endpoint. The diff is the user's own data.

## Active Constraints

- Prefer built-ins and hand-rolled solutions for trivial cases; use well-tested libraries for complex problems (e.g. diff algorithms, JSON path, etc.) — don't reinvent common things.
- No new UI framework; reuse existing popover backdrop and click-outside-close patterns.
- Code Health: `pre_commit_code_health_safeguard` clean before commit.
- `npm test` and `npm run build` clean.
- Manual runbook (`RESUME_DIFF_VIEWER_PLAN.md` §"Manual runbook" steps 1–5) executed and observed.

## Next Action

Run `/gsd-plan-phase 1` to begin planning Phase 1. Expected plan shape, per `RESUME_DIFF_VIEWER_PLAN.md` steps 1–5:
- Plan 1: `services/diffUtil.ts` + relocate `canonicalize` / `resumesAreEqual` + `unifiedDiffText` + `summariseJsonDiff` + unit tests.
- Plan 2: `latestBackupVersion` + `GET /generate/diffResume` route + route tests.
- Plan 3: UI modal scaffolding + clickable backup link + `openDiffModal` / `closeDiffModal` + manual runbook.

---
*State initialized: 2026-07-18 after brownfield add-on milestone initialization*
