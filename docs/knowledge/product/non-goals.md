---
title: Sheetbase Non-Goals
status: canonical
last_reviewed: 2026-08-30
---

# Sheetbase Non-Goals

These boundaries prevent roadmap drift and duplicate architecture.

## Not a generic database admin UI

Scientists should not have to manage relational schemas, SQL, storage internals or infrastructure directly. Steward surfaces expose intentional product concepts, not raw database administration.

## Not a BI/dashboard product

Scientific charts and analyses are first-class, but Sheetbase is not primarily a business-intelligence dashboard builder or semantic-metrics platform.

## Not “an ELN with a table widget”

Sheets, Datasets, Records and evidence are foundational product concepts. Structured data is not an embedded afterthought inside documents.

## Not “Excel in the browser”

Spreadsheet interaction is essential, but durable identity, provenance, typed structure, reuse and evidence distinguish Sheetbase from a file-based spreadsheet clone.

## Not forced-schema-first

Exploration is legitimate. Do not require every local column or ad-hoc calculation to become governed organisational schema before it can be useful.

## Not auto-promotion

Typing data, adding a local field or creating a calculation does not automatically create a Dataset Schema, Model field or reusable Definition.

## Not inheritance-heavy configuration

Prefer explicit composition, Templates, Definitions and parameters over hidden inheritance chains and mutable shared parent state.

## Not a second model for every surface

Do not create parallel Notebook, Sheet, Dataset, Record, permission, chart or automation models solely to make a UI screen easier to implement.

## Not integration-first

Generic interoperability matters, but integrations should not define the product roadmap. Sheetbase should mature for its own users first.

## Not automation-first

Pipelines and agents follow canonical human/domain semantics. Do not invent agent-only mutation routes, permissions or provenance shortcuts.

## Not a compatibility museum during pre-release

Sheetbase currently has no production users or production data. Superseded development-era APIs, schemas, scope vocabularies, persistence paths, aliases and shims should be removed unless an explicit current dependency requires compatibility.

Canonical evidence/versioning guarantees are different: Dataset Versions, published Definitions and submitted evidence must remain coherent because they are intentional product semantics.

## Not generic version-everything

Do not introduce a universal Sheet Version or version every mutable UI object. Version where historical scientific meaning or reusable published configuration requires it.

## Not arbitrary code execution as the default scientific UX

Roadmap 2 analysis and automation favour deterministic supported operations. General Python/R notebook execution is not a prerequisite for a strong Sheetbase scientific workspace.

## Not specialist-vendor-first integrations

Build generic connector contracts before committing the architecture to individual instrument vendors.

## Not an organisation hierarchy by assumption

GOV-02 organisation modelling requires an explicit ADR and product need. Do not casually introduce teams/org ownership/RLS semantics as a side effect of another feature.
