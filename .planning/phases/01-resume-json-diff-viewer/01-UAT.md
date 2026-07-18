---
status: complete
phase: 01-resume-json-diff-viewer
source:
  - .planning/phases/01-resume-json-diff-viewer/01-03-SUMMARY.md
  - .planning/phases/01-resume-json-diff-viewer/01-02-SUMMARY.md
  - .planning/phases/01-resume-json-diff-viewer/01-01-SUMMARY.md
started: 2026-07-18T00:58:37Z
updated: 2026-07-18T02:30:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Compare-with-backup control is visible and clickable
expected: |
  After applySuggestions completes, the suggestions panel shows a
  "Backup: v1" (or similar) entry. The label is rendered as a clickable
  control — clicking it triggers a fetch and opens a modal. Not plain text.
result: pass

### 2. Modal opens with unified diff content
expected: |
  Clicking the backup control opens a modal/dialog titled "Resume diff" (or
  similar). Inside, a code block shows the unified diff between the chosen
  backup and the current resume: red lines for removed, green lines for
  added, with `--- v1/...` and `+++ current/...` headers.
result: issue
reported: "modal opens and shows a unified diff, but it dumps the whole resume as a single big changed block instead of 3 small focused hunks. In vscode the same change is 3 small focused blocks with exact changed words highlighted. No red or green colour on added/removed lines."
severity: major

### 3. Modal shows a human-readable summary of changed paths
expected: |
  The modal also shows a short summary list of which JSON paths changed
  (e.g. "summary", "contact.email"). Rendered as a bullet list or similar.
  For a diff that only touched the summary field, the list contains exactly
  "summary".
result: issue
reported: "summary list does show, but the modal isn't wide enough — the entries are too cramped. contents observed: 'summary', 'skills.tools', 'experience.0.bullets.0', 'projects.2.bullets.4', 'No changes'."
severity: cosmetic

### 4. Modal closes via X button and click-outside
expected: |
  Clicking the close (X) button in the modal hides it. Clicking outside
  the modal panel (on the backdrop) also hides it. The underlying
  suggestions panel is unchanged. Focus returns to the trigger.
result: pass
note: "User notes: Close button (not X) works; click-outside works. X icon would be nicer."

### 5. Endpoint behaves correctly under failure modes
expected: |
  - Missing jobDir -> 400 with "jobDir required"
  - Bad version (v0, v-1, vabc) -> 400 with "invalid version"
  - jobDir escaping jobs root (../etc) -> 400 or 500 with named error
  - Non-existent backup (v999) -> 404 with "Backup not found"
  Tested via curl against the running dev server.
result: pass

## Summary

total: 5
passed: 5
issues: 0
pending: 0
skipped: 0
blocked: 0
fixed-by-gap-closure: 2

## Gaps

- gap_id: G-01-2
  truth: "Modal opens with a unified diff showing removed lines in red, added lines in green, with --- v1/... and +++ current/... headers; for typical edits the diff is rendered as small focused hunks, not a single block of the whole resume."
  status: resolved
  resolved_by: 01-04-PLAN.md
  resolved_at: 2026-07-18
  reason: "User reported: modal opens and shows a unified diff, but it dumps the whole resume as a single big changed block instead of 3 small focused hunks. In vscode the same change is 3 small focused blocks with exact changed words highlighted. No red or green colour on added/removed lines."
  severity: major
  test: 2
  root_cause: |
    Two independent causes:
    1. unifiedDiffText (diffUtil.ts:39-53) uses a naive single-hunk algorithm — one prefix+suffix pass produces ONE big hunk for all changes, not multiple focused hunks.
    2. renderDiffResponse (suggestions.js) uses .textContent instead of .innerHTML, so no HTML color spans can render; plus no CSS rules for diff-removed/diff-added.
  artifacts:
    - path: "services/diffUtil.ts"
      issue: "naive single-hunk algorithm in unifiedDiffText — one prefix+suffix = one big middle block"
    - path: "public/suggestions.js"
      issue: "renderDiffResponse uses .textContent, preventing HTML-based color markup"
    - path: "public/style.css"
      issue: "no .diff-removed / .diff-added CSS rules"
  missing:
    - "Replace unifiedDiffText with LCS-based multi-hunk algorithm (find all changed line ranges, emit separate @@ hunks)"
    - "Switch renderDiffResponse from .textContent to .innerHTML with color-span wrapping"
    - "Add .diff-removed (red), .diff-added (green), .diff-context (grey) CSS rules"
  debug_session: ".planning/debug/diff-rendering-large-block.md"
- gap_id: G-01-3
  truth: "Modal shows a human-readable summary list of changed paths that is readable (modal wide enough so path entries are not cramped)."
  status: resolved
  resolved_by: 01-04-PLAN.md
  resolved_at: 2026-07-18
  reason: "User reported: summary list does show, but the modal isn't wide enough — the entries are too cramped. contents observed: 'summary', 'skills.tools', 'experience.0.bullets.0', 'projects.2.bullets.4', 'No changes'."
  severity: cosmetic
  test: 3
  root_cause: |
    .popover-body has max-width: 420px (style.css:319) which applies to all popovers including the diff modal. The diff modal's .diff-body uses a 2:1 grid so the summary column gets only ~1/3 of 420px (≈126px after padding). Path strings like experience.0.bullets.0 need more horizontal room.
  artifacts:
    - path: "public/style.css"
      issue: ".popover-body max-width: 420px — diff modal inherits this and the summary column wraps"
  missing:
    - "Add a wider max-width override for #suggestions-diff-modal .popover-body (e.g. 600-640px)"
  debug_session: ".planning/debug/diff-modal-narrow.md"
