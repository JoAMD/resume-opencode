---
plan: 01-03
phase: 01-resume-json-diff-viewer
wave: 3
status: complete
commits:
  - b62f9d9
requirements:
  - DIFF-01
  - DIFF-08a
  - DIFF-08b
  - DIFF-08c
  - DIFF-09a
  - DIFF-09b
  - DIFF-10
---

# Plan 01-03 — In-app diff modal + docs sync

## Outcome

The "Backup: …" label in the suggestions panel is now a click-to-compare control. Clicking it opens a modal that fetches `GET /generate/diffResume?jobDir=<slug>&version=v<N>&format=both` (Plan 02's route) and renders the unified diff in a `<pre>` and `summary.changedPaths` as a bullet list. The modal reuses the existing `.popover` / `.popover-body` classes; no new CSS framework, no new dependencies. `README.md` and `docs/FEATURES.md` are updated in the same commit per AGENTS.md §3.

## Files Changed

- `public/suggestions.html` — new `<div id="suggestions-diff-modal" class="popover hidden" role="dialog" aria-label="Resume diff">` block appended after `#suggestions-file-popover`. Six new IDs: `suggestions-diff-modal`, `suggestions-diff-title`, `suggestions-diff-close`, `suggestions-diff-pre`, `suggestions-diff-summary`, `suggestions-diff-paths`, plus `suggestions-diff-empty`. Hidden by default.
- `public/suggestions.js` — `fetchSuggestionsTemplate` extended to also clone the diff modal. `initSuggestionsPanel` signature updated to accept `{ tplContent, popover, diffModal }`; the new modal is appended to `document.body` next to the file popover. New functions: `openDiffModal(version, trigger)`, `closeDiffModal()`, and a small `renderDiffPaths(paths)` helper. `showResult` now creates a `<button class="button-link">` that calls `openDiffModal(backupVersion)`. `handleApplySuccess` passes `backupVersion` through. Module-scope `diffModalTrigger` tracks the opener for focus restore. Close button + click-outside both close the modal.
- `public/style.css` — additive block (~55 lines) namespaced under `.popover-body`: `.diff-header`, `.diff-body`, `.diff-pre`, `.diff-summary` (+ `h3`/`ul`/`li`), and a top-level `.button-link` (transparent, underlined, focus-visible ring). The existing `.popover` and `.popover-body` rules at lines 303-346 are unchanged.
- `README.md` — two new paragraphs under "Apply suggestions to an existing resume" (after line 152) documenting the in-app diff and the `GET /generate/diffResume` endpoint with its format variants and allowlist.
- `docs/FEATURES.md` — new bullet at the end of the "Apply suggestions to an existing resume" section ("Compare with backup") linking to the README and listing the endpoint contract.

## Verification

- `npm test` — 220/220 pass across 19 files.
- `npm run build` — clean.
- `pre_commit_code_health_safeguard` on the repo — `quality_gates: passed` (no findings). The first refactor of `openDiffModal` and `fetchSuggestionsTemplate` tripped Code Health on CC=9 and a complex conditional; both were refactored (`openDiffModal` split into `fetchDiff` + `renderDiffResponse` + a thin orchestrator; the `!tpl || !popover || !diffModal` check rewritten as `[…].every(Boolean)`). After refactor, both are under threshold.
- `grep -c 'openDiffModal\|closeDiffModal' public/suggestions.js` — 5 matches (≥2 required).
- `grep -c 'suggestions-diff-' public/suggestions.html` — 7 matches (≥6 required).
- `grep -c 'diff-header\|diff-body\|diff-pre\|diff-summary' public/style.css` — 7 matches (≥4 required).
- `grep -c 'Compare with backup\|diffResume' README.md docs/FEATURES.md` — 2 matches per file (≥2 required).

## Manual Runbook Output (per `RESUME_DIFF_VIEWER_PLAN.md` §"Manual runbook")

Run against a job folder at `jobs/(already applied - repost) quartex-full-stack-engineer-adelaide-2026-07-03-19-17-49-735-opencode-gominimax-m27`. The fixture was created by copying the existing `structured-output.json` into `backups/v1/structured-output.json` and appending " (updated by runbook)" to the `summary` field of the on-disk current — then restored after the runbook completed.

| Step | Request | Result |
| --- | --- | --- |
| 4c happy path | `curl -s "http://localhost:3001/generate/diffResume?jobDir=<encoded>&version=v1" \| jq` | HTTP 200; `backupVersion: 1`; `summary.changedPaths: ["summary"]`; `unifiedDiffLength: 8971` |
| 4c `format=unified` | `&format=unified` | HTTP 200; `unifiedDiff` present, `summary` absent (`has("unifiedDiff") = true`, `has("summary") = false`) |
| 4c `format=summary` | `&format=summary` | HTTP 200; `summary` present, `unifiedDiff` absent (`has("unifiedDiff") = false`, `has("summary") = true`) |
| 4d UI smoke | `curl -sS "http://localhost:3001/suggestions.html" \| tail` | served the new `<div id="suggestions-diff-modal" …>` block with all six required IDs |
| 4e negative 404 | `&version=v999` | HTTP 404 (named error `Backup not found`) |
| extra 400 missing | no `jobDir` | HTTP 400 (`jobDir required`) |
| extra 400 bad version | `&version=v0` | HTTP 400 (`invalid version`) |
| extra 500 traversal | `&jobDir=../etc` | HTTP 500 (`Failed to resolve job directory` — `safeRealpath` returns null because `jobs/../etc` doesn't exist) |

The test fixture (`backups/v1/` folder and the modified current `structured-output.json`) was removed at the end of the runbook so the working tree is clean (`git status --short` shows no untracked changes under `jobs/`).

## Refactor Notes

- `openDiffModal` first landed at CC=9 (right at threshold; reported as `introduced`). Split into `fetchDiff(slug, version)` (pure HTTP call returning `{ ok, data }`), `renderDiffResponse(data)` (DOM updates), and a thin orchestrator (CC≈4).
- `fetchSuggestionsTemplate`'s `!tpl || !popover || !diffModal` was flagged as a "Complex Conditional". Replaced with `[tpl, popover, diffModal].every(Boolean)`.
- After refactor, the safeguard reports `quality_gates: passed` with zero findings.

## Hand-off to Verification

Phase 1 is complete. All three plans shipped, all 220 vitest cases pass, `npm run build` is clean, and the Code Health safeguard is clean across all modified files. The milestone gate (DIFF-10) is satisfied. The verifier (`/gsd-verify-work` or the auto-run verifier) can now run the full phase verification.
