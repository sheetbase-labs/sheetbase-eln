# Sheetbase

Sheetbase is a document-first electronic laboratory notebook for scientific work. This repository currently contains the product foundation and the source material that will guide the application UI.

## Stack

- TanStack Start and React 19 for the full-stack application.
- TanStack Query for server-state fetching and caching.
- TanStack DB with query-backed collections for optimistic, live client views.
- TanStack Table for headless tables and data grids.
- PostgreSQL with Drizzle ORM and migrations.
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

The app runs at `http://localhost:3000`. The PostgREST API runs at
`http://localhost:3001` (admin/health on 3002). Service credentials and
secrets live in `.env.local`; privileged database credentials never reach the
browser.

## Commands

Everything a new developer needs, without reading source:

| Task                                                 | Command                  |
| ---------------------------------------------------- | ------------------------ |
| Start local services (PostgreSQL + PostgREST)        | `pnpm services:up`       |
| Stop local services                                  | `pnpm services:down`     |
| Inspect service status                               | `pnpm services:ps`       |
| Follow service logs                                  | `pnpm services:logs`     |
| Recreate services from scratch                       | `pnpm services:recreate` |
| Start the app (dev)                                  | `pnpm dev`               |
| Build an immutable deployment artifact               | `pnpm artifact:build`    |
| Validate and print a deployment plan                 | `pnpm deploy:plan`       |
| Run all tests                                        | `pnpm test`              |
| Run database integration tests                       | `pnpm test:db`           |
| Generate a migration after schema edits              | `pnpm db:generate`       |
| Apply migrations                                     | `pnpm db:migrate`        |
| Seed minimal fixtures                                | `pnpm db:seed`           |
| Seed fixtures + demonstration data                   | `pnpm db:seed:demo`      |
| Reset the local database (guarded)                   | `pnpm db:reset`          |
| Fresh database: reset + migrate + seed               | `pnpm db:fresh`          |
| Format code                                          | `pnpm format`            |
| Full quality gate (check, lint, types, tests, build) | `pnpm validate`          |

See `docs/migrations.md` before changing schema, including how to verify
against a fresh database. See `docs/testing.md` for the test layers and
`docs/seeds.md` for fixture and seed conventions. Handsontable's required
commercial licence setup and client-only integration boundary are documented
in `docs/handsontable.md`. Environment separation, immutable artifacts,
managed-secret injection, promotion and rollback are documented in
`docs/deployment.md`.

## Repository boundaries

- `src/` is the production application — the only code that ships.
- `Concepts/sheetbase-ui-system-v2/` is the current UI-system study. It is
  reference material: read it, port reviewed pieces from it, never import or
  depend on it from `src/`.
- `Mockups/` contains the approved product mockups and the product
  specification PDF. Reference only.
- `docs/` holds working conventions (`conventions.md`, `migrations.md`,
  `testing.md`, `seeds.md`, `database-access.md`, `authentication.md`) and
  durable architectural decision records (`docs/decisions/`).
- `PRODUCT.md` and `DESIGN.md` describe product and design intent;
- `docs/dev-environment.md` describes the disposable auth-free development
  surface at `dev.sheetbase.co.uk`;
- `ROADMAP.md` and `TODO.md` govern what gets built and in what order.

Product components should be added through shadcn's source-owned pattern and
then reconciled with the concept system. Copying the concept catalogue
wholesale would preserve decisions that are still under review. Naming rules
for database objects, REST resources, domain identifiers and event types —
plus when to use TanStack Table vs Handsontable — are in
`docs/conventions.md`.
