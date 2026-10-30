# Implementation documentation

Current documentation for the running Sheetbase implementation is grouped by
purpose:

- [`api/`](api/) — public, notebook, scientific, export, and generated OpenAPI
  contracts.
- [`development/`](development/) — local setup, conventions, database access,
  migrations, fixtures, testing, and component integration guidance.
- [`operations/`](operations/) — running Sheetbase: start with
  [Running Sheetbase for your lab](operations/self-hosting.md) and the
  [configuration reference](operations/configuration.md), then authentication,
  deployment, file storage, backups, recovery, observability and security.
- [`subsystems/`](subsystems/) — administration, automation, collaboration,
  files, governance, integrations, performance, pipelines, and visualisation.
- [`knowledge/`](knowledge/) — canonical product, design, roadmap, architecture,
  decisions, and historical context.

The generated external API specification is
[`api/openapi/external-api-v0.json`](api/openapi/external-api-v0.json).

The first UI/UX and QA assessment uses the
[`notebook design and QA pilot`](development/notebook-design-qa.md), which defines
the workflow brief, acceptance matrix and performance measurement protocol.

## Where things live

- `docs/knowledge/roadmap-4/` and `roadmap-5/` are the active roadmap corpora; finished roadmaps 1 to 3 are in `docs/knowledge/history/archive/`.
- `docs/knowledge/proposals/` holds proposals that are not yet activated.
- `docs/knowledge/history/qa-2026-10/` holds the October 2026 QA reports.
- Loose build logs, patches and archives at the repo root are gitignored; do not commit them.
