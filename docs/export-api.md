# Export & portability API

DATA-02. Exports turn canonical Sheetbase objects into portable files without
weakening schema, provenance or evidence semantics. Every endpoint streams
through the same-origin boundary, authenticates with the Better Auth session,
enforces workspace RLS through PostgreSQL and writes a provenance receipt into
`api.data_exports`.

## Endpoints

| Endpoint                               | Formats                               | Object                          |
| -------------------------------------- | ------------------------------------- | ------------------------------- |
| `GET /api/export/dataset/$id`          | csv, tsv, json, ndjson, xlsx, parquet | Live Dataset                    |
| `GET /api/export/dataset-version/$id`  | csv, tsv, json, ndjson, xlsx, parquet | Dataset Version (frozen)        |
| `GET /api/export/sheet-instance/$id`   | json, csv, tsv, xlsx, parquet         | Sheet Instance                  |
| `GET /api/export/record/$id`           | json                                  | Record / Notebook document      |
| `GET /api/export/revision/$id/package` | zip                                   | Submitted revision evidence ZIP |

Downloads are plain GETs: session cookies authenticate them, so an anchor or
`window.open` is enough in the browser.

## Live state versus frozen evidence

Exports distinguish the two explicitly:

- **Live exports** (`_meta.state = "live"`) reflect mutable workspace state as
  of the last queried page. Their metadata carries the note: _This file is NOT
  immutable evidence._
- **Dataset Version exports** (`state = "version"`) read only the frozen copy
  captured by `snapshot_dataset`. Mutating the live dataset afterwards does not
  change a version export — this is proven by test.
- **Revision evidence packages** bundle one submitted revision: the immutable
  REV-002 envelope, its frozen Sheet grids, the pinned attachment manifest and
  the review/signature trail.

## Determinism

Machine-readable exports are deterministic: identical inputs produce identical
bytes. Wall-clock timestamps are deliberately excluded from file content —
export provenance (who/when/format) lives in `api.data_exports` receipts and in
the response headers instead. Decimal values inherit the canonical Dataset
contract's JSON number encoding; precision beyond IEEE double (~15 significant
digits) is rounded by that encoding, which is a documented boundary of reading
through `query_dataset_rows` rather than raw tables.

### Metadata envelope

JSON and XLSX exports embed `_meta` / a Metadata sheet:

```
kind            sheetbase.dataset.export | sheetbase.dataset-version.export | ...
state           live | version | evidence
objectId        stable object id
workspaceId     owning workspace
name            object name at export time
sourceRevision  dataset revision backing the rows
datasetVersion  { datasetVersionId, sourceDatasetRevision, label, schemaVersionId }
schema[]        { key, label, logicalType, nullable, unit }
notes[]         live/version statement
```

CSV/TSV stay pure data (headers only); units and schema travel in the JSON,
NDJSON companion or the XLSX Metadata sheet. Category and reference cells keep
their stable option/target ids — labels are presentation, ids are identity.

## Streaming and bounds

- CSV/TSV/JSON/NDJSON render line-by-line while paging the canonical RPCs
  (`query_dataset_rows`, `query_dataset_version_rows`, 1000-row windows), so
  memory stays bounded regardless of dataset size.
- XLSX materialises worksheet XML per sheet (bounded by the export itself).
- Parquet materialises column arrays and is capped at `PARQUET_MAX_ROWS`
  (200,000); larger datasets must use CSV/NDJSON.
- Evidence ZIPs buffer one entry at a time; entries derive from already-frozen
  revision content.

## Evidence package layout

```
evidence-<revisionId>.zip
├── README.md                  how to read the package
├── evidence.json              full machine-readable evidence document
├── grids/<blockId>.csv        frozen Sheet grid render per submitted block
├── files/files-manifest.csv   pinned attachments with sha256 checksums
└── checksums.sha256           sha256sum -c compatible manifest
```

The JSON document contains the revision identity and REV-002 integrity digest,
metadata/block snapshots, `canonicalSnapshot`, per-block Sheet evidence
(instance state, composed grid, pinned Dataset Version bindings), the retained
file manifest from `internal.revision_file_objects`, and the review/signature
trail (submission, decisions, check results, signatures, comments). It is
produced exclusively by `api.revision_evidence_package` — the SIGN-002
`export_revision_evidence` RPC was consolidated into it and removed.

## Permissions and failure modes

Authorization stays in PostgreSQL: metadata reads and data pages run through
RLS under the caller's short-lived JWT, so an inaccessible object is
indistinguishable from a missing one (`404 not_found`, no existence leak).
Unauthenticated requests get `401`; malformed formats get `400`; Parquet over
the row cap gets `413`. Every successful export writes a `data_exports` receipt
(actor user XOR credential, format, row count, byte size) visible to workspace
members for audit.

## Superseded paths removed

- The client-side "Export CSV" of whatever rows happened to be loaded was
  replaced by server-side streaming export of complete datasets.
- The client-side evidence JSON download (`downloadRevisionEvidence` /
  `export_revision_evidence` RPC) was replaced by the evidence package; the
  same machine-readable content is now part of `evidence.json`.
