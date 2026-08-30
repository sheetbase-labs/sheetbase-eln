---
title: Permissions, API and Automation
status: canonical
last_reviewed: 2026-08-30
---

# Permissions, API and Automation

## Server-authoritative security

PostgreSQL/RLS and canonical server operations are the security boundary.

Client-side hiding/gating improves UX but cannot be the sole permission check for privileged mutations or sensitive reads.

## Workspace membership and capabilities

Capabilities are derived from workspace membership/role rather than embedded as untrusted client claims.

Important settled behaviour includes:

- viewer is read-only;
- Steward can govern schema/configuration without needing blanket `workspace.admin`;
- privileged operations resolve capabilities server-side;
- workspace isolation remains enforced by RLS and scoped server execution.

Do not create a second capability vocabulary for an individual feature.

## Public API principle

The browser is one client.

The public API should expose canonical domain concepts suitable for:

- Python SDK;
- TypeScript SDK;
- integrations;
- Pipelines;
- future agents.

Do not design domain semantics that exist only as local UI state.

## Credential model

Roadmap 2 established a fail-closed external credential surface with canonical scope vocabulary.

The platform supports workspace service credentials and user-scoped personal tokens. Credential lifecycle and auditability are explicit.

Human-attestation actions such as submit/sign/amend stay off the external credential allowlist unless a future deliberate design changes that.

Retired `scientific:*` scope vocabulary must not be revived.

## OpenAPI and SDK direction

OpenAPI describes the supported credential-facing contract, not every internal database RPC.

Remaining Roadmap 2 API work is to mature this surface through:

- Python SDK;
- TypeScript SDK;
- Webhooks/events.

SDKs should be thin, ergonomic representations of the canonical API—not alternative business logic stacks.

## Connectors

The integration model is generic connector → connector run → validated mapping/commit into canonical Sheetbase data.

Secrets are sealed and administration respects `integrations.manage`.

Instrument/vendor integrations should be implementations of the generic contract rather than new top-level architectures.

## Pipelines

AUTO-01/02/03 established the canonical deterministic Pipeline model:

- versioned definitions;
- immutable published versions;
- manual/scheduled/event runs;
- run history/logs/outputs;
- bounded deterministic SQL execution in v1;
- provenance and capability control;
- Notebook output integration.

Do not create another automation model.

## Agents

AUTO-04 agent operations are typed durable proposals, not a mutation bypass.
PostgreSQL derives their preview and impact, requires a human-session approval
with the underlying capability, and executes the exact request through its
canonical Dataset Schema, Sheet Definition, Pipeline Definition/version or
Dataset row RPC.

Proposal creation has actor-bound idempotency. Approval and execution use
proposal revisions, while the target operation enforces its own optimistic
revision. Agent, tool, model and invocation provenance remain attached to the
proposal. Proposal events and `change_events` record the decision path; the
canonical operation records its normal audit/evidence effects.

Publish, submit, sign, amend and lock are not agent operation variants. AUTO-05
composes approved single operations as digest-pinned sequential workflows and
preserves these boundaries. A workflow stores exact operations and immutable
input references, emits one AUTO-04 proposal at a time, and never executes a
scientific mutation itself.

Workflow resume remains human-only. Cancellation and operation, token, or cost
budget exhaustion invalidate proposals that have not executed. External agents
may submit and inspect workflows, report usage, advance completed steps, and
cancel workflows they created. They cannot approve, execute, or resume a step.

Longer term, contextual AI should assist inside the scientific workspace rather than become a separate “AI product” that ignores Sheetbase structure.

## Idempotency and consequential mutations

External and automated operations should consider idempotency, retry behaviour, optimistic concurrency and provenance. A retry should not silently duplicate a scientific mutation.
