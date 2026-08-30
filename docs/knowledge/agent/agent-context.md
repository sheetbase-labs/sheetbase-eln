---
title: Sheetbase Agent Context
status: canonical
last_reviewed: 2026-08-30
---

# Sheetbase Agent Context

Load this before substantial implementation work.

## Product thesis

Sheetbase gives scientists spreadsheet immediacy while quietly providing stable identity, structure, provenance, reuse, governance, versioning and evidence.

The product centre is the scientist workspace: Notebook + Sheet + Dataset/Records + analysis. Integrations and automation extend it; they do not define it.

## Canonical concepts

- **Notebook** — scientific context/evidence container.
- **Sheet** — spreadsheet-native, compositional structured-data interaction surface.
- **Dataset** — durable rectangular data with stable rows/fields, schema binding and Dataset Versions.
- **Model / Record** — user-extensible scientific entity type / stable entity instance.
- **Sheet Definition / Sheet Instance** — reusable config / working state.
- **Notebook Template / Notebook** — reusable config / working state.
- **Dataset Version** — immutable meaningful structured-data snapshot.

## Critical invariants

1. PostgreSQL/RLS/server operations are authoritative.
2. Stable IDs, not labels/coordinates, carry durable meaning.
3. A Sheet may compose multiple Datasets and Model/Record sources plus local exploratory fields and calculations.
4. Every sourced Sheet column/value retains authoritative provenance; implicit joins by label are not canonical.
5. Spreadsheet row position is not semantic row identity.
6. Record creation from Sheets is first-class, including bulk workflows, but uses canonical Model validation, permissions and Record APIs.
7. A writable Sheet operation has exactly one authoritative write target; joined/derived/read-only values do not guess a destination.
8. Binding is not promotion. Promotion is explicit.
9. Reuse does not imply shared mutable state.
10. Existing instances do not silently upgrade when reusable definitions change.
11. Audit history is not the same as frozen evidence.
12. Do not introduce a generic Sheet Version.
13. Browser is one client; canonical scientific semantics cannot live only in UI state.
14. There is one capability system, one connector framework, one Pipeline model and one ChartSpec model.

## Pre-release rule

Sheetbase currently has **no production users and no production data**.

Therefore:

- remove superseded development-era contracts rather than preserving them;
- remove aliases/shims/dual reads/dual writes that exist only for hypothetical compatibility;
- remove compatibility-only tests for retired behaviour;
- do not preserve old storage interpretation solely because it once existed.

This does not weaken intentional Dataset Version, published Definition or submitted evidence semantics.

## Do not resurrect

- separate Table product;
- scientific-table/SCI-010 as future architecture;
- generated `sheet_*` resources as product/API authority;
- `scientific:*` external scopes;
- generic Sheet Version;
- automatic local-field promotion;
- hidden Template/Definition inheritance;
- second workflow/Pipeline model;
- vendor-specific integration architecture before generic connector semantics.

## UX bar

- dense, professional, calm;
- Attio-inspired interaction quality adapted to science;
- large primary work surface;
- spreadsheet-native keyboard/direct manipulation;
- progressive disclosure rather than giant forms/wizards;
- no oversized sparse application UI;
- provenance/errors obvious when needed, not permanently noisy.

## Scientific analysis

`ChartSpec` is canonical. Live and frozen charts share deterministic materialisation semantics. Frozen figures pin Dataset Versions. Display sampling must never silently become analysis sampling.

## Current roadmap state

Roadmap 1/Core is complete. After SCI-04, remaining active Roadmap 2 work is:

- API-04 Python SDK
- API-05 TypeScript SDK
- API-06 Webhooks
- AUTO-04 Agent-authored Operations
- AUTO-05 Agentic Scientific Workflows

GOV-02 Organisation Model remains ADR-gated/deferred. Roadmap 3 direction exists but is not yet an implementation task set.

## Required reading

Always also read:

1. [`../PRODUCT.md`](../PRODUCT.md)
2. [`../DESIGN.md`](../DESIGN.md)
3. [`../ROADMAP.md`](../ROADMAP.md)
4. [`../roadmap-2/NEXT.md`](../roadmap-2/NEXT.md) and the relevant task if doing Roadmap 2 work
5. [`../architecture/sheets.md`](../architecture/sheets.md) for Sheet/data workflow changes
6. relevant accepted ADRs under [`../decisions/`](../decisions/)
7. relevant implementation docs under `docs/` for the subsystem being changed.

This file is orientation, not permission to ignore current code or tests.
