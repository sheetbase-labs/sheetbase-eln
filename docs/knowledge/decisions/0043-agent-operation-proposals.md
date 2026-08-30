# 0043. Agent operation proposals

- **Status:** accepted
- **Date:** 2026-08-30
- **Ticket:** AUTO-04

## Context

AUTO-04 requires agents to suggest governed changes without creating a second
mutation system or granting an agent authority that a normal Sheetbase client
does not have. A proposal needs a stable preview, an approval decision,
optimistic concurrency, retry safety, agent/tool/model attribution, and an
evidence trail. Human-attestation actions must remain human-only.

## Decision

1. `api.agent_operation_proposals` is a durable envelope around one typed
   canonical operation. It stores the exact request, deterministic preview and
   impact, approval policy, request digest, status, result, and
   agent/tool/model/invocation provenance.
2. AUTO-04 supports single operations for Dataset Schema draft creation, Sheet
   Definition draft creation/update, Pipeline Definition/draft creation/update,
   and canonical Dataset row commits. It does not execute multi-step goals.
3. Agents may submit and inspect proposals with the dedicated
   `agent_operations:write` / `agent_operations:read` credential scopes.
   Every proposal requires explicit approval from a human session. The
   approver must hold the capability required by the underlying operation.
   Service credentials cannot approve or execute proposals.
4. Execution calls the existing canonical RPC. Dataset rows still use
   `commit_dataset_row_batch`; Dataset Schema, Sheet Definition, and Pipeline
   changes use their existing Definition/version RPCs. Their validation,
   capability checks, revisions, change events, and immutable published
   boundaries remain authoritative.
5. Proposal revisions protect approve/reject/execute transitions. The proposal
   id is the canonical Dataset commit idempotency key, while proposal creation
   has an actor-bound request digest and caller idempotency key.
6. `api.agent_operation_events` records the append-only proposal timeline.
   Proposal lifecycle also enters `change_events`, and the underlying canonical
   mutation emits its ordinary audit/evidence events.
7. Publish, submit, sign, amend, lock, and other attestation or evidence-boundary
   operations are absent from the operation union. Adding one requires an
   explicit policy decision, not a generic operation escape hatch.

## Consequences

- An agent-authored Dataset or Definition change produces the same canonical
  result and audit effects as the corresponding product action.
- Approval does not reserve the target. A conflicting change between preview
  and execution fails through optimistic concurrency and remains visible as a
  failed proposal.
- AUTO-05 may orchestrate several proposals later, but it must not weaken this
  per-operation approval and execution boundary.
