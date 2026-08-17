# Sheetbase Roadmap — Agent Prompts

This folder contains reusable starting prompts for the post-Core roadmap programmes.

## How to use

1. Start with [`../NEXT.md`](../NEXT.md).
2. Use the prompt matching the active programme/task.
3. The prompt does not replace the task file. `tasks/*.md`, accepted ADRs and current repository state remain authoritative.
4. Prompts deliberately tell agents to audit current implementation before making assumptions.
5. When an epic has been refined by PC-00 or later evidence, update the relevant task file and prompt together.

## Prompts

| Prompt | Programme |
| --- | --- |
| [`PC-00.md`](./PC-00.md) | Product & Platform Consolidation Audit |
| [`PC.md`](./PC.md) | Product Consolidation |
| [`API.md`](./API.md) | API & Developer Platform |
| [`DATA.md`](./DATA.md) | Data Interoperability |
| [`GOV.md`](./GOV.md) | Identity, Administration & Governance |
| [`COLLAB.md`](./COLLAB.md) | Collaboration |
| [`SCI.md`](./SCI.md) | Scientific Analysis & Visualisation |
| [`INT.md`](./INT.md) | Integrations |
| [`PLAT.md`](./PLAT.md) | Platform, Operations & Security |
| [`AUTO.md`](./AUTO.md) | Automation |

## Shared operating rules

- Work from a dedicated branch off current `main` unless the active hand-off explicitly says otherwise.
- Verify repository, branch, HEAD and task authority before editing.
- Preserve completed Core architecture unless concrete evidence exposes a defect.
- Keep PostgreSQL/RLS/server validation authoritative.
- Use stable semantic IDs rather than labels/positions for durable relationships.
- Implement migrations, production code, tests and documentation together.
- Use focused validation during development and the task-defined full gate at completion.
- Do not introduce Cursor/agent/vendor attribution into commits, source, docs or PR metadata.
- Use the repository's configured human/project Git identity.
- Implement only the active task identified by `NEXT.md`; do not jump ahead to another stream merely because its prompt exists.
