# Sheetbase

Sheetbase is a scientific data workspace and electronic laboratory notebook. The Notebook provides scientific context; Excel-like Sheets are the primary structured-data interaction surface; PostgreSQL remains authoritative.

> **Development knowledge:** start with [`docs/knowledge/README.md`](./docs/knowledge/README.md). Product, design, ADRs, Roadmaps 1–3, historical concepts/mockups and dated competitor research are standardised there.

## Stack

- TanStack Start and React 19 for the full-stack application.
- TanStack Query for server-state fetching and caching.
- TanStack DB with query-backed collections for optimistic, live client views.
- TanStack Table for headless tables and data grids.
- Handsontable for Excel-like scientific Sheet interaction.
- HyperFormula for deterministic spreadsheet calculation.
- PostgreSQL with Drizzle ORM and migrations.
- PostgREST for the primary data API with PostgreSQL row-level security.
- Tailwind CSS 4 and shadcn/ui's source-owned component convention.
- Vitest, Testing Library, ESLint, Prettier, and strict TypeScript.

## Local development

Requirements: Node.js 22.12 or newer, pnpm 11, and Docker.

```bash
cp .env.example .env.local
pnpm services:up
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm dev
```

The app runs at `http://localhost:3000`. The PostgREST API runs at `http://localhost:3001` (admin/health on 3002). Service credentials and secrets live in `.env.local`; privileged database credentials never reach the browser.

## Commands

| Task | Command |
| --- | --- |
| Start local services | `pnpm services:up` |
| Stop local services | `pnpm services:down` |
| Inspect service status | `pnpm services:ps` |
| Follow service logs | `pnpm services:logs` |
| Recreate services | `pnpm services:recreate` |
| Start the app | `pnpm dev` |
| Build deployment artifact | `pnpm artifact:build` |
| Validate deployment plan | `pnpm deploy:plan` |
| Run tests | `pnpm test` |
| Run DB tests | `pnpm test:db` |
| Generate migration | `pnpm db:generate` |
| Apply migrations | `pnpm db:migrate` |
| Seed demo data | `pnpm db:seed:demo` |
| Fresh database | `pnpm db:fresh` |
| Format | `pnpm format` |
| Full quality gate | `pnpm validate` |

Implementation/runbook documentation remains directly under `docs/`, including migrations, testing, security, deployment, recovery, integrations, APIs and observability.

## Repository knowledge

Canonical development knowledge lives under [`docs/knowledge/`](./docs/knowledge/):

```text
docs/knowledge/
├── PRODUCT.md
├── DESIGN.md
├── ROADMAP.md
├── roadmap-1/        # complete
├── roadmap-2/        # nearly complete
├── roadmap-3/        # strategic direction
├── decisions/        # ADRs + decision context
├── product/
├── architecture/
├── design/
├── concepts/         # historical runnable concepts/prototypes
├── mockups/          # historical visual product/design artefacts
├── references/
├── history/
└── agent/
```

## Current roadmap state

- **Roadmap 1 / Core Data Workspace:** complete; see [`docs/knowledge/roadmap-1/`](./docs/knowledge/roadmap-1/).
- **Roadmap 2 / Product & Platform Consolidation:** nearly complete; see [`docs/knowledge/roadmap-2/NEXT.md`](./docs/knowledge/roadmap-2/NEXT.md).
- **Roadmap 3:** strategic direction defined; see [`docs/knowledge/roadmap-3/README.md`](./docs/knowledge/roadmap-3/README.md).

## Core mental model

The durable product primitives are:

**Model → Record → Dataset → Sheet/View → Calculation → Notebook → Pipeline**

with Field Definitions and Policies/Capabilities shared across them.

A Sheet can combine multiple Datasets and Model Records plus local and calculated columns. Every displayed value has inspectable provenance and every writable value has one authoritative write target. Sheets support linking and creating Records directly, including bulk creation from pasted rows.
