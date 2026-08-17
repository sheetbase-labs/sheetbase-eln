# DATA — Data Interoperability

**Status:** planned; refine after PC-00.

## Programme goal

Make scientific data easy to bring into Sheetbase, move out in useful formats, attach as durable files and find again without weakening schema, provenance or evidence semantics.

## DATA-01 — Import Framework

### Scope

CSV, XLSX, TSV, JSON and clipboard; preview; sheet/range selection; header detection; type inference; target Dataset/Schema selection; field mapping; required/default handling; quantity/category/reference validation; Record resolution/create; row-level errors; validate-before-commit; atomicity policy; large-file handling; provenance and import report.

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
