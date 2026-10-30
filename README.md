# Sheetbase

Sheetbase is a scientific data workspace and electronic laboratory notebook. The Notebook provides scientific context; Excel-like Sheets are the primary structured-data interaction surface; PostgreSQL remains authoritative.

Self-hosted: you run it on your own server and your data stays in your own PostgreSQL database.

## Where to start

| I want to...                                       | Read                                                                                                                                                        |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run Sheetbase for my lab                           | [Running Sheetbase for your lab](docs/operations/self-hosting.md)                                                                                           |
| Look up a setting                                  | [Configuration reference](docs/operations/configuration.md)                                                                                                 |
| Back up, restore or upgrade                        | [Backups and export](docs/operations/workspace-export-and-backups.md), [Recovery](docs/operations/recovery.md), [Deployment](docs/operations/deployment.md) |
| Sign people in (GitHub, company SSO, emailed link) | [Authentication](docs/operations/authentication.md)                                                                                                         |
| Choose where files live (database or S3)           | [File storage](docs/operations/file-storage.md)                                                                                                             |
| Read my data with SQL or the API                   | [Data access](docs/operations/data-access.md), [External API](docs/api/external-api.md)                                                                     |
| Develop on it                                      | The sections below and [`docs/development/`](docs/development/)                                                                                             |
| Understand the product and decisions               | [`docs/knowledge/`](docs/knowledge/README.md)                                                                                                               |

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

Requirements: [mise](https://mise.jdx.dev) and Docker. `mise install` installs the Node.js and pnpm versions the project is pinned to (`mise.toml`; `.node-version` and `packageManager` carry the same versions for other tools).

```bash
mise install
```

The grid, chart and filter components are the `@sheetbase-labs/*` packages on GitHub Packages, which need a token even to install, so give pnpm one first. Use a classic personal access token with `read:packages`:

```bash
pnpm config set "//npm.pkg.github.com/:_authToken" <token>
# or, with GITHUB_PACKAGES_TOKEN / GH_TOKEN set, or the GitHub CLI signed in
# (run `gh auth refresh -s read:packages` first):
scripts/registry-auth.sh
```

Without a token you can instead build the packages from [`sheetbase-components`](https://github.com/sheetbase-labs/sheetbase-components) and link them; see [Consuming sheetbase-components](docs/development/sheetbase-components.md).

Then:

```bash
pnpm install
cp .env.example .env.local
# set SHEETBASE_DEV_AUTH_FREE=true in .env.local (see "Sign-in" below)
pnpm services:up          # Postgres 18 and PostgREST in Docker
pnpm db:migrate
pnpm db:seed:design       # a populated example workspace ("Process Development")
pnpm dev
```

Run `pnpm install` before `pnpm services:up`: pnpm checks dependencies before every script and fails without the token.

The app runs at `http://localhost:3000`. The PostgREST API runs at `http://localhost:3001` (admin/health on 3002). Service credentials and secrets live in `.env.local`; privileged database credentials never reach the browser.

**Sign-in.** Locally there is no GitHub or company login to point at. `SHEETBASE_DEV_AUTH_FREE=true` skips sign-in and acts as the seeded owner of the example workspace. Never use it on a shared server. To try real sign-in, see [Authentication](docs/operations/authentication.md).

`pnpm services:down` stops the services; `pnpm services:purge` also deletes the local database. If `pnpm db:migrate` fails with "relation already exists", the Docker volume is from an older schema: run `pnpm services:purge`, then `pnpm services:up` and migrate again. Cloud sandboxes (Amp orbs) have their own [quick-start](docs/development/local-dev-quickstart.md).

## Commands

| Task                       | Command                  |
| -------------------------- | ------------------------ |
| Start local services       | `pnpm services:up`       |
| Stop local services        | `pnpm services:down`     |
| Inspect service status     | `pnpm services:ps`       |
| Follow service logs        | `pnpm services:logs`     |
| Recreate services          | `pnpm services:recreate` |
| Start the app              | `pnpm dev`               |
| Build deployment artifact  | `pnpm artifact:build`    |
| Validate deployment plan   | `pnpm deploy:plan`       |
| Run tests                  | `pnpm test`              |
| Run DB tests               | `pnpm test:db`           |
| Generate migration         | `pnpm db:generate`       |
| Apply migrations           | `pnpm db:migrate`        |
| Seed demo data             | `pnpm db:seed:demo`      |
| Back up the whole database | `pnpm backup:run`        |
| Restore a workspace        | `pnpm workspace:restore` |
| Move files between stores  | `pnpm storage:copy`      |
| Fresh database             | `pnpm db:fresh`          |
| Format                     | `pnpm format`            |
| Full quality gate          | `pnpm validate`          |

Runbooks and reference live under [`docs/`](docs/README.md): operations, development, APIs and subsystems.

## Repository knowledge

Canonical development knowledge lives under [`docs/knowledge/`](./docs/knowledge/):

```text
docs/knowledge/
├── PRODUCT.md
├── DESIGN.md
├── ROADMAP.md
├── roadmap-1/        # complete
├── roadmap-2/        # active scope recorded closed; GOV-02 deferred
├── roadmap-3/        # merged implementation with qualified acceptance
├── roadmap-4/        # active; reconciled remaining tasks
├── decisions/        # ADRs + decision context
├── product/
├── architecture/
├── design/
├── references/
├── history/
└── agent/
```

## Current roadmap state

Roadmaps 1 to 4 are recorded complete in [current work](docs/knowledge/NEXT.md), with the deferrals and limits listed in the [Roadmap 4 evidence register](docs/knowledge/roadmap-4/RECONCILIATION.md). Task completion is not release acceptance. Roadmap 5's interface-closure tasks are implemented ([programme map](docs/knowledge/roadmap-5/PROGRAMME_MAP.md)); the scientific-workflows work in [`proposals/`](docs/knowledge/proposals/scientific-workflows/README.md) is still a proposal.

## Core mental model

The durable product primitives are:

**Model → Record → Dataset → Sheet/View → Calculation → Notebook → Pipeline**

with Field Definitions and Policies/Capabilities shared across them.

A Sheet can combine multiple Datasets and Model Records plus local and calculated columns. Every displayed value has inspectable provenance and every writable value has one authoritative write target. Sheets support linking and creating Records directly, including bulk creation from pasted rows.
