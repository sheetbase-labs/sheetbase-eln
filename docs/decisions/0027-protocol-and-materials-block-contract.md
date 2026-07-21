# 0027. Protocol and materials notebook block contract

- **Status:** accepted
- **Date:** 2026-07-21
- **Ticket:** SCI-002

## Context

SCI-001 made samples and reagents first-class records and retained
`protocol_template` as the protocol kind. ELN-005 established that a notebook is
the ordered `blocks` belonging to a record, with typed, versioned JSONB payloads.
SCI-002 must add executable protocol references and material observations
without introducing another identity, permission, link, event, or audit model.

The experiment must retain exactly what it used even when the reusable protocol
or current inventory state later changes. At the same time, the current
availability of a linked material must remain visible. Those are different
facts: the first is historical evidence and the second is live context.

## Decision

### 1. Protocol references and materials are notebook block types

`protocol_reference` and `materials` are added to the existing block type
vocabulary. Their durable content lives in `blocks.payload` with
`payload_schema_version = 1`. Ordered execution steps use the existing
`procedure_step` type. No protocol-run, material-usage, permission, or audit
tables are introduced.

PostgreSQL validates the SCI-002 payloads in addition to application-boundary
validation. The trigger verifies UUIDs, protocol/material kinds, revision
ownership, and same-workspace ownership, so direct PostgREST writes cannot
bypass the contract.

### 2. A protocol reference pins an immutable revision

A protocol-reference payload is either an empty editor state or a pinned
reference containing:

```json
{
  "protocolRecordId": "<uuid>",
  "protocolIdentifier": "PRT-2026-0001",
  "protocolTitle": "Titration Assay",
  "protocolRevisionId": "<uuid>",
  "version": "1.2",
  "approvalStatus": "active",
  "pinnedAt": "2026-07-21T12:00:00Z",
  "pinnedByUserId": "<actor-id>"
}
```

`pin_protocol_reference` is the transactional mutation. It locks the
experiment and protocol, verifies workspace and record kinds, snapshots the
protocol metadata and ordered blocks into a new immutable `revisions` row,
updates the reference block, copies each reusable `procedure_step` definition
into the experiment, creates the ordinary protocol `record_link`, and bumps
the experiment structure version. The revision id and snapshot—not mutable
semantic-version text—are the authority for the exact procedure used.

The displayed semantic version comes from the protocol's configurable
`properties.version` value, falling back to its metadata version when absent.
Approval status is the protocol record status captured at pin time. SCI-002
does not add the later review/signature workflow.

### 3. Procedure definitions and execution state are separate

Reusable procedure-step blocks on a protocol contain definition fields:
`text` and `stepNumber`. Pinning copies them into the experiment with source
provenance and execution fields:

```json
{
  "text": "Prepare the qPCR master mix.",
  "stepNumber": 1,
  "sourceProtocolRevisionId": "<uuid>",
  "sourceStepBlockId": "<uuid>",
  "completed": false,
  "note": "",
  "completedAt": null,
  "completedByUserId": null
}
```

The experiment copy is the only mutable execution state. Updating it never
rewrites the protocol template or pinned revision. The database stamps or
clears `completedAt` and `completedByUserId` when completion changes; clients
cannot forge attribution. Notes use the existing optimistic block-content
version. Block order remains the procedure order.

### 4. Materials preserve observations and resolve live state

A materials payload contains ordered items with a linked sample/reagent id,
captured stable identifier/title/kind, positive quantity, structured unit
(`code`, `symbol`, and optional `quantityKind`), optional note, and observation
timestamp. The captured fields are historical observations and are never
rewritten from the current record.

On every materials write PostgreSQL verifies that each target is a sample or
reagent in the experiment workspace and ensures the corresponding ordinary
`record_link` exists. Repeated uses of one material may remain separate payload
items while sharing one lineage link.

The UI resolves current records under RLS and reports live state separately:

- unavailable when the target cannot be resolved, is consumed, quarantined,
  or soft-deleted;
- archived when `archived_at` is set (the historical item remains readable);
- expired when record status is `expired` or an expiry property is before the
  current date;
- low stock when status is `low_stock`, or when configured quantity and a
  low-stock threshold make that derivation possible.

Missing inventory fields produce no invented warning or count. Live warnings
never alter material payloads or immutable notebook revisions.

### 5. REST, RLS, events, and audit

Ordinary authenticated reads use `blocks`, `records`, `record_links`, and
`revisions` through `/api/db`. Ordinary block payload updates continue through
`update_block_payload`, which provides optimistic concurrency. Protocol pinning
uses `pin_protocol_reference` because revision creation, copied steps, link
creation, and structure-version mutation must commit or roll back together.

Existing descendant RLS policies isolate blocks/revisions/links through their
owning records. The SCI-002 database trigger adds payload endpoint checks and
therefore rejects cross-workspace references even for direct CRUD. Archived
materials remain readable but cannot bypass the normal archived-record mutation
rules.

All writes update existing tables, so existing block, record-link, revision,
and record triggers emit the same durable, actor-attributed change events for
UI and REST callers. Completion attribution comes from request claims. No
parallel audit stream is added.

## Consequences

- Protocol and material blocks participate in existing ordering, optimistic
  concurrency, revisions, REST filtering, RLS, and live reconciliation.
- Protocol evidence remains reconstructable after template edits because each
  use owns an immutable revision snapshot and copied execution steps.
- Material quantity/unit observations remain stable while current inventory
  warnings can change honestly.
- A pinned protocol is not silently repinned. Choosing a newer template
  version is an explicit new reference operation.
- Inventory reservation/decrement, protocol approval/signatures, and full
  sample/reagent registries remain later-ticket work.

## Alternatives considered

- **Owned protocol-reference and material-usage tables.** Rejected for
  SCI-002: validated block payloads already own notebook resources and can
  preserve ordered observations. New tables would duplicate block identity
  and lifecycle without providing a required capability.
- **A mutable protocol id and semantic version only.** Rejected: neither
  preserves the exact procedure definition after edits.
- **Execution state on the protocol template.** Rejected: one experiment's
  completion and notes must never mutate the reusable definition or another
  experiment.
- **Copy current material state into history on every refresh.** Rejected: it
  rewrites observations and confuses live inventory context with evidence.
