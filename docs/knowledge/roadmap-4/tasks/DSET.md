# DSET — Datasets, Value Quality, Snapshots and Import

**Status (2026-09-27):** Proposed; not assigned.

## Programme goal

Keep instrument data trustworthy: values are never edited in place, problems
are flagged with reasons, every use cites a snapshot, and imports say exactly
what they did.

## Baseline at `main` `9538f36`

- `datasets`, `dataset_rows`, `dataset_versions` (immutable snapshots) with
  version rows and values; dataset schemas with versions (ADR-0034/0037/0038).
- `/datasets?dataset=` explorer; `import/import-wizard.tsx`; connectors with
  ingest panels; instrument raw files.
- Import is capped at 10 MiB and 1,000 rows (NEXT.md known limit).
- No value-level "out of range" flag with reason, no planned/pending rows, no
  snapshot comparison UI, no retention or row-removal policy.

## DSET-01 — Value flags and repeats

**Status:** proposed.

### Design

`canvas/Notebook.dc.html` (selected cell), `canvas/ExpDatasets.dc.html`,
"Mark out of range" in `canvas/DialogsRecord.dc.html`, `canvas/DatasetCompare.dc.html`.

### Scope

- Validation rules on a dataset schema field produce flags (out of range,
  missing unit, above curve, high replicate CV).
- "Mark out of range" with a reason category and comment: the value stays as
  recorded, is flagged and excluded from criteria and analyses until changed.
- "Request repeat": creates a derived sample (LAB-01) and planned rows that
  hold no values yet, shown as pending with the scheduled time.
- Flags and their changes are part of the next snapshot.

### Exit

A flagged value is excluded from ƒx criteria, analyses (SHEET-05) and pipeline
inputs by default, visibly and with the reason; planned rows are filled, not
duplicated, by a later import (DSET-05).

## DSET-02 — Dataset explorer

**Status:** proposed.

### Design

`canvas/DatasetsList.dc.html`, `DatasetsError`, `DatasetExplorer`.

### Scope

- List: tabs (all, mine, has issues, locked), inspector with issues and details.
- Explorer tabs: Data (views, filters, sort, fields), Columns (type, unit,
  required, check), Imports (file, parser, result), Used by, History.
- Missing unit fix: shows the source header, suggests a unit, requires a
  reason, sets the unit for all rows in one audited change, and optionally
  fixes the importer mapping for future imports.
- Partial load error state.

### Exit

"Set unit for 84 rows" works end to end on the seeded DS-0298, creates a new
snapshot, clears the inbox item and records the reason.

## DSET-03 — Snapshots and comparison

**Status:** proposed.

### Design

`canvas/DatasetSnapshots.dc.html`, `canvas/DatasetCompare.dc.html`,
`canvas/SnapshotsLaptop.dc.html`.

### Scope

Snapshot list (S-n, who or what made it, rows, change summary, pinned or cited
by, keeping); save a snapshot by hand; snapshot inspector (source, trigger,
file, hash, cited by); compare any two snapshots: rows added, changed,
removed, columns changed, flag changes, "only show changes".

### Exit

Comparison is computed on the server from version rows; the seeded S-14 →
S-15 comparison matches the design, including a flag change on an unchanged
value.

## DSET-04 — Snapshot retention

**Status:** proposed; after [DEC-11](DEC.md).

### Design

`canvas/SnapshotRemoved.dc.html`; retention text in `canvas/DatasetSnapshots.dc.html`.

### Scope

Workspace retention policy: snapshots cited by a signed record kept 15 years
from signing; uncited snapshots lose their rows N years after the dataset is
archived; ID, hash and history are kept. Warning before removal with "Keep";
a tombstone page for removed snapshots so links never break.

### Exit

A scheduled job removes only eligible rows, never those cited by signed
evidence (database test); removal is audited; links to a removed snapshot open
its tombstone.

## DSET-05 — Import flow

**Status:** proposed.

### Design

`canvas/ImportUpload.dc.html`, `canvas/ImportMap.dc.html`, `canvas/ImportFailed.dc.html`,
`design-system/components/Stepper/README.md`.

### Scope

- Three steps (upload, map columns, review and import) as a route.
- Parser recognition from file content; append to a dataset or create one;
  link to an experiment and instrument (with calibration status).
- Mapping with units and examples, saved as the default for that parser.
- Row outcomes before import: fills a planned row, new row, flagged (kept with
  its flag), skipped (controls); nothing dropped silently.
- File kept unchanged with its hash; import, mapping and hash written to the
  dataset's and experiment's History.
- Not recognised: explain the mismatch and offer manual mapping, a draft
  parser (DSET-06) or asking an admin.
- Revisit the 1,000-row and 10 MiB limits for plate-reader and bioreactor exports.

### Exit

The seeded plate-4 import fills planned row 97 and flags two rows as in the
design; a failed import writes nothing and keeps the file for retry.

## DSET-06 — Parsers per instrument

**Status:** proposed.

### Design

`canvas/SettingsInstruments.dc.html`, `canvas/ImportFailed.dc.html`,
`canvas/DatasetExplorer.dc.html` (parser version dropped units).

### Scope

Parsers as versioned definitions linked to instruments; draft, validate with a
test file, approve (QA) before importing GxP data; imports record the parser
version; failures raise a work item.

### Exit

A draft parser cannot import into a dataset marked GxP until approved; every
imported row can be traced to its parser version.
