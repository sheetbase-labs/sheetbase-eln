# SCI — Scientific Analysis & Visualisation

**Status:** in rework — the delivered stack is being moved onto canonical Dataset identity before merge (decision 0041).

## Programme goal

Make visualisation and analysis first-class scientific work over Sheetbase data, with stable source identities and reproducible definitions rather than copied values.

## SCI-01 — Charting — **implemented** (`feat/sci-01-charting`)

Scatter, line, bar, box, histogram, heatmap; error bars; grouping; colour/marker mapping; faceting; log axes; annotations; missing values; legends; interactive selection; export; accessible alternatives; stable field references; reusable chart configuration.

**Exit:** users create publication/useful scientific charts directly from Sheet/Dataset semantics without copying data into another tool.

Reworked onto canonical Datasets (decision 0037): `ChartSpec` references
`api.datasets` by UUID and binds fields by stable `field_id`; live rendering
reads through `query_dataset_rows`, and `freeze_chart` pivots
`dataset_row_values` server-side so frozen series stay byte-reproducible
against the pure TypeScript materialiser. Legacy `scientific_tables` and the
generated `sheet_*` relations are no longer part of the chart path.

## SCI-02 — Analysis Framework — **implemented** (`feat/sci-02-analysis-framework`)

Descriptive statistics; grouping/aggregation; transforms; regression; curve fitting; reusable analysis definition; immutable/versioned input support; provenance; execution errors; deterministic results where expected.

Avoid a giant statistical package in the first iteration.

**Exit:** common analysis can be defined, rerun and traced to explicit inputs.

Delivered as decision 0040, amended by decision 0041: versioned
`AnalysisDefinition` JSONB saved in `api.analysis_definitions` (RLS +
version-bump trigger), a narrow deterministic statistics kernel (grouped
descriptive statistics, polynomial least squares degrees 1–4 solved on
centred/scaled predictors with explicit log transforms), honest typed
execution errors, and source-revision provenance captured at save time.
Definitions reference exactly one Dataset; multi-Dataset composition waits
for demonstrated need.

## SCI-03 — Notebook Analysis Blocks — **implemented** (`feat/sci-03-notebook-analysis-blocks`)

Analysis and chart blocks embedded in Notebooks; source links; reload; frozen evidence behaviour; narrative flow from data to result to interpretation.

**Exit:** Sheet → analysis → chart → narrative works as one scientific record.

Delivered as an `analysis` notebook block referencing saved definitions by
UUID (decisions 0040/0041): live blocks execute against current rows with
honest loading/error states; freezing pins an immutable Dataset Version plus
the verbatim definition and column metadata — never a copy of the source rows
— so frozen evidence reconstructs deterministically from pinned inputs at any
scale; submission itself stamps `frozen.revisionId`, locking evidence against
unfreeze; the picker, editor, preview and route lifecycle follow the
chart-block precedents.

## SCI-04 — Advanced Scientific Visualisation

Plate maps, dose-response, assay-specific views, richer distributions and domain visualisations selected from real usage.

**Exit:** specialist visualisation extends the common framework rather than creating isolated mini-apps.

## Boundaries

- Charts reference stable fields/sources rather than copying data; frozen
  analysis pins immutable Dataset Versions rather than embedding rows.
- Analysis definitions are not only browser state.
- Do not create a second Pipeline architecture inside analysis.
- Scientific validity of specific methods requires explicit method/test scope.
