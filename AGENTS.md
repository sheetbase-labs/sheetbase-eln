# Sheetbase ELN

Electronic lab notebook for biopharma R&D. Full-stack TypeScript app with
PostgreSQL, PostgREST, and a TanStack Start SSR frontend.

## Development knowledge

Before substantial product, domain or roadmap work, read [`docs/knowledge/README.md`](docs/knowledge/README.md). Canonical product/design/roadmap knowledge and ADRs now live under `docs/knowledge/`:

- `docs/knowledge/PRODUCT.md`
- `docs/knowledge/DESIGN.md`
- `docs/knowledge/ROADMAP.md`
- `docs/knowledge/roadmap-1/` — completed Roadmap 1 / Core Data Workspace
- `docs/knowledge/roadmap-2/` — active Roadmap 2
- `docs/knowledge/roadmap-3/` — Roadmap 3 direction
- `docs/knowledge/decisions/` — ADRs and decision context
- `docs/knowledge/concepts/` — historical runnable concepts/prototypes
- `docs/knowledge/mockups/` — historical visual design/product artefacts

For **reviewing a PR, proposing work, or implementing a roadmap/product change**, follow [`docs/knowledge/agent/workflows.md`](docs/knowledge/agent/workflows.md). Do not substitute PR summaries or historical planning for inspection of the current code and canonical contracts.

When qmd is installed, use the committed [`.qmd/index.yml`](.qmd/index.yml) and [`docs/knowledge/agent/qmd.md`](docs/knowledge/agent/qmd.md) to search the knowledge base before consequential work. Search results are discovery only: open the relevant roadmap task, ADR and canonical documents in full before making architectural or merge judgements.

Implementation/runbook documentation remains directly under `docs/`.

## Build & run

| Command                          | Purpose                                                 |
| -------------------------------- | ------------------------------------------------------- |
| `pnpm install --frozen-lockfile` | Install deps (Node ≥22.12, pnpm 11.9.0)                 |
| `pnpm generate-routes`           | Generate TanStack Router route tree                     |
| `pnpm dev`                       | Vite dev server on port 3000                            |
| `pnpm build`                     | Production build → `dist/client/` + `dist/server/`      |
| `pnpm start`                     | Production server (`scripts/start-prod.mjs`) on `$PORT` |
| `pnpm typecheck`                 | TypeScript check (no emit)                              |
| `pnpm lint`                      | ESLint                                                  |
| `pnpm test`                      | Vitest (unit + integration)                             |
| `pnpm test:db`                   | Database integration tests                              |
| `pnpm test:api`                  | API tests                                               |
| `pnpm test:browser`              | Playwright E2E                                          |
| `pnpm validate`                  | Full: check + lint + typecheck + test + build           |

## Database

| Command              | Purpose                                          |
| -------------------- | ------------------------------------------------ |
| `pnpm db:migrate`    | Apply Drizzle migrations                         |
| `pnpm db:generate`   | Generate new migration from schema changes       |
| `pnpm db:seed:demo`  | Seed demo data                                   |
| `pnpm db:seed:month` | Seed month-scale data                            |
| `pnpm db:reset`      | Reset the database (guarded; local dev DBs only) |
| `pnpm db:fresh`      | Reset + migrate + seed                           |

Migrations are in `drizzle/` (148 files, 0000–0149). Schema source:
`src/db/schema.ts`. Migration config: `drizzle.config.ts`. The migration
connection uses `MIGRATION_DATABASE_URL` (dedicated `migrator` role), not the
app `DATABASE_URL`.

## Services (Docker Compose)

- **PostgreSQL 18** — `compose.yaml` for dev, `compose.deploy.yaml` for prod.
- **PostgREST v14.5** — REST API layer over the `api` schema. Custom image
  in `docker/postgrest/`.
- **App** — Node.js SSR server. In dev: `pnpm dev` or `pnpm start`. In prod:
  Docker container via `compose.deploy.yaml`.

Dev: `pnpm services:up` (starts postgres + postgrest).
Prod: `compose.deploy.yaml` (postgres + postgrest + app + migrate).

## Environment

Copy `.env.example` to `.env.local` and fill in values. Production uses
`/opt/sheetbase/.env.production` on the VPS (never committed). Key variables:

- `DATABASE_URL` — app DB connection (dev: localhost, prod: Docker service name `postgres`)
- `MIGRATION_DATABASE_URL` — drizzle-kit DDL (dedicated `migrator` role)
- `FORMULA_DATABASE_URL` — formula writer (dedicated `formula_runtime` role)
- `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` — session auth
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` — OAuth
- `PGRST_JWT_SECRET` — PostgREST JWT signing
- `POSTGREST_URL`, `POSTGREST_ADMIN_URL` — server-only upstream
- `SHEETBASE_ENV`, `SHEETBASE_SECRET_SOURCE` — deployment identity
- `VITE_HANDSONTABLE_LICENSE_KEY` — Handsontable license

See `.env.example` for all variables and documentation.

## Deployment

**Architecture:** Private Hostinger VPS → Cloudflare Tunnel → Docker Compose.

- **VPS:** Private, accessed via Tailscale only. No open inbound ports.
- **Public traffic:** Cloudflare Tunnel routes `app.sheetbase.co.uk` →
  `http://localhost:3000` on the VPS.
- **CI/CD:** GitHub Actions (`.github/workflows/deploy.yml`) is **paused**
  (PLAT-03): the trigger block is commented out. The canonical release path
  is `pnpm release:local` (`scripts/release.sh`) run on the VPS. See
  `docs/deployment.md`.
- **Release gate:** the workflow and `scripts/release.sh` run the same gate:
  typecheck, lint, tests, build, and a production dependency audit.
- **Deploy controller:** `scripts/deploy.ts` validates `@sha256` image
  references, runs migrations as a one-shot, starts the app, and polls the
  readiness endpoint. See `docs/deployment.md` for the full contract.
- **VPS runbook:** `docs/vps-deployment.md` covers VPS setup, secrets, and
  operations.

### Deploy workflow

Canonical path today — run on the VPS:

1. Fetch the release commit on the VPS checkout (`/opt/sheetbase`).
2. `pnpm release:local` — release gate (typecheck, lint, unit tests,
   production dependency audit, database tests against a disposable
   PostgreSQL container), local image build with `@sha256` digest pinning,
   then `deploy:plan` and `deploy:apply`.
3. `pnpm deploy:plan` validates image/migration compatibility.
4. `pnpm deploy:apply` — migrate (one-shot) → start app → readiness check
   against `/api/health/ready`.
5. Cloudflare Tunnel stays up — only the app container restarts.

When the GitHub Actions trigger is re-enabled: push to `main` → `verify`
gate job → `build` pushes images to GHCR → Action joins Tailscale, SSHes
to the VPS, loads `/opt/sheetbase/.env.production` (never committed), and
runs the same `deploy:plan` / `deploy:apply` steps.

### Required GitHub Secrets

| Secret                    | Purpose                              |
| ------------------------- | ------------------------------------ |
| `VPS_SSH_PRIVATE_KEY`     | SSH key for the VPS deploy user      |
| `VPS_TAILSCALE_IP`        | Tailscale IP of the VPS              |
| `TAILSCALE_AUTH_KEY`      | Tailscale auth key for CI nodes      |
| `DEV_VPS_SSH_PRIVATE_KEY` | SSH key for the dev-surface VPS user |
| `DEV_VPS_TAILSCALE_IP`    | Tailscale IP for the dev deploy      |
| `DEV_TAILSCALE_AUTH_KEY`  | Tailscale auth key for dev CI nodes  |

### Rollback

Set `SHEETBASE_APP_IMAGE` to a previous `@sha256` digest and run `pnpm deploy:apply`. Restore DB from backup if a migration is incompatible.

## Environments and automated delivery

The Hostinger VPS is the shared delivery target. It has two separate Docker surfaces; do not combine their Compose projects, databases, volumes, or environment files.

| Surface     | Public URL                    | Purpose                                | How it deploys                                                                   |
| ----------- | ----------------------------- | -------------------------------------- | -------------------------------------------------------------------------------- |
| Production  | `https://app.sheetbase.co.uk` | Real authenticated app                 | `pnpm release:local` on the VPS (workflow trigger paused, PLAT-03)               |
| Development | `https://dev.sheetbase.co.uk` | Disposable, auth-free demo environment | Manual dispatch of `.github/workflows/deploy-dev.yml` — trigger currently paused |

### Development environment

- The development app is a non-production demo surface. It uses `SHEETBASE_ENV=development` and `SHEETBASE_DEV_AUTH_FREE=true` to create an explicit auth-free fixture session. Never enable either setting in production.
- Its VPS checkout is `/opt/sheetbase-dev`, its secret file is `/opt/sheetbase-dev/.env.development`, and it runs `compose.dev.yaml` on loopback port `3100`.
- To deploy, use **Actions → Deploy development environment** and the deliberate confirmation flow. The trigger block in `deploy-dev.yml` is commented out (PLAT-03 pause); re-enable it first. Unlike production, this workflow builds images on a GitHub runner and pushes them to GHCR.
- Cloudflare Tunnel maps `dev.sheetbase.co.uk` to `127.0.0.1:3100`.

### Agent / AMP delivery workflow

1. Work in a normal branch and open or update a PR. AMP only needs GitHub access; it must not receive VPS, Tailscale, Cloudflare, OAuth, or secret values.
2. Review the PR locally or in an orb. Use the shared development environment only when a deployed demo is wanted.
3. Merge an approved PR to `main`. Deployment does not run automatically today; release with `pnpm release:local` on the VPS (see Deploy workflow above).
4. Use the development workflow only for an intentional shared demo update.

**Required rules:** keep image references digest-pinned; keep development and production data isolated; never put `.env` values in GitHub issues, PR comments, logs, code, or agent messages; validate `/api/health/ready` after deployment changes.

## Orb / local development

For Amp orb-specific setup (system PostgreSQL, no Docker), see `docs/orb-setup.md` and `.agents/setup`. The orb uses the system PostgreSQL cluster, not Docker Compose. PostgREST runs as a downloaded binary.

## Project conventions

- **TypeScript paths:** `#/` maps to `src/`.
- **Routing:** TanStack Router with committed generated route tree; run `pnpm generate-routes` after route-file changes.
- **API boundary:** browser data goes through the same-origin `/api/db/*` proxy, never directly to PostgREST.
- **Auth:** Better Auth with GitHub OAuth and database-backed sessions.
- **Testing:** Vitest for unit/integration, Playwright for E2E, real PostgreSQL for DB tests.
- **Migrations:** use `pnpm db:generate`; do not hand-edit generated SQL.
- **Deployment:** image references are digest-pinned.
