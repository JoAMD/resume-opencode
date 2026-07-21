# Phase 3: Form prefill, permalink URLs, and enhanced job folder links - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-21
**Phase:** 03-Form prefill, permalink URLs, and enhanced job folder links
**Areas discussed:** Form Prefill Trigger, Permalink URL Format, Permalink Error Handling, Artifact Links Location, Which Artifact Links, link.txt Format, Permalink.txt, Additional UI Enhancements, Prefill Data Scope, URL Sync Timing, Permalink.txt Write Timing, File Path Handling, Prefill When Fields Already Filled, Prefill Error Handling, Permalink Overwrite, Permalink Base URL, Slug Parsing, Blur vs Permalink Dialog Parity, Result Block on Permalink Load, Cover Letter URL Update, Prefill Files, Prefill Loading Indicator, Generation Status Display, Step Indicator Type, Poll Reuse, taskId Storage, No taskId Case, Step Labels

---

## Form Prefill Trigger

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-prefill on blur | When folderPath input loses focus, parse folder and fill form fields automatically | |
| Explicit Load button | Add a 'Load Job' button next to the folder path input | |
| URL hash triggers prefill | When app loads with #job=<slug> hash, auto-prefill from that folder | ✓ (both 1+3, user prefers 3) |

**User's choice:** Option 3 (URL hash) preferred, also option 1 (blur) if low-medium effort. Errors should not block dependent actions (mark as applied, compile, etc.). File paths resolve to parent folder.

---

## Permalink URL Format

| Option | Description | Selected |
|--------|-------------|----------|
| #job=<slug> | Minimal: http://host/#job=shopify-senior-se-2026-07-21 | ✓ |
| #/job/<slug> | REST-ish: http://host/#/job/shopify-senior-se-2026-07-21 | |
| #job/<slug>/<version> | With optional version for future backup versioning | |

**User's choice:** #job=<slug>

---

## Permalink Error Handling (Bad Permalink)

| Option | Description | Selected |
|--------|-------------|----------|
| Show error + clear hash | Toast error 'Job folder not found' and clear the hash | |
| Redirect to form | Silently remove the invalid hash and show the empty form | |
| Show empty form but keep hash | Keep the hash so user can correct it, but don't prefill anything | ✓ |

**User's choice:** Show error + keep hash

---

## Artifact Links Location

| Option | Description | Selected |
|--------|-------------|----------|
| In existing result block | Expand the existing result block shown after generation | ✓ |
| New 'Job Artifacts' panel | Dedicated panel listing all artifacts for the loaded job | |
| Floating action buttons | Small icon buttons near the folder path input | |

**User's choice:** Option 1 (existing result block), plus include the apply suggestions result block (compare with latest backup diff)

---

## Which Artifact Links

| Option | Description | Selected |
|--------|-------------|----------|
| All artifacts | resume.pdf, cover-letter.pdf, cover-letter.txt, ats-analysis.md — all clickable | ✓ |
| PDFs only | Just resume.pdf and cover-letter.pdf | |
| All + download ZIP | All above plus a 'Download all' ZIP | |

**User's choice:** All artifacts

---

## link.txt Format / Permalink.txt Decision

| Option | Description | Selected |
|--------|-------------|----------|
| Permalink first, posting second | Permalien URL on line 1, original job posting URL on line 2 | |
| Posting first, permalink second | Original job posting URL on line 1, permalien URL on line 2 | |
| Permalink only | Only write the permalink | |

**User's choice:** User pivoted to creating a separate `permalink.txt` file (not modifying link.txt)

---

## Permalink.txt Contents

| Option | Description | Selected |
|--------|-------------|----------|
| Just the permalink URL | Single line: the #job=<slug> URL | ✓ |
| JSON with metadata | { url, jobDir, generatedAt } | |
| URL + job folder name | Two lines: URL first, job folder name second | |

**User's choice:** Just the permalink URL

---

## Additional UI Enhancements

| Option | Description | Selected |
|--------|-------------|----------|
| Copy buttons for links | Small copy button next to each artifact link | |
| Quick-open all PDFs | Button to open resume.pdf + cover-letter.pdf simultaneously | ✓ |
| Both above | Add both copy buttons and 'open all PDFs' button | |

**User's choice:** Quick-open all PDFs

---

## Prefill Data Scope

| Option | Description | Selected |
|--------|-------------|----------|
| All form fields | Company, role, JD, extra notes, cover output, model — everything | |
| JD + basics only | Just job description, company, role — don't overwrite user preferences | |
| Folder name + JD | Parse company/role from folder slug, load JD from job-description.txt | |

**User's choice:** Option 1 (all form fields), but structured-output.json is NOT used. Use other-input.txt for most fields, full-jd.txt for SEEK input field.

---

## URL Sync Timing

Three options were confusing. Clarified: URL updates when user clicks any generate button AND when user manually types a folder path (not system-triggered).

| Option | Description | Selected |
|--------|-------------|----------|
| Update after generation only | URL hash only changes when generation completes | |
| Real-time URL updates | Update hash as form fields change | |
| On folder load only | URL updates when folder is loaded | |

**User's choice:** URL updates on generate button click AND on manual folder path input by user. System-triggered folder loading does not update hash.

---

## Permalink.txt Write Timing

| Option | Description | Selected |
|--------|-------------|----------|
| After every generation | Write permalink.txt after every successful generation | ✓ |
| On resume generation only | Only write after resume generation | |
| On explicit save action | Only write when user clicks a 'Save permalink' button | |

**User's choice:** After every generation (resume, cover, or both)

---

## File Path Handling

| Option | Description | Selected |
|--------|-------------|----------|
| Use parent folder | If file is inside a job folder, use the parent folder for prefill | ✓ |
| Error with guidance | Show error 'Please enter a folder path, not a file path' | |
| Try parent, error if not job folder | Use parent folder only if valid job folder | |

**User's choice:** Use parent folder

---

## Prefill When Fields Already Filled

| Option | Description | Selected |
|--------|-------------|----------|
| Always fill | Always overwrite form fields with loaded data | |
| Fill empty only | Only fill fields that are currently empty | |
| Confirm if different | If a field has a value, ask 'keep existing or use loaded?' | Variant |

**User's choice:** Variant — if any text field is filled, ask the user "keep existing or use loaded" for the whole form itself (not per-field)

---

## Prefill Error Handling

| Option | Description | Selected |
|--------|-------------|----------|
| Non-blocking | Show error toast but allow mark-as-applied, compile, etc. to still work | ✓ |
| Blocking | Error must be dismissed before any other action | |

**User's choice:** Non-blocking

---

## Permalink Overwrite

| Option | Description | Selected |
|--------|-------------|----------|
| Overwrite | Always write fresh | ✓ |
| Skip if exists | Leave existing permalink.txt untouched | |
| Append with timestamp | Keep old one as permalink-V1.txt, write new as permalink.txt | |

**User's choice:** Overwrite

---

## Permalink Base URL

| Option | Description | Selected |
|--------|-------------|----------|
| Current browser URL | Use whatever URL the user has open | ✓ |
| Configured base URL from .env | Use OPENCODE_HOSTNAME:PORT from .env | |

**User's choice:** Current browser URL

---

## Slug Parsing for Company/Role

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, parse from slug | Extract company and role from folder name | |
| No, from files only | Only use job-description.txt, other-input.txt | ✓ |
| Yes, as fallback | Parse from slug if other files don't have the info | |

**User's choice:** No, from files only

---

## Blur vs Permalink Dialog Parity

| Option | Description | Selected |
|--------|-------------|----------|
| Same dialog | If any form field is filled, ask 'keep existing or use loaded' — same for both triggers | ✓ |
| Blur is always automatic | Blur-triggered prefill never asks | |

**User's choice:** Same dialog

---

## Result Block on Permalink Load (Without Regeneration)

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, show result block | Show artifact links and 'compare with backup' when loading permalink | ✓ |
| No, only after generation | Result block only shows after generation | |

**User's choice:** Yes, show result block

---

## Cover Letter URL Update

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, update | Cover letter generation updates the permalink URL | ✓ |
| No, only on resume gen | URL only changes when resume is generated | |

**User's choice:** Yes, update

---

## Prefill Files

| Option | Description | Selected |
|--------|-------------|----------|
| job-description.txt + other-input.txt | Load JD from job-description.txt, other fields from other-input.txt | ✓ |
| full-jd.txt + other-input.txt | Prefer full-jd.txt over job-description.txt | |
| All available files | Read all: job-description.txt, full-jd.txt, other-input.txt, structured-output.json | |

**User's choice:** Option 1 (job-description.txt + other-input.txt), plus full-jd.txt to prefill "Paste SEEK job listing here to auto-fill" textarea

---

## Prefill Loading Indicator

| Option | Description | Selected |
|--------|-------------|----------|
| Yes | Brief 'Loading job...' indicator while files are read | ✓ |
| No, instant | Skip indicator — fast enough | |

**User's choice:** Yes

---

## Generation Status Display

| Option | Description | Selected |
|--------|-------------|----------|
| Step indicator + progress | Show 'Step 2/4: Running ATS analysis' with progress indicator | ✓ |
| Spinner + label | Just a spinning indicator + 'Generating...' label | |
| Artifact availability list | Show a list of what artifacts exist now vs. what's pending | ✓ (combined with 1) |

**User's choice:** Both option 1 AND option 3 — step indicator AND artifact availability list shown together as separate sections

---

## Poll Mechanism Reuse

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse taskId polling | Reuse GET /generate/task/:taskId — existing infrastructure | ✓ |
| New job-folder polling | New endpoint GET /generate/jobStatus/:slug | |

**User's choice:** Reuse taskId polling

---

## taskId Storage

| Option | Description | Selected |
|--------|-------------|----------|
| Session storage per job | Store taskId in sessionStorage keyed by jobDir | ✓ |
| Local storage | Store in localStorage — shared across tabs | |
| In job folder on server | Write taskId to a file in the job folder | |

**User's choice:** Session storage per job

---

## No taskId Case (Generation Complete)

| Option | Description | Selected |
|--------|-------------|----------|
| Show result block | Just show the artifacts that exist in the folder | ✓ |
| Try to detect via folder state | Check for session-info.txt or other signals | |

**User's choice:** Show result block. Note: F-UT-01 in CONCERNS.md for future enhancement if user wants the more complex detection.

---

## Step Labels

| Option | Description | Selected |
|--------|-------------|----------|
| Descriptive labels | Step 1: 'Generating resume + cover letter', Step 2: 'Running ATS analysis', etc. | ✓ |
| Brief labels | Step 1: 'Generating', Step 2: 'ATS analysis' | |
| Numbered only | Step 1/4, Step 2/4 | |

**User's choice:** Descriptive labels

---

## Deferred Ideas

### Generation Status Dashboard (Future Phase)
- A UI dashboard showing all in-progress generations across all open tabs
- Filed: CONCERNS.md F-UT-02

### Real-Time Push via WebSocket/SSE (Future Phase)
- Replace polling with push updates from server
- Filed: CONCERNS.md F-UT-03

### Detect Mid-Generation vs. Fresh Load (Future Enhancement)
- Check session-info.txt or artifact timestamps to distinguish completion state
- Filed: CONCERNS.md F-UT-01

---

*Discussion log completed: 2026-07-21*
