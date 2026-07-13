# LLM Provider Abstraction — Unrefined Plan

Status: **DRAFT / unrefined.** Awaiting answers to the open questions at the bottom before refinement.

Session reference: `ses_0a4390295ffeFjQUEdwVqOkply` — [open in OpenCode web](http://100.68.164.48:4096/L2hvbWUvYWRmX2hvbWVfam9lbC9zcmMvY29waWxvdC9yZXN1bWUtb3BlbmNvZGU/session/ses_0a4390295ffeFjQUEdwVqOkply)

---

## Context

The resume tool currently routes all LLM work through the OpenCode SDK. Five call
sites share a single internal function, `runOpenCode()` in
`services/ai.ts:857`, plus one outlier in
`extractATSKeywordsFromJDViaAI` (`services/ai.ts:1357`) that already uses
`chat.completions.create` directly:

| Caller | Function | Schema? | Site |
| --- | --- | --- | --- |
| Resume generation | `runOpenCode` + `RESUME_JSON_SCHEMA` | yes | `services/ai.ts:1139` |
| Cover letter | `runOpenCode` + `COVER_LETTER_JSON_SCHEMA` | yes | `services/ai.ts:1191` |
| Combined resume + cover letter | `runOpenCode` + `COMBINED_JSON_SCHEMA` | yes | `services/ai.ts:1231` |
| ATS analysis (AI) | `runOpenCode` + `ATS_ANALYSIS_JSON_SCHEMA` | yes | `services/atsAiService.ts:290` |
| Apply suggestions (edit) | `runOpenCode` (no schema — free-form JSON) | no | `services/fixSuggestionsService.ts:204` |
| ATS keyword extraction | `client.chat.completions.create` | no | `services/ai.ts:1373` |

Shared concerns every call site relies on:

- Per-model concurrency / queueing — `enqueueAIRequest` + `runWithConcurrency`
  (`services/ai.ts:218`).
- Prompt timeouts / abort — `AI_PROMPT_TIMEOUT_MS`, `AbortController`
  (`services/ai.ts:824`).
- JSON schema → structured output, **or** text/JSON parse fallback
  (`parseStructuredResult`, `parseTextResult`,
  `services/ai.ts:695–752`).
- Prompt logging to disk — `writePromptFile` (`services/ai.ts:599`).
- Returning a `sessionId` for the "Open in OpenCode web" UI link — this is
  **OpenCode-specific** and will be `undefined` for other providers.
- Trim-reprompt session reuse — `providedSessionId` keeps the model in the same
  session for trimming (`services/ai.ts:952`).

The question: how easy is it to swap the backend (Claude, OpenAI API key, Claude
Code, etc.)? Answer: easy, with a thin provider interface and a small amount of
behavioural parity work.

---

## TL;DR

The seam already mostly exists. All five structured call sites funnel through
`runOpenCode()`. The work is:

1. Define an `LLMProvider` interface and a registry.
2. Extract the current `runOpenCode` body into `OpenCodeProvider`.
3. Implement one or more new providers (`OpenAIProvider`, `ClaudeProvider`,
   optionally `ClaudeCodeProvider`).
4. Pick the provider with a single env var, defaulting to `opencode`.
5. Migrate `extractATSKeywordsFromJDViaAI` onto the same provider.
6. Hide the OpenCode-only "Open in OpenCode web" link in the UI when no
   `sessionId` is returned.
7. Update `README.md` and `docs/FEATURES.md`; add this plan under
   `docs/plans/`.

Routes, services, concurrency queue, backup, LaTeX, and the per-tab UI state do
**not** change.

---

## What's there today (what I'm abstracting)

The four structured call sites in `ai.ts` and `atsAiService.ts` collapse to:

```ts
const result = await enqueueAIRequest(model, () =>
  runOpenCode({ systemPrompt, userContent, model, promptLogDir, jsonSchema })
);
const { structured, sessionId, usedStructuredOutput } = result;
```

That is the contract to preserve.

### OpenCode-specific bits that need to be parameterised

- **JSON schema in `promptBody.format`** — OpenCode-specific field
  (`services/ai.ts:639`).
- **`promptBody.model = { providerID, modelID }`** — OpenCode-specific
  (`services/ai.ts:643`).
- **`bash` tool fallback** — `extractJsonFromToolCalls` and
  `pollOutputFile` (`services/ai.ts:668`, `754`) are workarounds for models
  that don't support structured output and were instructed to write their
  output to a file. Pure chat-completions APIs don't have a `bash` tool, so the
  new providers must force JSON a different way (response_format / tool_use /
  strict prompt + parse).
- **`MODELS_WITHOUT_STRUCTURED_OUTPUT` allowlist**
  (`services/ai.ts:268–285`) — list of `qwen3.6`, `qwen3`, `kimi-k2.6`, etc.
  that the current code treats as "no schema". This is an OpenCode escape
  hatch and can be deleted once providers own their own capability decision.
- **`sessionId` for "Open in OpenCode web"** — the apply-suggestions UI builds
  a deep link from this. Other providers return `undefined` and the link is
  hidden.
- **Session reuse for trim reprompts** — the trim loop in
  `enforceResumeCharLimit` (`services/ai.ts:181`) reuses
  `providedSessionId` so each attempt sees prior context. Stateless providers
  (OpenAI, Claude) can fold the conversation into `messages[]` instead, or
  accept that trimming becomes single-turn.

---

## Recommended design: `LLMProvider` interface + registry

### 1. Interface in `services/llm/types.ts`

```ts
export interface LLMRequest {
  model: string;
  systemPrompt: string;
  userContent: string;
  jsonSchema?: object;
  promptLogDir?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Reserved for session-style providers; stateless providers ignore it. */
  providedSessionId?: string;
}

export interface LLMResponse {
  structured: unknown;
  rawText: string;
  usedStructuredOutput: boolean;
  /** For OpenCode web deep-link; undefined for stateless providers. */
  sessionId?: string;
  /** For diagnostics / error surfacing. */
  rawModelOutput?: string;
}

export interface LLMCapabilities {
  /** Provider natively accepts a JSON schema (json_schema / tool_use). */
  supportsJsonSchema: boolean;
  /** Provider can carry state across calls (OpenCode session reuse). */
  supportsSessionReuse: boolean;
}

export interface LLMProvider {
  name: string;
  capabilities: LLMCapabilities;
  run(req: LLMRequest): Promise<LLMResponse>;
}
```

### 2. Implementations

- `services/llm/opencodeProvider.ts` — wraps the current `runOpenCode` body
  verbatim. `supportsSessionReuse = true`.
- `services/llm/openaiProvider.ts` — uses `openai` (npm) with
  `client.chat.completions.create({ model, messages,
  response_format: { type: 'json_schema', strict: true, schema } })`.
  Falls back to `json_object` mode and then to a strict prompt +
  `parseJSONFromResponse` for models without `json_schema`.
  `supportsSessionReuse = false`. No `sessionId`.
- `services/llm/claudeProvider.ts` — uses `@anthropic-ai/sdk` with
  `messages.create({ model, system, messages, tools: [{ name: 'json_output',
  input_schema: <jsonSchema> }] })` to force structured output via
  `tool_use`. `supportsSessionReuse = false`.
- `services/llm/claudeCodeProvider.ts` (optional) — shells out to the
  `claude` CLI with `--output-format json --system-prompt <file> --print`,
  parses stdout. Useful if the user wants Anthropic models but no API key.

### 3. Registry + selection

```ts
// services/llm/registry.ts
const providers = new Map<string, LLMProvider>();
providers.set('opencode', new OpenCodeProvider());
providers.set('openai', new OpenAIProvider());
providers.set('claude', new ClaudeProvider());

export function getProvider(name = process.env.LLM_PROVIDER ?? 'opencode'): LLMProvider {
  const p = providers.get(name);
  if (!p) throw new Error(`Unknown LLM_PROVIDER: ${name}`);
  return p;
}
```

### 4. The one-line change in `ai.ts`

`runOpenCode` becomes a thin adapter so the existing call sites keep working:

```ts
export async function runOpenCode(opts: RunOpenCodeOptions): Promise<RunOpenCodeResult> {
  return getProvider().run({
    model: opts.model ?? OPENCODE_MODEL,
    systemPrompt: opts.systemPrompt,
    userContent: opts.userContent,
    jsonSchema: opts.jsonSchema,
    promptLogDir: opts.promptLogDir,
    providedSessionId: opts.providedSessionId,
  });
}
```

`extractATSKeywordsFromJDViaAI` (`services/ai.ts:1357`) is migrated onto the
same provider so the hardcoded `client.chat.completions.create` to
`openai/gpt-4o` is no longer a separate code path.

### 5. Env contract

Added to `.env.example`:

```
# LLM_PROVIDER: opencode (default) | openai | claude
LLM_PROVIDER=opencode
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
```

The existing `OPENCODE_MODEL` / `OPENCODE_ATS_ANALYSIS_MODEL` are kept; for
`LLM_PROVIDER=openai` the model is a plain OpenAI model id like
`gpt-4o-mini`, for `LLM_PROVIDER=claude` it's e.g. `claude-3-5-sonnet-latest`.

---

## Considerations / things that will hurt

1. **Structured output is the load-bearing feature.** Every caller passes a
   `jsonSchema` and expects a parsed object back. For OpenAI this is
   `response_format: { type: 'json_schema', strict: true, schema }` (gated to
   `gpt-4o-2024-08-06+` and `gpt-4o-mini`). For Claude, `tool_use` with the
   schema as `input_schema` is the cleanest analogue. For Claude Code CLI,
   strict-prompt + `parseJSONFromResponse` (the existing helper at
   `services/ai.ts:519`).
2. **Trim reprompts reuse the OpenCode session** via `providedSessionId`
   (`services/ai.ts:952`). Stateless providers can either resend the
   conversation as `messages[]` (OpenAI/Claude support multi-message history;
   the provider folds `systemPrompt` + previous `userContent` turns into the
   message array) or accept slightly lower trim quality — trimming is a
   constrained task so single-turn is probably fine.
3. **Session-based UI features** — the "Open in OpenCode web" link in
   `public/suggestions.js` uses `sessionId`. With non-OpenCode providers,
   `sessionId` is undefined and the link should be hidden. The result type
   already allows that; the UI change is one place.
4. **Prompt-log dir naming** — the current prompt file is
   `opencode-prompt-<ts>.txt` (`services/ai.ts:871`). Rename to
   `llm-prompt-<ts>.txt` or parameterise per provider.
5. **Model allowlist** — `MODELS_WITHOUT_STRUCTURED_OUTPUT`
   (`services/ai.ts:268`) is OpenCode-specific. Move to per-provider
   capability map; the new providers decide for themselves.
6. **Privacy/ATS redaction** — `atsAiService.ts` already redacts PII via
   `redactResume.ts` before calling the model, so the ATS flow is safe for any
   provider. But the resume/cover-letter flows do **not** redact. With an
   external provider the full resume and the full base resume text go out.
   Consider a `requiresRedaction: boolean` capability on the provider so the
   redaction step is also provider-aware.
7. **Test impact** — `ai.sessionLifecycle.test.ts`,
   `ai.sessionInfo.test.ts`, `ai.concurrency.test.ts`,
   `ai.resumeCharLimit.test.ts`, `fixSuggestionsService.test.ts`,
   `atsAiService.test.ts` all mock `runOpenCode`. They'll keep working as long
   as the public `runOpenCode` symbol is preserved. If you want
   provider-specific tests, mock the provider instead.
8. **Timeouts** — `AI_PROMPT_TIMEOUT_MS` and the `AbortController`
   (`services/ai.ts:824`) need to be threaded into the new provider's request
   call. `LLMRequest.signal` covers that.
9. **Docs** — per `AGENTS.md` Section 3 this is a user-facing capability
   change (new env var, new provider options, new model dropdown semantics).
   `README.md` and `docs/FEATURES.md` both need updates; this plan is the
   `docs/plans/` entry that catches the design.

---

## Suggested implementation order

1. Create `services/llm/types.ts`, `services/llm/registry.ts`,
   `services/llm/opencodeProvider.ts` (extract from current `runOpenCode`).
   No behaviour change.
2. Add `LLM_PROVIDER` env + `OpenCodeProvider` wiring. Verify all existing
   tests pass.
3. Add `OpenAIProvider` (least surprise, most aligned with the existing
   `chat.completions` call in `extractATSKeywordsFromJDViaAI`). Add a small
   `services/llm/openaiProvider.test.ts` with a recorded response.
4. Add `ClaudeProvider` (Anthropic SDK with `tool_use`-based JSON output).
   Test.
5. Migrate `extractATSKeywordsFromJDViaAI` onto the same provider.
6. Hide the "Open in OpenCode web" link in `public/suggestions.js` when
   `sessionId` is undefined.
7. Update `docs/FEATURES.md` and `README.md`.

Each step is small and individually testable; no step touches route handlers,
the concurrency queue, the LaTeX/backup services, or the UI's per-tab state.

---

## Open questions (to be resolved before refinement)

1. **Which provider(s) first?** OpenAI is the most natural drop-in
   (chat-completions is already in the codebase for keyword extraction).
   Claude is the same shape but uses `tool_use` instead of `response_format`.
   Claude Code CLI is a third option that avoids the SDK entirely.
2. **Per-feature provider selection or one global `LLM_PROVIDER`?**
   Per-feature (e.g. `LLM_PROVIDER_RESUME`, `LLM_PROVIDER_ATS`) is more
   flexible but means more env vars; global is simpler.
3. **Session reuse on the trim loop** — okay to lose it (single-turn trim is
   fine for shortening bullets) or implement conversation-history folding for
   OpenAI/Claude providers?
4. **PII concerns** — the ATS flow already redacts, but the resume and
   cover-letter flows do not. With an external provider, the full resume and
   base resume text go out. Acceptable, or add a `requiresRedaction: true`
   mode for non-OpenCode providers that reuses `redactResume.ts`?
5. **Scope** — land in one PR (interface + one provider) or interface + all
   three providers?
