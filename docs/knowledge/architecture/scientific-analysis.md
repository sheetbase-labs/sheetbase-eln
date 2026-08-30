---
title: Scientific Analysis and Visualisation
status: canonical
last_reviewed: 2026-08-30
related:
  - docs/visualisations.md
  - docs/chart-api.md
---

# Scientific Analysis and Visualisation

SCI-04 completed the Roadmap 2 scientific visualisation maturity work. The canonical visualisation model is `ChartSpec`; Notebook chart blocks, Analysis Studio, freeze and export share it.

## Product role

Scientific visualisation is a core Sheetbase workflow, not decoration and not a BI dashboard subsystem.

The intended flow is:

```text
Sheet / Dataset
   ↓
explore / filter / transform
   ↓
visualise / summarise / fit
   ↓
inspect provenance
   ↓
Notebook
   ↓
freeze as evidence when required
```

## Canonical data source

Charts consume canonical Dataset data, including Sheet hand-off through Dataset binding. Saved mappings use stable field IDs rather than labels.

Frozen charts pin a Dataset Version. Frozen rendering rematerialises from version data through the same deterministic materialisation pipeline as live rendering.

## Supported scientific depth

The mature Roadmap 2 surface includes:

- scatter, line and connected/scatter-line variants;
- bar/grouped/stacked summaries;
- histogram, box, violin and strip distributions;
- summary plots and heatmaps;
- multi-series/grouping and faceting;
- local filters;
- bounded visualisation transforms;
- SD/SEM/CI and explicit error-bar semantics;
- OLS fits, equation/R²/n and supported confidence overlays;
- reference lines/bands/identity overlays;
- linear/log axes and scientific formatting;
- point inspection/provenance;
- SVG/PNG figure export;
- Notebook embedding and frozen evidence.

## Scientific transparency

Computed statistics and fits should expose method, n and relevant results. Sampling is for display only; scientific calculations use the full supported analysis population.

Invalid transformations are surfaced rather than silently coerced.

## Scale

The current client analysis envelope is bounded (`SCI_ANALYSIS_ROW_LIMIT`, currently 10,000 rows). Display marks use a chart-wide deterministic point budget (`SCI_RENDER_POINT_CAP`, currently 4,000) after analysis.

Larger datasets should fail honestly with guidance to filter/aggregate rather than silently analyse a truncated population.

These values are implementation limits, not eternal product semantics; changes should be measured and tested.

## Evidence invariant

Live/frozen equivalence is tested across transformations, summaries/error bars, violin/KDE, OLS and heatmap aggregation. Later live Dataset edits must not change a frozen figure's scientific result.

## Analysis Studio vs canonical artefact

Analysis Studio saved views are working/draft UI configuration. Notebook chart blocks are the auditable scientific artefact boundary.

Do not turn disposable view state into a second canonical chart/evidence model without a deliberate decision.

## Future scientific depth

Further scientific methods can be added when real workflows justify them, but should extend the existing ChartSpec/materialisation architecture rather than introduce specialist parallel chart systems.
