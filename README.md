# resume-opencode

An AI-powered resume tailoring tool that uses [opencode](https://opencode.ai) to rewrite and select resume bullets based on a job description.

## What it does

Given a base resume and a job description, the tool:
1. Extracts ATS keywords from the JD via AI
2. Calls an opencode agent with the base resume + JD
3. The agent rewrites and selects resume bullets to align with the JD using structured JSON output
4. Generates a tailored LaTeX resume and cover letter PDF
5. Runs ATS keyword coverage analysis against the generated resume

## Architecture

```
User Request → Express Server → opencode-sdk → opencode agent
                                      ↓
                               Agent reads base resume + JD
                               Rewrites bullets with structured output
                                      ↓
                               Server polls for output file
                                      ↓
                              ATS analysis + PDF generation
```

## Tech stack

- **Runtime**: Node.js, TypeScript, Express
- **AI**: `@opencode-ai/sdk` — calls opencode agent with structured JSON schemas
- **Output handling**: File polling for non-structured-output models
- **PDF**: LaTeX compilation via `pdflatex`
- **UI**: Vanilla HTML/CSS (served as static files)

## Key implementation details

### Structured outputs

Uses JSON schemas for both resume and cover letter to enforce consistent, type-safe responses:

- `RESUME_JSON_SCHEMA` — defines all fields with descriptions
- `COVER_LETTER_JSON_SCHEMA` — cover letter structure
- `COMBINED_JSON_SCHEMA` — both in a single call

Models that don't support structured output write JSON to a file; server polls for it.

### ATS keyword pipeline

1. AI extracts keywords from JD using a separate prompt + OpenAI API
2. After resume generation, `analyzeATSKeywordsAgainstResume()` runs regex matching
3. Reports coverage %, included keywords, and missing keywords

### Per-model AI concurrency

`enqueueAIRequest` in `services/ai.ts` runs all AI calls for the same model through a slot pool. By default the cap is `1` (strictly serial per model), preserving the original behavior. Set `OPENCODE_AI_CONCURRENCY=2` (or `3`) to allow that many calls per model to run in parallel; excess calls queue and wait. Raising it speeds up batch generation but can trigger upstream provider rate limits.

Set `OPENCODE_AI_QUEUE=false` to disable the queue entirely. Every call then runs immediately with no slot cap (`OPENCODE_AI_CONCURRENCY` is ignored). Use this when you want maximum throughput and trust upstream rate limits.

### Security

- Input sanitization on job descriptions (Unicode, special chars)
- Path allowlisting for file operations
- No sensitive data sent to third-party APIs (uses local opencode + self-hosted when possible)
- Basic auth on admin endpoints

## Scripts

```bash
npm run dev    # Development with hot reload (tsx watch)
npm run build  # Compile TypeScript
npm start      # Build and run production server
```