# ADR 0031: Reusable template identity, versioning, and instantiation

- **Status:** Accepted
- **Date:** 2026-07-22
- **Ticket:** SCI-006

## Context

SCI-006 requires reusable notebook and protocol templates that can be
instantiated into new records. The existing `protocol_template` record kind
(ADR 0015) already provides a notebook-backed template entity with `PRT-YYYY-
NNNN` identifiers, configurable properties (ADR 0026), and protocol/materials
blocks (ADR 0027). The Template Library mockup shows both protocol templates
("Protocol v2.3") and experiment templates ("Experiment v1.5"), so a generic
template model is needed.

The existing `pin_protocol_reference` RPC (ADR 0027) already creates an
immutable revision snapshot of a protocol template and deep-copies procedure
steps into an experiment. Template instantiation generalises this pattern:
create an immutable revision, deep-copy blocks, and create a provenance link.

## Decision

### Template identity

Templates are records. Two record kinds serve as templates:

| Kind                           | Prefix          | Instantiable as               |
| ------------------------------ | --------------- | ----------------------------- |
| `protocol_template` (existing) | `PRT-YYYY-NNNN` | experiment, protocol_template |
| `notebook_template` (new)      | `NBK-YYYY-NNNN` | experiment                    |

Both reuse the existing `records` infrastructure: UUID primary key,
workspace/project ownership, RLS, change events, audit attribution, archive/
restore, revisions, and configurable properties. No new identity table is
introduced.

`notebook_template` is added to the `records.kind` CHECK constraint and to the
`create_record` RPC's kind→prefix CASE. The `record_field_definitions.kind`
CHECK is widened to allow `notebook_template` configurable properties.

### Template type

Template type is discriminated by `records.kind`. The UI filters templates
with `kind=eq.protocol_template` or `kind=eq.notebook_template`. No separate
type column is introduced — the existing kind discriminator is sufficient.

### Template version

A template version is an immutable revision (existing `revisions` table)
capturing the template's metadata and blocks at a point in time. The revision
is created at instantiation time by the `instantiate_template` RPC, following
the same pattern as `pin_protocol_reference`.

The `revisions.reason` CHECK is widened to include `'validate'`, which is the
reason used for template-instantiation revisions.

The revision ID is the durable "template version" that the instantiated
record points to. Later edits to the template do not affect the revision or
the instantiated record.

### Validation status

Template lifecycle statuses reuse the existing `records.status` field:

| Kind                | Statuses                    | Instantiable |
| ------------------- | --------------------------- | ------------ |
| `protocol_template` | draft, under_review, active | active       |
| `notebook_template` | draft, validated            | validated    |

Status transitions are enforced by the existing `transition_record_status`
RPC. `notebook_template` gains two transitions:

- `draft → validated`
- `validated → draft`

Archived state is handled by the existing `archive_record` RPC (sets
`archived_at`). The archived-record guard in `transition_record_status`
(added in migration 0023) is preserved: archived templates are frozen and
cannot be transitioned until restored. Permission restriction is enforced by
existing RLS (workspace isolation). Neither archived nor permission-restricted
is a status value.

### Instantiation

The `instantiate_template` RPC is a transactional SECURITY DEFINER function
(matching `pin_protocol_reference`, so the `procedure_step` execution-block
trigger permits the copy) that atomically:

1. Validates the caller is an authenticated workspace member.
2. Locks the template record and verifies same-workspace (defence in depth
   alongside RLS).
3. Validates the template kind is `protocol_template` or `notebook_template`.
4. Validates the template is not archived (`archived_at IS NULL`).
5. Validates the template status is instantiable (`active` for
   `protocol_template`, `validated` for `notebook_template`).
6. Validates the target kind is compatible with the template kind.
7. Validates the target project is in the caller's workspace.
8. Creates an immutable revision snapshot of the template's metadata and
   ordered blocks (`reason = 'validate'`).
9. Creates a new record (experiment or protocol_template) via `create_record`.
10. Deep-copies the template's blocks into the new record:
    - `protocol_reference` blocks are skipped (experiment-specific pinning).
    - `procedure_step` blocks going to an experiment receive execution fields
      (`sourceProtocolRevisionId`, `sourceStepBlockId`, `completed`, `note`,
      `completedAt`, `completedByUserId`), matching the
      `pin_protocol_reference` pattern.
    - `procedure_step` blocks going to a `protocol_template` have execution
      fields stripped (they are definitions, not execution copies).
    - All other block types are copied as-is.
11. Creates a `record_link` with `link_type = 'template'` and
    `link_metadata = { "template_revision_id": "<uuid>" }`.
12. Bumps the new record's `structure_version`.
13. Returns `{ record, blocks, revision, link }`.

Deep-copying at instantiation time means the instantiated record is
self-contained. Later template edits, archiving, or deletion do not affect
it. This satisfies "without sharing mutable content accidentally."

### Source-version link

The existing `record_links` table is extended with:

- `link_metadata` JSONB column (default `'{}'`) — generic structured metadata
  for links. Template-instantiation links carry
  `{ "template_revision_id": "<uuid>" }`.
- `'template'` added to the `link_type` CHECK constraint.
- A CHECK constraint (`chk_record_links_template_metadata`) requires that
  every `link_type = 'template'` link carries a `template_revision_id` key in
  `link_metadata`, so the source version is verifiable at the DB boundary, not
  just opaque JSON.

No parallel provenance system is introduced. The link is an ordinary
`record_link`, visible in the inspector alongside other links, and
durable-change-event-attributed by the existing `record_links` trigger.

### Error shapes

The `SB006` SQLSTATE code (raised by `instantiate_template` when the template
is not instantiable) is mapped to the public `template_not_instantiable`
error category (HTTP 422) by `src/lib/errors.ts`.

| SQLSTATE | Category                    | HTTP | Condition                                            |
| -------- | --------------------------- | ---- | ---------------------------------------------------- |
| `42501`  | `permission_denied`         | 403  | Not a workspace member, cross-workspace, wrong kinds |
| `SB006`  | `template_not_instantiable` | 422  | Template not instantiable (wrong status or archived) |
| `SB004`  | `invalid_transition`        | 422  | Invalid status transition                            |

## REST surface

| Operation               | Method | Path                                                            |
| ----------------------- | ------ | --------------------------------------------------------------- |
| List protocol templates | GET    | `/api/db/records?kind=eq.protocol_template`                     |
| List notebook templates | GET    | `/api/db/records?kind=eq.notebook_template`                     |
| List all templates      | GET    | `/api/db/records?kind=in.(protocol_template,notebook_template)` |
| Create template         | POST   | `/api/db/rpc/create_record`                                     |
| Validate template       | POST   | `/api/db/rpc/transition_record_status`                          |
| Archive template        | POST   | `/api/db/rpc/archive_record`                                    |
| Instantiate template    | POST   | `/api/db/rpc/instantiate_template`                              |
| Read template blocks    | GET    | `/api/db/blocks?record_id=eq.<uuid>`                            |
| Read template links     | GET    | `/api/db/record_links?source_record_id=eq.<uuid>`               |

Instantiation request:

```json
POST /api/db/rpc/instantiate_template
{
  "p_template_record_id": "<uuid>",
  "p_target_project_id": "<uuid>",
  "p_target_kind": "experiment",
  "p_title": "Virus Stability at 4°C"
}
```

Instantiation response:

```json
{
  "record": { "id": "<uuid>", "identifier": "EXP-2026-0001", "..." },
  "blocks": [ { "id": "<uuid>", "type": "rich_text", "..." } ],
  "revision": { "id": "<uuid>", "reason": "validate", "..." },
  "link": { "id": "<uuid>", "link_type": "template",
            "link_metadata": { "template_revision_id": "<uuid>" } }
}
```

## Ownership and permissions

Templates are workspace-owned via `records.workspace_id`. RLS is
authoritative:

- Workspace members can read templates.
- Workspace members can create templates (via `create_record`).
- Workspace members can instantiate templates (via `instantiate_template`).
- Workspace owners can validate/archive templates.
- Cross-workspace access is rejected at the DB boundary by RLS and by
  explicit same-workspace checks in `instantiate_template`.

## Events and audit

No parallel event or audit system is introduced. The existing triggers on
`records`, `blocks`, `record_links`, and `revisions` emit durable change
events transactionally. Actor attribution comes from `api.current_user_id()`
via the JWT claims, the same path as every other mutation. REST mutations
produce the same events as UI mutations because both write to the same tables
through the same proxy.

`instantiate_template` is added to the external-token RPC allowlist
(`src/lib/external-token.ts`). External API credentials with `projects:write`
scope can instantiate templates within their pinned workspace.

## Consequences

- `notebook_template` is a new record kind. Adding it requires widening the
  `records.kind` and `record_field_definitions.kind` CHECK constraints and
  the `create_record` prefix CASE. Future template kinds follow the same
  pattern.
- `record_links.link_metadata` is a generic JSONB column. Future link types
  can use it for structured provenance without a migration.
- `instantiate_template` is the second transactional deep-copy RPC (after
  `pin_protocol_reference`). Both create immutable revisions and copy blocks.
  A future ticket could unify them if the patterns diverge.
- Template authoring (editing template blocks, version comparison, template
  inheritance) is deferred to later tickets. SCI-006 establishes the
  Template Library, instantiation, and lifecycle foundation only.
