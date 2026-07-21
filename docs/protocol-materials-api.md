# Protocol and materials notebook API

SCI-002 uses the existing authenticated same-origin `/api/db` boundary. UUIDs
and credentials below are placeholders.

## Resources

- `GET /api/db/blocks?record_id=eq.<experiment-id>&type=in.(protocol_reference,procedure_step,materials)&order=order.asc`
- `GET /api/db/records?id=in.(<material-id>,<protocol-id>)`
- `GET /api/db/revisions?id=eq.<pinned-revision-id>`
- `GET /api/db/record_links?source_record_id=eq.<experiment-id>&link_type=in.(protocol,sample,reagent)`
- `POST /api/db/rpc/update_block_payload` for one optimistic block-content
  update (notes, quantities, units, or completion intent).

All resources accept normal bounded PostgREST equality, `in`, ordering, range,
and selected-column filters allowed by the shared proxy. RLS limits every
result to the active workspace.

## Pin a protocol

```http
POST /api/db/rpc/pin_protocol_reference
Content-Type: application/json

{
  "p_block_id": "<protocol-reference-block-id>",
  "p_protocol_record_id": "<protocol-template-record-id>",
  "p_expected_block_version": 1,
  "p_expected_structure_version": 4
}
```

The response contains the canonical protocol-reference block, immutable
revision, copied procedure-step blocks, and new experiment structure version.
The operation is transactional. Repeating it against a pinned block or with a
stale version fails rather than silently changing historical provenance.

## Complete or reopen a procedure step

```http
POST /api/db/rpc/update_block_payload
Content-Type: application/json

{
  "p_block_id": "<procedure-step-block-id>",
  "p_payload": {
    "text": "Prepare the qPCR master mix.",
    "stepNumber": 1,
    "sourceProtocolRevisionId": "<revision-id>",
    "sourceStepBlockId": "<source-block-id>",
    "completed": true,
    "note": "Prepared on ice.",
    "completedAt": null,
    "completedByUserId": null
  },
  "p_expected_version": 1,
  "p_payload_schema_version": 1
}
```

PostgreSQL replaces completion timestamps and actor ids from authenticated
request claims. Reopening clears both fields. A stale block version returns the
shared `stale_version` error.

## Update materials

Materials are one ordered block payload. Each item requires a same-workspace
sample/reagent id, positive finite quantity, and structured unit. The database
captures/validates link identity and ensures stable `record_links` in the same
transaction. Archived records may remain referenced and readable; new
cross-workspace, missing, or soft-deleted targets are rejected.

Live archived/expired/low-stock/unavailable indicators are composed from the
current `records` representation. They do not modify the stored item or any
revision snapshot.

## Errors

Errors use the shared public envelope:

```json
{
  "error": {
    "category": "validation_error",
    "message": "The request could not be validated.",
    "requestId": "<request-id>"
  }
}
```

Relevant categories are `unauthorized`, `permission_denied`,
`validation_error`, `stale_version`, `missing_link`, and `not_found`. Callers
must branch on the category rather than PostgreSQL/PostgREST messages.
