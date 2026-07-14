# Resume Trim Self-Check + Per-Bullet Line Cap — Plan

**Status:** Approved, ready to build
**Owner:** TBD
**Date:** 2026-07-15

---

## TL;DR

The server-side trim loop in `enforceResumeCharLimit` (`services/ai.ts:166`) currently
gives the model only the *parent's* `CURRENT CHARACTER COUNT` and a prompt that
references a non-existent `count-characters` tool. The model cannot actually call
that tool, so the loop exits "successful" once the JSON character count fits under
`RESUME_CHAR_LIMIT` (7784) — but the produced bullets are often 116+ chars and wrap
to two printed lines, leaving the second line mostly empty.

This plan replaces the fake self-check with two real constraints:

1. **Server measures the result of every trim attempt** and feeds the *actual* char
   count plus a per-bullet length list back into the next attempt's user content.
2. **Per-bullet char cap** of **110** characters, enforced alongside the existing
   JSON limit. Bullets above the cap keep the loop running even when the JSON budget
   is satisfied. Cap is shared by both `resume.tex.template` and
   `resume-qa.tex.template` — same column width, same value.

The model's prompt loses the `count-characters` instruction (it never worked) and
gains an explicit numeric target plus the over-budget feedback list.

---

## Background / Problem

Empirical wrap point on letter paper, 11pt, `\small` body, default `itemize` indent,
0.97\textwidth column:

| Bullet chars | Renders as |
|---:|---|
| 103 | 1 line |
| 112 | 1 line |
| 116 | 2 lines (≈ 4 chars on second line) |
| 118 | 2 lines (≈ 6 chars on second line) |
| 123 | 2 lines (≈ 10 chars on second line) |

So the visual wrap threshold sits in **[112, 116]** chars. The 110-char target
gives a 2-char safety margin against wider glyphs (`m`, `w`) and the QA template's
identical column width.

User-reported examples (all from the same `enforceResumeCharLimit` pass):

- 112 chars → 1 line ✓
- 116 chars → wraps to 2 lines ✗
- 118 chars → wraps to 2 lines ✗
- 123 chars → wraps to 2 lines ✗

Concretely:

```
Led workflow engine reliability improvements (trigger-safety, actor-context
propagation, nested-flow behaviour).                                    # 112

Operated multi-tenanted SaaS on Azure (App Service, App Insights, Front
Door) focused on reliability and incident response.                    # 123
```

The first fits, the second wraps with most of line 2 empty.

## Root cause

`prompts/trim-resume-prompt.txt:15` says:

> After generating the complete JSON, EXTRACT the "resume" object first, then pass
> ONLY that extracted resume JSON string to the count-characters tool.

But `services/ai.ts` never sends a `tools` array to the OpenCode SDK
(`executeOpencodePrompt`, `ai.ts:824`, calls `client.session.prompt` without a
`tools` field). The model has no way to call `count-characters`, so it just
trusts the parent-injected count. `enforceResumeCharLimit` then re-measures
*server-side* (`ai.ts:206`) but discards the per-bullet breakdown and does not
feed it back.

The JSON budget (7784) is also independent of the per-bullet visual wrap. A
resume can be at 7000 JSON chars (under budget) and still have a bullet that
wraps.

## Goals

1. **Self-aware trim loop.** After every attempt, the server measures the
   resulting JSON length *and* each bullet's length, and feeds both into the next
   attempt's user content.
2. **Per-bullet line cap.** Add `BULLET_WIDTH_CHARS = 110` as a hard target. A
   bullet above 110 keeps the loop running even when the JSON budget is met.
3. **Same cap for QA template.** `resume-qa.tex.template` shares the column
   width, so it shares the cap. No template-specific code path.
4. **Backward compatible.** `characterCountTrimmed` semantics only loosen:
   "false" can now appear in cases where it previously would have been "true"
   (clean result after one trim pass). It can never go from "false" to "true"
   in a place that was previously "false".

## Non-goals

- Changing the per-attempt model or the JSON character limit (7784).
- Tightening the *first* generation (`resume-system-prompt.txt`) — that's a
  follow-up. The trim is the safety net.
- Cover-letter trim / line width. The cover letter is paragraphs and has no
  character limit today.
- Re-running latex through a real compiler to measure the wrap point. We
  approximate from font metrics + a measured sample.

## Design

### 1. `services/ai.ts` — `enforceResumeCharLimit`

After the existing `getResumeCharCount(current)` call on each attempt
(`ai.ts:206`), additionally:

- Walk `current.experience[*].bullets` and `current.projects[*].bullets`.
- For each bullet whose `length > BULLET_WIDTH_CHARS`, record:
  `{ section: "experience"|"projects", company: string, projectName?: string,
     idx: number, len: number, lastWord: string }`. `lastWord` is the trailing
  word the model can usually drop to get back under the cap — small but
  useful signal.
- Pass the resulting list into the next attempt's `userContent`.

The new user-content template replaces the one at `ai.ts:182`:

```
CURRENT RESUME (already tailored):
<json>

CURRENT CHARACTER COUNT: <measured after this attempt>
CHARACTER LIMIT: <RESUME_CHAR_LIMIT>
BULLET LENGTH BUDGET: <BULLET_WIDTH_CHARS> chars per bullet
BULLETS OVER BUDGET (length, last word):
  - experience[OneTeam Services].bullets[1] (146 chars, "...downloads.")
  - projects[AI Knowledge Assistant ...].bullets[2] (128 chars, "...review.")

Return a trimmed version of the same resume whose JSON-serialized length is
strictly less than RESUME_CHAR_LIMIT AND whose bullets are each no longer
than BULLET_WIDTH_CHARS chars. Do not change the candidate's actual
experience, skills, or summary content — only shorten bullet text and trim
low-impact wording. For each over-budget bullet, prefer dropping the
trailing word or a redundant clause to get under the budget.
```

If no bullets are over budget, the `BULLETS OVER BUDGET` section is omitted.

### 2. Short-circuit logic

The existing short-circuit at `ai.ts:209` (`if (count <= RESUME_CHAR_LIMIT) return ...`) is replaced with:

```ts
const overBudget = findOverBudgetBullets(current, BULLET_WIDTH_CHARS);
if (count <= RESUME_CHAR_LIMIT && overBudget.length === 0) {
  return { ...current, characterCountTrimmed: 'false' };
}
if (count <= RESUME_CHAR_LIMIT) {
  // JSON budget met but bullets still over — keep looping
  log(`enforceResumeCharLimit: attempt ${attempt} under JSON limit but ${overBudget.length} bullets over bullet cap, continuing`);
}
```

This is the only behavioural change visible to callers: `characterCountTrimmed`
flips to `"false"` more often (cleaner output), and the loop may run more
attempts than before (up to `RESUME_TRIM_MAX_ATTEMPTS`, default 3).

### 3. New constants

```ts
// services/ai.ts
export const BULLET_WIDTH_CHARS = Math.max(
  40,
  parseInt(process.env.OPENCODE_BULLET_WIDTH_CHARS || '110', 10) || 110,
);
```

The lower bound of 40 prevents a misconfiguration from making the loop
unsatisfiable.

### 4. New helper

```ts
// services/ai.ts
export interface OverBudgetBullet {
  section: 'experience' | 'projects';
  label: string;            // company or project name
  idx: number;
  len: number;
  lastWord: string;
}

export function findOverBudgetBullets(
  resume: ResumeData,
  cap: number,
): OverBudgetBullet[] { ... }
```

Returns `[]` when `resume` is nullish or has no bullet arrays. `lastWord` is
the last whitespace-delimited token with leading punctuation stripped, truncated
to 30 chars. Unit-tested in `services/ai.resumeCharLimit.test.ts`.

### 5. `prompts/trim-resume-prompt.txt` changes

- Drop the `count-characters tool` sentence entirely.
- Add: "BULLET LENGTH BUDGET: each bullet must be ≤ 110 characters to fit on
  one printed line. Bullets up to 130 are tolerated (2 lines), but anything
  above should be shortened further in the next pass."
- Add: "The next prompt will list bullets that are over budget with their
  current length. Shrink those first."
- Add: "Prefer cutting the trailing clause or redundant adjectives over
  reordering or merging bullets."
- Keep all existing content rules: mandatory experiences, no invention, schema
  unchanged, `characterCountTrimmed` field still required.

### 6. Tests — `services/ai.resumeCharLimit.test.ts`

New tests, all using the existing fake-`runOpenCode` harness
(`ai.resumeCharLimit.test.ts:117` onward):

- `findOverBudgetBullets returns bullets above cap with lastWord`
- `findOverBudgetBullets returns [] when no bullets over cap`
- `findOverBudgetBullets handles nullish resume`
- `enforceResumeCharLimit passes BULLET LENGTH BUDGET and over-budget list to subsequent user content` — captures attempt-2 `userContent`, asserts both strings present and the over-budget bullet's length appears.
- `enforceResumeCharLimit returns characterCountTrimmed=false when JSON is under limit and no bullets are over cap` (clean short-circuit)
- `enforceResumeCharLimit keeps looping when JSON is under limit but bullets over cap`
- `enforceResumeCharLimit honours OPENCODE_BULLET_WIDTH_CHARS env override`

The existing tests at lines 184, 192, 202, 212, 222, 232 must still pass. The
"loops up to configured max attempts" test at line 192 may need its mock to
return a result that *also* has an over-budget bullet, otherwise the new
short-circuit may exit early.

### 7. Docs (mandatory per `AGENTS.md` §3)

- `README.md` lines 72–76: replace the `count-characters` claim with the
  real mechanism. Add `BULLET_WIDTH_CHARS` env var.
- `docs/FEATURES.md` "Resume page-limit enforcement" section: document the
  per-bullet cap, the over-budget feedback list, and the new short-circuit
  condition.
- `docs/IGNORED_FILES.md`: not touched (no gitignore change).

## Files to change

| File | Change |
|---|---|
| `prompts/trim-resume-prompt.txt` | Remove `count-characters` instruction; add bullet cap rule + feedback hint |
| `services/ai.ts` | Add `BULLET_WIDTH_CHARS`, `findOverBudgetBullets`; extend `enforceResumeCharLimit` user-content + short-circuit |
| `services/ai.resumeCharLimit.test.ts` | Add 7 tests; adjust existing max-attempts test mock |
| `README.md` | Update lines 72–76; add `BULLET_WIDTH_CHARS` env var |
| `docs/FEATURES.md` | Update "Resume page-limit enforcement" section |
| `docs/plans/RESUME_TRIM_REWRITE_PLAN.md` | **This file** (already updated) |

## Trade-offs

- **Why 110 and not 112?** Two chars of safety against wider glyphs and the
  QA template's identical column. 112 is a measurement, not a guarantee.
- **Why not also cap the *first* generation prompt?** Out of scope. The trim
  is the safety net; the first generation can be loose. If we see the trim
  loop hitting the max-attempts cap often, that's the trigger to also tighten
  `resume-system-prompt.txt`.
- **Why measure char length of the bullet text, not the rendered width?**
  LaTeX doesn't expose per-bullet width without a compile pass. Approximating
  with char length plus a measured 110-char threshold is good enough — the
  existing bullets confirm the approximation holds across the candidate's
  actual content.
- **Why a hard 110, not "soft" with a 2-line tolerance?** Because the
  user-visible problem is *exactly* 2-line bullets with empty trailing lines.
  A 130-char "tolerance" would still produce them. The loop will only stop
  when bullets are under 110, except for the very last attempt where it bails
  with `characterCountTrimmed: "true"`.

## Rollback

- Revert `prompts/trim-resume-prompt.txt` to previous contents.
- Revert the `enforceResumeCharLimit` user-content builder and short-circuit
  in `services/ai.ts`.
- Drop the new tests.
- No data migration. `characterCountTrimmed` semantics only loosen — no
  caller can observe a stricter behaviour than before.

## Open questions

None at plan time. Defaults are: cap = 110, env var
`OPENCODE_BULLET_WIDTH_CHARS`, QA template shares the cap, docs updated in
the same change.
