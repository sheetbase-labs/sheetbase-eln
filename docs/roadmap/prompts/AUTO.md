# Prompt — AUTO Automation

> **DEFERRED. Do not use this prompt unless `docs/roadmap/NEXT.md` explicitly activates AUTO work.**

Work on the active **AUTO — Automation** epic in `phlohouse/sheetbase-eln` only after the roadmap's automation readiness gate has been satisfied.

## Prerequisites

Before editing, prove from current roadmap evidence that:

- canonical human Sheet/Notebook workflows are mature;
- public API/domain operations are stable;
- immutable Dataset Versions are practical inputs;
- credentials/service identities exist;
- import/export/files and provenance are mature enough;
- operational observability/retry controls exist;
- governance/capability boundaries are established.

If those are not true, stop and report the unmet prerequisites.

## Objective

Build deterministic automation first, then agent-assisted operations later, using the same canonical domain contracts as humans and external clients.

## Principles

- Pipeline Definitions and Runs have stable/versioned identity;
- consequential inputs are immutable or explicitly version-pinned;
- outputs are canonical Datasets/Versions/Records/files, not Pipeline-only storage;
- runs preserve code/config/input/output/environment provenance;
- retries/idempotency/concurrency are explicit;
- Python/SQL execution is sandboxed and governed;
- agents propose/execute ordinary authorised operations and never bypass permissions/validation/provenance;
- approval gates are available for consequential agent-authored changes.

## Do not

Do not start with a visual DAG builder. Do not create an AI-specific data model, permission model or evidence model. Do not let agents mutate PostgreSQL directly outside normal domain operations.

## Completion

Meet the active AUTO task exit criteria and report reproducibility, execution isolation, provenance, retry semantics, permissions, approval behaviour, tests and remaining risks.
