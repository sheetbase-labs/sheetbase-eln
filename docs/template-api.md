# Template library and instantiation API

SCI-006 uses the existing authenticated same-origin `/api/db` boundary
(ADR 0031). Templates are ordinary records (`kind = protocol_template` or
`kind = notebook_template`). Their blocks, links, revisions, events, and
audit attribution come from existing infrastructure. UUIDs and credentials
below are placeholders.

## Contract summary

- Templates are records. Two kinds serve as templates:
  - `protocol_template` (existing, `PRT-YYYY-NNNN`) — instantiable as
    `experiment` or `protocol_template`.
  - `notebook_template` (new, `NBK-YYYY-NNNN`) — instantiable as `experiment`.
- The `records.kind` column discriminates the template type. There is no
  separate type column.
- A template version is an immutable revision (existing `revisions` table)
  created at instantiation time. The revision ID is the durable version that
  the instantiated record points to.
- Lifecycle statuses reuse `records.status`:
  - `protocol_template`: `draft`, `under_review`, `active` (instantiable:
    `active`).
  - `notebook_template`: `draft`, `validated` (instantiable: `validated`).
- Archived templates (`archived_at IS NOT NULL`) stay visible and resolvable.
  You cannot instantiate or transition them until you restore them.
- Existing RLS enforces permission restriction (workspace isolation).
- Instantiation is a transactional deep-copy. The new record is
  self-contained. Later template edits, archiving, or deletion do not affect
  it.
- Existing triggers give durable change events and audit attribution. There
  are no template-specific event names.

## Resources

| Operation               | Method | Path                                                                       |
| ----------------------- | ------ | -------------------------------------------------------------------------- |
| List all templates      | GET    | `/api/db/records?kind=in.(protocol_template,notebook_template)`            |
| List protocol templates | GET    | `/api/db/records?kind=eq.protocol_template`                                |
| List notebook templates | GET    | `/api/db/records?kind=eq.notebook_template`                                |
| Filter by status        | GET    | `/api/db/records?kind=in.(...)&status=eq.validated`                        |
| Search by title/ID      | GET    | `/api/db/records?kind=in.(...)&(title=ilike.stab*,identifier=ilike.stab*)` |
| Include archived        | GET    | `/api/db/records?kind=in.(...)&archived_at=is.not.null`                    |
| Create template         | POST   | `/api/db/rpc/create_record`                                                |
| Validate template       | POST   | `/api/db/rpc/transition_record_status`                                     |
| Archive template        | POST   | `/api/db/rpc/archive_record`                                               |
| Restore template        | POST   | `/api/db/rpc/restore_record`                                               |
| Instantiate template    | POST   | `/api/db/rpc/instantiate_template`                                         |
| Read template blocks    | GET    | `/api/db/blocks?record_id=eq.<uuid>`                                       |
| Read template links     | GET    | `/api/db/record_links?source_record_id=eq.<uuid>`                          |
| Read source revision    | GET    | `/api/db/revisions?id=eq.<revision-uuid>`                                  |

All resources accept the normal bounded PostgREST equality, `in`, ordering,
range, and selected-column filters that the shared proxy allows. RLS limits
every result to the active workspace.

## Create a template

```http
POST /api/db/rpc/create_record
Content-Type: application/json

{
  "p_project_id": "<project-uuid>",
  "p_kind": "notebook_template",
  "p_title": "Stability Study (ICH)",
  "p_status": "draft",
  "p_tags": [],
  "p_properties": {}
}
```

Response:

```json
{
  "id": "<uuid>",
  "kind": "notebook_template",
  "identifier": "NBK-2026-0001",
  "title": "Stability Study (ICH)",
  "status": "draft",
  "workspace_id": "<uuid>",
  "project_id": "<uuid>",
  "...": "..."
}
```

Use `p_kind: "protocol_template"` for a protocol template (`PRT-YYYY-NNNN`).

## Validate a template

```http
POST /api/db/rpc/transition_record_status
Content-Type: application/json

{
  "p_record_id": "<template-uuid>",
  "p_target_status": "validated",
  "p_expected_metadata_version": 1
}
```

For `protocol_template`, use `"p_target_status": "active"`.

## Archive a template

```http
POST /api/db/rpc/archive_record
Content-Type: application/json

{
  "p_record_id": "<template-uuid>",
  "p_expected_metadata_version": 2
}
```

Archived templates stay visible in list responses. You cannot instantiate or
transition them. Restore with `rpc/restore_record` to unfreeze.

## Instantiate a template

```http
POST /api/db/rpc/instantiate_template
Content-Type: application/json

{
  "p_template_record_id": "<template-uuid>",
  "p_target_project_id": "<project-uuid>",
  "p_target_kind": "experiment",
  "p_title": "Virus Stability at 4°C"
}
```

The `p_title` parameter is optional. If you omit it, the system uses the
template's title.

Response:

```json
{
  "record": {
    "id": "<uuid>",
    "kind": "experiment",
    "identifier": "EXP-2026-0001",
    "title": "Virus Stability at 4°C",
    "status": "draft",
    "structure_version": 1,
    "...": "..."
  },
  "blocks": [
    {
      "id": "<uuid>",
      "type": "rich_text",
      "payload": { "...": "..." },
      "...": "..."
    },
    {
      "id": "<uuid>",
      "type": "checklist",
      "payload": { "...": "..." },
      "...": "..."
    }
  ],
  "revision": {
    "id": "<revision-uuid>",
    "record_id": "<template-uuid>",
    "reason": "validate",
    "structure_version": 1,
    "metadata_version": 1,
    "...": "..."
  },
  "link": {
    "id": "<link-uuid>",
    "source_record_id": "<new-record-uuid>",
    "target_record_id": "<template-uuid>",
    "target_kind": "notebook_template",
    "target_identifier": "NBK-2026-0001",
    "link_type": "template",
    "link_metadata": { "template_revision_id": "<revision-uuid>" },
    "...": "..."
  }
}
```

### Target kind compatibility

| Template kind       | Allowed `p_target_kind`           |
| ------------------- | --------------------------------- |
| `notebook_template` | `experiment`                      |
| `protocol_template` | `experiment`, `protocol_template` |

### Block copy semantics

- `protocol_reference` blocks are skipped (experiment-specific pinning).
- `procedure_step` blocks that go to an `experiment` receive execution fields
  (`sourceProtocolRevisionId`, `sourceStepBlockId`, `completed`, `note`,
  `completedAt`, `completedByUserId`), matching the `pin_protocol_reference`
  pattern.
- `procedure_step` blocks that go to a `protocol_template` have the execution
  fields stripped (they are definitions, not execution copies).
- All other block types are deep-copied as-is with new IDs.

## Error shapes

| SQLSTATE | Category                    | HTTP | Condition                                                |
| -------- | --------------------------- | ---- | -------------------------------------------------------- |
| `42501`  | `permission_denied`         | 403  | Not a workspace member, cross-workspace, wrong kinds     |
| `SB006`  | `template_not_instantiable` | 422  | Template not instantiable (wrong status or archived)     |
| `SB004`  | `invalid_transition`        | 422  | Invalid status transition (e.g. `validated → active`)    |
| `SB001`  | `stale_version`             | 409  | Optimistic metadata version mismatch                     |
| `23514`  | `validation_error`          | 400  | CHECK violation (e.g. template link without revision ID) |

Example error response:

```json
{
  "error": {
    "category": "template_not_instantiable",
    "message": "cannot instantiate from a draft notebook template (must be validated)"
  }
}
```

The proxy error envelope carries `category`, `message`, and optionally
`request_id`. It does not carry the SQLSTATE code.

## Archived-template behavior

- Archived templates appear in list responses when `archived_at=is.not.null`
  is included (the Template Library shows them with an "Archived" badge).
- `instantiate_template` rejects archived templates with `SB006`.
- `transition_record_status` rejects archived templates with `SB004`
  (archived records are frozen).
- Template archiving does not affect existing instantiated records or their
  source revisions.
- Restore an archived template with `rpc/restore_record` to allow transitions
  again. Instantiation still requires the correct status.

## Cross-workspace enforcement

- RLS on `api.records` limits reads to the active workspace.
- `instantiate_template` explicitly verifies that the template's
  `workspace_id` matches the caller's active workspace (defense in depth
  alongside RLS).
- The target project must be in the caller's workspace.
- Cross-workspace instantiation fails with `42501` (`permission_denied`,
  HTTP 403).

## Stable link representations

The `record_links` row with `link_type = 'template'` connects the
instantiated record (`source_record_id`) to the source template
(`target_record_id`). The `link_metadata.template_revision_id` field holds
the UUID of the immutable revision created at instantiation time. This
revision captures the exact template version — metadata, blocks, and
structure. The provenance stays durable and verifiable even if the template
is later edited, archived, or deleted.

A CHECK constraint (`chk_record_links_template_metadata`) requires every
`link_type = 'template'` link to carry a `template_revision_id` key. The
database boundary enforces this.

## Durable events and audit parity

All mutations — create, validate, archive, restore, instantiate — write to
the same `records`, `blocks`, `record_links`, and `revisions` tables through
the same proxy. The existing triggers emit durable change events
transactionally with actor attribution from `api.current_user_id()`. REST
mutations produce the same events and audit entries as UI mutations.
