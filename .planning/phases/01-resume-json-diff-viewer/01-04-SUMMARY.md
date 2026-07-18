---
phase: 01-resume-json-diff-viewer
plan: "04"
subsystem: ui
tags: [diff, modal, structuredPatch, diffWords, json-viewer]

# Dependency graph
requires:
  - phase: 01-resume-json-diff-viewer
    provides: services/diffUtil (canonicalize, resumesAreEqual, summariseJsonDiff) and GET /generate/diffResume (unified/summary/both) wired in plans 01-01 / 01-02
provides:
  - Multi-hunk unified diff output from services/diffUtil.unifiedDiffText (structuredPatch, context=3)
  - Word-level inline diff from services/diffUtil.generateInlineDiff (diffWords) for the Full file view
  - HTML rendering of diff output with escapeHtml + color spans (line + word levels) in public/suggestions.js
  - Hunks/Full file toggle tabs in the diff modal header
  - GET /generate/diffResume?format=word-diff returns { wordDiffHtml }
  - Widen diff modal popover-body to 640px so path summary column is readable
affects: [in-app-diff-viewer, apply-suggestions-panel]

# Tech tracking
tech-stack:
  added: [diff@9.0.0]
  patterns: [multi-hunk structuredPatch with context=3, innerHTML diff rendering with escapeHtml + color spans, lazy word-diff fetch on tab toggle]

key-files:
  modified:
    - services/diffUtil.ts
    - services/diffUtil.test.ts
    - public/suggestions.js
    - public/suggestions.html
    - public/style.css
    - routes/generate.ts
    - package.json
    - package-lock.json

key-decisions:
  - "Set structuredPatch context=3 to balance hunk focus against merge distance — disjoint changes >7 lines apart produce separate hunks"
  - "Lazy-fetch word-diff via format=word-diff instead of returning it with format=both — keeps the initial Hunks load small and lets the Full file tab stream the larger payload only on demand"
  - "Scope all diff CSS rules under .popover-body .diff-pre so they cannot leak to other popovers"
  - "Reset cachedWordDiffHtml on every openDiffModal so different backups don't reuse stale word-diff markup"

patterns-established:
  - "Pattern: HTML diff rendering uses escapeHtml on every line/segment before wrapping in spans — hunk and word diffs share the same XSS defence"
  - "Pattern: Modal toggle uses module-level state (lastUnifiedDiff, cachedWordDiffHtml) — fetch-once per open, not per click"

requirements-completed: []

coverage:
  - id: D1
    description: "unifiedDiffText uses structuredPatch for multi-hunk output (G-01-2 RC-1)"
    verification:
      - kind: unit
        ref: "services/diffUtil.test.ts#unifiedDiffText > produces separate hunks for multiple disjoint changes"
        status: pass
    human_judgment: false
  - id: D2
    description: "renderDiffResponse uses innerHTML with escapeHtml + line-level color spans (G-01-2 RC-2)"
    verification:
      - kind: unit
        ref: "npm run build"
        status: pass
    human_judgment: true
    rationale: "Renderer correctness is verified by build (no test asserts the innerHTML shape); the in-browser behaviour — that line spans appear coloured — is a UI judgment call"
  - id: D3
    description: "Diff modal popover-body widened to 640px so path summary column is readable (G-01-3)"
    verification:
      - kind: unit
        ref: "npm run build"
        status: pass
    human_judgment: true
    rationale: "CSS max-width change; visual adequacy of the wider column requires in-browser confirmation"
  - id: D4
    description: "generateInlineDiff exports full newStr content with word-level word-added/word-removed spans (G-01-2 RC-4)"
    verification:
      - kind: unit
        ref: "services/diffUtil.test.ts#generateInlineDiff > wraps an added word in word-added span"
        status: pass
      - kind: unit
        ref: "services/diffUtil.test.ts#generateInlineDiff > marks multiple changed words individually"
        status: pass
    human_judgment: false
  - id: D5
    description: "GET /generate/diffResume?format=word-diff returns { wordDiffHtml } (G-01-2 RC-5)"
    verification:
      - kind: unit
        ref: "npm run build"
        status: pass
    human_judgment: true
    rationale: "Endpoint wiring verified by build; runtime behaviour (200 + wordDiffHtml shape) needs curl smoke-test to confirm"
  - id: D6
    description: "Word-level CSS rules .word-removed / .word-added (G-01-2 RC-6)"
    verification:
      - kind: unit
        ref: "npm run build"
        status: pass
    human_judgment: true
    rationale: "CSS-only; visual fidelity (red strikethrough on removed words, green on added) needs in-browser confirmation"
  - id: D7
    description: "Hunks/Full file toggle in diff modal header (G-01-2 RC-7)"
    verification:
      - kind: unit
        ref: "npm run build"
        status: pass
    human_judgment: true
    rationale: "DOM/event behaviour — click swaps the view, lazy fetch fires only on Full file click, cache invalidates on new open — needs browser verification"

# Metrics
duration: 4 min
completed: 2026-07-18
status: complete
---

# Phase 1 Plan 4: Diff modal hunks, colors, and word-level view — Summary

**Multi-hunk unified diff with red/green line spans, plus a lazy-loaded word-level Full file view, behind Hunks/Full file tabs in the in-app diff modal.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-07-18T02:19:56Z
- **Completed:** 2026-07-18T02:24:02Z
- **Tasks:** 8
- **Files modified:** 8

## Accomplishments

- `unifiedDiffText` rewritten with `diff.structuredPatch` and `context=3` so disjoint edits render as separate focused hunks (G-01-2 RC-1)
- `renderDiffResponse` now uses `innerHTML` with `escapeHtml` and line-level `.diff-removed` / `.diff-added` color spans (G-01-2 RC-2)
- Diff modal `popover-body` widened to 640px so path strings like `experience.0.bullets.0` fit (G-01-3)
- New `generateInlineDiff` export using `diffWords` for word-level highlighting — same module as the line-level diff
- `GET /generate/diffResume` extended with `format=word-diff` returning `{ wordDiffHtml }` (G-01-2 RC-5)
- Word-level CSS rules `.word-removed` (red strikethrough) and `.word-added` (green), scoped under `.popover-body .diff-pre` to avoid popover leakage (G-01-2 RC-6)
- Hunks/Full file toggle tabs in the modal header; Full file view lazy-fetches word-diff on first click and caches per-modal-open (G-01-2 RC-7)
- All 17 `diffUtil` tests pass; full suite (225 tests across 19 files) green; `npm run build` clean; `pre_commit_code_health_safeguard` passed

## Task Commits

Each task was committed atomically:

1. **Task 1: Install diff library (G-01-2 RC-0)** — `48e0ae0` (feat)
2. **Task 2 + 4: Multi-hunk structuredPatch + word-level diffs (G-01-2 RC-1, RC-4)** — `c454981` (feat)
3. **Task 3: innerHTML + color spans (G-01-2 RC-2)** — `be40e38` (feat)
4. **Task 5: format=word-diff endpoint (G-01-2 RC-5)** — `59af91a` (feat)
5. **Task 6 + 8: diff CSS, modal widen, toggle tabs (G-01-2 RC-3/6, G-01-3)** — `f738d83` (feat)
6. **Task 7: Hunks/Full file toggle (G-01-2 RC-7)** — `2a3204b` (feat)

## Files Created/Modified

- `services/diffUtil.ts` — imports `structuredPatch, diffWords`; rewrites `unifiedDiffText`; adds `generateInlineDiff`; adds `escapeHtml` helper
- `services/diffUtil.test.ts` — adds 5 new tests (1 multi-hunk, 4 word-diff)
- `public/suggestions.js` — `renderDiffResponse` uses `innerHTML`; adds `wrapDiffLinesWithSpans`/`escapeHtml`/`switchToHunksView`/`switchToFullView`; wires Hunks/Full file tabs with lazy fetch and per-modal cache reset
- `public/suggestions.html` — adds `<div class="diff-view-toggle">` with Hunks/Full file buttons in the modal header
- `public/style.css` — line-level `.diff-removed`/`.diff-added`/`.diff-context`; word-level `.word-removed`/`.word-added`; modal `#suggestions-diff-modal .popover-body { max-width: 640px }`; `.diff-view-toggle` styles
- `routes/generate.ts` — extends `DiffResumeFormat` with `'word-diff'`; `diffResumeHandler` emits `response.wordDiffHtml` for that format
- `package.json` — adds `diff@^9.0.0` to dependencies
- `package-lock.json` — locks the new dep graph

## Decisions Made

- **`context: 3` for `structuredPatch`** — yields small focused hunks; a 30-KB resume with widely-spaced edits will produce multiple hunks, while a single localised change stays in one hunk. Lower values (e.g. 0) cause adjacent changes to split unnecessarily.
- **Lazy `format=word-diff` fetch** — keeps the initial Hunks response small (no word-level payload by default) and only ships the larger HTML when the user actually toggles to Full file.
- **Reset `cachedWordDiffHtml` per `openDiffModal`** — different backups have different content; reusing cached HTML across modal opens would show stale word spans.
- **CSS scoped under `.popover-body .diff-pre`** — other popovers (file picker, suggestions panel) share `.popover-body`; scoping prevents `.diff-removed`/`.word-added` from accidentally colouring unrelated content.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Multi-hunk test fixture had changes too close together for context=3**
- **Found during:** Task 2 (test RED phase)
- **Issue:** Plan's test fixture had two edits 3 lines apart; even with `context: 3` they merged into one hunk because the library needs `2*context < gap` to split.
- **Fix:** Replaced the fixture with a 20-line input and two edits 13 lines apart, which yields 2 hunks with `context: 3` and still proves the multi-hunk behaviour.
- **Files modified:** `services/diffUtil.test.ts`
- **Verification:** `npm test -- --run services/diffUtil.test.ts` — 17/17 pass
- **Committed in:** `c454981` (part of Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Test fixture adjustment only. Production behaviour (`context: 3`, multi-hunk output for widely-spaced edits) is exactly as specified.

## Issues Encountered

- `npm install diff@>=8.0.3` produced a stray file `=8.0.3` (npm warning output redirected into a file named `=8.0.3`). The actual install succeeded (`diff@9.0.0` in `package.json`, `node_modules/diff` populated). The stray file was deleted after the install completed and never staged.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 1 is the only phase in the M1 diff-viewer milestone. All four plans (01-01, 01-02, 01-03, 01-04) now have SUMMARY files; gap-closure plan 04 closes G-01-2 (multi-hunk + colors + word-diff) and G-01-3 (modal width). The manual runbook in `docs/plans/RESUME_DIFF_VIEWER_PLAN.md` should be re-executed to confirm the visual fix in a browser before milestone close.

---
*Phase: 01-resume-json-diff-viewer*
*Completed: 2026-07-18*
