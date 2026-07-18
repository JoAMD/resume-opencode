# Phase 2: Version diff selector + fire-and-forget ATS analysis - Context

**Gathered:** 2026-07-18
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers three capabilities:

1. **Version Diff Selector UI** — A new UI panel (similar to "Search past JDs") placed below it, allowing users to select any job folder and diff any two backup versions, with output shown in the existing diff modal.

2. **Auto-chain generation → applySuggestions → ATS** — After a successful resume generation completes, automatically fire `applySuggestions` in background. After `applySuggestions` completes, automatically fire ATS analysis in background. All steps are fire-and-forget; HTTP connection is never held.

3. **Phase 1 UI tweaks** — These are incorporated into Phase 2 scope since the UI will be touched anyway: (a) main model fills most of screen, (b) word diff shows line numbers for orientation when text overflows.

</domain>

<decisions>
## Implementation Decisions

### Version Diff Selector UI

- **D-01:** Panel placement: Below "Search past JDs" section in `public/index.html`
- **D-02:** Folder selection: Text input with autocomplete dropdown (like Search past JDs), pre-filled with currently loaded job folder. User can edit to search/select a different folder.
- **D-03:** Version selection: Two dropdown selects — "Source version" and "Target version" — both populated with available backup versions (v1, v2, v3, ...) from the selected folder's `backups/` directory
- **D-04:** Diff output: Reuse the existing Phase 1 diff modal (`suggestions-diff-modal` in `suggestions.js`). The modal already handles unified diff and changed-paths display.

### Fire-and-Forget Chain

- **D-05:** Trigger: Auto-applySuggestions fires **immediately after** POST /generate completes successfully (both "combined" and "resume-only" generation paths)
- **D-06:** After applySuggestions completes, ATS analysis fires automatically in background
- **D-07:** Both steps use the existing fire-and-forget IIFE pattern (`runApplySuggestionsBackground` style) — HTTP response is returned immediately with taskId; client polls for completion
- **D-08:** Checkbox option: Add "Auto-apply suggestions after generation" checkbox in the main form, checked by default. User can uncheck to skip the auto-chain for a given generation.

### ATS Result Notification

- **D-09:** Polling: Reuse existing `/generate/task/:id` polling mechanism for ATS completion
- **D-10:** Toast: When ATS completes, show a toast/alert in the UI with coverage % (e.g., "ATS analysis ready: 78% coverage")

### Existing Code Insights

- **D-11:** No new API endpoint needed for version-vs-version diff — the existing `GET /generate/diffResume` route already handles arbitrary folder/version via `jobDir` and `version` params. Just need a UI to select and call it.

### Deferred from Phase 1 (now in Phase 2 scope)

- **D-12:** Main model fills most of screen — styling tweak to `style.css` / `index.html`
- **D-13:** Word diff shows line number where the diff occurs — add line reference annotation to the word-diff output so user knows where to look when text overflows

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Core Implementation References
- `public/index.html` §"Search past JDs" — Reference pattern for new panel (lines 138-156)
- `public/suggestions.js` — Diff modal implementation (`openDiffModal`, `closeDiffModal`), backup version loading
- `routes/generate.ts` — `POST /generate/applySuggestions` route (lines 962-992), `runApplySuggestionsBackground` (lines 927-959), ATS call in generation flow (lines 1119-1145)
- `services/fixSuggestionsService.ts` — The applySuggestions service that runs in background
- `services/atsAiService.ts` — ATS analysis service to call in background
- `services/backupService.ts` — `latestBackupVersion` helper and backup listing

### UI Pattern References
- `public/style.css` — Existing styling for panels and form elements
- `.planning/codebase/CONCERNS.md` §"taskMap Is an Unbounded In-Memory Map" (line 338) — Note: taskMap is used for background task tracking; no eviction is a known concern but not blocking for this phase

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `suggestions-diff-modal` template (`suggestions.html`) — Already has the diff display structure (title, close button, unified diff pre, changed paths list, view-toggle buttons)
- `/generate/diffResume` route — Already accepts arbitrary `jobDir` and `version` params; can diff any two versions
- `backupService.ts` `latestBackupVersion` — Already lists available backups

### Established Patterns
- Fire-and-forget IIFE: `runApplySuggestionsBackground` pattern (routes/generate.ts:927) — use same pattern for chaining applySuggestions → ATS
- Autocomplete search: Search past JDs input pattern with debounce
- Task polling: `/generate/task/:id` pattern for checking completion

### Integration Points
- `routes/generate.ts` — Where to add the auto-chain logic (after generation completes)
- `public/suggestions.js` — Where to add the new version diff panel and ATS toast notification
- `public/index.html` — Where to add the new panel section

</code_context>

<specifics>
## Specific Ideas

- **UI detail:** Version diff selector panel should have the same visual style as "Search past JDs" — same `<section class="jd-search">` pattern
- **UX detail:** When user types in the folder input, autocomplete should filter job folders by slug match (like JD search does with job-description content)
- **Toast style:** Use existing status/toast pattern in the UI (look at how `setStatus` works in suggestions.js)

</specifics>

<deferred>
## Deferred Ideas

### Noted for Later
- **Phase 1 taskMap unbounded concern** — `.planning/codebase/CONCERNS.md` flags that taskMap has no eviction. Future phase may add TTL or LRU cap. Not in scope for Phase 2.

</deferred>

---

*Phase: 2-Version diff selector + fire-and-forget ATS analysis*
*Context gathered: 2026-07-18*
