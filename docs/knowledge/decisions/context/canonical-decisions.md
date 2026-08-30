---
title: Canonical Sheetbase Decisions
status: canonical
last_reviewed: 2026-08-30
---

# Canonical Sheetbase Decisions

This file summarises settled cross-cutting decisions. Accepted ADRs remain the detailed authority where they cover the same topic.

## Product model

### Notebook is the scientific context/evidence container

It composes narrative, structured data, files, analyses and review/evidence state.

### Sheet is the primary structured-data interaction surface

One Sheet product supports exploratory and governed/composed states. Do not create separate “table” and “sheet” products.

### Dataset is durable rectangular data

Datasets are presentation-independent, typed, revisioned and can produce immutable Dataset Versions.

### Model/Record provides scientific entity identity

Models are user-extensible; Records use stable identity distinct from display labels/human identifiers.

## Reuse

### Definition and instance are separate

Sheet Definition ≠ Sheet Instance. Notebook Template ≠ Notebook.

Reusable configuration can be versioned; working instances do not silently change when reusable definitions change.

### Reuse does not mean shared mutable state

Instantiation creates independent working state unless an explicit live-reference concept says otherwise.

## Local/governed semantics

### Exploratory and governed data coexist

A Sheet may combine Dataset fields, Record references, local exploratory fields and calculations.

### Binding and promotion are different

Binding attaches existing durable structure/data. Promotion explicitly converts useful local structure into governed/reusable structure.

### Promotion does not rewrite history

Historical local fields remain historically local; promotion does not pretend they were always governed.

## Write-back and identity

### Fail closed on ambiguous joins/write-back

One write-back target per operation. Record write-back uses UUID identity. Labels/coordinates are not semantic keys.

## Versioning/evidence

### Dataset Version is the immutable structured-data primitive

Use Dataset Versions to preserve meaningful tabular state. Do not create a generic Sheet Version.

### Published reusable configuration is immutable/versioned where meaning requires it

Existing consumers do not silently upgrade.

### Audit history is not frozen evidence

Audit explains change; evidence pins/reconstructs scientific meaning.

### Linked Records remain live context unless explicitly pinned

Do not freeze every relationship by default.

## Calculation

### Use the canonical formula/calculation architecture

Do not create per-feature calculation engines. Visualisation transforms are bounded chart operations, not a replacement Sheet formula system.

## Security/governance

### PostgreSQL/RLS is authoritative

Client gating is not a security boundary.

### Capabilities are canonical and role-mapped

Do not create feature-local permission systems.

### Steward can govern configuration without blanket workspace administration

Configuration authority and workspace administration are intentionally distinct.

### Viewer is read-only

Viewer semantics apply consistently across the product.

## API/platform

### Browser is one client

Canonical domain operations must be suitable for APIs/SDKs/integrations/automation, not hidden only in UI state.

### External credential scope vocabulary is fail-closed

Do not revive retired `scientific:*` scopes.

### Human attestation is intentionally constrained

Submit/sign/amend remain human-session operations under the current model.

## Integrations

### Generic connector framework precedes specialist integrations

Vendor/instrument connectors plug into one connector/run/mapping/commit model.

## Automation

### There is one Pipeline model

AUTO-01/02/03 established the canonical deterministic Pipeline definition/version/run/schedule/output model. Extend it; do not build a second automation substrate.

### Agents use the same platform semantics

Future agent-authored operations must respect canonical permissions, provenance, evidence and APIs.

## Scientific analysis

### ChartSpec is canonical

Analysis Studio, Notebook chart blocks, rendering, freeze and export use the same model.

### Frozen visualisations pin Dataset Versions and share live materialisation semantics

Do not duplicate scientific calculation logic in an independent freeze implementation.

## Pre-release compatibility

### There is no general backwards-compatibility obligation today

Sheetbase has no production users and no production data. Remove superseded development-era contracts, APIs, schemas, persistence paths, aliases, shims and compatibility-only tests unless an explicit current dependency requires them.

This does not weaken intentional version/evidence guarantees built into the canonical product.
