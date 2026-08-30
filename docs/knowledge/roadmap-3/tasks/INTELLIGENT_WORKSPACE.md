# Roadmap 3 Tasks — Intelligent Workspace

## Programme outcome

Introduce intelligence only where it can exploit Sheetbase's canonical context, permissions, provenance and deterministic operations safely.

---

## AI-01 — Contextual Scientific Intelligence Substrate

### Problem

Useful assistance requires a trustworthy context layer over canonical scientific objects. Without that, AI features either become shallow chat or build a parallel representation of the product.

### Scope

- permission-aware retrieval over canonical Notebook, Sheet, Dataset, Record, Template, analysis and relationship context;
- stable citations/references back to Sheetbase objects and versions;
- context assembly that distinguishes live state, frozen evidence and historical versions;
- explicit provenance for generated summaries/derived suggestions;
- reusable server-side intelligence interfaces so browser and future clients do not implement their own context logic;
- evaluation fixtures for representative scientific questions/tasks.

### Non-goals

- autonomous scientific decision-making;
- a separate vector/knowledge domain model becoming authoritative;
- silently treating generated content as evidence;
- bypassing RLS/capabilities;
- generic chatbot UI as the primary product surface.

### Dependencies

KNOW-01 recommended; mature canonical identities, APIs/events, evidence/version semantics.

### Required evidence

- permission/isolation tests for context retrieval;
- version/live/frozen distinction tests;
- source/citation traceability;
- evaluation set demonstrating correct context selection and refusal/uncertainty when context is insufficient.

### Exit criterion

Sheetbase can assemble permission-aware, provenance-aware scientific context for intelligent features while preserving canonical object/version boundaries and inspectable source references.

---

## ASSIST-01 — Embedded Scientific Assistance

### Problem

Assistance should reduce friction inside real scientific workflows rather than pull users into a separate chatbot experience.

### Scope

- contextual assistance in Notebook authoring, Sheet formula/data workflows, analysis setup, search/discovery and configuration where justified;
- suggestions presented as proposals that users inspect/accept/edit;
- use canonical operations for any persisted changes;
- citations/source context visible where scientifically relevant;
- clear generated-content state and user attribution on accepted changes;
- compact interaction patterns consistent with Sheetbase design.

### Non-goals

- authoritative scientific conclusions without user review;
- hidden writes;
- direct database mutation by model output;
- persistent assistant-only state models;
- assistance added to every screen without demonstrated value.

### Dependencies

AI-01; GRID-01 and NOTE-01 for their respective assistance surfaces.

### Required evidence

- end-to-end accept/edit/reject flows;
- permission and write-target tests for persisted suggestions;
- provenance/citation checks;
- user-visible failure behaviour when context/tool execution is unavailable.

### Exit criterion

Scientists can use contextual assistance inside key Sheetbase workflows, with every persisted change going through ordinary permissions/validation/provenance and no ambiguity between generated suggestions and canonical scientific evidence.

---

## AUTO-PLUS-01 — Mature Agentic Operations & Scientific Workflows

### Problem

Roadmap 2 AUTO-04/05 establish agent-authored operations and agentic scientific workflows. Roadmap 3 should mature them into dependable product capabilities rather than a separate automation stack.

### Scope

- compose agent activity through canonical API/SDK/Pipeline operations;
- explicit plans, proposed operations and user approval boundaries for consequential changes;
- durable run history, inputs, outputs, errors and provenance using existing Pipeline/evidence concepts where applicable;
- constrained retry/recovery and partial-failure semantics;
- reusable agent workflow definitions only if they map cleanly onto existing versioned configuration concepts;
- observability and audit appropriate to automated changes;
- human hand-off and review of generated scientific work.

### Non-goals

- second workflow/Pipeline engine;
- broad unsupervised autonomy;
- credentials/permissions beyond the acting principal;
- agent-only scientific data model;
- treating audit logs as frozen evidence.

### Dependencies

Roadmap 2 AUTO-04 and AUTO-05 complete; AI-01; mature SDK/event foundations recommended.

### Required evidence

- representative multi-step workflow tests with permission failures, retries and partial failures;
- provenance from agent request through canonical operation/Pipeline output;
- user approval tests for consequential actions;
- reconstruction/inspection of completed automated work.

### Exit criterion

Agentic workflows can perform useful multi-step scientific work through the same canonical operations, permissions, Pipelines and evidence semantics as human/API clients, with inspectable plans, provenance, failures and hand-offs.
