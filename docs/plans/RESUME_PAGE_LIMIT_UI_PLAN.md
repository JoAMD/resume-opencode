# Resume Page-Limit UI Surfacing — Plan (deferred)

**Status:** Draft (post-step 2 of the server-side page-limit work)

---

## TL;DR

Step 1 moved resume char-count measurement from the model to the server. Step 2 adds a server-side trim reprompt that loops up to 3 attempts. After step 2, a resume that still exceeds 7784 chars after 3 trim attempts comes back with `characterCountTrimmed: "true"` — but the user has no way to see that flag or the current char count in the UI.

This plan adds UI surfacing for both:

1. Show `characterCountTrimmed` (and ideally the actual char count) on the generation result, so the user knows whether a retry is needed.
2. If a resume comes back over the limit after the trim loop, surface a non-blocking warning rather than silently returning an oversized result.

---

## Scope (proposed)

- `routes/generate.ts` — surface `characterCountTrimmed` and `getResumeCharCount(resume)` in the API response (e.g. `meta: { resumeCharCount, resumeCharLimit, resumeTrimmed }`).
- Frontend (whatever consumes `/generate`) — render the flag and warning.
- Optionally: a "Trim" button that re-runs `enforceResumeCharLimit` against the existing resume without redoing the full generation.

## Non-goals

- Changing the trim algorithm itself (server-side loop is settled at 3 attempts).
- Per-bullet-level diffing between attempts (out of scope; trim is opaque to the user).

## Open questions

- Should the warning be a toast, an inline banner, or a row in the result panel?
- Should we cap the user-facing char count display at the limit, or show the over-by number too?
- Does the consumer want `resumeCharCount` in the response always, or only when `trimmed === "true"`?
