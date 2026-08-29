# Visualisations

Canonical SCI-04 reference for scientific graphing in Sheetbase.

Visualisation is a primary scientific interaction, not decoration. The
model is the existing `ChartSpec` (decision 0029, amended by 0041), not a
second chart product.

```text
Visualisation definition (ChartSpec)
        ↓
data source, encoding, transforms, appearance, overlays
        ↓
rendered instance
        ↓
optional frozen evidence (Dataset Version + pinned spec/series)
```

## Model

A visualisation is a versioned JSON object (`specVersion` 1) stored on:

- a Notebook `chart` block payload
- a saved Analysis Studio view (`api.analysis_views.spec`)

It references exactly one canonical Dataset by UUID and binds axes by
stable Dataset Schema Version `field_id`. Labels and units are
presentation metadata resolved from schema fields. Renaming a field does
not silently remap an existing graph.

Versioning of the spec itself is not used as a substitute for scientific
evidence. Frozen evidence pins a Dataset Version plus the configuration
needed to reproduce the figure.

## Data sources

Supported inputs:

- live Dataset (`query_dataset_rows`)
- frozen Dataset Version (`freeze_chart` snapshots via `snapshot_dataset`)
- Sheet-originated work, only through the bound Dataset (a Sheet is not a
  second store)

Local Sheet columns are not auto-promoted. The Sheet → `/analysis?dataset=`
handoff maps bound field IDs only.

Do not persist copied row blobs merely to draw a live chart. Frozen
payloads still carry derived series plus filtered rows for self-contained
visual evidence, with `datasetVersionId` on provenance.

## Plot types

| Type | Encoding |
| --- | --- |
| `scatter` | numeric x/y; optional series/colour/size |
| `line` | ordered x, connected |
| `scatter_line` / `connected_scatter` | points plus connecting lines |
| `histogram` | y only; shared bin edges |
| `box` / `violin` / `strip` | distribution of y, grouped by series |
| `bar` / `grouped_bar` / `stacked_bar` | categorical or numeric x, y height |
| `summary` | grouped mean or median with explicit interval |
| `heatmap` | x×y grid; count or aggregate of `valueField` |

Plot-type recommendation in the builder is deterministic (numeric+numeric →
scatter, category+numeric → box, y-only → histogram). The user stays in
control.

## Mappings

`fields` uses stable IDs:

- `x`, `y` — position
- `series` — traces / legend groups
- `color` — colour encoding; used as series when `series` is absent
- `size`, `shape`, `label` — optional encodings
- `group` — calculation grouping (summaries / error bars), not an implicit
  side-effect of colour
- `facet`, `facetRow`, `facetCol` — small multiples

Missing or retired field IDs surface as `missing_field`.

## Filters and transforms

Filters are part of the definition: `eq`, `ne`, `gt`/`gte`/`lt`/`lte`,
`in`, `between` (numeric or ISO date strings), `is_null`, `not_null`.

Transforms are a bounded visualisation set: `aggregate`, `normalise`,
`log10`, `ln`, `sqrt`, `abs`, `percentage`, `difference`, `ratio`. They do
not mutate the Dataset and are not a second formula engine.

## Summaries and error bars

Grouped summaries expose count, mean, median, min/max, SD and SEM. The
interval on the figure always records how it was produced:

- `source: computed` with `basis` `sd` | `sem` | `ci` | `range`
- `source: field` with `fieldId` (symmetric half-width) or
  `lowerFieldId` / `upperFieldId`

Zeros are plotted. Nulls and non-numeric strings are omitted and counted
in `droppedPoints`. Invalid log-axis values are not coerced.

## Fitting and overlays

OLS (`overlays.fit.method = ols`, degree 1–4) reuses the SCI-02 kernel.
The figure shows the equation, R² and n. Degree-1 fits may show a 95%
mean confidence band. Insufficient data is an explicit error, not a
silent empty line.

Reference overlays (`hline`, `vline`, `band`, `identity`) are visual
annotations (LLOQ, target titre, identity line). They are not hidden
validation rules.

## Axes, units, formatting

Axes support title, units from Dataset quantity metadata, min/max,
linear/log, reverse, and number-format kinds (`auto`, `decimal`,
`sigfig`, `scientific`, `percent`). Log scales reject non-positive values
explicitly.

Default axis titles can render `Titre (TU/mL)` when the field carries a
unit symbol. This layer does not invent unit conversion.

## Large data

Live reads cap at 5000 rows (`SCI_ROW_HARD_LIMIT`). Beyond that the
chart reports `dataset_too_large`. Within the cap, scatter marks may be
stride-sampled at 4000 points. Sampling is deterministic and disclosed.
OLS and grouped statistics use the full fetched set, not only displayed
marks.

## Live vs frozen

A live visualisation re-reads current Dataset rows. `freeze_chart`
snapshots a Dataset Version, stores provenance (`datasetId`,
`datasetVersionId`, schema version, row count, checksum) and derived
series. Later Dataset edits change the live graph and leave frozen
evidence unchanged. Submission stamps `frozen.revisionId`.

## Notebook and Studio

Notebook chart blocks embed the same `ChartSpec` with a table alternative.
Analysis Studio (`/analysis`) is the dense builder: source, encodings,
plot type, analysis overlays, axes, save, SVG/PNG export. Saved views are
reusable definitions; applying them to another Dataset requires explicit
field remapping, never silent name matching. Saved `analysis_views` are
owner-scoped with a version bump; they are not on the workspace
`change_events` vocabulary (same as analysis definitions).

Export writes the figure SVG (or a PNG raster of that SVG), not a
screenshot of application chrome. Presets: Notebook, Presentation,
Publication (`src/lib/visualisation-export.ts`).

A selected point can be inspected from the figure (click or arrow keys)
and shows Dataset row identity when the live query attached
`__sheetbaseRowId`.

## Provenance

A selected point can carry Dataset row identity (`__sheetbaseRowId`) when
the live query includes it. Frozen series keep mapped field IDs in
`frozen.data.columns`. Grouped summaries expose `n` and constituent
statistics.

## Known limits

- One Dataset per visualisation.
- Faceted freeze of histogram/box/heatmap remains refused (SCI-01).
- PDF figure export is not implemented; SVG is first-class, PNG is the
  raster path.
- Clipboard image copy is best-effort (`navigator.clipboard`).
- Polynomial fits above degree 4 are rejected.
- No Python/R, GIS, 3D, survival analysis, or dashboard/BI layer.
- Violin density is approximated in the browser from grouped y values;
  freeze still stores cartesian series, not a second density payload.

## Tests

Unit coverage lives in `src/lib/visualisation-pipeline.test.ts` and
`src/lib/visualisation-perf.test.ts`. Freeze/evidence is
`tests/db/sci-04-visualisation.test.ts`.
