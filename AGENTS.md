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

## Environments and automated delivery

The Hostinger VPS is the shared delivery target. It has three separate Docker
surfaces; do not combine their Compose projects, databases, volumes, or
environment files.

| Surface     | Public URL                            | Purpose                                     | How it deploys                                                                  |
| ----------- | ------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------- |
| Production  | `https://app.sheetbase.co.uk`         | Real authenticated app                      | Automatically from `main` via `.github/workflows/deploy.yml`                    |
| Development | `https://dev.sheetbase.co.uk`         | Disposable, auth-free demo environment      | Manual, deliberate dispatch of `.github/workflows/deploy-dev.yml`               |
| PR preview  | `https://pr-<number>.sheetbase.co.uk` | Isolated review environment for one open PR | Automatically on PR open, update, or reopen via `.github/workflows/preview.yml` |

### Development environment

- The development app is a **non-production** demo surface. It uses
  `SHEETBASE_ENV=development` and `SHEETBASE_DEV_AUTH_FREE=true` to create an
  explicit auth-free fixture session. Never enable either setting in
  production or a PR preview.
- Its VPS checkout is `/opt/sheetbase-dev`, its secret file is
  `/opt/sheetbase-dev/.env.development`, and it runs `compose.dev.yaml` on
  loopback port `3100`.
- To deploy, use **Actions → Deploy development environment**. Select the
  intended Git ref and enter `deploy-dev` in the confirmation field. The
  workflow builds immutable GHCR images, migrates, seeds the disposable demo
  data, restarts only the development Compose project, then proves readiness.
- Cloudflare Tunnel maps `dev.sheetbase.co.uk` to `127.0.0.1:3100`; it is a
  one-time VPS/Tunnel configuration, not a per-deploy operation.
- Development Actions secrets belong to the `development` GitHub environment:
  `DEV_VPS_SSH_PRIVATE_KEY`, `DEV_VPS_TAILSCALE_IP`, and
  `DEV_TAILSCALE_AUTH_KEY`.

### Pull-request previews

- Every same-repository PR automatically gets a fully isolated preview at
  `https://pr-<number>.sheetbase.co.uk`. Each preview has its own Compose
  project, PostgreSQL volume, object-storage volume, loopback port, and seeded
  demo data.
- The trusted workflow first builds PR code without deployment credentials,
  then publishes immutable images and deploys from trusted `main` workflow
  code. This is intentional: never move VPS, Cloudflare, GHCR, OAuth, or
  production secrets into AMP, an Orb, or PR-controlled workflow code.
- On successful deployment, the workflow creates or updates one marked PR
  comment containing the preview URL and `Last updated` timestamp. It uses the
  repository secret `PREVIEW_COMMENT_TOKEN`, a fine-grained token limited to
  this repository with **Pull requests: read/write**. Do not replace it with a
  broad personal token or expose its value.
- When a PR closes, the workflow tears down that preview and updates the same
  marked comment to say the preview was removed. It does not affect production
  or development.
- Cloudflare Tunnel routes `*.sheetbase.co.uk` to the VPS preview router on
  `127.0.0.1:31000`. This wildcard route and the preview-router system service
  are one-time infrastructure; agents should not edit them for ordinary PRs.
- Preview Actions secrets belong to the `preview` GitHub environment:
  `VPS_SSH_PRIVATE_KEY`, `VPS_TAILSCALE_IP`, and `TAILSCALE_AUTH_KEY`.
  `PREVIEW_COMMENT_TOKEN` is a **repository** Actions secret because the
  comment jobs do not declare that environment.

### Agent / AMP delivery workflow

1. Work in a normal branch and open or update a PR. AMP only needs GitHub
   access; it must not receive VPS, Tailscale, Cloudflare, OAuth, or secret
   values.
2. Wait for the `PR preview` workflow and use the URL in its marked PR comment
   for review. If it fails, inspect the failed Action job and fix the actual
   branch-related cause before retrying; do not guess at infrastructure changes.
3. Merge an approved PR to `main`. The normal production deployment workflow
   then performs the immutable-image VPS deploy automatically.
4. Use the development workflow only when an intentional shared demo update is
   wanted; it is not a substitute for PR previews and it is not automatic on
   every branch push.
5. Close unneeded PRs so their preview resources are cleaned up automatically.

**Required rules:** keep image references digest-pinned; keep development,
preview, and production data isolated; never put `.env` values in GitHub
issues, PR comments, logs, code, or agent messages; and validate
`/api/health/ready` after any deployment change.

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
