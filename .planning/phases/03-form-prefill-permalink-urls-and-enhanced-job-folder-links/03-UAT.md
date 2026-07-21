---
status: complete
phase: 03-form-prefill-permalink-urls-and-enhanced-job-folder-links
source: 03-CONTEXT.md
started: 2026-07-21T12:00:00Z
updated: 2026-07-21T12:00:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Permalink URL as href link
expected: When a resume is generated, a permalink URL is shown as a clickable <a href> element. The URL format should be: http://host/#job=<slug>
result: issue
reported: "looks a bit odd with the button UI, it would do better as a simple href"
severity: cosmetic

### 2. Permalink restores form state
expected: When loading a URL with #job=<slug> hash, the form is pre-filled with data from the job folder (job-description.txt, other-input.txt, full-jd.txt) and existing artifacts are shown
result: pass

### 3. Form prefill from job folder
expected: When entering a folder path in the Folder Path field and blurring, the form fields (job description, extra notes) are pre-filled from files in that folder
result: pass

### 4. Prefill confirm dialog
expected: If form fields are already filled when prefill triggers, a dialog asks "Keep existing or use loaded?"
result: pass

### 5. Enhanced result block - artifact links
expected: After generation (or loading permalink), result block shows: resume.pdf, cover-letter.pdf, cover-letter.txt, ats-analysis.md as clickable links
result: pass

### 6. Compare with latest backup
expected: Clicking "Compare with latest backup" opens a diff modal showing changes between current resume and most recent backup version
result: issue
reported: "Compare with latest backup gives toast: Diff modal not yet loaded. Try again in a moment. And on page load suggestions.js:685 Uncaught ReferenceError: openDiffModal is not defined"
severity: blocker

### 7. Quick-open all PDFs button
expected: A button that opens resume.pdf and cover-letter.pdf in separate tabs simultaneously
result: pass

### 8. Copy permalink button
expected: A copy button next to the permalink URL for easy sharing
result: pass

## Summary

total: 8
passed: 6
issues: 2
pending: 0
skipped: 0
blocked: 0

## Deferred Follow-Ups

- test: 4
  idea: "all the autofilling logic (from permalink and folder path), its missing the resume type dropdown"
  deferred_at: 2026-07-21

## Gaps

- gap_id: G-03-1
  truth: "Permalink URL shown as clickable <a href> element"
  status: failed
  reason: "User reported: looks a bit odd with the button UI, it would do better as a simple href"
  severity: cosmetic
  test: 1
  artifacts: []
  missing: []
  debug_session: ""

- gap_id: G-03-2
  truth: "Clicking 'Compare with latest backup' opens a diff modal showing changes between current resume and most recent backup version"
  status: failed
  reason: "User reported: Compare with latest backup gives toast 'Diff modal not yet loaded. Try again in a moment.' And on page load suggestions.js:685 Uncaught ReferenceError: openDiffModal is not defined"
  severity: blocker
  test: 6
  artifacts: []
  missing: []
  debug_session: ""
