# Testing Patterns

**Analysis Date:** 2026-07-18

## Test Framework

**Runner:**
- **Vitest 3.2.6** (`package.json:25,29`). Config lives in `vitest.config.ts` (12 lines).
- **`environment: 'happy-dom'`** — gives the tests a DOM so `public/utils.ts` and any browser-side code can run, but no real network or persistence.
- **`globals: true`** — `describe`, `it`, `expect`, `beforeEach`, `afterEach`, `vi`, `beforeAll`, `afterAll` are available without importing them, though the test files in this repo *do* still import them explicitly for clarity (see `services/redactResume.test.ts:1`).
- **`include: ['public/**/*.test.ts', 'services/**/*.test.ts', 'routes/**/*.test.ts']`** — tests are restricted to the three source-bearing directories; `scripts/` and `server.ts` are not under test.

**Assertion Library:**
- **`expect` from Vitest** (Chai-compatible API). No separate assertion library.

**Run Commands:**
```bash
npm test                  # vitest run  (single pass, CI mode)
npm run test:watch        # vitest       (interactive, rerun on change)
npx vitest run services/  # run only one directory
npx vitest run -t "redactResume"   # run only tests whose name matches the pattern
```
- `package.json:10-11` defines `test` → `vitest run` and `test:watch` → `vitest`.
- **No coverage runner is configured.** `vitest run --coverage` will fail because `@vitest/coverage-v8` is not in `devDependencies` even though `@vitest/ui` is. If a future task adds coverage requirements, install `@vitest/coverage-v8` and add `test:coverage` to `package.json`.

## Test File Organization

**Location:**
- **Strictly co-located next to the source file.** `services/ai.ts` → `services/ai.test.ts` (plus the per-feature `ai.<feature>.test.ts` siblings). `routes/generate.ts` → `routes/generate.test.ts`. `public/utils.ts` → `public/utils.test.ts`. There is no top-level `__tests__/` directory and no `test/` directory.

**Naming:**
- **`<source-basename>.test.ts`** (e.g. `redactResume.test.ts`, `atsReport.test.ts`, `latex.coverLetter.test.ts`).
- For `services/ai.ts` specifically, tests are split by **feature** rather than by source structure: `ai.privacy.test.ts`, `ai.sanitize.test.ts`, `ai.concurrency.test.ts`, `ai.coverLetter.test.ts`, `ai.sessionInfo.test.ts`, `ai.sessionLifecycle.test.ts`, `ai.resumeCharLimit.test.ts`. The single `ai.test.ts` (if it ever existed) is not present — feature files have replaced it.
- For `services/fixSuggestionsService.ts`, two test files exist: `fixSuggestionsService.test.ts` (happy path) and `fixSuggestionsService.failures.test.ts` (error/edge cases). Mirror this split if a future module grows large.
- **No `.spec.ts` files.** Always `.test.ts`.

**Structure:**
```
src-root/
├── public/
│   ├── utils.ts
│   └── utils.test.ts
├── routes/
│   ├── generate.ts
│   └── generate.test.ts
└── services/
    ├── ai.ts
    ├── ai.privacy.test.ts
    ├── ai.sanitize.test.ts
    ├── ai.concurrency.test.ts
    ├── ai.coverLetter.test.ts
    ├── ai.sessionInfo.test.ts
    ├── ai.sessionLifecycle.test.ts
    ├── ai.resumeCharLimit.test.ts
    ├── redactResume.ts
    └── redactResume.test.ts
```

## Test Structure

**Suite Organization:**
- **One top-level `describe` per exported function** (or per top-level concern for the feature-split `ai.*.test.ts` files). Nested `describe` blocks group by input shape or branch.
  ```ts
  // services/redactResume.test.ts
  describe('redactResumeForExternalModel', () => { ... });
  describe('isRedactedResume', () => { ... });
  describe('ensureRedactedResumeFile', () => { ... });
  describe('loadRedactedResumeFromDir', () => { ... });
  ```
- **`describe` strings are the function name verbatim** — no `'<file> > <func>'` prefix, no `'should …'`.
- **Each `it` describes behaviour, not the implementation.** Convention: imperative third person, no leading "should" in most files (the older `public/utils.test.ts` does use "should …"; both are accepted; new tests should follow the imperative style of `redactResume.test.ts`):
  ```ts
  it('strips every PII field to empty string', ...);            // services/redactResume.test.ts
  it('returns a taskId and resolves to complete when the service succeeds', ...);  // routes/generate.test.ts
  it('does not call session.delete if session creation itself failed', ...);        // services/ai.sessionLifecycle.test.ts
  ```

**Patterns:**
- **Setup pattern: per-`describe` `beforeEach` snapshots and restores `process.env`**, then sets the test-specific env. See `services/ai.sessionLifecycle.test.ts:95-113` and `services/ai.resumeCharLimit.test.ts:155-174`. The standard shape is:
  ```ts
  beforeEach(() => {
    savedEnv = { OPENCODE_FOO: process.env.OPENCODE_FOO, ... };
    process.env.OPENCODE_AI_CONCURRENCY = '1';
    process.env.OPENCODE_AI_QUEUE = 'false';
    // etc.
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  ```
- **Teardown pattern: `tmpLogDir = fs.mkdtempSync(...)` in `beforeEach`; `fs.rmSync(tmpLogDir, { recursive: true, force: true })` in `afterEach`.** The repo never leaks temp directories.
- **Assertion pattern: `expect(value).toEqual(expected)`** for object/array deep equality; `expect(value).toBe(x)` for primitives; `expect(value).toContain('substring')` and `expect(value).toMatch(/regex/)` for string content; `expect(fn).toThrow(/regex/)` for errors.
- **Use `expect(value, \`message ${field}\`)`** to attach a discriminator when asserting across a loop. The most common form is asserting every PII field:
  ```ts
  for (const field of PII_FIELDS) {
    const value = (redacted as unknown as Record<string, unknown>)[field];
    expect(value, `field ${field} should be empty`).toBe('');
  }
  ```
  See `services/redactResume.test.ts:58-62`, `services/ai.privacy.test.ts:181-185`.

## Mocking

**Framework:** **Vitest's built-in `vi`** (`vi.fn`, `vi.mock`, `vi.resetModules`, `vi.importActual`, `vi.restoreAllMocks`, `vi.clearAllMocks`). No Jest, no Sinon, no MSW.

**Patterns:**

**1. Module mocks via `vi.mock(path, factory)`:**
- **Always use the `.js` extension** when mocking a TS file: `vi.mock('./ai.js', ...)` (`services/fixSuggestionsService.test.ts:11`, `services/atsAiService.test.ts:36`).
- **Mock factories export only the surface the test needs.** For logger, this is the canonical silence:
  ```ts
  vi.mock('./logger', () => ({ log: vi.fn(), logError: vi.fn() }));
  ```
  Used in `services/fixSuggestionsService.test.ts:38-41`, `services/backupService.test.ts:27-30`, `services/fixSuggestionsService.failures.test.ts:39-42`.
- **Mock `fs` to control the filesystem** in tests that exercise filesystem logic without touching real disk. Pattern: hoist `vi.fn()` declarations, then mock the module with both default and named forms (Vitest dual-form because some files import `import fs from 'fs'` and others `import * as fs from 'fs'`):
  ```ts
  // services/generate.test.ts:6-52 (abridged)
  const existsSync = vi.fn();
  const mkdirSync = vi.fn();
  // ... more
  vi.mock('fs', () => ({
    default: { existsSync: (...a) => existsSync(...a), mkdirSync: (...a) => mkdirSync(...a), ... },
    existsSync: (...a) => existsSync(...a), mkdirSync: (...a) => mkdirSync(...a), ...
  }));
  ```
  This is the dominant pattern for `routes/generate.test.ts` (503 lines of it) and `services/backupService.test.ts` (130 lines). Per-test, the mocks are reset and re-implemented with `existsSync.mockImplementation((p) => ...)`.
- **Mock the OpenCode SDK with `vi.mock('@opencode-ai/sdk', () => ({ createOpencodeClient: vi.fn() }))`** and then call the mock factory with `(createOpencodeClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => mockClient)`. See `services/ai.sessionLifecycle.test.ts:44-89` for the canonical pattern; it is duplicated almost identically in `services/ai.sessionInfo.test.ts:53-107`, `services/ai.resumeCharLimit.test.ts:62-115`.
- **Mock the `./paths` module to redirect the project root into a `os.tmpdir()`** (essential for filesystem-touching tests):
  ```ts
  // services/jobDescriptionSearch.test.ts:6-9
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-opencode-jd-search-'));
  vi.mock('../services/paths', () => ({ findProjectRoot: () => tmpRoot }));
  ```
  Same pattern at `services/applications.test.ts:6-9`.

**2. Partial mocks with `vi.importActual`:**
- **Use `vi.importActual<typeof import('./module.js')>('./module.js')` to keep most of the module real and override one function:**
  ```ts
  // services/atsAiService.test.ts:36-44
  vi.mock('./ai.js', async () => {
    const actual = await vi.importActual<any>('./ai.js');
    return {
      ...actual,
      runOpenCode: (...args: any[]) => (runOpenCodeMock as any)(...args),
      enqueueAIRequest: (model, work) => enqueueMock(model, work),
      extractATSKeywordsFromJDViaAI: (...args) => (extractKeywordsMock as any)(...args),
    };
  });
  ```
  This is the standard for "I want to replace one function but keep the rest of the module's behaviour" (`services/fixSuggestionsService.test.ts:30-36` does the same for `redactResume`).

**3. Dynamic imports + `vi.resetModules()` to re-evaluate modules with new env:**
- **The canonical loader for `services/ai.ts` is the `loadModule` helper.** Re-used in `ai.concurrency.test.ts`, `ai.sessionLifecycle.test.ts`, `ai.sessionInfo.test.ts`, `ai.resumeCharLimit.test.ts`. Always shape:
  ```ts
  async function loadModule(envOverrides: Record<string, string | undefined> = {}) {
    vi.resetModules();
    sessionCalls.length = 0;
    sessionCounter = 0;
    mockClient = undefined;
    for (const [k, v] of Object.entries(envOverrides)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    const mod = await import('./ai.js');
    const { createOpencodeClient } = await import('@opencode-ai/sdk');
    mockClient = buildMockClient();
    (createOpencodeClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => mockClient);
    return mod;
  }
  ```
  Every test in those files calls `const { generateResumeJSON } = await loadModule({ ... })` to get a fresh, env-aware module.

**4. Mocking timers and async concurrency:**
- **`vi.useFakeTimers()` is NOT used.** Concurrency tests use `setTimeout(r, 20)` and `await new Promise(r => setTimeout(r, 20))` to flush microtasks instead (`services/ai.concurrency.test.ts:109,114,168,185`).
- **`deferred<T>()` helper** (`services/ai.concurrency.test.ts:30-36`) is the standard way to capture a Promise's resolve and resolve it from outside the work function. Copy it when you need it.

**What to Mock:**
- **External side effects only**: the filesystem (when a test wants to assert "if fs is in state X, do Y"), the OpenCode SDK, the Tectonic compiler, the logger, the AI queue (`enqueueAIRequest` is mocked to call `work()` directly when the test cares about flow rather than scheduling).
- **Mock the *external interface* (`@opencode-ai/sdk`)** and let the rest of the code (session lifecycle, queue, retry, redacted-resume write) execute real.

**What NOT to Mock:**
- **The unit under test.** The function being tested is always imported and called directly.
- **Pure helpers within the same module.** Do not mock `buildLatex` when testing `fixSuggestionsService.applySuggestions` if the latex output is part of what you want to verify — instead, give it a real input and assert on the real output. The current tests in `fixSuggestionsService.test.ts` *do* mock `buildLatex` because they care about the orchestration, not the LaTeX; that is a valid call.
- **`fs.mkdtempSync` / `os.tmpdir()`**. Tests use the real filesystem via `os.tmpdir()`. Never mock these.

## Fixtures and Factories

**Test Data:**
- **Inline `buildSampleResume()` / `buildSmallResume()` / `buildOversizedResume()` / `buildMockResumeStructured()` functions** at the top of every test file that needs a `ResumeData` literal. Examples:
  - `services/redactResume.test.ts:15-51` `buildSampleResume()`
  - `services/ai.resumeCharLimit.test.ts:11-60` `buildSmallResume()`, `buildOversizedResume()`
  - `services/ai.sessionInfo.test.ts:10-51` `buildMockResumeStructured()`, `buildMockCoverLetterStructured()`, `buildMockCombinedStructured()`
  - `services/ai.sessionLifecycle.test.ts:12-42` `buildMockStructured()`, `buildMockPromptResponse()`
- **There is no shared `__fixtures__` directory**; every test file owns its own builder. This is intentional — fixtures drift quickly, and a self-contained file is easier to keep current.
- **Use `JSON.parse(JSON.stringify(input))` for deep clones** (see `services/redactResume.test.ts:66`, `services/fixSuggestionsService.test.ts:67`).
- **Job-directory fixtures use `fs.mkdtempSync(path.join(os.tmpdir(), '<feature>-'))`**, then `fs.mkdirSync + fs.writeFileSync` to lay out a realistic tree. Canonical pattern in `services/fixSuggestionsService.test.ts:60-76` `makeFixture()`.

**Location:**
- **Inline in the same file.** No `__fixtures__/`, no `test-utils/`. A test file imports nothing but the code under test, `vitest`, and the Node built-ins (`fs`, `os`, `path`).

## Coverage

**Requirements:** **Not enforced.** No `coverageThreshold` in `vitest.config.ts`, no CI gate. The repo has ~5,000 lines of TS and ~4,500 lines of tests but the ratio varies by feature (e.g. `services/ai.ts` is 1,453 lines and is tested by ~900 lines across 7 files; `services/atsService.ts` has no `.test.ts` at all).

**View Coverage:**
```bash
# Not currently wired. To enable:
npm install --save-dev @vitest/coverage-v8
# Then:
npx vitest run --coverage
```

## Test Types

**Unit Tests:**
- **Dominant style.** Each test file targets one source file and asserts behaviour of each exported function. Pure functions (`redactResumeForExternalModel`, `isRedactedResume`, `parseSeekInput`, `buildLatex`, `escapeCsvField`, `formatLocalTimestamp`, `searchJobDescriptions`, `renderAtsAnalysisMarkdown`, `sanitizeJobDescription`, `enforceResumeCharLimit`'s pure branches) are tested with constructed inputs and no I/O.
- **Sample pure-function test pattern** — see `services/atsReport.test.ts:5-94` (4 `it` blocks covering the full matrix of optional fields in `ATSAnalysisResult`).

**Integration Tests:**
- **Filesystem + multiple-module tests.** The dominant "integration" test in this repo is one that builds a temp job dir, writes a resume JSON, calls the service, and asserts on both the returned value and the files written. Canonical example: `services/redactResume.test.ts:104-159` `ensureRedactedResumeFile` tests (writes → reads back → modifies → writes again → reads).
- **Route tests are HTTP integration tests** that spin up an Express app on `127.0.0.1:<random-port>` and make real `http.request` calls. See `routes/generate.test.ts:472-503` `invokeRoute` helper:
  ```ts
  async function invokeRoute(router: any, method: 'get' | 'post', routePath: string, body?: any) {
    const express = (await import('express')).default;
    const app = express();
    app.use(express.json());
    app.use('/generate', router);
    const server = http.createServer(app).listen(0);
    const port = (server.address() as any).port;
    // ... real http.request ...
  }
  ```
  Re-use this helper verbatim if you add a new route test.

**E2E Tests:**
- **Not used.** No Playwright, no Cypress, no WebDriver. The "UI" in `public/` (vanilla HTML/CSS/JS) is exercised only via `happy-dom` and the small `public/utils.test.ts`.

## Common Patterns

**Async Testing:**
- **Await the function under test directly**; no `done` callbacks. Vitest returns a Promise from `it`, so `await generateResumeJSON(...)` works.
- **Flush microtasks with `await new Promise(r => setTimeout(r, 20))`** between dispatches in concurrency tests. See `services/ai.concurrency.test.ts` for the canonical pattern. The `20ms` is the AI concurrency poll interval × a safety factor.
- **For SDK-driven async code, every test that goes through the queue must `await new Promise(r => setTimeout(r, 20))` after dispatch** to let the slot-pool bookkeeping settle before asserting. This is why the comment "concurrency poll is 5ms" exists in `services/ai.ts:76`.

**Error Testing:**
- **`expect(fn).toThrow(/regex/)` is the standard.** Test for partial message match so error wording can evolve:
  ```ts
  expect(() => createVersionedBackup(jobDir, 'resume')).toThrow(/job directory does not exist/);
  // services/backupService.test.ts:123
  expect(result).rejects.toThrow(/simulated prompt failure/);
  // services/ai.sessionLifecycle.test.ts:154
  expect(result).rejects.toThrow(/Invalid response from OpenCode.*sessionId=sess-1/);
  // services/ai.sessionInfo.test.ts:253
  ```
- **For domain errors, assert the type and the `.code` and the `.backup` field**:
  ```ts
  // routes/generate.test.ts:410-414
  const { NoOpResultError } = await import('../services/fixSuggestionsService.js');
  applySuggestionsMock.mockRejectedValue(new (NoOpResultError as any)({ version: 1, ... }));
  // later, in assertions:
  expect(poll.body.error).toBe('no-op');
  ```

**Tests for the "PII invariant":**
- **There is a non-negotiable privacy assertion in `services/ai.privacy.test.ts:163-185`** that the redacted resume sent to the ATS model never contains a non-empty PII field. Any change to the redaction path must keep this passing. New modules that send resumes to external models should add a similar test.

**Tests for the "session lifecycle invariant":**
- **`services/ai.sessionLifecycle.test.ts`** verifies both `OPENCODE_KEEP_SESSION=true` and `OPENCODE_KEEP_SESSION=false` paths. The `deletes` count must equal `1` in the false path and `0` in the true path, across `session.create` failure, `session.prompt` failure, and successful run. Any change to session lifecycle must keep this passing.

**Tests for prompt-injection / filesystem traversal:**
- **`routes/generate.test.ts:320-331`** asserts that `attachedFilePaths: ['/etc/passwd']` is rejected with `400 Attached file escapes job directory`. Any new file-ingestion route must add a parallel test.

---

*Testing analysis: 2026-07-18*
