# 0024. Transactional CSV interchange and bounded spreadsheet scope

- Status: Accepted
- Date: 2026-07-20
- Ticket: DATA-005
- Builds on: 0019, 0020

## Context

Scientists need to move ordinary spreadsheet data into and out of managed
scientific sheets without bypassing typed PostgreSQL constraints, stable
identities, attribution, or formula provenance. CSV files have ambiguous text
encoding, delimiters, headers and inferred types. A partially applied import is
especially dangerous because it can look complete while silently omitting
invalid rows.

## Decision

The first interchange contract is bounded CSV plus a separate Sheetbase
metadata JSON document. The browser previews at most 10 MB and 5,000 data rows,
with an explicit encoding (`UTF-8`, `UTF-16 LE`, or `Windows-1252`), delimiter
(comma, semicolon, or tab), and header choice. It parses quoted fields, detects
candidate types, reports malformed input, duplicate file rows, and every
row/field conversion error before enabling import.

Every source column is explicitly ignored, mapped to an existing stable column
identity, or mapped to a new typed column. The user chooses whether exact
duplicates within the submitted file are allowed, reject the whole import, or
skip later copies. This policy deliberately does not guess whether an existing
database row is scientifically equivalent; future record-key configuration may
add that separate concept.

`api.import_scientific_rows` is one PostgreSQL transaction. It locks the table
and owning record, checks the expected schema version and scopes, creates any
new managed columns through the existing safe DDL compiler, applies all accepted
rows through typed generated relations, and then records provenance. Any type,
constraint, permission, schema-version, or row error rolls back new columns,
all rows, provenance and events. Imports are not chunked or resumable in this
bounded first contract.

CSV export contains stable API field names plus reserved row identity/version.
Numeric formatting is deterministic and uses scientific notation for very
large or small finite values. The companion metadata JSON records table and
column stable identities, labels, logical types, units, nullability, validation,
category options, resource name and schema version. Exported formula values are
not substituted into literal CSV cells; formula definitions and trusted result
states remain separate REST resources.

`api.scientific_transfers` records import/export operation, table and record,
format, bounded file name/size/SHA-256 for imports, row count, duplicate policy,
non-sensitive parse settings, actor and timestamp. Durable change events carry
only transfer identity, counts and schema version, never file contents.

Direct XLSX parsing is not supported in this first scope. Users export one
value-only worksheet to CSV before import. Multiple worksheets, formulas,
macros, charts, merged cells, formatting, comments, hidden ranges, named ranges,
external links and workbook calculation state are unsupported and are not
silently flattened. A future XLSX reader must present worksheet selection and
the same typed preview/mapping transaction rather than treating workbook cells
as authoritative calculations.

## Consequences

- A failed import cannot leave partial rows or schema behind.
- Files remain client-side; Sheetbase stores a digest and provenance, not an
  unnecessary copy of the source CSV.
- The 5,000-row limit is honest and keeps one transaction bounded. Larger data
  requires a future staged, explicitly resumable design.
- CSV plus metadata is reproducible and approachable but does not preserve
  spreadsheet presentation or workbook behavior.
