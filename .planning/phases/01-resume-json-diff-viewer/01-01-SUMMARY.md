---
plan: 01-01
phase: 01-resume-json-diff-viewer
wave: 1
status: complete
commits:
  - 38bb4b2
requirements:
  - DIFF-05
  - DIFF-05b
  - DIFF-07a
---

# Plan 01-01 — Shared services/diffUtil

## Outcome

Created `services/diffUtil.ts` owning four named exports: `canonicalize`, `resumesAreEqual`, `unifiedDiffText`, `summariseJsonDiff`. The first two were moved verbatim out of `fixSuggestionsService.ts`; the second two are new. `fixSuggestionsService.ts` now imports `resumesAreEqual` from `./diffUtil` and the local copies are gone. The pre-existing `describe('resumesAreEqual')` block in `fixSuggestionsService.test.ts` was rewired to import from `./diffUtil.js`; all three of its cases still pass.

`unifiedDiffText` is a local "common prefix + suffix + middle hunk" implementation (~30 lines). It does not call `require('node:diff')` — that module is not a real Node built-in (see `.planning/research/DIFF_LIBRARY_NOTE.md`).

`summariseJsonDiff` is a small recursive walker with three accumulators (`changedPaths`, `addedKeys`, `removedKeys`). Object keys present in only one side are recorded as added/removed; equal-length arrays are walked element-by-element; mismatched arrays or scalar mismatches are recorded as a single `changedPaths` entry.

## Files Changed

- `services/diffUtil.ts` (new, 110 lines) — the four exports.
- `services/diffUtil.test.ts` (new, 12 cases) — pure-function tests, no mocks.
- `services/fixSuggestionsService.ts` — removed local `canonicalize` and `resumesAreEqual`; added `import { resumesAreEqual } from './diffUtil';`.
- `services/fixSuggestionsService.test.ts` — three dynamic imports rewritten to `./diffUtil.js`.

## Verification

- `npx vitest services/diffUtil.test.ts` — 12/12 pass.
- `npm test` — 210/210 pass across 19 files (no regressions).
- `npm run build` — clean (`tsc -p tsconfig.json`).
- `pre_commit_code_health_safeguard` on the repo — `quality_gates: passed`. `services/diffUtil.ts` is clean; the `fixSuggestionsService.ts` "degraded" reports are `change-type: unchanged` with `verdict: stable` (pre-existing smells surfaced because the file is in the diff, not introduced by this plan).
- `grep -n 'node:diff' services/diffUtil.ts` — no matches.
- `grep -n 'resumesAreEqual\|canonicalize' services/fixSuggestionsService.ts` — only the new import line; local definitions gone.

## Refactor Notes

The first pass of `diffUtil.ts` tripped Code Health on `walk` (CC=18) and `unifiedDiffText` (CC=14). Refactored to:

- `unifiedDiffText` split into `countCommonPrefix` / `countCommonSuffix` / inline hunk builder.
- `walk` split into `walkObjectDiff` / `walkArrayDiff` / `walk` dispatcher.
- `walkObjectDiff` further split into `pushRemovedKeys` / `pushAddedKeys` / `recurseSharedKeys` to keep CC ≤ 9.
- `prefix` and `acc` packed into a `WalkContext` record so the recursion helpers have object-only signatures.
- `LinePair` record groups `before` / `after` line arrays for the prefix/suffix counters.

These changes are internal; the public 4-export API is unchanged.

## Hand-off to Plan 2

Plan 02 can now `import { unifiedDiffText, summariseJsonDiff } from '../services/diffUtil';` in `routes/generate.ts`. The route handler reads `backups/v${version}/structured-output.json` and the on-disk `structured-output.json`, pretty-prints both with `JSON.stringify(_, null, 2)`, and passes them to `unifiedDiffText` and `summariseJsonDiff`.
