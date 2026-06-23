# OpenCode Session Keep + Surface Session ID — Plan

**Branch:** `fix/opencode-session-keep`
**Worktree:** *(create from `main`; tag in PR description)*
**Status:** Draft (pre-implementation)

---

## TL;DR

`services/ai.ts` currently deletes the OpenCode server session in a `finally` block right after every `client.session.prompt` call, so any session id the server logs (`ses_…`) is gone from the OpenCode server before a developer can find it. This plan:

1. Stops the unconditional auto-delete. Sessions are kept by default (env-gated off switch).
2. Surfaces the session id in three places: the `/generate/task/:id` polling response, a new `session-info.txt` in the job folder, and a "OpenCode session: `ses_…`" line in the UI result area. `other-input.txt` is also updated to reference the id.
3. Enriches the `Invalid response from OpenCode` error to include the session id and the raw model output, so the next failure is debuggable from the server log alone.

No backward compatibility is preserved for the internal generator return shapes — the three public generators (`generateResumeJSON`, `generateCoverLetterJSON`, `generateCombinedJSON`) are callers-internal to this repo and the test suite is updated in lockstep.

---

## Symptom (recap)

User reports:
> when i generate resume and cover letter it spits out session id but recently i cant find the session at all

Most recent production log (`logs/server-2026-06-23.log:31-40`):
```
[2026-06-23T14:08:27.668Z] ERROR: OpenCode combined generation error: Error: Invalid response from OpenCode
    at generateCombinedJSON (/home/adf_home_joel/src/copilot/resume-opencode/dist/services/ai.js:856:19)
```

User confirms auto-delete happens for **all** prompts (success and failure) — not just the failing ones. The session id printed to the server's terminal stdout is not persisted anywhere durable, and the session itself is destroyed before any external tool can connect to the OpenCode server to inspect it.

### Why the session id is currently invisible

| Place | Status | Why |
| --- | --- | --- |
| `services/ai.ts:461` `console.log('Session created:', ...)` | ❌ | Goes to stdout, not `services/logger.ts` → `logs/server-*.log`. Captured only by the tmux terminal where the server runs. |
| `services/ai.ts:802` `[timing] session.create OK in Nms (id=ses_…)` | ❌ | Same — stdout, not the file logger. |
| `services/ai.ts:810-812` `deleteOpencodeSession` in `finally` | ❌ | Destroys the session before any external inspection. |
| `other-input.txt` in job folder | ❌ | Written **before** the prompt runs (`routes/generate.ts:224`); the session id isn't known yet. |
| `GET /generate/task/:taskId` response | ❌ | `taskMap` only stores `status`/`result`/`error`/`startedAt` (`routes/generate.ts:226-236`). |
| `public/index.html` UI | ❌ | No reference to session id; `waitForTask` (`index.html:264-272`) just returns the result object. |

---

## Goal

Make a freshly-created OpenCode session **findable from three durable locations** so a developer debugging a failure (or even a success) can:

1. Read the id from the UI without opening the terminal.
2. Read the id from `jobs/<company-role-…>/session-info.txt` on disk.
3. Read the id from `jobs/<company-role-…>/other-input.txt` (already part of the job-folder snapshot convention).
4. Get the id + raw model output in the server log when the structured response is invalid, so log-only debugging still works.

And keep the session alive on the OpenCode server long enough to inspect it.

---

## Non-goals

- Replacing the blocking `client.session.prompt` with `session.prompt.sse(...)`. That is Option C in `AI_PROMPT_TIMEOUT_PLAN.md` and remains deferred.
- Changing the OpenCode server-side `headersTimeout`/`requestTimeout`. That is Option D in the same plan and remains out of repo.
- Server-side session retention policy on the OpenCode server itself. We trust the upstream default.
- Persisting conversation history across the `generateResume` → `generateCoverLetter` boundary. The two paths use separate sessions today; that stays as-is.
- Any external API contract changes. There is none — the Express server is the only consumer.

---

## Changes

### Step 1 — `services/ai.ts`: stop auto-deleting, return the session id

**1.1. `RunOpenCodeResult` gets a new optional field.**
```ts
interface RunOpenCodeResult {
  structured: any;
  rawText: string;
  usedStructuredOutput: boolean;
  sessionId: string;          // NEW: always populated
  rawModelOutput?: string;    // NEW: populated when rawText is empty (structured-only path)
}
```

**1.2. `runOpenCodePipeline` returns the session id and stops auto-deleting.**
- Drop the unconditional `finally { deleteOpencodeSession(...) }` block.
- Add a new env knob `OPENCODE_KEEP_SESSION` (default `true`). When `false`, keep the old `finally`-delete behavior so anyone who explicitly wants the old behavior can opt in.
- `RunOpenCodeResult` is constructed once at the end of the function with `sessionId` and (when `usedStructuredOutput` is true) `rawModelOutput = JSON.stringify(result.data?.info?.parts ?? [])` so downstream diagnostics have something to print.
- Replace the raw `console.log('Session created:', …)` (`ai.ts:461`) and the `id=ses_…` timing line (`ai.ts:802`) with `log(...)` from `logger.ts` so the id lands in `logs/server-*.log` and is greppable after the fact.

**1.3. `resolvePromptResult` and the "Invalid response" path surface the session id.**
- When the structured result is missing the expected fields (`ai.ts:1012-1014`), the thrown `Error('Invalid response from OpenCode')` is enriched:
  ```ts
  throw new Error(
    `Invalid response from OpenCode (sessionId=${sessionId}, ` +
    `usedStructuredOutput=${usedStructuredOutput}, ` +
    `rawModelOutput=${JSON.stringify(rawModelOutput).slice(0, 2000)})`
  );
  ```
- The session id propagates from the pipeline into this throw site, so a single `grep "Invalid response from OpenCode" logs/` finds both the id and the raw model payload in one line.

### Step 2 — `services/ai.ts`: thread the session id out of the three generators

Return type changes (no backward compat — the only callers are `routes/generate.ts` and the test files updated in Step 5):

```ts
export interface GenerateResumeResult {
  resume: ResumeData;
  sessionId: string;
}
export interface GenerateCoverLetterResult {
  coverLetter: CoverLetterJSON;
  sessionId: string;
}
export interface GenerateCombinedResult {
  resume: ResumeData;
  coverLetter: CoverLetterJSON;
  atsKeywords: string[];
  sessionId: string;       // resume session
  coverLetterSessionId: string;
}
```

For the combined path, two sessions are created (one per `runOpenCode` call). Both ids are returned. The UI/folder get the *resume* session id (the primary one); the cover-letter session id is logged for completeness.

### Step 3 — `routes/generate.ts`: persist the session id

**3.1. `formatOtherInput` (line 111) gets a new section appended before the trailing newline:**
```
OpenCode Session ID: ses_xxxxx
```
This is a forward reference — when the function is called from `POST /generate/` at line 224, the session id is not yet known, so the actual id is written into `other-input.txt` via a *second* call after the background task captures it. To avoid two full rewrites, the strategy is:

- `formatOtherInput(body)` continues to be called at line 224 with the **placeholder** `OpenCode Session ID: (pending — see session-info.txt)`.
- After `executeGeneration` returns, a new `appendJobFile(jobDir.jobDir, 'other-input.txt', '\nOpenCode Session ID: ' + sessionId + '\n')` writes the real id.

**3.2. New `session-info.txt`** is written at the same point as the append, with:
```
OpenCode Session ID: ses_xxxxx
Model: opencode-go/minimax-m2.7
Generated At: 2026-06-24T14:06:45.251Z
Cover Letter Session ID: ses_yyyyy   # only for combined path
```

**3.3. `taskMap` record shape** (line 226-236) extended:
```ts
type TaskRecord = {
  status: 'pending' | 'complete' | 'error';
  startedAt: number;
  result?: Record<string, unknown>;
  error?: string;
  sessionId?: string;            // NEW
  coverLetterSessionId?: string; // NEW (combined path only)
};
```

**3.4. `GET /generate/task/:taskId` response (line 198-203)** includes `sessionId` and `coverLetterSessionId` at the top level, alongside `status`/`result`/`error`/`startedAt`. The UI in Step 4 reads these.

**3.5. `executeGeneration` (line 477)** captures both session ids from the generator returns and:
- Writes `session-info.txt` to `jobDir.jobDir`.
- Appends the `OpenCode Session ID:` line to `other-input.txt`.
- Returns the resume session id inside the `result` object too, so the UI can read it from `result.sessionId` (which is what `waitForTask` already returns) without a second fetch.

### Step 4 — `public/index.html`: show the session id in the result area

After `waitForTask` returns (line 322), append a small "OpenCode session: `ses_…`" line under the existing folder/status block. The id is read from `result.sessionId` (now populated by Step 3.5). Click-to-copy via `navigator.clipboard.writeText` is included so the dev can paste it straight into the OpenCode TUI / curl. `lastTaskId` storage (line 336-338) is unchanged.

A new helper function:
```js
function renderSessionId(sessionId) {
  if (!sessionId) return;
  const el = document.createElement('div');
  el.className = 'session-id';
  el.innerHTML = `OpenCode session: <code>${sessionId}</code> <button>Copy</button>`;
  el.querySelector('button').onclick = () => navigator.clipboard.writeText(sessionId);
  document.querySelector('.result').appendChild(el);
}
```

### Step 5 — tests

**5.1. `services/ai.sessionLifecycle.test.ts` — update existing tests for new default.**
- The 4 existing tests assume `delete` is called unconditionally. They are updated to:
  - Pass `OPENCODE_KEEP_SESSION=false` and assert the old delete behavior (4 tests retained as the "opt-in" suite).
- 4 new tests added with default `OPENCODE_KEEP_SESSION=true`:
  1. `does not call session.delete after a successful resume generation`
  2. `does not call session.delete when the prompt throws`
  3. `does not call session.delete if session creation itself failed` (unchanged behavior)
  4. `rotation: rotates the client after OPENCODE_CLIENT_ROTATE_AFTER requests without leaking sessions` (asserts no delete on rotation, only on the explicit opt-in path)

**5.2. `services/ai.sessionInfo.test.ts` (new) — assert session id return value.**
- 3 tests:
  1. `generateResumeJSON returns { resume, sessionId }` with the id from `client.session.create`.
  2. `generateCoverLetterJSON returns { coverLetter, sessionId }` similarly.
  3. `generateCombinedJSON returns both sessionId (resume) and coverLetterSessionId (cover)`.
- All 3 mock the SDK the same way `ai.sessionLifecycle.test.ts` does.

**5.3. `routes/generate.test.ts` — assert UI/job-folder surfacing.**
- 2 new tests:
  1. `POST /generate followed by GET /generate/task/:id returns sessionId in the task response and the result object`.
  2. `the job folder contains session-info.txt with the sessionId and a second other-input.txt line pointing to it`.

---

## Risks

1. **Default-on session keep changes resource pressure on the OpenCode server.** The `OPENCODE_CLIENT_KEEPALIVE=false` + `OPENCODE_CLIENT_ROTATE_AFTER` knobs (`AI_PROMPT_TIMEOUT_PLAN.md` Options B) already bound socket usage at the *client* level; this change moves session accumulation to the *server* level. Mitigation: each session is small (a few KB of conversation history). At the observed prompt rate of 1–4 generations/day, server-side accumulation is not a concern in the short term. We can add a TTL-based cleanup sweep later if it ever becomes one.

2. **The 5-minute `HeadersTimeoutError` the user just hit is unrelated to this plan** (the user already noted this; the `AI_PROMPT_TIMEOUT_PLAN.md` is the right place for that fix). Keeping sessions does not *cause* that timeout — Option B's leak hypothesis is no longer the active theory. The new `Invalid response from OpenCode (sessionId=…, rawModelOutput=…)` line will give us the diagnostic data we need to figure out the next step (likely Option C: SSE, or a model-side token-budget cap).

3. **Two sessions per combined request doubles the surface area for the timeout bug.** Same mitigation as risk #2 — we are not making it worse, just making the failure observable.

4. **The `[timing] session.create OK … (id=ses_…)` log line is moving from `console.log` to `log()`.** Anyone parsing the tmux stdout (e.g. a future test harness) will see different output. No such harness exists in the repo; no action needed.

5. **`other-input.txt` placeholder line + post-hoc append.** If a downstream tool reads `other-input.txt` between the two writes (window: <1 s on the combined path), it will see the placeholder. No such tool exists in the repo; the job-folder UI treats `other-input.txt` as user-facing input, not machine input. Acceptable.

---

## Rollout checklist

- [ ] Branch off `main`: `git switch -c fix/opencode-session-keep`
- [ ] Step 1 edits to `services/ai.ts`
- [ ] Step 2 return-type changes
- [ ] Step 3 edits to `routes/generate.ts`
- [ ] Step 4 edits to `public/index.html`
- [ ] Step 5 test updates + new test files
- [ ] `npm run build` clean
- [ ] `npx vitest run` — all green (target: 60+ tests, was 57)
- [ ] `pre_commit_code_health_safeguard` — no regressions
- [ ] Manual smoke: generate a resume, confirm `ses_…` shows in the UI, in `other-input.txt`, and in `session-info.txt`. Confirm the session is still listed by the OpenCode server (`opencode session list` or TUI `> sessions`).
- [ ] Manual smoke: trigger the `Invalid response from OpenCode` failure again, confirm the new error message includes the session id and raw model output.
- [ ] PR description links to this plan and to `AI_PROMPT_TIMEOUT_PLAN.md`.

---

## Related plans

- `AI_PROMPT_TIMEOUT_PLAN.md` (sibling) — the headers-timeout work. Step 1 above is the "keep" counterpart to that plan's "delete in finally" choice; the version log in that plan's appendix is updated to record this reversal.
- `HARDENING_PLAN.md`, `ISOLATION_PLAN.md` (parent repo, not in scope here).
