# Phase 2: Version diff selector + fire-and-forget ATS analysis - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-18
**Phase:** 02-version-diff-selector-fire-and-forget-ats-analysis
**Areas discussed:** Version diff selector UI placement, Folder selection UX, Version selection UX, Diff output location, ATS triggering, Auto-apply checkbox, ATS notification, Phase 1 tweaks handling, Tech debt question

---

## Gray Area 1: Folder Selection UX

| Option | Description | Selected |
|--------|-------------|----------|
| Text input with autocomplete | User types folder slug, dropdown shows matching jobs (like Search past JDs) | ✓ |
| Dropdown picker | Show all available job folders as dropdown (could be long) | |
| Pre-filled with current job | Auto-fill with current job, editable | ✓ (combined with autocomplete) |

**User's choice:** Option 1 and 3 — text input with autocomplete AND pre-filled with current job folder, but editable if user wants different folder
**Notes:** User wants the best of both worlds — starts with current job pre-filled, can type to search/filter other folders

---

## Gray Area 2: Version Selection UX

| Option | Description | Selected |
|--------|-------------|----------|
| Two dropdowns | Source version and Target version dropdowns | ✓ |
| Click-to-select pills | Click source, click target, then Diff button | |
| Grid with checkboxes | List all backups with checkboxes | |

**User's choice:** Two dropdowns (Recommended). Server handles diff and path validation between any two selected backup versions.
**Notes:** Both dropdowns populated with available backups from selected folder's `backups/` directory

---

## Gray Area 3: Diff Output Location

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse existing diff modal | Phase 1 modal showing unified diff + changed paths | ✓ |
| Inline below panel | Expand panel itself to show diff | |
| New dedicated section | Separate diff results section elsewhere | |

**User's choice:** Reuse existing diff modal (Recommended)
**Notes:** The modal already handles unified diff and changed-paths display — just populate with selected version pair

---

## Gray Area 4: ATS Triggering

| Option | Description | Selected |
|--------|-------------|----------|
| Always after applySuggestions | Auto-run in background after every successful applySuggestions | ✓ |
| User-initiated only | Only when user explicitly clicks "Run ATS Analysis" | |
| Both options | Auto-run + explicit button | |

**User's choice:** Always after applySuggestions, AND also auto-trigger applySuggestions after resume generation
**Notes:** User clarified: Generate → auto applySuggestions → auto ATS analysis. All fire-and-forget.

---

## Gray Area 5: Auto-apply Checkbox

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, add checkbox | "Auto-apply suggestions after generation" checkbox (checked by default) | ✓ |
| No, always auto-apply | Always auto-apply, no skip option | |
| Env var only | Control via OPENCODE_AUTO_APPLY_SUGGESTIONS env var | |

**User's choice:** Yes, add checkbox (Recommended)
**Notes:** Checkbox checked by default. User can uncheck to skip for a given generation.

---

## Gray Area 6: ATS Notification

| Option | Description | Selected |
|--------|-------------|----------|
| Poll via same task endpoint | Reuse /generate/task/:id polling mechanism | ✓ |
| Toast/alert in UI | Show notification banner when ATS completes | ✓ |
| Update suggestions panel | Show ATS coverage % in suggestions panel | |

**User's choice:** Poll via task endpoint AND show toast/alert
**Notes:** Client polls for completion, and UI shows toast when done (e.g., "ATS analysis ready: 78% coverage")

---

## Gray Area 7: Phase 1 Tweaks Handling

| Option | Description | Selected |
|--------|-------------|----------|
| Defer to Phase 2 | Include Phase 1 tweaks (model fill screen, word diff line numbers) as part of Phase 2 scope | ✓ |
| Handle as hotfix | Quick fixes before Phase 2 begins | |
| Separate maintenance phase | Phase 1.5 or maintenance phase | |

**User's choice:** Defer to Phase 2 (Recommended)
**Notes:** UI will be touched anyway for version diff selector — natural place to also fix Phase 1 styling issues

---

## Gray Area 8: Tech Debt Question

**Question asked:** Is there tech debt mentioned in concerns for fire-and-forget ATS analysis?

**Answer:** The fire-and-forget pattern itself is NOT tech debt — `applySuggestions` already uses it successfully. CONCERNS.md flags:
- taskMap is unbounded (no eviction)
- taskMap is process-local (can't share across workers)
- Potential promise leaks in background IIFE patterns

**Notes:** None of these cause "HTTP connection held" — the existing pattern already detaches properly. Concerns are about long-term reliability, not correctness.

---

## Deferred Ideas

- **taskMap unbounded concern** — Future phase may add TTL/LRU cap to taskMap. Not in scope for Phase 2.
