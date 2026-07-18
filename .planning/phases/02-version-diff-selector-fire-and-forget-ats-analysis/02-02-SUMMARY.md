---
phase: "02"
plan: "02"
subsystem: auto-chain
tags:
  - fire-and-forget
  - auto-apply
  - ATS
  - background-tasks
key-files:
  - routes/generate.ts
  - public/index.html
  - public/style.css
metrics:
  endpoints_added: 1
  ui_elements_added: 2
  polling_functions_added: 2
---

# Plan 02-02 — Auto-chain: generate → applySuggestions → ATS

## What was built

Implemented the fire-and-forget auto-chain: after resume generation completes successfully, automatically fire applySuggestions in background (if checkbox checked), then after applySuggestions completes, automatically fire ATS analysis in background. Shows a toast when ATS coverage is ready.

## Commits

| Task | Description | Commit |
|------|-------------|--------|
| Task 1 | Add auto-apply suggestions checkbox | feat(02-02) |
| Task 2 | Create runAtsBackground + POST /runAtsBackground | feat(02-02) |
| Task 3 | Wire auto-chain in generateResume | feat(02-02) |
| Task 5 | Add ATS toast notification | feat(02-02) |

## Changes

- **public/index.html** — added "Auto-apply suggestions after generation" checkbox (checked by default, persisted in sessionStorage); added `pollApplySuggestionsThenAts` function to poll applySuggestions completion then fire ATS; added `pollAtsCompletion` function to poll ATS completion and show toast; added `#ats-toast` div
- **routes/generate.ts** — added `runAtsBackground(taskId, input)` function that runs ATS analysis in background, saves `ats-analysis.json` and `ats-analysis.md`, updates taskMap with coveragePercent; added `POST /generate/runAtsBackground` route that accepts `{jobDir, atsKeywords, resumeJSON}`, returns `{taskId}` immediately, fires background ATS
- **public/style.css** — added `.toast` and `.toast.hidden` CSS rules for toast notification styling

## Deviations

None.

## Self-Check

PASSED
