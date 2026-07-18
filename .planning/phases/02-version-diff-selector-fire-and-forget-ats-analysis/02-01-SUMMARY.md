---
phase: "02"
plan: "01"
subsystem: version-diff-selector
tags:
  - UI
  - diff-viewer
  - version-selector
key-files:
  - services/backupService.ts
  - routes/generate.ts
  - public/index.html
  - public/suggestions.js
  - public/style.css
metrics:
  endpoints_added: 2
  ui_elements_added: 1
  css_rules_added: 3
---

# Plan 02-01 — Version-diff-selector panel + Phase 1 UI tweaks

## What was built

Added a version-diff-selector panel to the main UI and fixed two Phase 1 UI nits. The panel lets the user pick any job folder and diff any two backup versions, reusing the existing diff modal.

## Commits

| Task | Description | Commit |
|------|-------------|--------|
| Task 1 | Add `listBackupVersions` + `listJobDirs` helpers + GET endpoints | feat(02-01) |
| Task 2 | Add version-diff-selector panel to index.html | feat(02-01) |
| Task 3 | Wire version-diff-selector to existing diff modal | feat(02-01) |
| Task 4 | Phase 1 UI tweaks — JD textarea + line numbers | feat(02-01) |

## Changes

- **services/backupService.ts** — added `listBackupVersions(backupsRoot): number[]` (sorted ascending) and `listJobDirs(jobsRoot): string[]` (sorted alphabetically)
- **routes/generate.ts** — added `GET /generate/listJobDirs` (returns `{dirs: string[]}`) and `GET /generate/listBackups?jobDir=…` (returns `{versions: number[]}`)
- **public/index.html** — added version-diff-panel section below jd-search-panel with folder autocomplete input and two version dropdowns; increased jobDescription textarea rows from 14 to 20
- **public/suggestions.js** — modified `openDiffModal` to accept optional `explicitSlug` third argument; added initialization for version-diff-selector panel (fetch job dirs on load, populate version dropdowns on folder change, call openDiffModal with explicit slug on Diff button click)
- **public/style.css** — added `.diff-line-num`, `.diff-line-num--changed`, `.diff-pre` CSS rules; added `.toast` and `.toast.hidden` CSS rules

## Deviations

None.

## Self-Check

PASSED
