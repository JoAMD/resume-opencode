---
plan: 01-02
phase: 01-resume-json-diff-viewer
wave: 2
status: complete
commits:
  - 5723b12
requirements:
  - DIFF-02
  - DIFF-03
  - DIFF-04
  - DIFF-04b
  - DIFF-06
  - DIFF-07b
---

# Plan 01-02 — `GET /generate/diffResume` route + `latestBackupVersion`

## Outcome

Added the read-only `GET /generate/diffResume` route and the supporting `latestBackupVersion(backupsRoot): number | null` helper. The route returns the unified diff between a chosen backup version and the on-disk resume, plus a `summary.{changedPaths, addedKeys, removedKeys}` list, when both files exist on disk. The route is path-allowlisted, validates inputs, defaults to the latest backup when `version` is omitted, and accepts `format=unified|summary|both` (default `both`). 10 new vitest cases cover the full surface.

## Files Changed

- `services/backupService.ts` — added `latestBackupVersion(backupsRoot)` as a pure read (`fs.existsSync` + `fs.readdirSync` only, no `mkdirSync` / `copyFileSync`). Mirrors the `nextBackupVersion` `/^v(\d+)$/` parse so the two helpers agree on directory naming. Returns `null` when the directory is missing or contains no `vN` entries.
- `routes/generate.ts` — added imports for `unifiedDiffText` and `summariseJsonDiff` from `../services/diffUtil` and for `latestBackupVersion` from `../services/backupService`. Added `DiffResumeFormat`, `DiffResumeValidated`, `parseVersionString`, `resolveAllowedJobDir`, `resolveBackupVersion`, `resolveDiffFormat`, `validateDiffResumeRequest`, and `diffResumeHandler`. Registered `router.get('/diffResume', diffResumeHandler)` directly under `/generate` (no `requireAdminAuth` wrap, matching the rest of the `/generate` sub-router per `server.ts:300`).
- `routes/generate.test.ts` — added the `latestBackupVersion` mock to the `vi.mock('../services/backupService', ...)` block (new mock — the file did not previously mock this module). Appended a new `describe('GET /generate/diffResume', ...)` block with 10 cases.

## Behaviour

| Input | Status | Body |
| --- | --- | --- |
| `jobDir=shopify-swe&version=v1` (both files exist) | 200 | `{ jobDir, backupVersion: 1, backupPath, currentPath, unifiedDiff, summary }` |
| `jobDir=shopify-swe&version=v1&format=unified` | 200 | as above, no `summary` |
| `jobDir=shopify-swe&version=v1&format=summary` | 200 | as above, no `unifiedDiff` |
| `jobDir=shopify-swe&version=v1&format=garbage` | 400 | `{ error: 'invalid format' }` |
| `jobDir=shopify-swe` (no `version`) | 200 | uses `latestBackupVersion(backupsRoot)`; 404 with `Backup not found` if no backups |
| missing `jobDir` | 400 | `{ error: 'jobDir required' }` |
| `version=v0\|v-1\|vabc` | 400 | `{ error: 'invalid version', jobDir, version }` |
| `jobDir=../etc` (escapes jobs root) | 400 | `{ error: 'jobDir escapes jobs root' }` |
| `safeRealpath` returns null | 500 | `{ error: 'Failed to resolve job directory' }` |
| missing backup file | 404 | `{ error: 'Backup not found', jobDir, version }` |
| missing current file | 404 | `{ error: 'Resume not found', jobDir, version }` |

`version` regex is tightened to `/^v([1-9]\d*)$/` (no leading zeros, must be ≥ 1). The "must be 1" check is now in the regex, not a separate `n < 1` branch — fewer code paths to verify.

## Verification

- `npx vitest routes/generate.test.ts -t diffResume` — 10/10 pass.
- `npm test` — 220/220 pass across 19 files (no regressions).
- `npm run build` — clean.
- `pre_commit_code_health_safeguard` on the repo — `quality_gates: passed`. The earlier `validateDiffResumeRequest` (CC=15) was refactored into `resolveAllowedJobDir` + `resolveBackupVersion` + `resolveDiffFormat` + a thin orchestrator (CC≈7) so the function-level smell and the module mean complexity stay under threshold. `parseVersionString` was simplified to a single regex match (no chained branches). Per-file `verdict` for all three modified files: no `degraded` flag.
- `grep -n 'latestBackupVersion' services/backupService.ts` — exports the new function.
- `grep -n "router.get('/diffResume'" routes/generate.ts` — route registered.
- `grep -n 'unifiedDiffText\|summariseJsonDiff\|latestBackupVersion' routes/generate.ts` — all three imports + uses present.

## Refactor Notes

First-pass `validateDiffResumeRequest` tripped Code Health on CC=15. Decomposed into:

- `resolveAllowedJobDir(queryJobDir)` — handles the path allowlist (`safeRealpath` + `pathIsInsideDir` + `ensureJobsRootRealpath`).
- `resolveBackupVersion(backupsRoot, queryVersion)` — handles explicit `version` vs `latestBackupVersion` default.
- `resolveDiffFormat(raw)` — validates the `format` query parameter against a `ReadonlySet<DiffResumeFormat>`.
- `parseVersionString(raw)` — single regex match `/^v([1-9]\d*)$/` enforces "positive integer prefixed with v" without a second branch.
- `validateDiffResumeRequest` is now a thin orchestrator that chains the three resolvers and runs the two `existsSync` checks inline.

After refactor, all four helpers are CC ≤ 5; the orchestrator is CC ≈ 7. Module mean complexity stays under 4.0.

## Hand-off to Plan 3

Plan 03 (UI) can now call `GET /generate/diffResume?jobDir=<slug>&version=v${backupVersion}` from `public/suggestions.js`'s `openDiffModal` and render the `unifiedDiff` into a `<pre>` and `summary.changedPaths` as a bullet list. The route returns 200 on success, 404 on missing files, 400 on bad input — all of which the UI can handle with a small `try/catch` or `response.ok` check.
