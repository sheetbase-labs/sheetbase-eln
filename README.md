# Sheetbase

Sheetbase is a scientific data workspace and electronic laboratory notebook. The notebook provides scientific context; Excel-like Sheets are the primary structured-data interaction surface; PostgreSQL remains authoritative.

> **Current development programme:** Core Data Workspace. Before substantial domain or product work, read [`docs/core/README.md`](./docs/core/README.md). It links the canonical core product model, target architecture, migration map, epics and agent continuation guidance.

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

TanStack DB makes queries reactive when their collections change; PostgreSQL changes do not reach the browser by themselves. The initial collection adapter can use TanStack Query and API invalidation, while a push or sync transport should be selected when real-time collaboration requirements are implemented.

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

| Task                                          | Command                  |
| --------------------------------------------- | ------------------------ |
| Start local services (PostgreSQL + PostgREST) | `pnpm services:up`       |
| Stop local services                           | `pnpm services:down`     |
| Inspect service status                        | `pnpm services:ps`       |
| Follow service logs                           | `pnpm services:logs`     |
| Recreate services from scratch                | `pnpm services:recreate` |
| Start the app (dev)                           | `pnpm dev`               |
| Build an immutable deployment artifact        | `pnpm artifact:build`    |
| Validate and print a deployment plan          | `pnpm deploy:plan`       |
| Run all tests                                 | `pnpm test`              |
| Run database integration tests                | `pnpm test:db`           |
| Generate a migration after schema edits       | `pnpm db:generate`       |
| Apply migrations                              | `pnpm db:migrate`        |
| Seed minimal fixtures                         | `pnpm db:seed`           |
| Seed fixtures + demonstration data            | `pnpm db:seed:demo`      |
| Reset the local database (guarded)            | `pnpm db:reset`          |
| Fresh database: reset + migrate + seed        | `pnpm db:fresh`          |
| Format code                                   | `pnpm format`            |
| Full quality gate                             | `pnpm validate`          |

See `docs/migrations.md` before changing schema, `docs/testing.md` for test layers, `docs/seeds.md` for fixtures/seeds, `docs/handsontable.md` for the Handsontable integration boundary, `docs/security-headers.md` for the PLAT-03 header slice and `docs/deployment.md` for environment/deployment guidance.

## Repository boundaries

- `src/` is the production application — the only code that ships.
- `Concepts/sheetbase-ui-system-v2/` is the current UI-system study. It is reference material: read it, port reviewed pieces from it, never import or depend on it from `src/`.
- `Mockups/` contains approved product mockups and the product specification PDF. Reference only.
- `docs/core/` defines the current core product/architecture programme and is the first stop for architectural/domain work.
- `docs/references/` contains dated research/reference material. It explains influences and alternatives but is not normative.
- `docs/references/eln-competitors/` captures the 13 August 2026 review of Benchling, Dotmatics, Signals Notebook, SciNote, Labguru and Sapio plus cross-product patterns.
- `docs/archive/` identifies superseded planning material and where its immutable Git history can be recovered. Archived plans are not implementation guidance.
- `docs/decisions/` contains durable ADRs.
- `PRODUCT.md` and `DESIGN.md` describe broader product and design intent.
- `docs/dev-environment.md` describes the disposable auth-free development surface at `dev.sheetbase.co.uk`.
- `ROADMAP.md` gives the active high-level epics. The pre-Core root `TODO.md` has been removed from the active tree so agents cannot mistake obsolete unchecked tickets for current requirements.

Product components should be added through shadcn's source-owned pattern and then reconciled with the concept system. Naming rules for database objects, REST resources, domain identifiers and event types — plus when to use TanStack Table vs Handsontable — are in `docs/conventions.md`.

## Current core mental model

The durable product primitives are:

**Model → Record → Dataset → Sheet/View → Calculation → Notebook → Pipeline**

with Field Definitions and Policies/Capabilities shared across them.

A Sheet can combine multiple Datasets and Model Records plus local and calculated columns. Every displayed value has inspectable provenance and every writable value has one authoritative write target. Sheets must support linking and creating Records directly, including bulk creation from pasted rows.
