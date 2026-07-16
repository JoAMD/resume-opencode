# Job Description Content Search — Plan

**Status:** Implemented

---

## TL;DR

Add a content-based duplicate search across every `jobs/<slug>/` folder so the
user can paste a few words (or a short sentence) and quickly answer "have I
already applied to something like this?". The current `findApplications` is
purely metadata-based (link / company / role) and only ever reads
`jobs/applications.csv`. The new tool reads the actual JD text stored in each
job folder.

The metadata-based duplicate guard on `POST /generate` is **not** changed —
this is a separate ad-hoc lookup tool.

---

## Goals

1. Search every `jobs/<slug>/` folder's `job-description.txt` (and
   `full-jd.txt` when present) for text the user types.
2. Support two modes from the same input box, switchable in the UI:
   - `exact-substring` (default) — the input is treated as one literal
     phrase (case-insensitive). Mirrors "type a sentence and find a job
     that says this".
   - `all-words-AND` — every whitespace-separated word must appear in
     the file. Mirrors the `rg "software"` workflow.
3. Return a small context snippet per match so the user can see *why* it
   matched without opening the folder.
4. Surface the tool in the existing main page as a compact panel so it sits
   next to the existing duplicate-guard UI.

## Non-goals (explicit)

- **No changes** to `findApplications`, `applications.csv`, or the
  `POST /generate` duplicate gating. Those stay metadata-only.
- No new dependencies. No CLI script in this iteration.
- No code-health / refactor work beyond what is necessary to add the feature.
- No writes to disk — this is a read-only search.

## Future work (deferred)

These were considered and intentionally not done in this iteration; revisit
when there is a real need:

- **Wire JD-search into the `POST /generate` duplicate prompt.** A future
  iteration could pre-flight the new request's `jobDescription` against past
  JDs and surface a "this JD looks like one you applied to 3 weeks ago"
  warning alongside the existing metadata-based 409. This is intentionally
  out of scope for now because (a) it changes the existing 409 UX, and
  (b) metadata-based gating already catches the common case of "I literally
  applied to this same posting". Revisit when the user wants the
  content-based check to be in the critical path.
- **A small CLI helper** (e.g. `scripts/searchJobsByDescription.ts`,
  `npm run search-jd -- "software engineer adelaide"`) for terminal-driven
  use. The HTTP endpoint + UI cover the primary workflow today.
- **Token-level highlighting** in the snippet (mark which words matched in
  AND mode). Cheap to add later if it becomes useful.
- **Per-folder "applied" metadata on the hit** (read `applications.csv` to
  show the row that matches the folder). Useful, but adds coupling between
  the two services; defer until the search panel proves its worth.
- **Configurable result cap via UI** (a "show more" button or infinite
  scroll). The current hard cap of 50 is enough for the current ~100
  folders; revisit when growth makes 50 too tight.

---

## Design

### Surface

New HTTP endpoint:

```
GET /generate/searchByDescription?text=…&mode=all-words-AND|exact-substring&limit=50
```

- Always case-insensitive.
- Empty / whitespace `text` → `200 { matches: [] }` (no error).
- Unknown `mode` → `400`.
- `limit` clamped to `[1, 200]`, default `50`.

### Files scanned

Per folder, in this order:

1. `jobs/<slug>/job-description.txt` — if it exists, evaluate a match.
2. `jobs/<slug>/full-jd.txt` — if it exists, evaluate a match.

A single folder can produce up to **two** hits (one per file), so the UI can
show both when the long-form and short-form diverge.

### Match semantics

- `exact-substring` (default): lowercase both input and content, require
  `content.includes(text)`. Empty input → no match.
- `all-words-AND`: split `text.trim()` on whitespace, drop empties. Every
  token must appear in the file's lowercased content. Empty token list →
  no match (treated as no-op, same as empty text).

### Snippet

Centre on the first match in the file:

- For `exact-substring`: centre on the first occurrence of the literal
  phrase.
- For `all-words-AND`: centre on the first occurrence of the **first
  token** (predictable, cheap).

Slice `±60` characters around that index, collapse internal whitespace to
single spaces, prefix `…` and/or suffix `…` when the slice is cut at a
boundary. Truncate to a hard maximum of 200 chars.

### Result shape

```ts
type SearchHit = {
  jobDir: string;                                    // folder name only
  matchedFile: 'job-description.txt' | 'full-jd.txt';
  snippet: string;                                   // ~120-char window
  mtimeMs: number;                                   // for sort
};
```

Sorted by `mtimeMs` desc (most recent folder first), then truncated to
`limit`.

Response:

```json
{
  "matches": [ { "jobDir": "...", "matchedFile": "...", "snippet": "...", "mtimeMs": 0 } ],
  "mode": "exact-substring",
  "text": "software engineer",
  "count": 12
}
```

### UI

A compact "Search past JDs" panel below the existing result block, using
existing CSS classes (`.field`, `.button`, `.button-small`) so no style
changes are needed:

- Text input (`#jd-search-text`).
- Mode select (`#jd-search-mode`) with `All words (AND)` (default) and
  `Exact substring` options.
- Search button (`#jd-search-btn`).
- Results container (`#jd-search-results`) — list of folder-name links
  pointing at `/jobs/<jobDir>/<matchedFile>`, with the snippet below.

Always visible (not gated on `lastJobDir`), so it can be used before any
generation.

---

## Files

### New

- `services/jobDescriptionSearch.ts` — pure function, only depends on `fs`
  and `path`. `SearchMode = 'all-words-AND' | 'exact-substring'`.
  Exports `searchJobDescriptions({ text, mode?, jobsDir, limit? })`.
- `services/jobDescriptionSearch.test.ts` — vitest cases mirroring
  `applications.test.ts` style (mocked `findProjectRoot` via a tmp dir).

### Edited

- `routes/generate.ts` — one new `router.get('/searchByDescription', …)`
  block after the existing `checkDuplicate` handler. Reuses the existing
  `jobsDir` constant and the same `log` / `logError` style.
- `public/index.html` — new panel + small inline-script block. No CSS
  changes.
- `docs/FEATURES.md` — new subsection "Content search across past JDs"
  under the existing "Duplicate guard" section.
- `README.md` — extend the "Job applications tracking + duplicate guard"
  bullet with one paragraph pointing at the new endpoint + UI panel, with
  the same `rg "software"` example to anchor on the user's existing
  workflow.

`vitest.config.ts` already globs `services/**/*.test.ts`, so the new test
picks up automatically.

---

## Verification

- `npm test` — new tests pass, `applications.test.ts` still green (so the
  metadata-based duplicate guard is unaffected).
- Manual: `npm run dev`, then in the browser:
  - `software` in AND mode → several matches across past folders, snippets
    show JD context.
  - `senior software engineer` in AND mode → narrows to senior-only
    folders.
  - Same query in `exact-substring` mode → re-queries with the literal
    phrase semantics.
  - A short sentence that exists in one folder's JD → that folder only in
    substring mode; may match more in AND mode (token-wise).
- `curl 'http://localhost:3000/generate/searchByDescription?text=software&mode=all-words-AND'`
  returns the documented JSON shape.
