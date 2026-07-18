---
status: diagnosed
phase: 02-version-diff-selector-fire-and-forget-ats-analysis
source:
  - .planning/phases/02-version-diff-selector-fire-and-forget-ats-analysis/02-01-SUMMARY.md
  - .planning/phases/02-version-diff-selector-fire-and-forget-ats-analysis/02-02-SUMMARY.md
started: 2026-07-18T00:00:00Z
updated: 2026-07-18T00:00:00Z
---

## Current Test

[testing paused — 1 issue diagnosed]

## Tests

### 1. Version-diff-selector panel loads job directories
expected: |
  Version-diff-selector panel appears below jd-search-panel. On page load, the folder
  autocomplete input fetches and displays available job directories from the server.
result: skipped
reason: "Deferred follow-up: works on laptop but not on mobile"

### 2. Version-diff-selector populates version dropdowns
expected: |
  After selecting a job folder, both version dropdowns populate with available backup
  version numbers from that folder (ascending order).
result: pass

### 3. Version-diff-selector opens diff modal with two versions
expected: |
  Clicking the Diff button with two different versions selected opens the diff modal
  showing the diff between those two versions.
result: pass

### 4. JD textarea has 20 rows (Phase 1 UI tweak)
expected: |
  The jobDescription textarea is taller than before — approximately 20 rows visible
  without scrolling.
result: skipped
reason: ""

### 5. Diff line numbers visible and clickable
expected: |
  In the diff view, each line shows a line number. Clicking a line number highlights it.
  Line numbers are displayed in a distinct column beside the diff content.
result: issue
reported: "Line numbers are shown and highlighted correctly for changed lines, but they are in 'hunks mode' instead of 'full file mode'. User wants full file mode line numbers."
severity: major

### 6. Auto-apply suggestions checkbox present and checked by default
expected: |
  A checkbox labeled "Auto-apply suggestions after generation" appears, is checked by
  default, and its state persists in sessionStorage.
result: pending

### 7. Resume generation auto-fires applySuggestions
expected: |
  After resume generation completes successfully (with auto-apply checked), applySuggestions
  fires automatically in the background.
result: pending

### 8. ATS analysis fires after applySuggestions completes
expected: |
  After applySuggestions completes, ATS analysis fires automatically in the background.
result: pending

### 9. ATS toast notification appears when coverage is ready
expected: |
  When ATS analysis completes, a toast notification appears indicating ATS coverage is
  ready. The toast can be dismissed.
result: pending

## Summary

total: 9
passed: 2
issues: 1
pending: 4
skipped: 2
blocked: 0

## Gaps

- gap_id: G-02-5
  truth: "Diff line numbers shown in full file mode with highlighting for changed lines"
  status: failed
  reason: "User reported: Full file mode has no line numbers at all; hunks mode has sequential numbers but they don't match actual file line numbers from @@ headers"
  severity: major
  test: 5
  root_cause: |
    Two separate issues:
    1. Full-file view: switchToFullView sets diffPre.innerHTML = wordDiffHtml directly, and wordDiffHtml (from generateInlineDiff) has no line numbers at all
    2. Hunks view: wrapDiffLinesWithSpans uses idx+1 instead of parsing @@ hunk headers
  artifacts:
    - path: "public/suggestions.js"
      issue: "switchToFullView (line 280-286) uses wordDiffHtml with no line numbers; wrapDiffLinesWithSpans (line 296-312) uses idx+1"
      lines: "280-312"
    - path: "services/diffUtil.ts"
      issue: "generateInlineDiff (line 68-82) produces word-level diff HTML with no line numbers"
      lines: "68-82"
  missing:
    - "Task 1: Fix wrapDiffLinesWithSpans to parse @@ hunk headers for running oldLine/newLine counters"
    - "Task 2: Update switchToFullView to use wrapDiffLinesWithSpans(lastUnifiedDiff) instead of wordDiffHtml"
  debug_session: ""

## Deferred Follow-Ups

- test: 1
  idea: "Works on laptop but not on mobile — add mobile support for version-diff-selector panel"
  deferred_at: 2026-07-18
