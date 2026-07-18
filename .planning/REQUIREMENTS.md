# Requirements: resume-opencode — Diff Viewer Milestone

**Defined:** 2026-07-18
**Milestone:** In-app resume JSON diff viewer (M1)
**Core Value:** The generated resume must be correctly tailored to the job description — semantically, not just by keyword stuffing. This milestone makes the existing apply-suggestions flow's backup visible in-app.

This milestone is a single-feature add-on to an existing, actively-developed brownfield project. The validated requirements are the entire existing surface of `resume-opencode` (documented in `.planning/codebase/ARCHITECTURE.md` and `docs/FEATURES.md`); they are listed in `PROJECT.md` and are not re-emitted here. The active and out-of-scope sections below are the *delta* for this milestone.

## v1 Requirements

### Diff viewer (server)

- [ ] **DIFF-05**: `services/diffUtil.ts` exposes `canonicalize(value)`, `resumesAreEqual(a, b)`, `unifiedDiffText(a: string, b: string, labelA: string, labelB: string): string`, and `summariseJsonDiff(a, b): { changedPaths, addedKeys, removedKeys }`. The `unifiedDiffText` implementation uses a local "common prefix + change block" algorithm — `node:diff` is **not** a real Node built-in (see `.planning/research/DIFF_LIBRARY_NOTE.md`).
- [ ] **DIFF-05b**: `services/fixSuggestionsService.ts` imports `resumesAreEqual` from `./diffUtil` and deletes its local copy. No other callers of `resumesAreEqual` or `canonicalize` exist in `services/`.
- [ ] **DIFF-06**: `services/backupService.ts` adds `latestBackupVersion(backupsRoot: string): number | null` — pure read, no side effects, no change to `nextBackupVersion`.
- [ ] **DIFF-02**: `GET /generate/diffResume?jobDir=…&version=…&format=unified|summary|both` returns `{ jobDir, backupVersion, backupPath, currentPath, unifiedDiff?, summary? }` per the plan. `format` defaults to `both`; `unified` omits `summary`; `summary` omits `unifiedDiff`. Both files are pretty-printed via `JSON.stringify(_, null, 2)` before diffing so key reordering is not noise. **No PII handling on the route** — the route is read-only and serves the user's own resume (no third-party call). The path allowlist (`safeRealpath` + `pathIsInsideDir`) is the security boundary; see DIFF-03 for the admin-auth decision.
- [ ] **DIFF-03**: The route reuses the `safeRealpath` + `ensureJobsRootRealpath` allow-list pattern from `routes/generate.ts:797-799` (and the `pathIsInsideDir` check). Path-traversal payloads (`jobDir=../etc`) are rejected. **The route is NOT wrapped in `requireAdminAuth`** — it follows the existing `/generate/*` convention where only `/api/config` and `/api/edit` are admin-gated (see `server.ts:65,139`).
- [ ] **DIFF-04**: `version` is validated against `/^v\d+$/` after `Number` parse; rejects `v0`, negative numbers, and non-numeric. When omitted, defaults to `latestBackupVersion(backupsRoot)`.
- [ ] **DIFF-04b**: 404 with `{ error: 'Backup not found' | 'Resume not found', jobDir, version }` when the resolved backup or current file is missing. 400 with `{ error: 'jobDir required' }` when `jobDir` is missing. 400 with `{ error: 'invalid version' }` on bad `version`.

### Diff viewer (tests)

- [ ] **DIFF-07a**: `services/diffUtil.test.ts` covers: `resumesAreEqual` parity (key reorder is still equal); `unifiedDiffText` produces `''` for identical inputs and contains a known changed line for a known input; `summariseJsonDiff` returns the expected paths for a known added key, removed key, and changed scalar; `unifiedDiffText` on a ~30 KB file completes in <50 ms.
- [ ] **DIFF-07b**: `routes/generate.test.ts` covers: 200 on happy path with two known JSONs (asserts `unifiedDiff` contains a known line and `summary.changedPaths` contains the expected path); 404 when backup is missing; 404 when current is missing (error message names the missing file); 400 when `jobDir` is missing; 400 when `version` is `v0` / `v-1` / `vabc`; 400/403 on path-traversal (`jobDir=../etc` rejected by `safeRealpath`); `format=summary` omits `unifiedDiff`; `format=unified` omits `summary`; `format=both` (default) includes both.

### Diff viewer (UI)

- [ ] **DIFF-08a**: `public/suggestions.html` adds a single hidden modal scaffold (`id="suggestions-diff-modal"`) with a close button, a header `Job: <slug> · Backup: v<N>`, and a `<pre>` body for the unified diff. Reuses the existing popover backdrop class.
- [ ] **DIFF-08b**: `public/suggestions.js` rewires `showResult` (`public/suggestions.js:268-284`) so the backup-path text becomes a clickable control that calls `openDiffModal(backupVersion)`. `openDiffModal(version)` validates `getJobSlug()` is set, fetches `GET /generate/diffResume?jobDir=…&version=v${version}`, renders `unifiedDiff` into the `<pre>` and `summary.changedPaths` as a side-panel bullet list, and reuses the click-outside-close pattern at `public/suggestions.js:235-237`. `closeDiffModal()` hides the modal and restores focus.
- [ ] **DIFF-08c**: A small block of CSS is added (either inline in `public/suggestions.html` or in `public/style.css`, whichever already holds the popover styles — verify by grep on `popover-empty` / `.popover`).
- [ ] **DIFF-01**: The user can complete the round trip: generate a resume → run **Apply suggestions** with any short text → after the apply task completes, click **Compare with backup v1** → modal opens with the unified diff and `summary.changedPaths` → close via button or click-outside.

### Docs

- [ ] **DIFF-09a**: `README.md` extends the existing "Apply suggestions to an existing resume" section with one paragraph documenting the in-app diff and the `GET /generate/diffResume` endpoint.
- [ ] **DIFF-09b**: `docs/FEATURES.md` extends the existing "Apply suggestions to an existing resume" section with a new bullet: "Compare current resume against any backup version (`GET /generate/diffResume`, UI link in the suggestions panel)."

### Safeguard

- [ ] **DIFF-10**: `pre_commit_code_health_safeguard` is clean (no regression) on the final commit. `npm test` and `npm run build` are clean. The manual runbook in `RESUME_DIFF_VIEWER_PLAN.md` §"Manual runbook" steps 1–5 is executed and observed before the milestone is declared done.

> **Decision (2026-07-18):** The diff route is read-only and serves the user's own resume over a path-allowlisted endpoint. The source plan originally said it would be admin-gated, but no existing `/generate/*` route is admin-gated, so this route follows the existing convention. Admin-gating the whole `/generate/*` surface is a separate, broader decision deferred to a future milestone.

## v2 Requirements

Deferred to future milestones. Tracked but not in current scope.

### UI side-by-side diff
- **DIFF-11**: Side-by-side field-level diff with colour-coded JSON (the explicitly-deferred item from the plan).

### Backup-version picker
- **DIFF-12**: Modal shows a small dropdown to pick any backup version (not just latest). Currently latest-only.

### Inline (non-modal) panel
- **DIFF-13**: Alternative inline expandable panel below the existing buttons instead of the modal. Currently modal.

### OpenCode web link on diff
- **DIFF-14**: "Open in OpenCode web" link for the new `applySuggestions` session in the diff modal header (mirrors what the apply result block already does).

## Out of Scope

| Feature | Reason |
|---------|--------|
| Side-by-side field-level diff with colour-coded JSON | Deferred to v2; current text diff is sufficient for the "what changed" use case. |
| Diffing `resume.pdf` / `resume.tex` / `cover-letter.json` | Only `structured-output.json` is the source of truth; the rest are derived. |
| Comparing two arbitrary backup versions (e.g. v1 vs v3) | Adds UI surface for marginal value; deferred. |
| Auto-running the diff after every successful `applySuggestions` | User is in flow; explicit click keeps the surface calm. |
| Live / streaming / incremental diff | Resume JSONs are <50 KB; cost is negligible. |
| Server-side caching of the diff response | Same as above. |
| New runtime dependencies (e.g. a JSON-path library) | Well-tested libraries are preferred for complex problems; trivial implementations (~50 lines) may be hand-rolled when clearly sufficient. |
| Wiring the JD content search into `POST /generate` (deferred item in `docs/FEATURES.md`) | Separate concern; belongs to a future milestone. |
| `RESUME_PAGE_LIMIT_UI_PLAN.md` (UI surfacing of `characterCountTrimmed`) | Sibling plan; distinct feature. |
| `LLM_PROVIDER_ABSTRACTION_PLAN-unrefined.md` | Early-stage, unrefined; needs its own scoping. |
| Tech-debt items from `.planning/codebase/CONCERNS.md` (duplicate `/api/read`, `UI_DIST` dead code, `ADMIN_PASSWORD` fail-closed, `RESUME_CHAR_LIMIT` env-var promotion, `strict: false`, etc.) | Out of scope for this milestone; tracked for future milestones. |
| The three open questions in `RESUME_DIFF_VIEWER_PLAN.md` | Deferred to plan-phase per user decision; plan's recommendations (modal, `format=summary`, latest-only) stand as defaults. |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DIFF-05 | Phase 1 | Pending |
| DIFF-05b | Phase 1 | Pending |
| DIFF-06 | Phase 1 | Pending |
| DIFF-02 | Phase 1 | Pending |
| DIFF-03 | Phase 1 | Pending |
| DIFF-04 | Phase 1 | Pending |
| DIFF-04b | Phase 1 | Pending |
| DIFF-07a | Phase 1 | Pending |
| DIFF-07b | Phase 1 | Pending |
| DIFF-08a | Phase 1 | Pending |
| DIFF-08b | Phase 1 | Pending |
| DIFF-08c | Phase 1 | Pending |
| DIFF-01 | Phase 1 | Pending |
| DIFF-09a | Phase 1 | Pending |
| DIFF-09b | Phase 1 | Pending |
| DIFF-10 | Phase 1 | Pending |

**Coverage:**
- v1 requirements: 16 total
- Mapped to phases: 16
- Unmapped: 0 ✓

---
*Requirements defined: 2026-07-18*
*Last updated: 2026-07-18 after brownfield add-on milestone initialization*
