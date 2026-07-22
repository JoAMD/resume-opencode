---
phase: "03"
plan: "02"
type: execute
completed_at: "2026-07-21"
status: complete
---

# Plan 03-02: 4-Step Status Panel for Permalink Reload Mid-Chain

## What shipped

### Server (`routes/generate.ts`)

- `TaskResult` type extended with optional `step: number` and
  `stepLabel: string`; the in-memory `taskMap` record type makes both
  required after task creation.
- `STEP_LABELS: Record<number, string>` constant and exported
  `setTaskStep(taskId, step)` helper. Step values: 1=generating, 2=running
  ATS, 3=applying suggestions, 4=final ATS.
- `taskMap.set` call sites updated to populate `step` + `stepLabel` at
  every entry (`POST /generate/`, `POST /generate/applySuggestions`,
  `runApplySuggestionsBackground`, `POST /generate/runAtsBackground`,
  `runAtsBackground`).
- `GET /generate/task/:taskId` response now includes `step` and
  `stepLabel`.

### Client (`public/index.html` + `public/suggestions.js` + `public/style.css`)

- New `<section id="status-panel">` with 4 `<li class="status-step">` rows,
  one per `STEP_LABELS` entry. Each row has an `<span class="inline-spinner">`
  and a `<span class="status-step-label">`.
- New `recordTaskId(slug, taskId)`, `loadTaskChain(slug)`,
  `clearTaskChain(slug)`, `renderStatusPanel(maxStep, allComplete)`,
  `pollChain(slug, taskIds)`, and `startStatusPolling(slug)` functions in
  the inline script.
- `startStatusPolling` is invoked from `runPrefill` (Plan 01's helper) on
  successful prefill. It reads the chain, polls each `taskId`, updates
  the panel with the max step across the chain, and clears the chain
  when all tasks are complete.
- `taskId_<slug>` and `taskChain_<slug>` sessionStorage keys written from
  three sites: the main generation success, the auto-apply
  `POST /generate/applySuggestions` success, and the
  `POST /generate/runAtsBackground` success.
- `apply-task-started` event listener (inline script) consumes the event
  dispatched by `public/suggestions.js` and records the taskId. The
  listener reads both `taskId` and `slug` from the event detail (slug is
  not in scope from the inline script).
- `open-diff-for-latest` event listener (inline script) fetches
  `GET /generate/listBackups?jobDir=<slug>`, picks the max version, and
  calls `globalThis.openDiffModal(latest, null, slug)`. Has a 2-second
  poll for `openDiffModal` to load if suggestions.js is still bootstrapping.
- `public/suggestions.js`:
  - `applyBtn` click handler dispatches
    `CustomEvent('apply-task-started', { detail: { taskId, slug } })`
    after the apply-suggestions `taskId` is received.
  - `globalThis.openDiffModal = openDiffModal;` at the end of the file
    exposes the existing function for the inline script.
- `public/style.css`:
  - `.status-panel` / `.status-panel.hidden` / `.status-panel h3` for
    the section background and toggle.
  - `.status-steps` / `.status-step` for the four rows; default state is
    dimmed grey.
  - `.status-step[data-active="true"]` lights the active step white and
    shows the spinner.
  - `.status-step[data-done="true"]` paints completed steps green and
    shows a checkmark via `::before`.
  - `.status-step .inline-spinner { display: none; }` keeps the spinner
    hidden by default.

### Tests

- New `describe('Task step tracking', ...)` block in
  `routes/generate.test.ts` (3 tests):
  - Asserts `setTaskStep` is exported.
  - Asserts a new `POST /generate/` task has `step: 1` and
    `stepLabel: 'Generating resume + cover letter'` in the polling
    response.
  - Asserts `setTaskStep(taskId, 3)` mutates the record and the next
    `GET /generate/task/:taskId` returns the new step + label.

## Verification

- `npx vitest run routes/generate.test.ts` — passes (41 tests; 3 new).
- `npm test` — 248 tests pass, no regressions.
- `npm run build` — clean.
- Identifier grep (per plan verify step) confirms `status-panel`,
  `status-step`, `recordTaskId`, `loadTaskChain`, and
  `open-diff-for-latest` are present in `public/index.html`;
  `globalThis.openDiffModal` and `apply-task-started` are present in
  `public/suggestions.js`; `status-panel` and `status-step` are present
  in `public/style.css`.

## Manual runbook (deferred to a human-verify pass)

Captured for the Phase 3 UAT; the non-blocking steps depend on a running
server + OpenCode backend:

1. Start a generation; mid-generation, copy the permalink URL, open a
   new tab, paste it. Confirm the status panel shows step 1 with a
   spinner. Refresh the tab; confirm the chain continues from the same
   taskId.
2. Wait for the auto-chain to fire (apply suggestions + ATS); confirm
   the status panel advances through steps 3 and 4 with descriptive
   labels and inline spinners next to the pending artifacts. When the
   chain completes, the status panel closes.
3. Reload the permalink after the chain completes; confirm the status
   panel does NOT appear (D-26) and the result block is shown instead.
4. Click **Compare with latest backup** from the result block; confirm
   the diff modal opens.
5. Stop the server mid-generation; reload the permalink; confirm the
   "Server restarted — chain lost" toast appears and the status panel
   closes.

## Deviations from the plan

- The plan proposed `setTaskStep` in the order of "in process step-2
  bump from `executeGeneration`". Implementation kept the design where
  step transitions are driven by separate background tasks (apply
  suggestions at step 3, ATS background at step 4). The
  `executeGeneration` signature is unchanged, so no in-process step-2
  bump is needed.
- The plan's `runApplySuggestionsBackground` reference in the action
  list had a typo (`runApplySuggestionsBackground` instead of
  `runApplySuggestionsBackground`); the actual symbol is
  `runApplySuggestionsBackground` (singular `Suggestion` not
  `Suggestions` in the function name). The taskMap.set updates land on
  the correct function.
- The plan's "Compare with latest backup" implementation suggested a
  fallback that polls for `globalThis.openDiffModal`; the final
  implementation waits up to 2 seconds (in 50ms increments) before
  giving up with a toast.

## Self-Check

- [x] All tasks executed.
- [x] Each task committed individually (1 commit on
  `feat/permalink-prefill` for this plan; Plan 01 was 3 commits).
- [x] `npm test` is clean (248 tests, 0 failures).
- [x] `npm run build` is clean.
- [x] Code Health safeguard: `pre_commit_code_health_safeguard` is not
  available in this runtime (no codescene CLI on `PATH`). Tests + build
  + manual review of the diff is the substitute.
- [x] No modifications to shared orchestrator artifacts.
