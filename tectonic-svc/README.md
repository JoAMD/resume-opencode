# tectonic-svc

A standalone Tectonic LaTeX compiler running in Docker, exposed as an HTTP
service on port 4000. Accepts LaTeX source via `POST /compile` and returns the
compiled PDF as the response body.

Extracted from `../resume-tool/` so the compiler can be built, run, and
deployed independently of the larger resume tooling app.

## Endpoints

| Method | Path       | Body     | Response           |
| ------ | ---------- | -------- | ------------------ |
| POST   | `/compile` | LaTeX    | `application/pdf`  |
| any    | other      | -        | `404 Not found`    |

The server also strips legacy unicode directives (`\input{glyphtounicode}`,
`\pdfgentounicode=1`) that break Tectonic in older templates.

## Files

- `Dockerfile.tectonic` — Alpine 3.19 base, installs Tectonic 0.15.0 and Node.js
- `tectonic-server.ts` — Node HTTP server
- `docker-compose.yml` — exposes port 4000 as `tectonic-compile`

## Build & run

The Dockerfile expects a compiled `dist/tectonic-server.js`. Build the TS
first, then bring up the container.

```bash
cd resume-opencode/tectonic-svc

npm init -y
npm i -D typescript @types/node
npx tsc tectonic-server.ts

docker compose up -d --build
```

Verify:

```bash
curl -sS -X POST --data-binary @sample.tex http://localhost:4000/compile -o out.pdf
```

## Client config

Point the resume tool at this service via:

```
TECTONIC_URL=http://localhost:4000/compile
```

Tectonic gets a 55-second timeout per compile and the working directory is
cleaned up on success or failure.
