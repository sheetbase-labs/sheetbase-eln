# AUTO+ — Mature Agentic Operations & Scientific Workflows

**Status:** planned; depends on Roadmap 2 AUTO-04/05 plus EVENT and AI substrate.

## Programme goal

Mature agent-authored and agent-run workflows on top of the canonical Pipeline, permission and provenance systems.

## AUTO-PLUS-01 — Tool/Operation Catalogue

### Goal

Define a bounded catalogue of agent-callable canonical Sheetbase operations.

### Scope

- expose supported domain operations as typed tools;
- explicit input/output/error contracts;
- capability/workspace checks identical to normal clients;
- distinguish read, draft/propose and mutate operations;
- human-only attestation operations remain unavailable.

### Exit

Agents can discover and invoke a documented set of canonical operations without private database access or UI automation.

## AUTO-PLUS-02 — Plans, Approval & Safe Execution

### Goal

Make multi-step agent work inspectable and controllable.

### Scope

- structured plans and proposed operations;
- dry-run/preview where supported;
- approval gates for consequential mutations;
- idempotency/retry/resume semantics;
- cancellation and partial-failure handling.

### Exit

A representative multi-step agent workflow can be previewed, approved, executed and safely resumed/cancelled with clear state and errors.

## AUTO-PLUS-03 — Scientific Workflow Provenance & Evaluation

### Goal

Make agentic scientific work auditable and scientifically trustworthy.

### Scope

- operation/run provenance tied to canonical Pipeline/operation identities;
- input/output/version references;
- evaluation suites for correctness, permission isolation and failure behaviour;
- evidence boundaries for outputs included in submitted work;
- observability/cost/latency metrics.

### Exit

Agentic workflows produce inspectable provenance and pass repeatable semantic/security evaluations before being treated as mature product capability.

## Boundaries

- Do not create a second agent workflow engine beside canonical Pipelines.
- Agent-authored operations use ordinary validation/permissions.
- Agents cannot sign/attest on behalf of humans.
