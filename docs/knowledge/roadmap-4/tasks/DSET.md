# DSET — Datasets, Value Quality, Snapshots and Import

**Status (2026-10-02):** Reconciled against `9bbd305c`; see [task evidence](../RECONCILIATION.md#dset) and [live tracker](../CHECKLIST.md). Baseline sections describe the original planning snapshot, not current absence.

**Original scope note (2026-09-27):** Original proposal. Current status is reconciled below.

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

**Status (2026-10-02):** partial; nod `in-progress`. [Evidence and remaining work](../RECONCILIATION.md#dset-01).

**Original decision/dependency note:** Original proposal.

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

### Start here

- Rows and values: `api.dataset_rows`, `api.dataset_row_values`
  (typed value columns), versions `api.dataset_versions`,
  `api.dataset_version_rows`, `api.dataset_version_values` in `src/db/schema.ts`.
- Validation: `api.validate_dataset_row_batch`, schema field rules
  (`api.dataset_schema_version_fields`), `src/lib/dataset-product.ts`,
  `src/lib/dataset-explorer-data.ts`; tests `tests/db/datasets.test.ts`.
- Analyses and criteria that must honour exclusions: `src/lib/analysis-definition.ts`,
  `src/lib/chart-data.ts`, sheet calculations in `src/lib/calculation.server.ts`,
  pipeline input materialisation in `src/lib/pipeline-execute.server.ts`.

### Steps (PRs)

1. **Flags.** `api.dataset_value_flags` (dataset, row, field, kind
   `out_of_range | missing_unit | above_curve | high_cv`, reason category,
   comment, set by, set at, cleared at). System flags written by validation;
   RPC `flag_dataset_value` / `clear_dataset_value_flag` with reason. Flags
   are copied into the next snapshot. DB tests.

   **System rules (implemented 2026-10-03, migration 0294/0295).** A rule lives
   in `dataset_schema_version_fields.validation.extensions.systemFlags` and
   produces a `source = 'system'` flag with its own provenance (`system_rule`,
   `evaluated_value`, `threshold`, `evaluated_at`), all frozen into the
   snapshot. Shapes:

   ```jsonc
   {
     "extensions": {
       "systemFlags": {
         // Soft min/max; the hard validation.min/max still rejects a value.
         "out_of_range": { "min": 2, "max": 4 },
         // Numeric field that must carry a unit in its quantity metadata.
         "missing_unit": { "requiresUnit": true },
         // Replicate dispersion: rows sharing the group field's value.
         "high_cv": {
           "maxCvPercent": 20,
           "groupByFieldId": "<uuid of another schema field>",
           "minReplicates": 3,
         },
       },
     },
   }
   ```

   Evaluation stays in the write path, like the original `out_of_range` rule:
   `validate_dataset_row_batch` previews the row-level rules (`out_of_range`,
   `missing_unit`) for a written row, `commit_dataset_row_batch` reconciles them
   after the values land and recomputes `high_cv` once across the dataset's
   groups, and `recompute_dataset_system_flags(dataset)` re-runs everything on
   demand so a rule change need not wait for the next edit. `high_cv` is not
   evaluated in a validation dry run because it needs committed cross-row
   values.

   Clearing a `system` flag is an override: the RPC requires a reason from a
   workspace writer, records the reason and actor, and the dismissed rule is not
   re-raised while the evaluated value is unchanged. Manual flags are unchanged.

   `above_curve` is **not implemented**: it needs a calibration-curve definition
   (standard concentrations, response, fit model, acceptance band) that no
   schema field or dataset metadata stores yet. Until that contract exists a
   rule could only guess, so the kind stays in the model and the RPC accepts it
   for manual flags, but no system rule writes it.

2. **Exclusion.** Analyses, chart data, ƒx criteria and pipeline inputs exclude
   flagged values by default and report them; unit tests in each module.
3. **Planned rows.** Row status `planned` with scheduled time and no values;
   RPC `plan_dataset_rows`; import fills planned rows by sample/well key
   (used by DSET-05).
4. **Request repeat.** RPC creating the derived dilution sample (LAB-01) and
   planned rows in one transaction.
5. UI: "Mark out of range" dialog (`DialogsRecord`), selected-value inspector
   actions (`Notebook`, `ExpDatasets`).

### Check it

`pnpm test:db` (flags, exclusion in pipeline materialisation), unit tests for
analysis exclusion; parity for the mark-out-of-range dialog.

### Exit

A flagged value is excluded from ƒx criteria, analyses (SHEET-05) and pipeline
inputs by default, visibly and with the reason; planned rows are filled, not
duplicated, by a later import (DSET-05).

## DSET-02 — Dataset explorer

**Status (2026-10-02):** partial; nod `in-progress`. [Evidence and remaining work](../RECONCILIATION.md#dset-02).

**Original decision/dependency note:** Original proposal.

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

### Start here

`src/routes/datasets.tsx` (1,989 lines, list and explorer via `?dataset=`),
`src/lib/dataset-explorer-data.ts`, `src/components/datasets/dataset-product-controls.tsx`,
`src/components/data-grid/`, `tests/browser/data-007-dataset-explorer.test.ts`,
`tests/api/dataset-explorer.test.ts`.

### Steps (PRs)

1. Routes `/datasets` (list) and `/datasets/$datasetId/{data,columns,imports,snapshots,compare,history}`;
   redirect `?dataset=` URLs.
2. List per `DatasetsList` with issues inspector; partial error state.
3. Explorer tabs; Columns tab with checks; Imports tab from import records
   (DSET-05); Used-by from record links and analysis inputs.
4. **Set unit.** RPC `set_dataset_field_unit(dataset, field, unit, reason,
fix_mapping boolean)` creating a new schema version or field revision and a
   snapshot, clearing `missing_unit` flags, optionally updating the parser
   mapping; audited. DB test.

### Check it

Updated browser and API tests; parity for `DatasetsList`, `DatasetsError`,
`DatasetExplorer`.

### Exit

"Set unit for 84 rows" works end to end on the seeded DS-0298, creates a new
snapshot, clears the inbox item and records the reason.

## DSET-03 — Snapshots and comparison

**Status (2026-10-03):** done; nod `done` — closed 2026-10-03 by `4bf62ec0` (see [update since the 2 October audit](../RECONCILIATION.md#update-since-this-audit)). [Evidence and remaining work](../RECONCILIATION.md#dset-03).

**Original decision/dependency note:** Original proposal.

### Design

`canvas/DatasetSnapshots.dc.html`, `canvas/DatasetCompare.dc.html`,
`canvas/SnapshotsLaptop.dc.html`.

### Scope

Snapshot list (S-n, who or what made it, rows, change summary, pinned or cited
by, keeping); save a snapshot by hand; snapshot inspector (source, trigger,
file, hash, cited by); compare any two snapshots: rows added, changed,
removed, columns changed, flag changes, "only show changes".

### Start here

`api.snapshot_dataset`, `api.query_dataset_version_rows`, version tables in
`schema.ts`, `tests/db/datasets.test.ts`; pipeline run input versions
(`pipeline_runs.input_versions`) and revision sheet evidence
(`api.revision_sheet_evidence`) for "cited by".

### Steps (PRs)

1. Snapshot list read model: made by (user, import, pipeline run), rows,
   change summary vs previous, cited by (signed revisions, analyses, pipeline
   runs), keeping status (DSET-04).
2. RPC `compare_dataset_versions(a, b)` returning added, changed (per field,
   including flag changes), removed rows and column changes; paginated. DB
   tests with a flag-only change.
3. Snapshots and Compare tabs per design; "Save a snapshot now".

### Check it

DB test for comparison; parity for `DatasetSnapshots`, `DatasetCompare`,
`SnapshotsLaptop`.

### Exit

Comparison is computed on the server from version rows; the seeded S-14 →
S-15 comparison matches the design, including a flag change on an unchanged
value.

## DSET-04 — Snapshot retention

**Status (2026-10-03):** done; nod `done` — closed 2026-10-03 by `cda5daec` (see [update since the 2 October audit](../RECONCILIATION.md#update-since-this-audit)). [Evidence and remaining work](../RECONCILIATION.md#dset-04).

**Original decision/dependency note:** [DEC-11](DEC.md) accepted 2026-09-27: snapshots cited by a signed record are kept 15 years from signing (QA to confirm); uncited snapshots lose their rows 2 years after the dataset is archived, keeping ID, hash and history.

### Design

`canvas/SnapshotRemoved.dc.html`; retention text in `canvas/DatasetSnapshots.dc.html`.

### Scope

Workspace retention policy: snapshots cited by a signed record kept 15 years
from signing; uncited snapshots lose their rows **2 years** after the dataset is
archived; ID, hash and history are kept. Warning before removal with "Keep";
a tombstone page for removed snapshots so links never break.

### Start here

Version tables above; `src/lib/backup.ts` and `scripts/` for scheduled jobs;
pipeline scheduler (`src/lib/pipeline-scheduler.server.ts`) as the pattern for
a periodic server job.

### Steps (PRs)

1. Retention policy in workspace settings (periods from DEC-11); `kept_until`
   computed per snapshot (cited by signed evidence → 15 years from signing).
2. Job removing rows of eligible snapshots, keeping ID, hash, counts and
   history; `rows_removed_at`; audit event. Never touches cited snapshots
   (DB test).
3. "Keep" RPC with reason; warning banner before removal; tombstone view for
   removed snapshots (`SnapshotRemoved`).

### Check it

DB tests for eligibility and the job; parity for `SnapshotRemoved`.

### Exit

A scheduled job removes only eligible rows, never those cited by signed
evidence (database test); removal is audited; links to a removed snapshot open
its tombstone.

## DSET-05 — Import flow

**Status (2026-10-02):** partial; nod `in-progress`. [Evidence and remaining work](../RECONCILIATION.md#dset-05).

**Original decision/dependency note:** Original proposal.

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

### Start here

`src/components/import/import-wizard.tsx` (dialog today),
`src/lib/import-parse.ts` (`IMPORT_LIMITS`: 10 MiB, 1,000 rows),
`import-mapping.ts`, `import-commit.ts`, `api.import_scientific_rows`,
`api.commit_dataset_row_batch_atomic`, `src/lib/connectors/plate-reader.ts`,
`instrument-ingestion.ts`, `api.instrument_raw_files`, `tests/db/data-01-import.test.ts`.

### Steps (PRs)

1. `/import` route with the three-step `Stepper`; upload stores the raw file
   with checksum first (PROJ-04 files), then parses.
2. Parser recognition: run registered parsers (DSET-06) over the file and pick
   the matching one; show what it read.
3. Mapping step with units and examples; save as the parser's default mapping
   (`api.parser_mappings`).
4. Review step computing row outcomes server-side (fills planned, new,
   flagged, skipped) in a dry run; commit writes one snapshot and History
   entries for dataset and experiment.
5. Failure page with the three options.
6. Raise limits to cover a 96-well plate export and a 14-day bioreactor
   export (measure and record numbers here); stream parse on the server for
   large files.

### Check it

`tests/db/data-01-import.test.ts` extended for planned-row filling and
flags; browser test for the three steps; parity for `ImportUpload`,
`ImportMap`, `ImportFailed`.

### Exit

The seeded plate-4 import fills planned row 97 and flags two rows as in the
design; a failed import writes nothing and keeps the file for retry.

## DSET-06 — Parsers per instrument

**Status (2026-10-02):** not-started; nod `todo`. [Evidence and remaining work](../RECONCILIATION.md#dset-06).

**Original decision/dependency note:** Original proposal.

### Design

`canvas/SettingsInstruments.dc.html`, `canvas/ImportFailed.dc.html`,
`canvas/DatasetExplorer.dc.html` (parser version dropped units).

### Scope

Parsers as versioned definitions linked to instruments; draft, validate with a
test file, approve (QA) before importing GxP data; imports record the parser
version; failures raise a work item.

### Start here

`src/lib/connectors/` (`registry.ts`, `plate-reader.ts`, `instrument-ingestion.ts`),
`api.connectors`, `api.instruments`, `src/components/integrations/ingest-panel.tsx`,
`tests/db/int-connectors.test.ts`.

### Steps (PRs)

1. `api.parsers` and `api.parser_versions` (instrument, format, status
   `draft | validated | approved | retired`, mapping) with RPCs to create,
   validate (run against a test file, store the result), approve (QA
   capability).
2. Imports record the parser version; datasets marked GxP refuse draft parsers
   (server check).
3. Instruments and parsers settings page (`SettingsInstruments`), failure work
   item (WORK-01).

### Check it

DB tests for approval gating; parity for `SettingsInstruments`.

### Exit

A draft parser cannot import into a dataset marked GxP until approved; every
imported row can be traced to its parser version.
