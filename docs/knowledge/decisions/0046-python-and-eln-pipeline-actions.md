# 0046. Python and governed ELN pipeline actions

- **Status:** accepted
- **Date:** 2026-09-07
- **Supersedes:** ADR-0042's SQL-only transform and mandatory Dataset output limits

## Context

The requested Pipeline scope includes Python and automation across the ELN,
including inbound and outbound webhooks. A Dataset transformation is one use
case, not the definition of a Pipeline. The original AUTO brief included Python;
the subsequent SQL-only scope revision is historical rather than the current
product boundary.

## Decision

1. Keep the canonical Definition, immutable published Version, Run, actor,
   digest, trigger occurrence and Dataset provenance contracts. Extend the v1
   configuration with optional ordered analysis steps, ELN actions, webhook
   destinations and an immutable Python runtime pin. Existing SQL configurations
   retain their meaning; no second automation engine or Dataset writer is added.
2. Analysis is optional. SQL and Python steps may be chained; the next step reads
   the preceding rows as `previous`. A Pipeline may instead perform ELN actions
   without Dataset inputs, analysis or Dataset output.
3. Python runs in a fresh, bounded container under a separate trusted broker.
   The application and untrusted job never receive Docker control-plane access.
   Jobs receive no credentials, host mounts or network. Installed packages and
   the runtime image are immutable; the published configuration pins the image.
4. ELN actions use an explicit, extensible catalogue of canonical RPCs. Values
   are bound parameters; the executor assumes the authenticated role and the
   run actor's claims. Required revisions, workspace boundaries, validation and
   permissions remain authoritative. Python never performs direct database writes.
5. Actions may reference run parameters, preceding analysis rows, Dataset output
   or earlier action results. Their results are recorded in the same Run.
   The initial catalogue covers projects, records, sample custody, reagent stock
   and Dataset operations. Human confirmations, signatures and attestations
   remain human steps; a pipeline cannot fabricate a session or confirmation.
6. All database work and the outgoing webhook outbox commit together. A step,
   action or output failure rolls back earlier database work before failing the
   Run. Signed HTTP POST delivery uses the existing webhook retry/replay engine,
   with its existing destination administration and secrets. Delivery is
   at-least-once; run success means queued, not acknowledged by the receiver.
7. Inbound webhooks use revocable random bearer tokens, stored only as hashes,
   scoped to a Definition and the configuring user's current permissions.
   Required idempotency keys bind an occurrence to the original inputs and
   published version. Retried deliveries do not silently select a new version.
8. Execution is serialized per Run. Cancellation can proceed while analysis is
   running; output is rejected at the next safe point. Database work has a
   ten-minute budget checked between queries, below stale-run reconciliation.

## Consequences

The Python broker and reviewed runtime images require explicit environment
configuration. The local implementation and its tests do not deploy the broker
or activate Python in production. Python pins remain valid only while that
exact runtime is available; changing a pin requires a new draft and publication.

A versioned workflow is replayable, but arbitrary Python (clock/randomness),
current-state ELN actions and remote HTTP consumers are not mathematically
deterministic. Retrying failed database work is safe because it rolls back;
receivers must honour the stable event id to deduplicate external delivery.

See [Pipeline contract](../../subsystems/pipelines.md) and
[Python operations](../../operations/pipeline-python.md) for the executable
interfaces, limits and deployment boundary.
