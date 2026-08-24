# 0041. Canonical sources for charts and analysis (SCI foundation rework)

- **Status:** accepted
- **Date:** 2026-08-24
- **Tickets:** SCI-01/02/03 foundation rework
- **Amends:** 0029 (source identity), 0040 (input binding, frozen evidence)
- **Depends on:** 0037 (canonical Dataset storage and versioning)

## Context

The first SCI delivery extended the decision-0029 chart contract and added
analysis definitions on top of the legacy `scientific_tables` /
`scientific_columns` subsystem and its generated `sheet_*` physical
relations. PC-00 explicitly directs that old specialist surfaces not be
revived, and the SCI objective is analysis over **canonical Sheet/Dataset
data**. With no users or production history there is no reason to cement a
new analytics layer onto the compatibility subsystem.

Three correctness defects in the same delivery forced one architectural
pass before any incremental fixes:

1. `columnId` was claimed authoritative but resolution fell back to
   `fieldName`, silently rebinding calculations to a different field when an
   ID went missing — violating "stable semantic IDs beat labels".
2. Analysis accepted any number of input datasets while execution and
   freezing used only the first.
3. Frozen analysis embedded the complete source row set into the block's
   JSONB payload with no scale bound — making the notebook block a second
   bulk-data store, contrary to the SCI boundary that charts/analysis must
   not be the authoritative storage of their source data. Separately,
   revision binding existed as RPCs but nothing in the submission lifecycle
   called them.

## Decision

1. **Canonical identity only.** Chart specs and analysis definitions
   reference canonical Datasets (`api.datasets.id`) and bind fields by the
   stable Dataset Schema Version `field_id`. No SCI code or SQL reads
   `scientific_tables`, `scientific_columns` or generated relations.
   Bindings carry no display name; labels/units are presentation metadata
   resolved from schema fields (or frozen column metadata), never used for
   resolution.

2. **Single-Dataset analyses.** `AnalysisDefinition.datasets` contains
   exactly one `{ datasetId }`; validators enforce it in TypeScript, the DB
   trigger and the freeze RPC. Multi-Dataset composition is deferred until
   real composition semantics exist.

3. **Live reads through CORE-02 RPCs.** Live charts and analyses read rows
   via `query_dataset_rows`, which pivots typed values into field_id-keyed
   objects; runtime row keys equal bound `fieldId`s by construction. The
   client materialises at most 5000 rows and surfaces an honest
   `dataset_too_large` state beyond it — never silent truncation.

4. **Frozen analysis pins Dataset Versions, not rows.**
   `freeze_analysis_block` snapshots the input Dataset via
   `api.snapshot_dataset` into immutable `dataset_version_*` tables and
   stores: the verbatim definition snapshot, column metadata for bound
   fields, and provenance `{ datasetId, datasetVersionId,
schemaVersionNumber, sourceDatasetRevision, rowCount, checksum }` where
   checksum = md5 over the Version's normalised per-row values for bound
   fields ordered by `row_id`. Rendering reconstructs deterministically by
   paging `query_dataset_version_rows` and re-executing the pure kernel,
   verifying rowCount against the pin (`evidence_mismatch` otherwise).
   Frozen chart payloads keep their derived series (self-contained visual
   evidence) with provenance keyed by `datasetId`.

5. **Fit overlays plot the fitted space.** Regression coefficients describe
   transformed coordinates (ADR 0040 §6); fit previews therefore draw
   observations with the same monotonic transforms applied, label axes with
   the transform, and are restricted to ungrouped regressions until
   per-group curves exist — one group's model must never be drawn over
   another group's observations.

6. **Numerics.** Polynomial least squares centres and scales the predictor
   before solving and expands back to raw-space coefficients, so degrees
   1–4 stay stable across scientific magnitudes without importing a
   statistical package.

7. **Revision binding happens at submission.** `submit_record_revision`
   pre-allocates the revision UUID, stamps `frozen.revisionId` onto all of
   the record's frozen chart/analysis blocks still unbound, and only then
   captures the envelope and digest — inside one transaction, as a SECURITY
   DEFINER system action authorised only for that null→uuid transition.
   The submitted snapshot, live blocks and digest therefore agree at the
   evidence boundary; digest canonicalisation strips the self-referential
   bound id (and binding-volatile block metadata) so client previews taken
   before binding remain valid. The standalone bind RPCs are removed;
   unfreeze remains refused once evidence is locked.

## Consequences

- Migrations 0124–0128 were corrected in place before merge (draft stack);
  0127 delivers in-transaction submission binding instead of the
  `bind_analysis_revision` trigger/RPC pair.
- Frozen analysis blocks stay small regardless of Dataset scale;
  reconstruction cost is proportional to pinned rows and bounded by the
  client ceiling, above which reconstruction reports an honest failure.
- `snapshot_dataset` runs per analysis freeze — sanctioned as submission
  evidence under ADR 0037, and intentionally substantial.
- HyperFormula staleness detection leaves the chart path: calculated-column
  staleness is a legacy-sheet concept; canonical Datasets have no formula
  engine.
- Omitted-row counts count rows once (a row invalid in both heatmap
  dimensions is one omission).
