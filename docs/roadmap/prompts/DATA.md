# Prompt — DATA Data Interoperability

Work on the **assigned DATA stream** in `phlohouse/sheetbase-eln`. Read `docs/roadmap/NEXT.md` first.

DATA-01 is **waiting on PC-01**. Do not start import/paste framework work until the canonical Sheet interaction exists. When assigned, refine the contract against that Sheet experience.

Read `docs/roadmap/NEXT.md`, `tasks/DATA.md`, PC-00 evidence, canonical Dataset/Record/Notebook contracts and existing import/export/file/search code before implementation.

## Objective

Make scientific data easy to bring into, find within and take out of Sheetbase without bypassing canonical validation, identity or evidence semantics.

## Principles

- import is mapping + validation + preview + explicit commit, not blind file ingestion;
- Dataset/Record writes use canonical server operations;
- row-level failures map back to source rows/fields;
- exports preserve identity/version/provenance metadata where relevant;
- files are durable versioned scientific objects with checksums and safe access controls;
- search returns canonical objects and respects permissions;
- portability matters; do not trap scientific data in UI-only representations.

## Working method

Implement only the active DATA epic. Inspect existing capabilities first. Keep PostgreSQL/RLS authoritative, use bounded/streaming approaches for large transfers, add failure/retry/security tests and avoid duplicating Dataset/Record semantics inside import code.

## Do not

Do not build instrument-specific ingestion before the generic import/file contracts are sound. Do not create a second storage/version model for imported data. Do not start Pipelines.

## Completion

Meet the task exit criteria and report supported formats/workflows, validation semantics, scale evidence, security/provenance behaviour, tests and remaining gaps.
