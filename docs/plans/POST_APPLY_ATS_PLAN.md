# Post-Apply ATS Analysis + Backup ATS Files — Plan

## Goal

Two related changes on a new worktree `feat/post-apply-ats` off `main`:

1. After `applySuggestions` completes successfully, the server runs ATS
   analysis on the *new* resume and surfaces the result in the same task
   response. The UI's existing `alert()` (same shape as the standalone
   "Run ATS Analysis" button) shows the fresh coverage.
2. When the resume backup is created, copy `ats-analysis.md` and
   `ats-analysis.json` into the `backups/vN/` folder alongside the resume
   files, so a backup is a self-contained snapshot of the resume + its
   analysis.

## Decisions

- **Trigger:** run after a *real* (non-no-op) apply. Skip on no-op and on
  apply error. Best-effort: a failed analysis never fails the apply.
- **Transport:** extend the existing `applySuggestions` background task
  (`taskMap` + `runApplySuggestionsBackground` + `GET /generate/task/:taskId`).
  No new task, no new poll, no new endpoint. The existing
  `waitForTask` in `public/suggestions.js:247` returns the new fields for
  free.
- **UI:** `alert()` with the same shape as the existing
  `public/index.html:647-648` "Run ATS Analysis" button.
- **Backup scope:** only the `'resume'` kind. Cover-letter and `both`
  backups stay unchanged.

## Files

### `services/backupService.ts`

- Add `'ats-analysis.md'` and `'ats-analysis.json'` to
  `RESUME_BACKUP_FILES`. `BACKUP_FILES_BY_KIND['resume']` picks them up
  via spread; no other code changes in this file.

### `routes/generate.ts`

- `runApplySuggestionsBackground` (line 798): after `applySuggestions`
  resolves successfully, call
  `executeATSAnalysis({ folderPath: input.jobDir, resumeJSON: result.resume, lastGeneratedResumeJSON: result.resume, modelSelect: input.modelSelect })`.
  - Success → add `atsAnalysis: { coveragePercent, missingFromResume, includedInResume, source }` and `atsStatus: 'complete'` to the task result.
  - Failure (catch + log) → `atsAnalysis: null`, `atsStatus: 'failed'`, status stays `'complete'`.
- `NoOpResultError` branch (line 816): add `atsStatus: 'skipped'`, `atsAnalysis: null` to the no-op result so the UI sees a uniform shape.
- `taskMap` value type: add optional `atsAnalysis: { coveragePercent, missingFromResume, includedInResume, source } | null` and `atsStatus: 'complete' | 'failed' | 'skipped' | undefined`.

### `public/suggestions.js`

- `handleApplySuccess` (line 332):
  - `atsStatus === 'complete'` → `alert(\`ATS Coverage: ${atsAnalysis.coveragePercent}%\n\nMissing keywords: ${missing}\`)` matching `public/index.html:647-648`.
  - `atsStatus === 'failed'` → status line: "Done. Post-apply ATS analysis failed." (no alert; the user can re-run it manually).
  - `atsStatus === 'skipped'` (or undefined, for the no-op case where `handleApplyError` fires) → no extra message.

### Tests

- `services/backupService.test.ts`: extend "creates v1 when no backups dir
  exists" to seed `ats-analysis.md` + `ats-analysis.json` in the job dir
  and assert they appear in `result.files`. Add a "skips missing
  analysis files" case.
- `routes/generate.test.ts`: three new cases behind the existing
  `executeATSAnalysis` mock:
  1. Analysis success → task result has `atsAnalysis.coveragePercent` and `atsStatus: 'complete'`.
  2. Analysis throws → task result has `atsAnalysis: null` and `atsStatus: 'failed'`, status is still `'complete'`.
  3. No-op path → no analysis runs; `atsStatus: 'skipped'`.

### Docs (per AGENTS.md)

- `docs/FEATURES.md`: extend the apply-suggestions section with: "After a
  successful apply, the server runs ATS analysis on the new resume and
  includes the result in the same task response (`atsAnalysis` +
  `atsStatus`). The UI shows coverage in an alert matching the standalone
  Run ATS Analysis button. On a no-op or analysis failure, apply still
  succeeds and `atsStatus` is `'skipped'` or `'failed'` respectively."
- `README.md`: add a sentence to the AI analysis bullet noting that the
  post-generation analysis also runs after every successful apply.

## Workflow

1. New worktree: `git worktree add -b feat/post-apply-ats …`
2. Implement + run `npm test` after each step.
3. `codescene_pre_commit_code_health_safeguard` before commit.
4. `codescene_analyze_change_set` with `base_ref=main` before opening PR.
5. Address any Code Health regressions before declaring done.

## Out of scope

- Re-running ATS analysis in the background after the user closes the tab (fire-and-forget on the server).
- Showing the post-apply ATS result in any persistent panel — it's alert-only, matching the existing button.
- Covering cover-letter and `both` backup kinds with the analysis files.
