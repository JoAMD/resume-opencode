# AI Prompt Headers Timeout — Status & Plan

**Branch / Commit:** `main` @ `bc63890` — `fix(ai): bound prompt fetch with AbortController to surface clean timeout`
**Worktree:** `fix/ai-prompt-headers-timeout` (still attached, harmless — commit already in `main`)

## Symptom

Under load, the `/generate` endpoint surfaced:

```
[AI ERROR] TypeError: fetch failed
  cause: HeadersTimeoutError: Headers Timeout Error
  code: 'UND_ERR_HEADERS_TIMEOUT'
  at ... executeOpencodePrompt (dist/services/ai.js:529)
```

The `client.session.prompt` call in `services/ai.ts` had no upper bound. When the OpenCode server stalled before sending response headers (typically because of accumulating keep-alive sockets from long-lived sessions), undici tripped its `headersTimeout` and the error bubbled up opaque and unactionable.

## What Was Done — Option A (✅ Shipped)

Wrapped the prompt fetch in an `AbortController` with a configurable timeout.

**`services/ai.ts`**

| Change | Detail |
| --- | --- |
| New env knob | `OPENCODE_AI_PROMPT_TIMEOUT_MS` (default `600000` = 10 min, min 1 s) |
| `executeOpencodePrompt` | Now creates an `AbortController`, sets a `setTimeout` that calls `ac.abort(new Error('OpenCode prompt timed out after Xms'))`, and forwards `ac.signal` to `client.session.prompt` |
| Logging | Adds `Prompt timeout (ms): <value>` line at the start of every `runOpenCode` run |
| Failure mode | Hangs now fail with a descriptive `Error` caught cleanly by the existing `try/catch` in `runOpenCode` (`services/ai.ts:680`). The undici `HeadersTimeoutError` is now the fallback, not the primary failure shape. |

**Verification (run on `main`)**

- `npm run build` — clean (`tsc -p tsconfig.json`)
- `npx vitest run` — **50/50 tests passing** across 6 files (including `services/ai.concurrency.test.ts`)
- Merged with `--no-ff`; merge commit `ee93a51` on `main`.

**Diff:** `services/ai.ts` +19 / −10. The `package-lock.json` drift from `npm install` in the worktree was intentionally excluded from the commit.

## Root Cause — Why "After a While"

The error only emerges under load because of two compounding issues in the existing code:

1. **Sessions never close.** `runOpenCode` calls `client.session.create(...)` (`ai.ts:434`) but never calls `client.session.delete(...)`. The OpenCode server retains the session (and its keep-alive HTTP connection) until manual cleanup.
2. **Singleton client reuse.** The SDK and client are cached as module-level singletons (`ai.ts:31-59`). Every prompt reuses the same fetch client, so keep-alive sockets accumulate inside its undici agent.

Together these gradually starve the OpenCode server's connection pool, causing response headers to be delayed past undici's `headersTimeout` (default 300 s on older Node, 60 s on newer; in your stack it's whatever the OpenCode binary defaults to).

**Option A is the safety net** that converts a hang into a clean error. **Option B is the cure** that prevents the hang from happening in the first place.

---

## What Is Remaining

### Option B — Recommended next step (1–2 h, design-safe)

**Goal:** stop leaking sessions and connections; make "after a while" failures go away, not just become reportable.

**Changes:**

1. **`runOpenCode` `finally` block** — call `client.session.delete({ path: { id: sessionId } })` after every prompt (success or error), wrapped in its own `try/catch` so cleanup errors never mask the real result.
2. **Refresh the client periodically** — after each successful `runOpenCode` (or every N requests), set `opencodeClient = null` so the next call constructs a new client. This releases the undici agent and its keep-alive socket pool.
3. **Disable HTTP keep-alive on the client config** — set `keepalive: false` (Node/undici honors this on `RequestInit`) so each prompt opens a fresh socket that closes immediately after the response. Trade-off: a small per-request TCP cost in exchange for bounded socket usage.
4. **Test** — extend `services/ai.concurrency.test.ts` to assert `session.delete` is called in both success and error paths.

**Risk:** low. The runtime shape doesn't change; only lifecycle does. The existing concurrency tests cover the queue/concurrency invariant that must keep passing.

### Option C — Refactor prompt to streaming/SSE (defer)

**Goal:** eliminate `headersTimeout` entirely by switching from a blocking `session.prompt(...)` to the SDK's `session.prompt.sse(...)` stream (`node_modules/@opencode-ai/sdk/dist/gen/client/client.gen.js:137-146`).

**Why it helps:** the server starts sending SSE event headers immediately, so the client never waits past the headers deadline. You also get progress events for UX and can abort early on bad outputs.

**Cost:** significant. `parseTextResult` / `parseStructuredResult` / `pollOutputFile` (`ai.ts:512-587`) all assume a single response. They'd need to be rebuilt around an async iterator of `message.part.delta` events. Tests would need updating.

**Recommend:** defer until Option B is in and we know whether `headersTimeout` is still occurring.

### Option D — Server-side tuning (only if you self-host `opencode serve`)

If you launch the OpenCode server yourself (e.g. in a long-lived supervisor), set its `http.Server` timeouts on launch:

```js
server.headersTimeout = 10 * 60_000   // 10 min
server.requestTimeout = 10 * 60_000
```

This is an OpenCode-binary configuration change, not in this repo.

---

## Rollout / Verification Checklist

For whichever option you take next:

- [ ] Re-run `npm run build` — must be clean
- [ ] Re-run `npx vitest run` — must stay 50/50
- [ ] Manual smoke test against a real OpenCode server: trigger a long prompt and confirm the abort message in logs
- [ ] If Option B: add unit test for `session.delete` lifecycle
- [ ] Push branch and open PR; reference this doc in the PR description

## References

- Files: `services/ai.ts:589-609` (new `executeOpencodePrompt`), `services/ai.ts:64` (new env constant), `services/ai.ts:611-685` (`runOpenCode`)
- SDK: `node_modules/@opencode-ai/sdk/dist/client.js:31-37` (fetch wrapper that explicitly disables `req.timeout`, confirming the SDK does **not** expose a `timeout` config — `AbortController` is the right tool)
- Sample error: captured in commit message `bc63890`
