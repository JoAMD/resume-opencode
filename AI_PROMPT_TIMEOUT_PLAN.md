# AI Prompt Headers Timeout — Status, Plan, and Test Runbook

**Worktree:** `fix/ai-session-lifecycle` @ `5cc911f` (branched from `main` @ `1c8b617`)
**Scope:** Options A + B complete; debug endpoint shipped for Option B validation; Option C/D still deferred.

---

## TL;DR

| Option | What it does | Status |
| --- | --- | --- |
| **A** — `AbortController` bound on `client.session.prompt` | Converts a hang into a clean, descriptive timeout error. | ✅ Shipped on `main` (`bc63890`). |
| **B** — Session lifecycle + client rotation + `keepalive: false` | Stops the leak that caused "after a while" failures. | ✅ Implemented in this worktree (`5cc911f`). |
| **C** — Switch `session.prompt` → `session.prompt.sse(...)` | Eliminates `headersTimeout` entirely by streaming. | ⏸ Deferred — design-safe, significant refactor. |
| **D** — Server-side `headersTimeout`/`requestTimeout` tuning | Only relevant if you self-host `opencode serve`. | ⏸ Out of repo. |

---

## Symptom (re-cap)

```
[AI ERROR] TypeError: fetch failed
  cause: HeadersTimeoutError: Headers Timeout Error
  code: 'UND_ERR_HEADERS_TIMEOUT'
  at executeOpencodePrompt (services/ai.ts:631)
```

The `client.session.prompt` call had no upper bound. When the OpenCode server stalled before sending response headers (typically because of accumulating keep-alive sockets from long-lived sessions), undici tripped its `headersTimeout` and the error bubbled up opaque and unactionable.

A second, related symptom seen in production logs:
```
Error: Invalid response from OpenCode
  at generateCombinedJSON (services/ai.ts:743)
```
This is a *truncated JSON parse* from the model finishing mid-token — same root cause (leak → prompt runs out of time/budget server-side).

---

## Option A — ✅ Shipped (on `main`, commit `bc63890`)

Wrapped the prompt fetch in an `AbortController` with a configurable timeout.

`services/ai.ts`

| Change | Detail |
| --- | --- |
| New env knob | `OPENCODE_AI_PROMPT_TIMEOUT_MS` (default `600000` = 10 min, min 1 s) |
| `executeOpencodePrompt` | Creates an `AbortController`, sets a `setTimeout` that calls `ac.abort(new Error('OpenCode prompt timed out after Xms'))`, forwards `ac.signal` to `client.session.prompt`. |
| Logging | Adds `Prompt timeout (ms): <value>` line at the start of every `runOpenCode` run. |
| Failure mode | Hangs now fail with a descriptive `Error` caught cleanly by the existing `try/catch` in `runOpenCode`. The undici `HeadersTimeoutError` is now the fallback, not the primary failure shape. |

---

## Option B — ✅ Implemented in this worktree (commit `0c06f68`)

### Goal
Stop leaking sessions and connections; make "after a while" failures go away, not just become reportable.

### Changes (3 files, +289 / −3)

**1. `services/ai.ts` (+52 / −3)**
- New env knobs:
  - `OPENCODE_CLIENT_KEEPALIVE` (default `false`) — forwarded as `keepalive` on `RequestInit`. Disables per-socket reuse; each prompt opens a fresh socket that closes immediately after the response.
  - `OPENCODE_CLIENT_ROTATE_AFTER` (default `50`) — count-based client rotation. After N requests, the cached `opencodeClient` is set to `null` so the next call constructs a new client (releasing the undici agent + keep-alive pool).
- `getOpencodeClient()` — rotated when count ≥ threshold; logs `Rotating OpenCode client after N requests to release keep-alive sockets`.
- New `deleteOpencodeSession(client, sessionId)` — calls `client.session.delete({ path: { id: sessionId } })`, errors are logged non-fatally.
- `runOpenCode` — captures `client` and `sessionId` in outer scope, adds a `finally` block that always calls `deleteOpencodeSession`. `sessionId` is `null` if `createOpencodeSession` itself threw, in which case delete is skipped.
- New `maybeApplyDebugSleep(signal)` — reads `OPENCODE_DEBUG_PROMPT_SLEEP_MS`; if > 0, awaits a `setTimeout` (cancellable via the AbortController's `signal`) before calling `client.session.prompt`. Used by the debug endpoint to simulate a slow upstream.

**2. `routes/generate.ts` (+44 / 0)**
- New `POST /generate/debug/slow-prompt` — **gated by `ENABLE_DEBUG_ROUTES=true`**. Body: `{ sleepMs, jobDescription?, extraNotes?, modelSelect? }`. Sets `OPENCODE_DEBUG_PROMPT_SLEEP_MS` for the duration of the call, calls `generateResumeJSON`, returns `{ ok, elapsedMs, name }` or `{ ok: false, elapsedMs, error, code }`.
- Default-off so it can't be hit in production by accident.

**3. `services/ai.sessionLifecycle.test.ts` (new, +193)**
- 4 tests (mocked SDK):
  1. `calls session.delete on the success path`
  2. `still calls session.delete when the prompt throws`
  3. `does not call session.delete if session creation itself failed`
  4. `rotates the client after OPENCODE_CLIENT_ROTATE_AFTER requests and reuses session.delete`

### Verification
- `npm run build` — clean (`tsc -p tsconfig.json`).
- `npx vitest run` — **57/57 tests passing** across 7 files (50 prior + 4 new lifecycle + 3 already-existing on `ai.concurrency`/`generate` etc.).
- No changes to `prompts/` or `templates/`. Code-only.

---

## Option C — ⏸ Deferred

**Goal:** eliminate `headersTimeout` entirely by switching from a blocking `session.prompt(...)` to the SDK's `session.prompt.sse(...)` stream (`node_modules/@opencode-ai/sdk/dist/gen/client/client.gen.js:137-146`).

**Why it helps:** the server starts sending SSE event headers immediately, so the client never waits past the headers deadline. You also get progress events for UX and can abort early on bad outputs.

**Cost:** significant. `parseTextResult` / `parseStructuredResult` / `pollOutputFile` all assume a single response. They'd need to be rebuilt around an async iterator of `message.part.delta` events. Tests would need updating.

**Recommend:** defer until Option B is in production for a real burn-in period and we can confirm whether `headersTimeout` is still occurring.

---

## Option D — ⏸ Out of repo

If you launch the OpenCode server yourself (e.g. in a long-lived supervisor), set its `http.Server` timeouts on launch:

```js
server.headersTimeout = 10 * 60_000   // 10 min
server.requestTimeout = 10 * 60_000
```

This is an OpenCode-binary configuration change, not in this repo. Recommend: do this in the `opencode` Docker/launch config, not here.

---

## Rollout / Verification Checklist

For the merged branch:

- [x] Re-run `npm run build` — clean
- [x] Re-run `npx vitest run` — 57/57 passing
- [ ] Manual smoke test via debug endpoint (see runbook below)
- [ ] Push branch and open PR; reference this doc in the PR description
- [ ] After merge: re-deploy and watch production logs for `Rotating OpenCode client after N requests...` and zero new `HeadersTimeoutError` over a multi-day window

---

# Test Runbook — How to Validate the Timeout Fix

## Prereqs
- An OpenCode server running locally on `http://localhost:4096` (or set `OPENCODE_HOSTNAME`/`OPENCODE_PORT`).
- A `.env` in this worktree (`cp ../resume-opencode/.env .env` if not present).
- `node_modules` present (`npm install` if not).

## Step 1 — Build & test (baseline)
```bash
cd ~/.local/share/opencode/worktree/2b8a1538785307c7a14ebb52a3dfa52bc3d2b581/fix/ai-session-lifecycle
npm run build          # → tsc, no output = OK
npx vitest run         # → 57/57 passing
```

## Step 2 — Start the server with the debug route enabled

In one terminal:
```bash
cd ~/.local/share/opencode/worktree/2b8a1538785307c7a14ebb52a3dfa52bc3d2b581/fix/ai-session-lifecycle
ENABLE_DEBUG_ROUTES=true \
OPENCODE_AI_PROMPT_TIMEOUT_MS=15000 \
npm start
```

- `ENABLE_DEBUG_ROUTES=true` — registers `POST /generate/debug/slow-prompt`.
- `OPENCODE_AI_PROMPT_TIMEOUT_MS=15000` — overrides the 10-min default down to **15 s** so the test runs fast.

You should see `Resume OpenCode tool running at http://localhost:3001` (port 3001 per `server.ts:18`).

## Step 3 — Trigger the slow-prompt timeout (primary test)

In another terminal:
```bash
curl -s -X POST http://localhost:3001/generate/debug/slow-prompt \
  -H 'Content-Type: application/json' \
  -d '{"sleepMs": 30000, "modelSelect": "opencode/gpt-5-nano"}' | jq
```

**Expected response (HTTP 500, ~15 s):**
```json
{
  "ok": false,
  "elapsedMs": ~15000,
  "error": "OpenCode prompt timed out after 15000ms",
  "name": "Error",
  "code": undefined
}
```

**Expected server logs:**
```
========== OPENCODE STARTING ==========
Model: opencode/gpt-5-nano
Structured output: yes
Prompt timeout (ms): 15000
DEBUG: sleeping for 30000 ms before client.session.prompt (simulate slow upstream)
[AI ERROR] Error: OpenCode prompt timed out after 15000ms
```

**What this proves:**
- The AbortController (Option A) fires *before* undici's `headersTimeout`.
- The error is clean, descriptive, and caught by the existing `try/catch`.
- Crucially, **no `HeadersTimeoutError: UND_ERR_HEADERS_TIMEOUT`** — Option A is now the primary defense.

## Step 4 — Verify `session.delete` is called in the finally block

Watch the server logs for the session lifecycle. After the request above completes (with either success or the 15-s timeout), the server should have called `client.session.delete({ path: { id: <sessionId> } })`. The `deleteOpencodeSession` function logs to `logError` only on error, so a clean exit is silent — that's correct.

To make it visible, temporarily add `console.log('session deleted:', sessionId)` inside `deleteOpencodeSession` and re-run the curl. Remove the log before committing.

## Step 5 — Verify client rotation

Set a low rotation threshold and hit the endpoint a few times:
```bash
ENABLE_DEBUG_ROUTES=true \
OPENCODE_CLIENT_ROTATE_AFTER=3 \
OPENCODE_AI_PROMPT_TIMEOUT_MS=15000 \
npm start
```

Then run the curl **4 times in a row**:
```bash
for i in 1 2 3 4; do
  curl -s -X POST http://localhost:3001/generate/debug/slow-prompt \
    -H 'Content-Type: application/json' \
    -d '{"sleepMs": 1000, "modelSelect": "opencode/gpt-5-nano"}' > /dev/null
done
```

**Expected log line on the 4th request:**
```
Rotating OpenCode client after 3 requests to release keep-alive sockets
```

This proves the rotation counter is firing and the cached `opencodeClient` is being nulled so the next call gets a fresh undici agent.

## Step 6 — Confirm the `Invalid response from OpenCode` symptom is also fixed (optional)

If you can reproduce the truncated-JSON error on `main`, re-run the same job against this worktree's server. With sessions no longer leaking server-side, the model should have more time/budget per request and complete the JSON. If you still see truncation, it's a prompt-size issue, not a leak issue — consider Option C (SSE) or shrinking the combined-prompt.

## Step 7 — Tear down
```bash
# Ctrl-C the server
unset ENABLE_DEBUG_ROUTES
# (Leave OPENCODE_AI_PROMPT_TIMEOUT_MS at 600000 in .env for production)
```

---

## References

- Worktree: `~/.local/share/opencode/worktree/2b8a1538785307c7a14ebb52a3dfa52bc3d2b581/fix/ai-session-lifecycle`
- Branch: `fix/ai-session-lifecycle`
- Files touched (this branch vs main):
  - `services/ai.ts` (+52 / −3)
  - `routes/generate.ts` (+44 / 0)
  - `services/ai.sessionLifecycle.test.ts` (new, +193)
- SDK: `node_modules/@opencode-ai/sdk/dist/client.js:31-37` (fetch wrapper that explicitly disables `req.timeout`, confirming the SDK does **not** expose a `timeout` config — `AbortController` is the right tool)
- Main repo plan: `../resume-opencode/AI_PROMPT_TIMEOUT_PLAN.md` (now superseded by this doc for the worktree).
