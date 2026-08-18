# Sheetbase Roadmap — Agent Prompts

This folder contains reusable starting prompts for the post-Core roadmap programmes.

## How to use

1. Start with [`../NEXT.md`](../NEXT.md).
2. Use the prompt matching the **assigned** stream in `NEXT.md`. Ready does not mean implement every Ready stream.
3. The prompt does not replace the task file. `tasks/*.md`, accepted ADRs, accepted PC-00 decisions and current repository state remain authoritative.
4. Prompts deliberately tell agents to audit current implementation before making assumptions.
5. When an epic has been refined by PC-00 or later evidence, update the relevant task file and prompt together.

## Prompts

| Prompt | Programme |
| --- | --- |
| [`PC-00.md`](./PC-00.md) | Product & Platform Consolidation Audit (complete) |
| [`PC.md`](./PC.md) | Product Consolidation (PC-01 and PC-02 complete) |
| [`API.md`](./API.md) | API & Developer Platform (Ready candidate: API-02, low) |
| [`DATA.md`](./DATA.md) | Data Interoperability (Ready candidate: DATA-01, medium) |
| [`GOV.md`](./GOV.md) | Identity, Administration & Governance (GOV-01 complete) |
| [`COLLAB.md`](./COLLAB.md) | Collaboration |
| [`SCI.md`](./SCI.md) | Scientific Analysis & Visualisation |
| [`INT.md`](./INT.md) | Integrations |
| [`PLAT.md`](./PLAT.md) | Platform, Operations & Security (headers slice complete) |
| [`AUTO.md`](./AUTO.md) | Automation |

## Shared operating rules

- Work from a dedicated branch off current `main` unless the active hand-off explicitly says otherwise.
- Verify repository, branch, HEAD and task authority before editing.
- Preserve completed Core architecture unless concrete evidence exposes a defect.
- Keep PostgreSQL/RLS/server validation authoritative.
- Use stable semantic IDs rather than labels/positions for durable relationships.
- Implement migrations, production code, tests and documentation together.
- Use focused validation during development and the task-defined full gate at completion.
- Do not introduce Cursor/agent/vendor attribution into commits or source/docs comments. Cursor-generated PR footers are acceptable.
- Use the repository's configured human/project Git identity.
- Implement only the **assigned** stream/task in `NEXT.md`. Do not assume ownership of every Ready row.

## Pre-release compatibility rule

Sheetbase currently has **no production users and no production data**. For all unfinished roadmap work, backwards compatibility is **not** a default requirement.

When implementation supersedes a development-era contract, API, scope, persistence path, schema stack, UI surface or data shape:

- remove the obsolete path rather than maintaining it as deprecated compatibility;
- remove compatibility aliases, fallback behaviour, conversion shims and tests that exist only for hypothetical users/data;
- update development fixtures/seeds to the canonical model rather than preserving old formats;
- prefer one canonical implementation over dual-read, dual-write or legacy branches;
- do not preserve old data interpretation for hypothetical historical data that does not exist.

Only retain compatibility when the active task or an explicit product/architecture decision identifies a concrete current dependency that requires it. If uncertain, flag the dependency; do not invent compatibility pre-emptively.

This rule does not weaken canonical versioning/evidence invariants. New Dataset Versions, published Definitions and submitted evidence must remain internally interpretable as the product evolves.
