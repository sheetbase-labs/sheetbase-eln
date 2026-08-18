# DATA — Data Interoperability

**Status:** DATA-01 complete. Remaining work is DATA-02 (export), DATA-03 (files) and DATA-04 (search). Do not start those until assigned.

## Programme goal

Make scientific data easy to bring into Sheetbase, move out in useful formats, attach as durable files and find again without weakening schema, provenance or evidence semantics.

## DATA-01 — Import Framework

**Priority:** medium. **Status:** Complete.

### Current state

Laboratory files and clipboard pastes import into governed Dataset and Record state. The wizard parses CSV, TSV, JSON, XLSX and clipboard text, previews rows, maps columns, fail-closes on type coercion, validates against the Dataset's current Schema Version, then commits only through `validate_dataset_row_batch` / `commit_dataset_row_batch` or `validate_sheet_record_batch` / `create_model_record`.

Canonical Sheet paste remains grid interaction (PC-01), not this framework. Plate CSV stays a plate-designer tool. Leftover scientific CSV import is no longer a product path.

### Scope delivered

CSV, XLSX, TSV, JSON and clipboard; preview; sheet selection; header detection; target Dataset or Record mapping; required-field handling; fail-closed integer/decimal/boolean coercion; Schema Version pinning; row-level errors; validate-before-commit; 1–1000 row batches (canonical RPC ceiling).

### Exit

Users can safely turn common laboratory files/pastes into governed Dataset/Record state with clear validation before commit.

## DATA-02 — Export & Portability

Dataset/Version export; Sheet export; Record export; Notebook/evidence package; CSV/XLSX/JSON/Parquet where appropriate; schema/units/provenance metadata; stable machine-readable exports; human-readable evidence export.

### Exit

Users can extract both usable data and interpretable evidence without reverse-engineering internal storage.

## DATA-03 — File & Attachment Platform

Object storage; upload/download; checksums; immutable versions where required; MIME metadata; previews; Notebook/Record/Dataset attachments; provenance; retention; permissions; large uploads; optional malware scanning; evidence pinning.

### Exit

Files are durable scientific objects with identity and integrity rather than opaque browser attachments.

## DATA-04 — Global Search

Search Records, Notebooks, Datasets, Templates, Sheets and files; type/workspace/project filters; identifiers/titles/tags; full text; permission filtering; keyboard navigation; direct source links.

Start with PostgreSQL search unless evidence justifies specialist infrastructure.

### Exit

Users can reliably locate scientific objects without knowing which subsystem owns them.

## Boundaries

- Import is not a second Dataset write path; it must use canonical validation/mutation contracts.
- Export must not imply mutable evidence is immutable.
- Files should not be embedded into database JSON as a substitute for object storage.
- Search indexes must respect authoritative permissions.
