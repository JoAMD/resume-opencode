# Interview STAR Stories & Multi-Tenancy Notes

## STAR Story Index

1. **STAR #1 — Technical Challenge**: External request ingestion (13-point story, ~4 weeks)
2. **STAR #2 — Bigger Project Delivered**: External request ingestion (same story, delivery angle)
3. **STAR #3 — Influencing Technical Direction**: Question-config JSON adoption & seed.json

---

## STAR #1 — Technical Challenge

**Situation**
On our low-code workflow platform, flows could be triggered manually or by webhooks, but there was no clean, first-class way for external systems to push structured data in and reliably get a result back. Teams were bolting together ad-hoc endpoints, which made payloads inconsistent and result retrieval flaky — a real gap as more integration-style use cases landed.

**Task**
I owned a 13-point story (3–4 weeks) to deliver the end-to-end external request ingestion capability: a webhook-style trigger step, schema-driven payload handling, validation, an async result pattern, and the error/feedback contract back to the caller.

**Action**
- Designed a schema-driven payload model where, if no schema is defined, the full payload passes through; if a schema is defined, unknown fields are dropped silently. That single rule removed a class of "why did my field disappear?" bugs while keeping the path flexible for callers.
- Built the async result pattern as **accept + retrieve by ID**: the caller gets a fast `accepted` response with an execution ID and polls a result endpoint. This decoupled caller latency from flow execution time and gave a stable contract even for long-running flows.
- Implemented payload → flow variable mapping so downstream steps could consume the validated payload without bespoke glue code.
- Reused the existing auth middleware (API key / user token / system JWT) rather than inventing a new auth path — the security model was already there, I just had to wire it in correctly.
- Collaborated on the trigger-safety / actor-context piece so the system could distinguish "user triggered" vs "automation triggered" for audit and permission checks.
- Hit a late-discovered set of edge cases in real-world payloads (nested structures, large bodies, type mismatches) that forced me to harden the validation/transform path and adjust the error responses so callers could act on them.

**Result**
Shipped to production and adopted by customer integrations. Became a foundational capability that later stories — the authenticated file-download action and the user-override answer model — were built on top of, reducing manual update steps and unblocking follow-on work.

---

## STAR #2 — Bigger Project Delivered

**Situation**
Our low-code platform had forms/foundations for data and a flow engine for automation, but no first-class way to ingest requests from external systems into flows. As integration use cases grew, this was becoming a product gap, not a one-off ask.

**Task**
Deliver the **external request ingestion** capability end-to-end: webhook-style trigger, schema-driven payload handling, validation, async result retrieval, auth, and the error contract back to callers. 13 points, ~4 weeks, backend-heavy with some UI config slices woven in.

**Action**
- **Planned the slicing** as a backend-heavy story: trigger, payload schema, validation, async result, error responses, then UI config slices for the trigger step's configuration surface. I led the payload schema, validation, and async result pieces end-to-end, and collaborated on trigger safety / actor context.
- **Designed the contract.** Async = accept + retrieve by execution ID, so the caller's latency is decoupled from flow execution time. Validation = schema-driven with a clear, opinionated rule: empty schema → pass everything through; defined schema → unknown fields dropped silently. That one rule made the behavior predictable for integrators.
- **Built it.** Implemented the webhook trigger, payload → flow variable mapping so downstream steps consume the payload without bespoke glue, and the result endpoint for polling. Reused the existing auth middleware (API key / user token / system JWT) — no new auth path to maintain.
- **Managed the creep.** Scope grew mid-flight: actor-context/audit requirements were added, and we had to loosen validation to handle real-world partial/messy payloads. I renegotiated the slice, kept the contract intact, and pushed the late-discovered payload edge cases (nested structures, large bodies) through hardening rather than a redesign.
- **Collaborated** with the teammate owning trigger safety / actor context so the system could reliably distinguish user-triggered vs automation-triggered for permission and audit.

**Result**
Shipped to production, used by customer integrations shortly after, and became the **platform foundation** for later work — the authenticated file-download action and the user-override answer model were both built on top of it. Reduced manual data-entry steps, unblocked follow-on stories, and gave the platform a clean, reusable integration surface.

---

## STAR #3 — Influencing Technical Direction (Question-Config JSON & Seed-Driven Forms)

**Situation**
Our platform's forms were historically built with hand-rolled React per form, which made new form types slow to ship and made tenant-level customization (custom plugins, extensions, varied layouts) hard to plan for. A frontend-focused solutions architect proposed a model: a single **question config JSON** schema that describes positioning, types, and behavior, and a renderer that turns it into a React form.

**Task**
Get the team actually using it. Not just for my own features — across the squad and the broader engineering group, so the platform had a consistent, data-driven form layer ready for per-tenant extension.

**Action**
- Adopted it in my own features as the first concrete proof point.
- Championed it in group code reviews, suggesting it to peers when I saw hand-rolled form patterns creeping back in.
- Pushed for the same question-config JSON to be the source of truth in **seed.json**, the large config file seeded into the backend that determines how the whole system behaves — so the form layer and the platform config layer shared one schema.
- Positioned it explicitly as **future-planning groundwork for custom plugins and per-tenant extensions**, not just a cleanup.

**Result**
Became the de facto form-building pattern on the team. The shared question-config-as-source-of-truth approach gave the platform a data-driven foundation that's now ready for per-tenant plugin/extension work without re-platforming forms later.

---

## Interview Tips

- Lead with **STAR #1** if asked for a "hardest technical problem" — foregrounds the schema rule and the async-by-ID pattern.
- Lead with **STAR #2** if asked for a "biggest project" or "most complex delivery" — foregrounds scope, slicing, scope-creep handling, and platform-level impact.
- Lead with **STAR #3** if asked about *technical leadership*, *advocacy*, *setting direction*, or *platform thinking* — it's an "influence without authority" story.
- Memorable concrete details to keep:
  - "Accept + retrieve by ID" async pattern
  - "Empty schema passes through, defined schema drops unknowns silently" validation rule
  - "Reused existing auth middleware — no new auth path to maintain"
  - "Question-config JSON as the single source of truth, including in seed.json"
- Likely follow-ups:
  - "What edge cases did you find?" → nested structures, large bodies, type coercion
  - "Why async by ID instead of sync?" → caller latency, long-running flows, back-pressure
  - "How did you decide on the auth approach?" → reuse existing middleware rather than build new
  - "How did you get buy-in for the question-config pattern?" → dogfooding in own features first, then code-review nudges, then shared seed.json

---

# Multi-Tenancy Architecture Notes

## Context

A low-code platform where flows, forms, and foundations are architected multi-tenant from the start. Tenants can extend the platform with custom plugins and per-tenant configuration.

## What I Had

1. **Billing and token system per tenant**
   - Data tokens and compute tokens assigned per flow / workflow run
   - Enables fair-share resource allocation and tenant-level billing

2. **Event-driven architecture**
   - Used for all flow triggers, answer-change events, etc.
   - Carries internal event types as well
   - Standard pattern: events carry `tenantId` as a first-class field for routing and security

3. **Data-driven architecture**
   - `seed.json` — a large JSON file seeded into the backend that determines how the whole system works
   - Per-tenant config stored in the database
   - Question-config JSON used as the form-definition source of truth
   - Makes the platform very configurable and plugin-friendly per tenant

4. **Forms, flows, and foundations architected multi-tenantly from the start**
   - Every persisted entity has a tenant boundary (compound key, row-level security, tenant-aware repository)
   - Retrofitting tenant boundaries later is painful — doing it up front was the right call

5. **Microservices where applicable**
   - Document generation as its own service (bursty, CPU-heavy, scales independently)
   - Separate sync server for collaborative editing features — tenant-aware and multi-tenanted

6. **Load balancing on Azure App Service VMs**
   - App Service gives instance-level scaling but not tenant-aware routing
   - Needs a tenant-aware dispatcher / custom router to:
     - Sticky-route by tenant hash
     - Detect noisy neighbors
     - Enforce per-tenant concurrency limits

## What Was Missing (Things I Would Add)

7. **Tenant isolation & security boundaries**
   - Not just auth — blast-radius control
   - Row-level security in the DB
   - Per-tenant encryption keys (or per-tenant key references) for sensitive data
   - Explicit "this code path must never cross tenants" tests
   - The scariest multi-tenant bugs are silent data leaks between tenants

8. **Observability per tenant**
   - Logs, metrics, traces all carry `tenantId`
   - Without this, debugging a single tenant's issue means drowning in noise
   - First production incident without per-tenant observability is a nightmare

9. **Rate limiting & quotas per tenant**
   - Pairs with the token system
   - Even with billing tokens, you usually want **hard rate limits** at the API/flow level
   - Prevents one tenant from degrading others
   - Throttling, concurrency caps, queue priorities

10. **Data residency / regional tenancy**
    - Some tenants in regulated regions (EU, etc.) require data to stay in-region
    - Shapes DB topology, backup strategy, and which Azure region their flows run in
    - Important to design for even if not needed day one

11. **Tenant lifecycle**
    - Onboarding, offboarding, suspension, deletion, data export
    - Often forgotten until a customer churns or a legal request comes in
    - GDPR right-to-erasure alone can force architecture changes if not designed for

12. **Feature flags / per-tenant feature rollout**
    - Gradual rollouts, beta cohorts, enterprise-only features
    - Quick rollback when something goes wrong for one tenant

13. **Background job / queue isolation per tenant**
    - Long-running flow for tenant A shouldn't block tenant B's flows
    - Per-tenant queues or weighted fair queueing

14. **Testing strategy for multi-tenancy**
    - Dedicated test suite that **explicitly tries to cross tenant boundaries** and asserts failure
    - Only way to catch silent data leaks before they ship

## Priority View

If ranking what to think about **first**:

1. **#7 Isolation/security** and **#8 Observability** — without these, everything else is built on sand
2. **#3 Data-driven config versioning** — `seed.json` + per-tenant DB config is the biggest source of migration pain
3. **#1 Token system** — anchors billing and the "fair share" story
4. The rest can layer in as the platform matures

---

# Appendix: Reconstruction Questions

The STAR stories were reconstructed from memory using structured Q&A. Below are the full questions and options used.

## Round 1 — Situation & Scope

### Q1. What was the business trigger — why did this 13-point story exist?
- **Customer/partner demand** — Customers/partners were asking for a way to push data into the platform from their own systems.
- **Internal product gap** — The product team identified a gap: no clean way for external systems to feed the workflow engine. *(selected)*
- **Sales/enterprise deal blocker** — An enterprise prospect required it as a condition to sign/expand.
- **Don't fully remember — best guess** — Pick the most likely and adjust later.

### Q2. What does "external request ingestion" actually mean in this story?
- **HTTP/webhook trigger step** — External systems send an HTTP request to the platform to kick off a flow. *(selected)*
- **Polling/ingest endpoint** — The platform polls an external system on a schedule and ingests responses.
- **Generic inbound API endpoint** — Generic endpoint that accepts payloads and routes them into flows/forms.
- **Unsure — pick closest** — Pick the closest so we can refine.

### Q3. What did "payload handling and validation foundations" cover? *(multi-select)*
- **Payload schema definition** — Shape, types, required fields. *(selected)*
- **Validation on receipt** — Reject/handle bad payloads. *(selected)*
- **Mapping payload → flow inputs** — Map validated payload to flow variables. *(selected)*
- **Async/result pattern for caller** — Caller gets an ID, polls/queries later. *(selected)*
- **Auth/security on the endpoint** — Tokens, signatures, IP allowlists. *(selected — auth was simple; existing middleware with API key / user token / system JWT already existed)*
- **Error/feedback to caller** — Success/failure responses back to caller. *(selected)*

### Q4. How were sub-tasks split?
- **Backend / API / trigger / payload / validation / tests** — Backend heavy.
- **Frontend config / schema UI / docs** — Config/UI heavy.
- **Both backend + frontend slices** — Mixed, typical for a platform feature. *(selected: backend heavy with UI features in between)*

## Round 2 — Hardest Problem, Role, Duration, Outcome

### Q5. What was the technical challenge / hard problem?
- **Validation design (schema vs runtime)** — Dynamic payloads, missing fields, type coercion, partial schemas.
- **Async/result retrieval pattern** — Caller polls/gets result without blocking.
- **Trigger safety / actor context** — Distinguish "user triggered" vs "automation triggered" for permission/audit.
- **Payload → flow variable mapping** — Map external payloads to flow variables cleanly.
- **Other / multiple intertwined**. *(selected: 1, 2, and 3)*

### Q6. Which sub-task or area did you personally own vs. collaborate on?
- **You led most of the backend** — Owned the bulk (trigger, payload, validation, async).
- **You led a specific slice** — Led a slice end-to-end, collaborated on the rest. *(selected: led payload schema, validation, async result; collaborated on trigger safety / actor context)*
- **Tech lead / coordinated across slices** — Split work, reviewed, unblocked, owned architecture.
- **Mixed — unsure** — Hands-on in some areas, coordinated in others.

### Q7. Timeline / duration feel
- **~3 weeks, mostly smooth**
- **~3 weeks with a notable blocker**
- **4+ weeks, scope grew mid-flight** — Classic 13-point creep. *(selected)*
- **4+ weeks, mostly execution** — Late-stage polish.

### Q8. Result / measurable outcome *(multi-select)*
- **Shipped + used by customers** — Real integrations shortly after. *(selected)*
- **Unblocked follow-up work** — Enabled dependent stories. *(selected)*
- **Reduced manual steps / errors** — Less manual data entry. *(selected)*
- **Platform foundation for new use cases** — Later features built on it. *(selected)*
- **Don't remember specifics**

## Round 3 — Texture, Async Shape, Validation Rule, Scope Creep

### Q9. What was the most specific / memorable moment?
- **Late-discovered edge cases in payloads** — Nested arrays, huge bodies, unicode. *(selected)*
- **Async pattern rework** — Long-poll vs callback vs poll-by-id.
- **Cross-team coordination friction** — Schema, infra, frontend.
- **Schema flexibility vs safety tradeoff** — Validation had to be more lenient.
- **None stick out — keep it clean**

### Q10. Async result pattern — which best matches?
- **Sync response with execution result** — Near-real-time.
- **Accepted + poll/retrieve by ID** — Fast `accepted`, then poll. *(selected)*
- **Both options available** — Caller chooses.
- **Unsure**

### Q11. How would you describe the validation design in one phrase?
- **Strict schema-first, fail fast** — Match the schema or get rejected.
- **Schema with optional/partial fields** — Required validated, optional passed through.
- **Schema + transform, lenient on shape** — Validate and coerce/normalize. *(selected with custom wording: "schema + transform, if schema is empty, all fields pass through; if schema exists then unknown fields are dropped silently")*
- **Unsure**

### Q12. What scope-creep moment stands out most?
- **Actor-context / audit requirements added** — Who triggered, user vs automation. *(selected)*
- **Async result pattern late addition**
- **Schema flexibility / partial-payload support** — Loosened validation. *(selected "a bit")*
- **UI config scope grew** — Beyond original backend focus.
- **Multiple small additions** *(selected: option 1 and a bit of 3)*

## STAR #3 — Question-Config Origin Notes

The question-config / seed.json story was added in a follow-up, reconstructed from free-form description rather than structured Q&A. Key facts:

- **Origin**: A frontend-focused solutions architect proposed a model: a single question-config JSON schema + a renderer that turns it into a React form with positioning and various config.
- **Your role**: Supporter / advocate. Helped the team start using it, implemented it in own features, suggested to peers and in group code reviews.
- **Seed.json connection**: Same question config is used in `seed.json`, the large JSON seeded into the backend that determines how the whole system works.
- **Future intent**: Custom plugins and per-tenant extensions to be possible without re-platforming forms.
