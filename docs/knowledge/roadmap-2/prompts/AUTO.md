# Prompt — AUTO Automation

Work on the active **AUTO — Automation** epic in `phlohouse/sheetbase-eln`.

## Authority

Branch from current `main` unless `docs/roadmap/NEXT.md` specifies another base. Read `NEXT.md`, `tasks/AUTO.md`, relevant earlier roadmap evidence and the canonical Dataset/API/governance/operations contracts used by the active epic before editing.

## Objective

Build deterministic Pipeline capabilities and later agent-assisted operations using the same canonical Sheetbase domain contracts as humans and external clients.

## Principles

- Pipeline Definitions and Runs have stable/versioned identity;
- inputs and outputs are explicit and use canonical Dataset/Version/Record/file contracts;
- consequential inputs are immutable or explicitly version-pinned where reproducibility requires it;
- runs preserve code/config/input/output/environment provenance;
- retries/idempotency/concurrency are explicit;
- Python/SQL execution is sandboxed and governed;
- schedules and event triggers use normal platform event/service-identity contracts;
- agents propose/execute ordinary authorised operations and never bypass permissions, validation or provenance;
- approval gates are available for consequential agent-authored changes.

## Working method

Implement only the active AUTO epic. Inspect current API, Dataset Version, event, service identity, execution and observability capabilities before editing. Reuse them rather than creating Pipeline-specific substitutes. Add reproducibility, retry, isolation, permission and provenance tests appropriate to the active task.

## Do not

Do not create an AI-specific data, permission or evidence model. Do not let Pipelines or agents mutate PostgreSQL outside normal governed domain operations. Do not assume a visual DAG builder is required unless product evidence supports it.

## Completion

Meet the active AUTO task exit criteria and report user/platform outcome, execution/reproducibility semantics, provenance, retry/concurrency behaviour, permissions, tests and remaining risks.
