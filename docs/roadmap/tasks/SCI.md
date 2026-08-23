# SCI — Scientific Analysis & Visualisation

**Status:** planned; begin after canonical Sheet workflows stabilise unless PC-00 finds an earlier dependency.

## Programme goal

Make visualisation and analysis first-class scientific work over Sheetbase data, with stable source identities and reproducible definitions rather than copied values.

## SCI-01 — Charting — **implemented** (`feat/sci-01-charting`)

Scatter, line, bar, box, histogram, heatmap; error bars; grouping; colour/marker mapping; faceting; log axes; annotations; missing values; legends; interactive selection; export; accessible alternatives; stable field references; reusable chart configuration.

**Exit:** users create publication/useful scientific charts directly from Sheet/Dataset semantics without copying data into another tool.

Delivered on top of decision 0029 without rewriting its contract: the three
distribution/grid types extend `ChartSpec` (`typeParams`, annotations, facet
mapping), the renderer and Analysis Studio gained faceted small multiples,
interactive selection and omitted-row surfacing, and `freeze_chart`
materialises the aggregated series server-side so frozen snapshots stay
byte-reproducible against the pure TypeScript materialiser.

## SCI-02 — Analysis Framework

Descriptive statistics; grouping/aggregation; transforms; regression; curve fitting; reusable analysis definition; immutable/versioned input support; provenance; execution errors; deterministic results where expected.

Avoid a giant statistical package in the first iteration.

**Exit:** common analysis can be defined, rerun and traced to explicit inputs.

## SCI-03 — Notebook Analysis Blocks

Analysis and chart blocks embedded in Notebooks; source links; reload; frozen evidence behaviour; narrative flow from data to result to interpretation.

**Exit:** Sheet → analysis → chart → narrative works as one scientific record.

## SCI-04 — Advanced Scientific Visualisation

Plate maps, dose-response, assay-specific views, richer distributions and domain visualisations selected from real usage.

**Exit:** specialist visualisation extends the common framework rather than creating isolated mini-apps.

## Boundaries

- Charts reference stable fields/sources rather than copying data.
- Analysis definitions are not only browser state.
- Do not create a second Pipeline architecture inside analysis.
- Scientific validity of specific methods requires explicit method/test scope.
