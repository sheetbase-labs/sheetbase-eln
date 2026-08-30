# DATA — Data Interoperability

**Status:** Complete. DATA-01 (import), DATA-02 (export, #68), DATA-03 (files, #66) and DATA-04 (search, #67) are delivered.

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

**Priority:** medium. **Status:** Complete (#68).

Delivered: streaming Dataset and Dataset Version exports (CSV/TSV/JSON/NDJSON/XLSX/Parquet) through the canonical query RPCs; Sheet Instance export (JSON full state plus local-grid CSV/TSV/XLSX); canonical Record JSON document; deterministic revision evidence ZIP (evidence.json, README, frozen grids as CSV, pinned file manifest, sha256 manifest) from `api.revision_evidence_package`; `api.data_exports` receipts; ExportMenu UI on datasets/sheets/notebooks/reviews. Live exports are explicitly labelled not-evidence; version exports proven byte-stable after live mutation.

### Exit — met

Users can extract both usable data and interpretable evidence without reverse-engineering internal storage.

## DATA-03 — File & Attachment Platform

**Priority:** medium. **Status:** Complete (#66).

Delivered: consolidation of the SCI-003 platform as the one canonical file subsystem (`request-auth` session resolver, `docs/file-platform.md` contract), API-level cross-workspace upload/download denial without existence leak, unauthenticated denial, zero-byte boundary, checksum stability across renames, viewer writer gate on `create_file_upload`. Retention immutability (REV-002 pinning) already proven by the existing suites. PostgREST dev image fixed for libpq.

### Exit — met

Files are durable scientific objects with identity and integrity rather than opaque browser attachments.

## DATA-04 — Global Search

**Priority:** medium. **Status:** Complete (#67).

Delivered: `api.search` extended to Datasets, Sheet Instances and the Notebook Template catalogue alongside records/files under one SECURITY INVOKER + RLS permission model; `p_result_type` facet; record-only filters keep exact prior semantics; deep links per object class; object-class tabs with counts derived from the same filtered set; PostgreSQL FTS only, real-time.

### Exit — met

Users can reliably locate scientific objects without knowing which subsystem owns them.

## Boundaries

- Import is not a second Dataset write path; it must use canonical validation/mutation contracts.
- Export must not imply mutable evidence is immutable.
- Files should not be embedded into database JSON as a substitute for object storage.
- Search indexes must respect authoritative permissions.
