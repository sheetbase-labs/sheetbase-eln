# Scientific Records API (SCI-001)

Samples, reagents and protocols are record kinds within the existing notebook
`records` infrastructure (decision 0026). They reuse the same stable UUID
identity, project/workspace ownership, RLS, durable change events and audit
attribution as experiments and reports. This document maps the SCI-001
surface to HTTP through the same-origin `/api/db` PostgREST boundary.

Decision records: 0015 (vocabulary), 0026 (scientific record kinds and
configurable properties). `docs/notebook-api.md` covers the shared record and
link resources; this document covers the SCI-001 additions.

## Record kinds and identifiers

| Kind                | Identifier prefix | Status vocabulary                                                          |
| ------------------- | ----------------- | -------------------------------------------------------------------------- |
| `sample`            | `SMP-YYYY-NNNN`   | `available`, `reserved`, `consumed`, `expired`, `quarantined`, `frozen`    |
| `reagent`           | `RGT-YYYY-NNNN`   | `available`, `reserved`, `consumed`, `expired`, `quarantined`, `low_stock` |
| `protocol_template` | `PRT-YYYY-NNNN`   | `draft`, `active`, `under_review`                                          |

Identifiers are project-scoped and sequential, assigned by the
`create_record` RPC. They are independent of the display title and never
reused. `protocol_template` is the record kind; `protocol` is the link type
used when referencing one from a notebook.

## Configurable properties

Scientific records carry a flat `properties` JSONB column. The shape is
configured per workspace through `record_field_definitions`:

| Field          | Purpose                                                                  |
| -------------- | ------------------------------------------------------------------------ |
| `field_name`   | stable machine key (immutable after creation)                            |
| `label`        | human label shown in the inspector and picker                            |
| `logical_type` | `text`, `integer`, `decimal`, `boolean`, `date`, `timestamp`, `category` |
| `nullable`     | whether the value may be absent                                          |
| `validation`   | `{ "enum": [...] }` for category fields                                  |
| `unit`         | `{ "symbol": "µg" }` display unit                                        |
| `lifecycle`    | `active` or `retired` (retired fields keep historical values)            |

A PostgreSQL trigger (`internal.validate_record_properties`) authoritatively
validates `properties` against the workspace's active definitions on INSERT
and whenever kind/properties change. The application library
(`src/lib/scientific-records.ts`) mirrors the checks for better client-side
errors. Experiment and report records skip validation (they have no field
definitions).

## Resources

| Resource                   | Shape                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `records`                  | filter by `kind=eq.sample`, `kind=eq.reagent`, `kind=eq.protocol_template`. `GET`, `PATCH`. Created via RPC. |
| `record_field_definitions` | workspace-owned configurable field schema. `GET`, `POST`, `PATCH` (owner). `DELETE` not granted.             |
| `record_links`             | typed links from a notebook record to a scientific record. Created via `create_record_link` RPC.             |

### Examples

All examples use placeholders, not real credentials.

#### Create a sample

```jsonc
// POST /api/db/rpc/create_record
{
  "p_project_id": "00000000-0000-4000-8000-000000000100",
  "p_kind": "sample",
  "p_title": "Virus stock A",
  "p_status": "available",
  "p_properties": { "note": "cold chain", "mass": 1.5 }
}
// 200
{
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "identifier": "SMP-2026-0001",
  "kind": "sample",
  "status": "available",
  "properties": { "note": "cold chain", "mass": 1.5 },
  "created_by_user_id": "github|123",
  "metadata_version": 1
}
```

#### List samples for the current workspace

```http
GET /api/db/records?kind=eq.sample&order=archived_at.asc,identifier.asc
```

Cross-workspace records are invisible under RLS; no client-side filter is
needed.

#### Define a configurable field

```jsonc
// POST /api/db/record_field_definitions
{
  "workspace_id": "00000000-0000-4000-8000-000000000001",
  "kind": "sample",
  "field_name": "mass",
  "label": "Mass",
  "display_order": 2,
  "logical_type": "decimal",
  "nullable": true,
  "unit": { "symbol": "µg" },
  "validation": {},
}
```

Only workspace owners may write field definitions. The `field_name`, `kind`
and `workspace_id` are immutable after creation.

## RPCs

All RPCs are `POST /api/db/rpc/<name>` with a JSON body and run as
`SECURITY INVOKER` so writes are still subject to RLS.

### `transition_record_status`

Controlled lifecycle transition with optimistic concurrency. Rejects
archived records (frozen until restored).

```jsonc
// POST /api/db/rpc/transition_record_status
{
  "p_record_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "p_target_status": "reserved",
  "p_expected_metadata_version": 1,
}
```

Allowed transitions are defined per kind in decision 0026 and mirrored in
`src/lib/scientific-records.ts`. Unknown or disallowed transitions raise
`SB004` → `invalid_transition` (422). A metadata-version mismatch raises
`SB001` → `stale_version` (409).

### `create_record_link`

Creates a durable link from a notebook record to a scientific record.
Validates same-workspace membership and rejects cross-workspace targets.

```jsonc
// POST /api/db/rpc/create_record_link
{
  "p_source_record_id": "00000000-0000-4000-8000-000000000010",
  "p_target_kind": "protocol_template",
  "p_target_identifier": "PRT-2026-0001",
  "p_link_type": "protocol",
  "p_target_record_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
}
```

The preserved `target_identifier` keeps the link historically resolvable
when the target is later archived or soft-deleted. Cross-workspace targets
raise `SB002` → `missing_link` (422).

## Error shapes

All errors use the stable public envelope from `src/lib/errors.ts`. Clients
branch on `error.category`, not on messages or PostgREST-internal codes.

| SQLSTATE | Category             | HTTP | Meaning                                            |
| -------- | -------------------- | ---- | -------------------------------------------------- |
| `SB001`  | `stale_version`      | 409  | optimistic-concurrency mismatch                    |
| `SB002`  | `missing_link`       | 422  | link target unresolved / cross-workspace           |
| `SB004`  | `invalid_transition` | 422  | disallowed lifecycle transition or archived record |
| `SB005`  | `invalid_properties` | 422  | configurable property failed DB validation         |
| `42501`  | `permission_denied`  | 403  | RLS denied access                                  |
| `23514`  | `validation_error`   | 400  | check constraint (e.g. unsupported kind)           |

```jsonc
// 422 invalid_properties
{
  "error": {
    "category": "invalid_properties",
    "message": "property \"approved\" must be a boolean",
    "request_id": "...",
  },
}
```

## Archived-record behavior

Archiving sets `archived_at` via an authenticated `PATCH` on `records`.
Archived records:

- remain **readable** (RLS does not hide them);
- remain **link-resolvable** through the preserved `target_identifier`;
- are **frozen**: `transition_record_status` rejects them with
  `invalid_transition` until they are restored (`archived_at = NULL`).

The record picker excludes archived records from the active group by
default but surfaces them under an "Archived" heading when
`includeArchived` is set, so existing historical links render honestly.
