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
| `GET /api/export/record/$id/eln`       | .eln                                  | One experiment as an archive    |
| `GET /api/export/project/$id/eln`      | .eln                                  | All experiments in a project    |
| `POST /api/import/eln?projectId=$id`   | .eln body                             | Import experiments as drafts    |

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
the row cap gets `413`.

Receipts are authoritative and server-owned. Request roles hold no INSERT
grant on `api.data_exports` and no receipt-writer RPC is callable through
`/api/db`; receipts are written exclusively by the export routes over the
application's own database connection, deriving `workspace_id` and
`actor_user_id` from the verified Better Auth session. Fabricating or
reattributing an audit row would require server compromise, not a crafted
HTTP call.

A receipt is part of the successful-export contract: it persists once the
export content has been generated (for streams, strictly after a successful
close) with the exact number of delivered rows, and a receipt failure aborts
the export. Failed exports leave no receipt. Because export is a read-plane
action, plain unsuspended workspace membership gates the receipt RPC —
workspace `viewer` accounts may export data they can read while the system
records the action on their behalf.

## Superseded paths removed

- The client-side "Export CSV" of whatever rows happened to be loaded was
  replaced by server-side streaming export of complete datasets.
- The client-side evidence JSON download (`downloadRevisionEvidence` /
  `export_revision_evidence` RPC) was replaced by the evidence package; the
  same machine-readable content is now part of `evidence.json`.

## .eln archives

`.eln` is the ELN Consortium interchange format: a ZIP with one top-level
folder and an RO-Crate 1.1 `ro-crate-metadata.json`, readable by other ELNs
(eLabFTW, Chemotion, openBIS and others).

```
<name>/ro-crate-metadata.json      crate graph (root Dataset -> experiments)
<name>/<EXP-001 Title>/experiment.json   native Sheetbase notebook document
<name>/<EXP-001 Title>/files/…           attached files, with sha256 in the crate
<name>/<EXP-001 Title>/datasets/…        cited Datasets as CSV (frozen version if pinned)
<name>/<EXP-001 Title>/signatures.json   electronic signatures
<name>/<EXP-001 Title>/audit.csv         full audit history of the record
```

Each experiment is a `Dataset` entity (`identifier`, `name`, `text`,
`keywords`, `dateCreated`, status/kind as `PropertyValue`). Files and Datasets
are `File` entities with `encodingFormat`, `contentSize` and `sha256`.
Signatures are `Action` entities also typed `sheetbase:Signature`
(`https://sheetbase.io/ns/eln#`) carrying meaning, signer role, auth method,
revision id and the revision integrity digest, linked to a `Person`.

- **Authorisation.** Reads use the caller's RLS-scoped token, so a caller
  exports only what they can see; inaccessible or missing ids are `404`.
- **Receipts.** Each exported experiment writes an `api.data_exports` receipt
  (`object_type = record`, `format = eln`); a project export writes one per
  experiment. If a receipt cannot be written the export fails.
- **Limits.** At most 200 experiments per project archive (`413
too_many_experiments`) and 256 MiB of attached-file bytes per archive; files
  that are not active, are absent from storage or do not fit are left out of
  the archive rather than failing it.
- **Live, not evidence.** Like other live exports this is not immutable
  evidence; use the revision evidence package for submitted revisions.
- **Import.** `POST /api/import/eln?projectId=…` with the raw archive as the
  body (max 64 MiB) creates one `draft` experiment per crate experiment, with
  tags and rich-text blocks, plus a closing provenance paragraph naming the
  original identifier. Blocks that reference workspace objects (files, Sheets,
  Datasets, charts), attached files, signatures and audit history are **not**
  imported and are listed in `warnings`; foreign crates import their `text`.
  Entry names with `..`, absolute paths or backslashes, encrypted entries and
  ZIP64 archives are refused.
