# Roadmap: resume-opencode — Diff Viewer Milestone (M1)

**Date:** 2026-07-18
**Milestone goal:** Ship the in-app resume JSON diff viewer end-to-end so that after `applySuggestions` completes, the user can see the unified diff between any backup version and the current resume in one click from the suggestions panel — without leaving the app or opening a terminal.

**Scope:** Single feature, single phase. Per user decision, this milestone does not include the sibling `RESUME_PAGE_LIMIT_UI_PLAN.md`, the `LLM_PROVIDER_ABSTRACTION_PLAN-unrefined.md` sketch, the JD content-search `POST /generate` wiring, or any of the tech-debt items in `.planning/codebase/CONCERNS.md`. Those belong to future milestones.

**Coarse granularity (3–5 phases, 1–3 plans each).** This milestone's scope is one phase.

---

## Phases

### Phase 1: Resume JSON diff viewer

**Goal:** Ship the in-app diff viewer end-to-end: shared `diffUtil`, `GET /generate/diffResume` route, clickable backup link in the suggestions panel, modal viewer, docs sync, and a clean Code Health safeguard.
**Mode:** standard
**Requirements:** DIFF-01, DIFF-02, DIFF-03, DIFF-04, DIFF-04b, DIFF-05, DIFF-05b, DIFF-06, DIFF-07a, DIFF-07b, DIFF-08a, DIFF-08b, DIFF-08c, DIFF-09a, DIFF-09b, DIFF-10 (16 v1 requirements)
**Success Criteria:**

1. `services/diffUtil.ts` exists; `fixSuggestionsService.ts` imports `resumesAreEqual` from it; the local copy is gone. `unifiedDiffText` and `summariseJsonDiff` have unit tests in `services/diffUtil.test.ts`.
2. `GET /generate/diffResume?jobDir=…&version=…&format=unified|summary|both` returns 200 on a known job with a known backup, 404 with a named error when the backup or current is missing, 400 on bad `jobDir` / `version` / path-traversal, and the response shape matches the plan. `latestBackupVersion` is added to `services/backupService.ts`.
3. The suggestions panel's "Backup: …" text becomes a clickable control; clicking opens a modal that shows the unified diff and a `summary.changedPaths` bullet list. Close via button or click-outside. No new CSS framework. Prefer built-ins for trivial cases; use well-tested libraries for complex problems.
4. `README.md` and `docs/FEATURES.md` are updated in the same commit as the feature. `npm test` and `npm run build` are clean. `pre_commit_code_health_safeguard` reports no regression. The manual runbook in `RESUME_DIFF_VIEWER_PLAN.md` steps 1–5 has been executed and observed.

**Plans:** 4/4 plans executed

- [x] 01-01-PLAN.md
- [x] 01-02-PLAN.md
- [x] 01-03-PLAN.md
- [x] 01-04-PLAN.md
- Plan 1: `services/diffUtil.ts` + relocate `canonicalize` / `resumesAreEqual` + add `unifiedDiffText` + `summariseJsonDiff` + unit tests.
- Plan 2: `latestBackupVersion` + `GET /generate/diffResume` route + route tests.
- Plan 3: UI modal scaffolding + clickable backup link + `openDiffModal` / `closeDiffModal` + manual runbook.
- Plan 4 (gap-closure): Multi-hunk LCS diff algorithm + color spans + modal width fix (G-01-2, G-01-3)

---

## Coverage

| Requirement | Phase | Status |
|-------------|-------|--------|
| DIFF-01 | Phase 1 | Pending |
| DIFF-02 | Phase 1 | Pending |
| DIFF-03 | Phase 1 | Pending |
| DIFF-04 | Phase 1 | Pending |
| DIFF-04b | Phase 1 | Pending |
| DIFF-05 | Phase 1 | Pending |
| DIFF-05b | Phase 1 | Pending |
| DIFF-06 | Phase 1 | Pending |
| DIFF-07a | Phase 1 | Pending |
| DIFF-07b | Phase 1 | Pending |
| DIFF-08a | Phase 1 | Pending |
| DIFF-08b | Phase 1 | Pending |
| DIFF-08c | Phase 1 | Pending |
| DIFF-09a | Phase 1 | Pending |
| DIFF-09b | Phase 1 | Pending |
| DIFF-10 | Phase 1 | Pending |
| VDS-01 | Phase 2 | Pending |
| VDS-02 | Phase 2 | Pending |
| VDS-03 | Phase 2 | Pending |
| VDS-04 | Phase 2 | Pending |
| AUTO-01 | Phase 2 | Pending |
| AUTO-02 | Phase 2 | Pending |
| AUTO-03 | Phase 2 | Pending |
| AUTO-04 | Phase 2 | Pending |
| AUTO-05 | Phase 2 | Pending |
| UI-01 | Phase 2 | Pending |
| UI-02 | Phase 2 | Pending |

**Coverage:**

- v1 requirements: 16 (Phase 1) + 11 (Phase 2) = 27 total
- Mapped to phases: 27
- Unmapped: 0 ✓

---

## Out of milestone scope (deferred to future milestones)

These are visible in the project today and intentionally not addressed by this milestone. Capture in `PROJECT.md` Out of Scope or in the requirements doc under v2 / Out of Scope for traceability.

- `RESUME_PAGE_LIMIT_UI_PLAN.md` — UI surfacing of `characterCountTrimmed` (sibling plan, distinct feature).
- `LLM_PROVIDER_ABSTRACTION_PLAN-unrefined.md` — early-stage abstraction sketch, needs its own scoping.
- JD content search wired into `POST /generate` — deferred item in `docs/FEATURES.md` and `docs/plans/JD_CONTENT_SEARCH_PLAN.md`.
- Tech-debt backlog in `.planning/codebase/CONCERNS.md` (duplicate `/api/read`, `UI_DIST` dead code, `ADMIN_PASSWORD` fail-closed, `RESUME_CHAR_LIMIT` env-var promotion, `strict: false`, etc.).
- The three open questions in `RESUME_DIFF_VIEWER_PLAN.md` (modal vs inline, `format=summary` first-class, backup-version picker) — deferred to plan-phase per user decision; the plan's recommendations stand as defaults.

### Phase 2: Version diff selector + fire-and-forget ATS analysis

**Goal:** Ship three capabilities: (1) version-diff-selector panel below "Search past JDs" for diffing any two backup versions; (2) fire-and-forget auto-chain: generation → auto-applySuggestions → ATS analysis; (3) Phase 1 UI tweaks (main model fills screen, word diff shows line numbers).
**Requirements**: VDS-01, VDS-02, VDS-03, VDS-04, AUTO-01, AUTO-02, AUTO-03, AUTO-04, AUTO-05, UI-01, UI-02
**Depends on:** Phase 1
**Plans:** 2 plans

Plans:

- [x] 02-01-PLAN.md — Version-diff-selector panel + Phase 1 UI tweaks
- [x] 02-02-PLAN.md — Auto-chain: generate → applySuggestions → ATS

### Phase 3: Form prefill, permalink URLs, and enhanced job folder links

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 2
**Plans:** 0 plans

Plans:

- [ ] TBD (run /gsd-plan-phase 3 to break down)

---
*Roadmap created: 2026-07-18*
*Last updated: 2026-07-18 after brownfield add-on milestone initialization*
