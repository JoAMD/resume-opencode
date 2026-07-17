# Coding Conventions

**Analysis Date:** 2026-07-18

## Naming Patterns

**Files:**
- **Lowercase, dot-separated segments describing the feature under test.** Source files use plain lowercase names: `redactResume.ts`, `jobDescriptionSearch.ts`, `texCompiler.ts`. Test files mirror the source name and append `.test.ts` (no `__tests__` directories, no `spec.ts`): `services/redactResume.test.ts` co-located next to `services/redactResume.ts`. A handful of test files in `services/` use the form `ai.<feature>.test.ts` (e.g. `ai.privacy.test.ts`, `ai.concurrency.test.ts`, `ai.sessionLifecycle.test.ts`) to group multiple `ai.ts` behaviours by feature.
- Public/browser-side code lives in `public/` and follows the same lowercase convention (`utils.ts`, `index.html`, `suggestions.js`).
- One feature per file is the dominant style. Larger files (`services/ai.ts`, `routes/generate.ts`) are intentional and accumulate related helpers; new feature modules should still start as their own file.

**Functions:**
- **camelCase for every exported and unexported function** (`buildLatex`, `applyResumeCharLimitFlag`, `getResumeCharCount`, `createJobDirectory`, `enqueueAIRequest`, `runWithConcurrency`, `findLatestTexFile`, `compilePDFViaTectonic`). No PascalCase verbs.
- **PascalCase only for classes and custom error types** (`NoOpResultError` in `services/fixSuggestionsService.ts`).
- Predicate / guard functions use `is…` / `has…` / `can…` (`isRedactedResume`, `modelSupportsStructuredOutput`).
- Module-internal helpers are often prefixed with a verb that states the side effect (`readLazyFile`, `summariseFailure`, `requireExists`, `safeReadFile`, `assertRedactionHolds`, `resolveRedactedResume`).
- **Boolean env-flag readers use the verb form `XYZ_ENABLED = ... !== 'false'`** (see `services/atsAiService.ts:48` `const ATS_AI_ENABLED = (process.env.OPENCODE_ATS_AI ?? 'true').toLowerCase() !== 'false';` and `services/ai.ts:79` `const OPENCODE_KEEP_SESSION = (process.env.OPENCODE_KEEP_SESSION ?? 'true').toLowerCase() !== 'false';`).

**Variables:**
- **camelCase for locals and module-scope `let`/`const`** (`tmpRoot`, `sessionCalls`, `mockClient`, `findProjectRoot`).
- **SCREAMING_SNAKE_CASE for module-scope config constants** — both for env-derived values (`OPENCODE_MODEL`, `OPENCODE_PASSWORD`, `AI_CONCURRENCY`, `AI_PROMPT_TIMEOUT_MS`, `RESUME_CHAR_LIMIT`) and for project constants (`CSV_HEADER`, `CSV_FILENAME`, `ATTACH_ORDER`, `REDACTED_FILE_NAME`, `TECTONIC_URL`, `PDF_MAGIC`).
- **File-scope `const` is preferred over `let` everywhere**; `let` is reserved for genuinely reassigned state (caches, mutable module state in `ai.ts` such as `opencodeClientRequestCount`, `aiInFlight`).
- **Hard-coded "magic" limits/constants live at the top of the file** with a short inline comment when non-obvious (`RESUME_CHAR_LIMIT = 7784 // todo: hard-coded resume character limit for now` at `services/ai.ts:81`).

**Types:**
- **PascalCase for `type` / `interface` / `enum`** names: `ResumeData`, `ResumeExperience`, `ResumeSkills`, `JobContext`, `ApplicationRow`, `ApplySuggestionsInput`, `ApplySuggestionsResult`, `ATSAiAnalysisInput`, `BackupResult`, `SearchMode`.
- **The same name is reused for both the `type` and the `Result`/`Outcome`/`Output` interface** that wraps it (e.g. `RunOpenCodeResult`, `ATSAiAnalysisOutcome`, `ATSAnalysisOutput`, `FindResult`).
- **Const arrays are paired with a `type` derived from them**:
  ```ts
  export const PII_FIELDS = ['name', 'phone', 'email', ...] as const;
  export type PiiField = (typeof PII_FIELDS)[number];
  ```
  See `services/redactResume.ts:5-15`.
- **Discriminated unions use string literal `source?: 'ai' | 'regex'`** rather than numeric enums (see `services/types.ts:57` `ATSAnalysisResult.source`).
- **Builder/result interfaces end in `Result` / `Outcome` / `Output`**; input shapes end in `Input` (e.g. `ATSAnalysisInput`).

## Code Style

**Formatting:**
- **No `prettier`, no `biome`, no `.editorconfig` configured** in this repo. Style is whatever the author types and TypeScript is happy with.
- Observed defaults in `services/`, `routes/`, `public/`:
  - **2-space indentation** for TypeScript and JSON; 4-space for the small `.html` files.
  - **Single quotes** for strings (`'string'`) are the majority; JSON-schema literals in `services/ai.ts` (around lines 107-164, 293-352) inconsistently use **double quotes** because they're declared as plain JS object literals (`type: "object"`) — preserve that when editing schemas.
  - **Semicolons at the end of statements** are used throughout `services/*.ts`; one-off style in some larger functions drops them but the majority uses them.
  - **Trailing commas** are mixed; some files use them, some do not. The author does not consider it a blocker.
- TypeScript target is **`ES2021`**, **`NodeNext` modules**, **`node16` resolution** (`tsconfig.json`). Use `.js` extension in `import` paths for relative imports of TS modules when running compiled output (e.g. `import('./ai.js')` everywhere in `*.test.ts` and inside dynamically imported modules in `services/ai.ts:119`). For source-to-source imports inside the package, plain `from './ai'` (no `.js`) is also accepted because of `NodeNext` interop, but tests and dynamic imports are always `from './ai.js'`.

**Linting:**
- **No `.eslintrc*`, `eslint.config.*`, or `biome.json` present** in the repo root. Lint is whatever the IDE / reviewer enforces.
- TypeScript is set to **`"strict": false`** (`tsconfig.json:8`). Nullable values are guarded with explicit `if (!x) return ...` or `(x ?? 'default')` patterns rather than strict null checks. Do not assume `strict` is on.

## Import Organization

**Order:**
1. **External (Node + npm) imports** — `fs`, `path`, `os`, `child_process`, `express`, `axios`, `multer`, `slugify`, `dotenv`. Always `from '<package>'`.
2. **Internal relative imports**, alphabetised, with parent-relative paths first.
3. **Type-only imports use the leading `type` keyword** (`import { ResumeData } from './types';` is value-or-type, while `import type { Request } from 'express';` is type-only; `services/ai.ts:1` mixes both forms).
4. **Side-effect imports** are placed at the very top of the module to run first (e.g. `import 'dotenv/config';` at `server.ts:1`, `import './loadEnv';` is invoked as a function `loadEnv();` inside `services/ai.ts:9` and `services/atsAiService.ts:22`).
5. **`.js` extension in dynamic `import(...)` calls and `.test.ts` imports** because the test runner resolves them through `vitest.config.ts` and the build emits `.js`. The project mixes:
   ```ts
   import { generateResumeJSON } from '../services/ai';              // source file
   const mod = await import('./ai.js');                              // dynamic in tests
   vi.mock('./ai.js', async () => { ... });                          // vitest mock
   ```
   When writing a test that uses `vi.mock` or `await import(...)`, always include the `.js` suffix; when writing a source file that imports another source file at module top level, the `.js` suffix is optional.

**Path Aliases:**
- **No path aliases.** All imports are relative (`./ai`, `../services/types`). The `tsconfig.json` `paths` field is not set.

## Error Handling

**Strategy:**
- **Throw plain `Error` with a string message**, including the failing input and a stable reason:
  ```ts
  // services/backupService.ts:37
  throw new Error(`Cannot create backup: job directory does not exist: ${jobDir}`);
  // services/fixSuggestionsService.ts:89
  throw new Error('userSuggestions is required');
  // services/texCompiler.ts:21
  throw new Error(`pdflatex failed for ${path.basename(texPath)}: ${message}`);
  ```
  Errors always include the input that caused them; they are never just `throw new Error('fail')`.

- **Domain errors are a `class extends Error` with a stable `code`** for callers to switch on. The single example in the codebase is `NoOpResultError` in `services/fixSuggestionsService.ts:30`:
  ```ts
  export class NoOpResultError extends Error {
    readonly code = 'no-op';
    readonly backup: BackupResult;
    constructor(backup: BackupResult) { super('Model did not change the resume (no-op after retry)'); this.backup = backup; }
  }
  ```
  When a route handler needs to distinguish a domain error from a system error, it does `instanceof NoOpResultError` and reads `error.code` (see `routes/generate.test.ts:413-414` for the test pattern).

- **Catch-and-warn for best-effort side effects (logging, log file writes, optional cache invalidation)**:
  ```ts
  // services/logger.ts:20-24
  try { fs.appendFileSync(logFile, line + '\n', 'utf8'); } catch { /* ignore file write errors */ }
  // services/redactResume.ts:49-56
  try { const existing = fs.readFileSync(targetPath, 'utf8'); if (existing === serialized) return { ...wroteFile: false }; } catch { /* fall through and rewrite */ }
  ```
  A swallowed `catch` is always followed by an inline comment explaining why the throw is safe to ignore.

- **`logError(...)` is preferred over `throw` when the failure is non-fatal but the operator should know** (e.g. `services/atsAiService.ts:42-45` falls back to an empty prompt if the file read fails, `services/fixSuggestionsService.ts:213-215` logs and continues if the redacted-resume refresh fails).

- **Re-throw with extra context** when bubbling an error up. Pattern: `logError('context:', err); throw new Error('context failed: ' + (err instanceof Error ? err.message : String(err)));`. The `err instanceof Error ? err.message : String(err)` form is repeated everywhere — use it as the canonical shape.

- **AI / network failure fallback is a first-class return, not an exception**. The canonical example is `services/atsAiService.ts:308-353` `runAtsAiAnalysis`: try AI, on any throw return `source: 'regex'` with `fallbackReason: <message>`. New features that depend on the model should follow this pattern: never let a network/SDK exception surface raw to the caller; downgrade to the local-only path and report the reason.

- **Sanitise user-controlled message text** before it can land in regex / shell / LaTeX:
  - `services/ai.ts:14-29` `sanitizeJobDescription` strips emoji, smart quotes, dashes, pipes, backticks, brackets before sending to the model.
  - `services/latex.ts:38-51` `esc` escapes every LaTeX special character before substitution.
  - `services/redactResume.ts:19-27` `redactResumeForExternalModel` blanks PII fields before they leave the server. There is a **non-negotiable redaction guard** at `services/atsAiService.ts:209-218` `assertRedactionHolds` that throws if any PII field is non-empty after redaction; the test `services/ai.privacy.test.ts:163-185` enforces this invariant.

## Logging

**Framework:** Custom `services/logger.ts` (not `pino`, `winston`, etc.). Two functions only: `log(...args)` and `logError(...args)`.

**Patterns:**
- **`log(...)` is used at every state-change point** (session lifecycle, model call start/finish, backup, fallback, fallback reason, redacted-resume write). See `services/atsAiService.ts:42`, `services/ai.ts:58`, `services/fixSuggestionsService.ts:192`, `services/atsService.ts:39,98`.
- **`logError(...args)` is for failures** (caught errors, fallback-to-reason, sanitised `err.message`). Always pass the error as the trailing argument; `logError` extracts `err.stack ?? err.message` for `Error` instances (`services/logger.ts:27-35`).
- **Stringify any non-string arg with `JSON.stringify`** so the log line stays a single line — this is enforced by the logger itself (`services/logger.ts:17,28`).
- **Per-day log files** in `logs/server-YYYY-MM-DD.log`; the file write is best-effort (`try { fs.appendFileSync(...) } catch { /* ignore */ }`).
- **All log output is mirrored to `console.log` / `console.error`**; tests silence the logger with `vi.mock('./logger', () => ({ log: vi.fn(), logError: vi.fn() }))` (see `services/fixSuggestionsService.test.ts:38-41`, `services/backupService.test.ts:27-30`).
- **Logging is the only permitted cross-cutting observability tool.** No metrics, traces, or APM SDK is used.

## Comments

**When to Comment:**
- **Inline `//` above a non-obvious line** — kept short, often a one-phrase "what" hint: `// fall through and rewrite` (`services/redactResume.ts:55`), `// todo: hard-coded resume character limit for now` (`services/ai.ts:81`).
- **JSDoc / doc blocks are not used.** Function-level documentation is in the commit message / `docs/FEATURES.md`, not above the function.
- **`// FIXME` / `// HACK` / `// XXX` do not appear** in source. TODO comments do appear (e.g. `// todo: hard-coded resume character limit for now`) and should be tracked in `.planning/` if they need follow-up.
- **Comments that label disabled code use `// `** on every line that is commented out, not `/* */`. Example: `services/ai.ts:302-303` `// githubUrl: { type: "string" ... }` (disabled JSON-schema fields).

**JSDoc/TSDoc:**
- **Not used.** No `@param` / `@returns` / `@throws` tags anywhere. Public APIs are documented in `docs/FEATURES.md` and `README.md`; the TS types are the source of truth.

## Function Design

**Size:**
- **Most functions are 5-50 lines.** Larger functions exist (`routes/generate.ts` has multiple 100+ line request handlers; `services/ai.ts` is 1,453 lines and is the de-facto shared module) but they are split into clearly named private helpers above them.
- **Refactor when a function exceeds ~80 lines** OR has more than 3 distinct responsibilities. Prefer extracting to a `function` (not a `const`) so it can be mocked or replaced.

**Parameters:**
- **One positional `args` object for any function with 3+ parameters.** Examples:
  - `services/atsAiService.ts:273` `callAtsAnalysisModel({ model, sanitizedJD, jdKeywords, redactedResume, promptLogDir })`
  - `services/fixSuggestionsService.ts:181` `runWithNoOpRetry({ before, resume, userContent, modelCtx })`
  - `services/ai.ts:96-99` `finalizeResume(structured, model, promptLogDir, meta: { callerLabel, providedSessionId? })`
- **Optional parameters are explicit `?` and typed `T | undefined`**, never `?:` defaulted to `null`. Use `?? 'default'` rather than `|| 'default'` for env-driven strings so the empty string still passes through.

**Return Values:**
- **Async functions return `Promise<T>` where `T` is a domain type** (e.g. `Promise<ApplySuggestionsResult>`, `Promise<ResumeData>`). Never `Promise<unknown>`.
- **Side-effecting helpers return a small object that records the action's outcome**:
  - `services/redactResume.ts:39-61` `ensureRedactedResumeFile` → `{ path, redacted, wroteFile }`
  - `services/applications.ts:113-159` `appendApplication` → `{ appended: boolean; reason?: 'duplicate-job-dir' | 'no-job-dir'; row: ApplicationRow }`
  - `services/backupService.ts:48-66` `createVersionedBackup` → `{ version, backupDir, files }`
- **Functions that may legitimately return "nothing" return `null`, not `undefined` and not an empty `[]`** when the contract is "look up something on disk". See `services/jobDir.ts:31-44` `resolveJobDir` returns `string | null`; `services/jobDir.ts:88-95` `findLatestTexFile` returns `string | null`.
- **Pure render / parse functions return `string`** and never throw on edge cases — they emit an empty/placeholder. See `services/atsReport.ts:3-23` (`joinList`, `bulletList`, `gapList` all return the fallback string when the input is empty).

## Module Design

**Exports:**
- **Named exports only.** No `default export` in any source file. Test files use a dynamic `import('./module.js')` rather than a static default import. (The only `default` exports in the codebase are from third-party packages like `express`.)
- **Pure helpers that are only used inside one file are NOT exported** (e.g. `services/latex.ts:11-51` `toText`, `asArray`, `asRecord`, `esc`, `buildEducationEntries`, `buildExperienceEntries`, `buildProjectEntries`, `removeSectionIfEmpty` are all module-internal).
- **Stable public API surface is exposed via an `export … from` pattern is NOT used** — every public symbol is declared and exported in its own file.

**Barrel Files:**
- **No barrel files** (`index.ts` re-exports). Callers import directly from the leaf module (`import { buildLatex } from './latex';`, not `import { buildLatex } from '../services';`).
- **This is a deliberate choice** that makes the dependency graph easy to follow and avoids accidental cycles.

## Additional Style Notes

- **Module-scope `loadEnv();` is called at the top of every file that reads env vars at module-evaluation time** (`services/ai.ts:9`, `services/atsAiService.ts:22`). It is idempotent (`services/loadEnv.ts:5-9` short-circuits after the first call). New services that need `.env` should do the same.
- **Constants derived from env are computed at module load** with safe defaults and `Math.max(..., 1)` clamping (`services/ai.ts:75-79` `AI_CONCURRENCY`, `AI_PROMPT_TIMEOUT_MS`, `OPENCODE_KEEP_SESSION`). Tests mutate `process.env` *and* call `vi.resetModules()` + dynamic import to get a fresh module instance with the new env (`services/ai.concurrency.test.ts:6-23`, `services/ai.sessionLifecycle.test.ts:75-89`).
- **JSON is the only serialisation format** between layers (resume, cover letter, ATS analysis, applications, env profile). No YAML, no TOML, no MessagePack.
- **Async filesystem is not used.** All I/O is `fs.readFileSync` / `fs.writeFileSync` / `fs.mkdirSync` / `fs.appendFileSync` / `fs.copyFileSync` etc. The codebase is single-process; concurrency is handled by an in-process model queue (`aiInFlight` / `aiQueues` in `services/ai.ts:218-241`).
- **Stringly-typed env flags are converted to booleans at the boundary** with `(process.env.X ?? '<default>').toLowerCase() !== 'false'` (or `!== 'true'` for the inverse). Never use `Boolean(process.env.X)` — that is `true` for any non-empty string, which is wrong here.
- **Test files are part of the contract.** When you change a public function's signature, update the `.test.ts` file in the same change. Tests are not optional.
- **Prompts and templates live OUTSIDE the repo** (`docs/IGNORED_FILES.md`). The test setup (`vitest.setup.ts`) synthesises them in a `os.tmpdir()` directory before any test runs, so a fresh checkout with no `prompts/` symlink still passes `vitest run`. Do not move prompts into the repo.

---

*Convention analysis: 2026-07-18*
