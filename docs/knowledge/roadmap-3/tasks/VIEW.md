# VIEW — Rich Scientific Representations

**Status:** planned; not active until promoted by `docs/knowledge/NEXT.md`.

## Programme goal

Represent scientific data in richer domain-appropriate ways while retaining canonical underlying data, identity and evidence semantics.

## VIEW-01 — Representation Framework

### Goal
Define a reusable representation contract over canonical Sheet/Dataset/Record sources.

### Scope
- representation identity/configuration separate from source data;
- common source/materialisation contract;
- read-only versus editable representation boundaries;
- permissions/provenance/version behaviour;
- shared embedding in Notebook/object contexts.

### Exit
New scientific representations can be added without inventing bespoke storage/query/permission models.

## VIEW-02 — Plate & Spatial Data Views

### Goal
Mature plate-map and other bounded spatial layouts for scientific use.

### Scope
- canonical source binding and row/well identity;
- selection, annotation and linked-record context;
- scalable rendering and export;
- live/frozen behaviour where embedded in evidence.

### Exit
A plate/spatial representation works from canonical data, supports useful scientific interaction and reconstructs correctly when frozen.

## VIEW-03 — Time-Series, Distribution & Comparative Views

### Goal
Provide reusable scientific data views beyond generic tables/charts.

### Scope
- grouped time-series inspection;
- distribution/replicate comparison views;
- faceting/conditioning using explicit source fields;
- hand-off into canonical ChartSpec/analysis rather than a separate graph engine.

### Exit
Scientists can inspect common experimental structures interactively and promote relevant selections/configuration into canonical analysis/figures.

## VIEW-04 — Representation Export, Embedding & Evidence

### Goal
Make rich representations portable and evidentially coherent.

### Scope
- Notebook embedding;
- high-quality image/data export where meaningful;
- stable representation configuration;
- frozen representation reconstruction against pinned Dataset Versions;
- API/SDK-readable representation metadata where public.

### Exit
A rich view can be embedded, exported and frozen without losing its scientific source/configuration meaning.

## Boundaries

- ChartSpec remains canonical for scientific visualisation.
- Representations do not own copied source data by default.
- Display reduction/sampling must never silently alter analysis semantics.
