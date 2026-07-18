---
phase: 01-resume-json-diff-viewer
verified: 2026-07-18T02:25:30Z
status: human_needed
score: 14/16 must-haves verified
behavior_unverified: 2
overrides_applied: 0
overrides: []
re_verification: null
gaps: []
deferred: []
behavior_unverified_items:
  - truth: "DIFF-01: User can complete the round trip — generate, apply suggestions, click Compare with backup, see modal with unified diff and changedPaths, close via button or click-outside"
    test: "In the browser, generate a resume → run Apply suggestions with a short edit text → wait for apply to complete → click 'Compare with backup v1' in the suggestions panel → verify the modal opens with the unified diff and the summary.changedPaths list, and that it closes via the Close button and via click-outside"
    expected: "Modal opens with red removed / green added lines in multiple focused hunks, side panel lists JSON paths that changed, Close button and click-outside both hide the modal and restore focus to the trigger"
    why_human: "End-to-end browser flow touches Express + static server + DOM event handlers — no test exercises this round trip; presence and wiring are green, runtime behaviour needs human eyes"
  - truth: "DIFF-10: pre_commit_code_health_safeguard is clean; npm test and npm run build are clean; manual runbook in RESUME_DIFF_VIEWER_PLAN.md steps 1-5 is executed and observed"
    test: "Open the diff modal in-browser and confirm: (1) multiple focused hunks with red/green coloring instead of one giant block, (2) path summary column is readable at 640px width without wrapping, (3) Hunks/Full file tabs switch correctly — Hunks shows line spans, Full file shows word-level inline highlights, and Full file lazy-loads via format=word-diff"
    expected: "Hunks view: short focused hunks with red/green context. Full file view: red strikethrough on removed words, green background on added words. Path entries like experience.0.bullets.0 fit on one line. Code Health safeguard has no regression."
    why_human: "Visual fidelity (colour saturation, line breaks, span alignment) and Code Health safeguard are the final acceptance gates; the runbook in RESUME_DIFF_VIEWER_PLAN.md requires human observation"
human_verification:
  - test: "Generate → Apply suggestions → click 'Compare with backup v1' → confirm modal opens with focused multi-hunk diff + red removed / green added lines + summary.changedPaths side panel"
    expected: "Modal renders a multi-hunk unified diff with line-level color spans; side panel shows paths like 'summary', 'skills.tools', 'experience.0.bullets.0' on a single line each"
    why_human: "End-to-end browser flow not covered by automated tests; renderer correctness needs eyes-on confirmation"
  - test: "Click the Full file tab — confirm word-level highlighting (red strikethrough for removed words, green background for added words) appears; click Hunks tab — confirm return to line-level view"
    expected: "Full file view shows newStr content with per-word word-removed / word-added spans; tab toggle is instant after first Full file click (cache hit); new modal open re-fetches the word-diff"
    why_human: "Visual fidelity of the word-level diff and the lazy-fetch / cache-invalidation behaviour need browser confirmation"
  - test: "Resize the modal to its natural width and confirm the summary column has enough room for 'experience.0.bullets.0' without wrapping"
    expected: "Path entries render on a single line at 640px modal width"
    why_human: "Visual adequacy of the wider modal — no test asserts the column width is sufficient"
---

# Phase 1: Resume JSON diff viewer — Verification Report

**Phase Goal:** Ship the in-app diff viewer end-to-end: shared `diffUtil`, `GET /generate/diffResume` route, clickable backup link in the suggestions panel, modal viewer, docs sync, and a clean Code Health safeguard.
**Verified:** 2026-07-18T02:25:30Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1 | `services/diffUtil.ts` exports `canonicalize`, `resumesAreEqual`, `unifiedDiffText`, `summariseJsonDiff`, `generateInlineDiff` | ✓ VERIFIED | `services/diffUtil.ts:1,155` — `export { canonicalize, resumesAreEqual, unifiedDiffText, summariseJsonDiff, generateInlineDiff }` |
| 2 | `services/fixSuggestionsService.ts` no longer defines `canonicalize` or `resumesAreEqual`; imports `resumesAreEqual` from `./diffUtil` | ✓ VERIFIED | `services/fixSuggestionsService.ts` — `import { resumesAreEqual } from './diffUtil';`; no local `function canonicalize` / `function resumesAreEqual` in file |
| 3 | `unifiedDiffText` returns `''` for identical inputs and a unified-diff block for different inputs | ✓ VERIFIED | `services/diffUtil.test.ts` — 3 unifiedDiffText tests + 1 multi-hunk test all pass |
| 4 | `unifiedDiffText` produces multiple focused hunks for disjoint changes (G-01-2 RC-1) | ✓ VERIFIED | `services/diffUtil.test.ts#unifiedDiffText > produces separate hunks for multiple disjoint changes` — 2 hunks asserted, 4+ context lines, hunk-header regex matched |
| 5 | `summariseJsonDiff` returns expected dot/index paths for known added/removed/changed values | ✓ VERIFIED | 3 summariseJsonDiff tests pass (`addedKeys`, `removedKeys`, `changedPaths`) |
| 6 | `generateInlineDiff` returns full newStr content with word-added/word-removed spans (G-01-2 RC-4) | ✓ VERIFIED | 4 generateInlineDiff tests pass: identical-strings escape only; single-word adds/removes wrap; multiple words each wrap |
| 7 | `services/backupService.ts` adds `latestBackupVersion(backupsRoot): number \| null` as pure read | ✓ VERIFIED | `services/backupService.ts` — `export function latestBackupVersion(...)` present; `nextBackupVersion` unchanged |
| 8 | `GET /generate/diffResume` returns 200 on happy path, 404 with named error on missing file, 400 on bad jobDir/version/traversal, with correct `format` variants | ✓ VERIFIED | `npm test -- --run -t diffResume` — 10 tests pass (happy path, format=unified/summary/both, v0/v-1/vabc invalid, ../etc traversal, missing backup 404) |
| 9 | Route reuses `safeRealpath` + `ensureJobsRootRealpath` allowlist | ✓ VERIFIED | `routes/generate.ts` `validateDiffResumeRequest` calls `resolveAllowedJobDir` which wraps `safeRealpath` + `ensureJobsRootRealpath` + `pathIsInsideDir` |
| 10 | Route supports `format=word-diff` returning `{ wordDiffHtml }` (G-01-2 RC-5) | ✓ VERIFIED | `routes/generate.ts` — `DiffResumeFormat` union includes `'word-diff'`; `DIFF_FORMATS` set includes it; `diffResumeHandler` emits `response.wordDiffHtml` for that format |
| 11 | UI: backup-path text is a clickable control; clicking opens the modal with the diff and changedPaths | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `public/suggestions.js` — `trigger.addEventListener('click', () => openDiffModal(backupVersion, trigger))`; `openDiffModal` and `closeDiffModal` defined; wiring code present — runtime browser flow needs human confirmation |
| 12 | Modal renders multi-hunk diff with line-level red/green coloring and word-level highlights; modal widened to 640px | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | All four `public/style.css` rules in place (`.diff-removed`, `.diff-added`, `.diff-context`, `.word-removed`, `.word-added`); `#suggestions-diff-modal .popover-body { max-width: 640px }` present; Hunks/Full file toggle buttons present in HTML and wired in JS — visual fidelity needs human eyes |
| 13 | `openDiffModal` reuses the popover backdrop and click-outside-close pattern | ✓ VERIFIED | `public/suggestions.js` — modal root cloned from `#suggestions-diff-modal` (`.popover.hidden`); click-outside handler at the popover-root level reuses the same pattern as the file popover |
| 14 | `README.md` documents the in-app diff and the endpoint | ✓ VERIFIED | `README.md` — paragraph under "Apply suggestions to an existing resume" documents Compare-with-backup and the `GET /generate/diffResume` endpoint with format variants |
| 15 | `docs/FEATURES.md` adds a bullet for Compare with backup | ✓ VERIFIED | `docs/FEATURES.md` — bullet under "Apply suggestions to an existing resume" section |
| 16 | `pre_commit_code_health_safeguard` is clean; `npm test` and `npm run build` are clean | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `npm test` → 225/225 pass across 19 files; `npm run build` → tsc clean; `pre_commit_code_health_safeguard` → `quality_gates: passed`; the broader "manual runbook in RESUME_DIFF_VIEWER_PLAN.md steps 1-5 executed and observed" portion of the success criterion needs human confirmation |

**Score:** 14/16 truths verified (2 present + wired, behaviour unexercised)

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `services/diffUtil.ts` | Exports canonicalize, resumesAreEqual, unifiedDiffText, summariseJsonDiff, generateInlineDiff | ✓ VERIFIED | 155 lines; all 5 exports present; imports `structuredPatch, diffWords` from `diff` v9.0.0 |
| `services/diffUtil.test.ts` | 17 tests for diffUtil (4 new in plan 04) | ✓ VERIFIED | 17 tests pass: 3 canonicalize, 3 resumesAreEqual, 5 unifiedDiffText, 3 summariseJsonDiff, 4 generateInlineDiff |
| `services/fixSuggestionsService.ts` | Imports resumesAreEqual from ./diffUtil; local copies removed | ✓ VERIFIED | Single import line; no local `function canonicalize/resumesAreEqual` |
| `services/fixSuggestionsService.test.ts` | Updated import path | ✓ VERIFIED | `await import('./diffUtil.js')` pattern preserved; tests pass |
| `services/backupService.ts` | `latestBackupVersion(backupsRoot)` added; `nextBackupVersion` unchanged | ✓ VERIFIED | Both exports present; pure read function |
| `routes/generate.ts` | GET /diffResume with all format variants, 404/400 named errors, allowlist reuse | ✓ VERIFIED | 1375 lines; route registered; `DiffResumeFormat` includes 'word-diff' |
| `routes/generate.test.ts` | Describe block for GET /generate/diffResume (10+ tests) | ✓ VERIFIED | 11 occurrences of `diffResume` in test file; 10 diffResume tests pass |
| `public/suggestions.html` | Diff modal scaffold + Hunks/Full file tabs | ✓ VERIFIED | `#suggestions-diff-modal` with toggle div + two `button` tabs |
| `public/suggestions.js` | `openDiffModal`/`closeDiffModal`/toggle wiring | ✓ VERIFIED | 570 lines; `switchToHunksView`/`switchToFullView` defined; click handlers wired |
| `public/style.css` | .diff-removed/.diff-added/.diff-context/.word-removed/.word-added rules; modal max-width 640px; .diff-view-toggle | ✓ VERIFIED | All 5 rules present, scoped under `.popover-body .diff-pre`; `max-width: 640px` rule for `#suggestions-diff-modal` |
| `README.md` | Diff paragraph + endpoint doc | ✓ VERIFIED | Compare-with-backup paragraph + format variants |
| `docs/FEATURES.md` | Compare with backup bullet | ✓ VERIFIED | Bullet present in Apply Suggestions section |
| `package.json` | `diff@>=8.0.3` runtime dep | ✓ VERIFIED | `"diff": "^9.0.0"` in dependencies |
| `package-lock.json` | Locked dep graph | ✓ VERIFIED | Committed alongside |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `services/diffUtil.ts` | `diff` npm package | `import { structuredPatch, diffWords } from 'diff'` | ✓ WIRED | Both functions called in unifiedDiffText / generateInlineDiff |
| `services/fixSuggestionsService.ts` | `services/diffUtil.ts` | `import { resumesAreEqual } from './diffUtil'` | ✓ WIRED | Function used in the no-op comparison logic |
| `routes/generate.ts` | `services/diffUtil.ts` | `import { unifiedDiffText, summariseJsonDiff, generateInlineDiff }` | ✓ WIRED | All three functions called in `diffResumeHandler` |
| `routes/generate.ts` | `services/backupService.ts` | `import { latestBackupVersion }` | ✓ WIRED | Called in `resolveBackupVersion` when version is omitted |
| `public/suggestions.js` | `/generate/diffResume` | `fetch(url)` in `fetchDiff` and `format=word-diff` fetch in toggle | ✓ WIRED | Two fetch calls; response handled and rendered into DOM |
| `public/suggestions.html` modal | `public/style.css` rules | ID-based selectors (`#suggestions-diff-modal`) and class-based (`.diff-view-toggle`) | ✓ WIRED | Modal element + tabs + close button all styled |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| `public/suggestions.js` modal | `lastUnifiedDiff` / `cachedWordDiffHtml` | `fetch('/generate/diffResume?…')` | ✓ Yes — backed by `fs.readFileSync` of on-disk JSON files | ✓ FLOWING |
| `routes/generate.ts` `diffResumeHandler` | `response.unifiedDiff` / `response.summary` / `response.wordDiffHtml` | `fs.readFileSync(v.backupFile)` + `fs.readFileSync(v.currentFile)` | ✓ Yes — real disk reads, not stub | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| `structuredPatch` and `diffWords` resolve from installed `diff` package | `node -e "const d = require('diff'); console.log(typeof d.structuredPatch, typeof d.diffWords)"` | `function function` | ✓ PASS |
| Full test suite | `npm test` | 225/225 pass across 19 files | ✓ PASS |
| TypeScript build | `npm run build` | tsc clean (no output, exit 0) | ✓ PASS |
| diffUtil multi-hunk test exists and passes | `npm test -- --run -t "produces separate hunks for multiple disjoint changes"` | 1 test passes (224 skipped) | ✓ PASS |
| Route test suite | `npm test -- --run -t diffResume` | 10 tests pass (215 skipped) | ✓ PASS |
| Code Health safeguard | `pre_commit_code_health_safeguard` | `quality_gates: passed`, no results array entries | ✓ PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` declared by any PLAN; no conventional probe discovery applied (this is not a migration / CLI phase).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ---------- | ----------- | ------ | -------- |
| DIFF-01 | 01-03 | User can complete round trip (generate → apply → compare → close) | ⚠️ NEEDS HUMAN | End-to-end browser flow not testable without running server + DOM; wiring code present |
| DIFF-02 | 01-02, 01-04 | GET /generate/diffResume response shape + format variants | ✓ SATISFIED | 10 diffResume route tests pass; response shape `{ jobDir, backupVersion, backupPath, currentPath, unifiedDiff?, summary?, wordDiffHtml? }` matches plan |
| DIFF-03 | 01-02 | Route reuses safeRealpath + ensureJobsRootRealpath allowlist; path-traversal rejected | ✓ SATISFIED | `validateDiffResumeRequest` → `resolveAllowedJobDir` wraps both helpers; traversal test (jobDir=../etc) returns 400 |
| DIFF-04 | 01-02 | `version` validated against `/^v\d+$/`; v0/v-1/vabc rejected; omitted defaults to latestBackupVersion | ✓ SATISFIED | `parseVersionString` matches the regex; 3 invalid-version tests pass; `resolveBackupVersion` falls back to `latestBackupVersion` when `queryVersion` empty |
| DIFF-04b | 01-02 | 404 with `{ error: 'Backup not found' \| 'Resume not found', jobDir, version }`; 400 with `jobDir required` / `invalid version` | ✓ SATISFIED | `diffResumeHandler` returns `includeLocator = err === 'Backup not found' \|\| err === 'Resume not found' \|\| err === 'invalid version'` and includes jobDir/version in those responses |
| DIFF-05 | 01-01, 01-04 | diffUtil exports the 4 base functions + generateInlineDiff | ✓ SATISFIED | 5 exports present; tests pass; originally noted "uses local 'common prefix + change block' algorithm" — plan 04 replaced this with the `diff` library's `structuredPatch`, which is the well-tested-library path the constraints permit |
| DIFF-05b | 01-01 | fixSuggestionsService imports resumesAreEqual from ./diffUtil; no other callers of resumesAreEqual/canonicalize | ✓ SATISFIED | Single import; grep shows no local `function canonicalize` / `function resumesAreEqual` in fixSuggestionsService; no other callers of `canonicalize` in `services/` |
| DIFF-06 | 01-02 | `latestBackupVersion(backupsRoot): number \| null` in backupService | ✓ SATISFIED | Function present; returns `null` when no `v*` directories exist |
| DIFF-07a | 01-01, 01-04 | diffUtil.test.ts covers the contract | ✓ SATISFIED | 17 tests pass — covers parity, identical/diff outputs, 30 KB perf smoke, multi-hunk, word-diff |
| DIFF-07b | 01-02 | routes/generate.test.ts covers happy path, 404s, 400s, traversal, format variants | ✓ SATISFIED | 10 diffResume tests pass |
| DIFF-08a | 01-03, 01-04 | suggestions.html adds hidden modal scaffold with header, body, close button | ✓ SATISFIED | `#suggestions-diff-modal` present with `.popover.hidden`, header `<span id="suggestions-diff-title">`, `<pre id="suggestions-diff-pre">`, close button, diff-view-toggle, and side panel |
| DIFF-08b | 01-03, 01-04 | suggestions.js rewires showResult; openDiffModal/closeDiffModal/toggle wired | ✓ SATISFIED | `trigger.addEventListener('click', () => openDiffModal(backupVersion, trigger))`; `openDiffModal`/`closeDiffModal`/`switchToHunksView`/`switchToFullView` defined; Full file tab lazy-fetches format=word-diff and caches |
| DIFF-08c | 01-03, 01-04 | CSS additions reusing .popover / .popover-body | ✓ SATISFIED | All rules scoped under `.popover-body .diff-pre`; modal widened to 640px |
| DIFF-09a | 01-03 | README documents the in-app diff and endpoint | ✓ SATISFIED | Compare-with-backup paragraph present; format variants documented |
| DIFF-09b | 01-03 | FEATURES.md adds the bullet | ✓ SATISFIED | Bullet present |
| DIFF-10 | 01-03, 01-04 | Code Health safeguard clean; npm test + build clean; manual runbook observed | ⚠️ NEEDS HUMAN | All three automated checks green; the manual runbook in `docs/plans/RESUME_DIFF_VIEWER_PLAN.md` §"Manual runbook" steps 1-5 needs human observation in the browser |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| (none) | — | — | — | No TBD/FIXME/XXX markers; no console.log-only implementations; no empty `return {}` stubs; no hardcoded empty data sources; all new state has a real fetch source |

### Human Verification Required

Two categories need human eyes — the round-trip browser flow (DIFF-01) and the manual runbook (DIFF-10) including visual fidelity of the new CSS, modal width, and Hunks/Full file toggle behaviour.

1. **End-to-end round trip (DIFF-01)** — generate → apply suggestions → click Compare with backup → confirm multi-hunk diff with red/green line coloring → close via button and click-outside.
2. **Manual runbook (DIFF-10)** — open modal in browser, confirm: (a) multiple focused hunks with red/green coloring instead of one giant block, (b) path summary column readable at 640px without wrapping, (c) Hunks/Full file tabs swap views correctly with lazy word-diff load and cache invalidation on new modal open.

### Gaps Summary

No gaps blocking goal achievement. Two `human_needed` items (DIFF-01 round trip and DIFF-10 manual runbook) are the natural hand-off to the developer for browser confirmation; the wiring and automated checks are all green. The plan-04 deviation (test fixture adjusted for `context=3` semantics) is documented in `01-04-SUMMARY.md` and does not affect the production behaviour.

---

_Verified: 2026-07-18T02:25:30Z_
_Verifier: gsd-verifier (inline)_
