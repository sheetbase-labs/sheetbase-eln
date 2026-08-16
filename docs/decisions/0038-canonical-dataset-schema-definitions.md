# ADR 0038 — Canonical Dataset Schema Definitions

- Status: Accepted
- Date: 2026-08-15
- Related: ADRs 0021, 0034, 0037; CORE-02; CORE-05.1 audit

## Context

Two Dataset Schema surfaces exist. CORE-02 introduced `api.dataset_schema_definitions`,
immutable Schema Versions, stable Field Definition IDs, and Dataset → Schema
Version binding. SCI-010 earlier introduced `api.dataset_schemas`,
`api.dataset_schema_fields`, generated scientific tables, `/schemas`, and
`query_dataset`. Evolving both as governed systems would split identity,
versioning and permission work.

## Decision

CORE-02 Dataset Schema Definitions and Schema Versions are the canonical
governed Dataset Schema system. SCI-010 remains a supported compatibility
surface for existing scientific-table consumers. No new governed
schema/version behaviour is added to SCI-010. Existing SCI-010 identities and
data stay resolvable during migration. Convergence is explicit and incremental;
the `/schemas` product surface should eventually consume the canonical system.
CORE-05 implements Dataset Schema governance once, on the CORE-02 path.

## Consequences

New publish, retire, evolution and promotion work targets CORE-02 RPCs and
tables. SCI-010 RPCs may keep current behaviour. Historical SCI-010 rows are
not deleted in CORE-05. A later migration must map SCI-010 identities onto
canonical Schema Versions without breaking existing Sheets or queries.
