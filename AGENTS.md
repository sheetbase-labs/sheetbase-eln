# Sheetbase ELN

Electronic lab notebook for biopharma R&D. Full-stack TypeScript app with
PostgreSQL, PostgREST, and a TanStack Start SSR frontend.

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

| Command              | Purpose                                    |
| -------------------- | ------------------------------------------ |
| `pnpm db:migrate`    | Apply Drizzle migrations                   |
| `pnpm db:generate`   | Generate new migration from schema changes |
| `pnpm db:seed:demo`  | Seed demo data                             |
| `pnpm db:seed:month` | Seed month-scale data                      |
| `pnpm db:fresh`      | Reset + migrate + seed                     |

Migrations are in `drizzle/` (55 files, 0000–0054). Schema source:
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
- **CI/CD:** GitHub Actions (`.github/workflows/deploy.yml`) on push to `main`:
  build immutable Docker image → push to GHCR → SSH deploy via Tailscale.
- **Deploy controller:** `scripts/deploy.ts` validates `@sha256` image
  references, runs migrations as a one-shot, starts the app, and polls the
  readiness endpoint. See `docs/deployment.md` for the full contract.
- **VPS runbook:** `docs/vps-deployment.md` covers VPS setup, secrets, and
  operations.

### Deploy workflow

1. Push to `main` → GitHub Actions builds + pushes images to GHCR.
2. Action joins Tailscale, SSHes to VPS at `/opt/sheetbase`.
3. Loads `/opt/sheetbase/.env.production` (never committed).
4. `pnpm deploy:plan` — validates image/migration compatibility.
5. `pnpm deploy:apply` — migrate → start app → readiness check.
6. Cloudflare Tunnel stays up — only the app container restarts.

### Required GitHub Secrets

| Secret                | Purpose                         |
| --------------------- | ------------------------------- |
| `VPS_SSH_PRIVATE_KEY` | SSH key for the VPS deploy user |
| `VPS_TAILSCALE_IP`    | Tailscale IP of the VPS         |
| `TAILSCALE_AUTH_KEY`  | Tailscale auth key for CI nodes |

### Rollback

Set `SHEETBASE_APP_IMAGE` to a previous `@sha256` digest and run
`pnpm deploy:apply`. Restore DB from backup if a migration is incompatible.

## Orb / local development

For Amp orb-specific setup (system PostgreSQL, no Docker), see
`docs/orb-setup.md` and `.agents/setup`. The orb uses the system PostgreSQL
cluster, not Docker Compose. PostgREST runs as a downloaded binary.

## Project conventions

- **TypeScript paths:** `#/` maps to `src/` (see `tsconfig.json`).
- **Routing:** TanStack Router with file-based routes. `src/routeTree.gen.ts`
  is committed — run `pnpm generate-routes` after adding/removing route files,
  then commit the result. CI and `.agents/setup` do not regenerate it.
- **API boundary:** The browser never talks to PostgREST directly. All data
  goes through the same-origin `/api/db/*` proxy (`src/routes/api/db/$.ts`).
- **Auth:** Better Auth with GitHub OAuth. Database-backed sessions. See
  `docs/authentication.md`.
- **Testing:** Vitest for unit/integration, Playwright for E2E. DB tests use a
  real PostgreSQL instance. See `docs/testing.md`.
- **Migrations:** Always use `pnpm db:generate` (never hand-edit generated SQL).
  Migration files are named `NNNN_description.sql`.
- **Deployment contract:** Images must be referenced by `@sha256` digest, never
  by tag. The deploy controller validates this. See `docs/deployment.md`.
