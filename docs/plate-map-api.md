# Plate map notebook block API

SCI-005 uses the existing authenticated same-origin `/api/db` boundary
(ADR 0030). A plate map is a `blocks` row with `type='plate_map'` and a
versioned JSONB `payload` (`payload_schema_version=1`). UUIDs and credentials
below are placeholders.

## Contract summary

- A plate map specification stores plate dimensions (format, rows, cols),
  well assignments (role, optional sample link, replicate, volume, notes),
  and validation configuration (required roles, volume bounds).
- No biotech-specific assay semantics are baked into the role vocabulary;
  roles are generic (`sample`, `positive_control`, `negative_control`,
  `blank`, `empty`) and extensible.
- Sample links reuse the existing SCI-001 record-link machinery. The payload
  stores an honest `SampleRef` snapshot (`recordId`, `identifier`, `title`,
  `archived`) so archived, renamed, or soft-deleted samples remain historically
  resolvable.
- The DB trigger (`api.validate_scientific_block`) enforces structural
  invariants and same-workspace sample reference integrity. Application
  validation improves error messages but is not the only boundary.
- Plate edits persist atomically through the existing `update_block_payload`
  RPC with expected-version optimistic concurrency — all wells live in a
  single JSONB payload, so no bulk-assignment RPC is needed.
- Durable change events and audit attribution come from existing block
  triggers; no plate-map-specific event names.

## Resources

- `GET /api/db/blocks?record_id=eq.<experiment-id>&type=eq.plate_map&order=order.asc`
  — list plate map blocks for a record.
- `GET /api/db/blocks?id=eq.<plate-map-block-id>&select=id,type,payload` — read
  a single plate map block.
- `POST /api/db/rpc/insert_block` — insert a plate map block (draft `{}` is
  valid).
- `POST /api/db/rpc/update_block_payload` — update the plate map payload (title,
  spec, wells, validation config).

All resources accept normal bounded PostgREST equality, `in`, ordering, range,
and selected-column filters allowed by the shared proxy. RLS limits every
result to the active workspace.

## Payload shape

```typescript
interface PlateMapBlockPayload {
  title?: string
  spec?: PlateMapSpec
  provenance?: string
}

interface PlateMapSpec {
  specVersion: number // 1
  format: string // '96_well' initially
  rows: number // 8 for 96-well
  cols: number // 12 for 96-well
  wells: WellAssignment[]
  validation: {
    requiredRoles?: string[]
    volumeMin?: number
    volumeMax?: number
    volumeUnit?: string
  }
}

interface WellAssignment {
  wellCode: string // canonical "A1", "B12"
  row: number // 0-based
  col: number // 0-based
  role: string // 'sample' | 'positive_control' | 'negative_control' | 'blank' | 'empty'
  sampleRef?: {
    recordId: string // stable UUID of the sample record
    identifier: string // observed display identifier
    title: string // observed display title
    archived?: boolean // snapshot of archived state
  }
  replicate?: number // positive integer
  volume?: { value: number; unit: string }
  notes?: string
}
```

An empty draft `{}` is valid, so the editor opens immediately and the user
configures the plate interactively.

## Insert a plate map block

```http
POST /api/db/rpc/insert_block
Content-Type: application/json

{
  "p_record_id": "<experiment-record-id>",
  "p_type": "plate_map",
  "p_payload": {},
  "p_payload_schema_version": 1,
  "p_expected_structure_version": 4
}
```

The response contains the new block and the bumped `structure_version`.

## Update a plate map payload

```http
POST /api/db/rpc/update_block_payload
Content-Type: application/json

{
  "p_block_id": "<plate-map-block-id>",
  "p_payload": {
    "title": "qPCR titration plate",
    "spec": {
      "specVersion": 1,
      "format": "96_well",
      "rows": 8,
      "cols": 12,
      "wells": [
        {
          "wellCode": "A1",
          "row": 0,
          "col": 0,
          "role": "sample",
          "sampleRef": {
            "recordId": "<sample-record-uuid>",
            "identifier": "SMP-2025-0001",
            "title": "LVV-CAR-T drug substance"
          },
          "replicate": 1,
          "volume": { "value": 20, "unit": "µL" }
        },
        {
          "wellCode": "A2",
          "row": 0,
          "col": 1,
          "role": "positive_control"
        },
        {
          "wellCode": "A3",
          "row": 0,
          "col": 2,
          "role": "negative_control"
        },
        {
          "wellCode": "A4",
          "row": 0,
          "col": 3,
          "role": "blank"
        }
      ],
      "validation": {
        "requiredRoles": ["positive_control", "negative_control"],
        "volumeMin": 5,
        "volumeMax": 100,
        "volumeUnit": "µL"
      }
    },
    "provenance": "Virus Stability qPCR"
  },
  "p_expected_version": 1,
  "p_payload_schema_version": 1
}
```

The response contains the updated block with the incremented `version`.

## Validation errors

The DB trigger raises `SQLSTATE 23514` for invalid payloads. The proxy maps
this to the `validation_error` category. Error codes:

| Code                       | Description                                                         |
| -------------------------- | ------------------------------------------------------------------- |
| `invalid_shape`            | Payload or spec is not an object                                    |
| `missing_field`            | Required field is absent                                            |
| `invalid_value`            | Field value is invalid (e.g. wrong rows/cols)                       |
| `unsupported_format`       | Format is not in the approved set                                   |
| `unsupported_spec_version` | specVersion is not 1                                                |
| `unsupported_role`         | Role is not in the approved set                                     |
| `invalid_well_code`        | Well code is malformed or out of bounds                             |
| `duplicate_well`           | Two wells share the same well code                                  |
| `out_of_bounds`            | Row or col is outside the plate dimensions                          |
| `invalid_sample_ref`       | Sample reference is missing fields or points to a non-sample record |
| `invalid_volume`           | Volume value is not positive or exceeds configured bounds           |
| `invalid_replicate`        | Replicate is not a positive integer                                 |
| `missing_required_role`    | A configured required role is not present on the plate              |
| `duplicate_assignment`     | Same sample + role + replicate appears in multiple wells            |

Example error response:

```json
{
  "error": {
    "category": "validation_error",
    "code": "23514",
    "message": "duplicate wellCode \"A1\" (also at index 0)"
  }
}
```

## Archived-sample behavior

When a sample record is archived after being referenced by a plate map:

- The `sampleRef` in the payload retains the honest snapshot
  (`recordId`, `identifier`, `title`, `archived: true`).
- `GET /api/db/blocks?id=eq.<plate-map-block-id>` continues to return the
  block with the archived reference.
- `fetchRecordById` resolves the live record state; the UI shows the
  archived indicator alongside the stored identifier.
- The DB trigger accepts archived sample references in the same workspace.

## Cross-workspace enforcement

- RLS on `api.blocks` limits reads to the active workspace.
- The DB trigger rejects `sampleRef.recordId` values pointing to records in
  a different workspace.
- The `create_record_link` same-workspace enforcement applies to any
  record links created for sample references.

## Stable link representations

The `sampleRef.recordId` (UUID) is authoritative and stable. The
`sampleRef.identifier` and `sampleRef.title` are observed display values
captured at assignment time, ensuring historical resolution even if the
sample record is later renamed or archived.
