# Development environment

Sheetbase runs a non-production, auth-free environment for reviewing the current
product on a stable URL: **`https://dev.sheetbase.co.uk`**. The environment is a
disposable demo surface. It is not a staging or production environment.

## Boundaries

- `SHEETBASE_ENV=development` and `SHEETBASE_DEV_AUTH_FREE=true` select the open
  development identity. The application refuses this flag in staging or
  production.
- The seeded identity is `owner@sheetbase.test` by default, with the existing
  fixture workspace and Virus Stability demo data. `SHEETBASE_DEV_USER_ID` goes
  to both the app and seed containers. The auth-free session and its
  fixture-workspace owner membership then stay aligned. A custom ID gets a
  unique `owner+...@sheetbase.test` seed email. No GitHub/Google OAuth
  application, user session, or Better Auth setup is necessary to view or edit
  the demo.
- `compose.dev.yaml` uses the `sheetbase-dev` Compose project, host port
  `3100`, Postgres volume `sheetbase-dev-postgres-data`, and object-storage
  volume `sheetbase-dev-object-storage`. These resources are separate from
  production.
- The dev database and files are disposable. Anyone with the URL can change
  them. Do not put real research data or credentials there.

## One-time operator setup

These steps require Gareth's approval and access to the VPS, Cloudflare, and
GitHub repository settings. This section documents the steps only; the PR does
not create or delete external resources.

1. Choose the development host. It may share the production VPS, but use a
   separate checkout at `/opt/sheetbase-dev`, the separate Compose file, and a
   separate env file at `/opt/sheetbase-dev/.env.development`.
2. Create the DNS/tunnel route for `dev.sheetbase.co.uk` in Cloudflare. The
   tunnel ingress must target `http://127.0.0.1:3100`. Keep the tunnel token on
   the VPS. Do not put it in GitHub or this repository. If you use the
   production VPS, add a second ingress rule. Do not change the existing
   `app.sheetbase.co.uk` rule.
3. Install Docker/Compose. Verify the `deploy` user can run Docker. Clone this
   repository into `/opt/sheetbase-dev`. Keep the checkout's origin pointed at
   the GitHub repository.
4. Create the dev env file. It needs disposable values for the database role
   passwords and JWT secret, plus the internal Compose URLs below. Do not copy
   production values.

```dotenv
POSTGRES_DB=sheetbase_dev
POSTGRES_USER=sheetbase_dev
POSTGRES_PASSWORD=<new-disposable-value>
POSTGREST_AUTHENTICATOR_PASSWORD=<new-disposable-value>
MIGRATOR_PASSWORD=<new-disposable-value>
FORMULA_WRITER_PASSWORD=<new-disposable-value>
DATABASE_URL=postgresql://sheetbase_dev:<password>@postgres:5432/sheetbase_dev
MIGRATION_DATABASE_URL=postgresql://migrator:<migrator-password>@postgres:5432/sheetbase_dev
FORMULA_DATABASE_URL=postgresql://formula_runtime:<formula-password>@postgres:5432/sheetbase_dev
PGRST_DB_URI=postgresql://authenticator:<postgrest-password>@postgres:5432/sheetbase_dev
PGRST_JWT_SECRET=<new-disposable-value-at-least-32-characters>
BETTER_AUTH_URL=https://dev.sheetbase.co.uk
SHEETBASE_SECRET_SOURCE=vps-local
SHEETBASE_DEV_USER_ID=00000000-0000-4000-8000-000000000001
```

`compose.dev.yaml` supplies `SHEETBASE_ENV=development`,
`SHEETBASE_DEV_AUTH_FREE=true`, local file storage, and the dev-only Better
Auth fallback secret. OAuth variables are intentionally absent.

5. Create a GitHub Actions **development** environment with only these
   secrets: `DEV_VPS_SSH_PRIVATE_KEY`, `DEV_VPS_TAILSCALE_IP`, and
   `DEV_TAILSCALE_AUTH_KEY`. The existing production secrets stay in the
   production environment. `.github/workflows/deploy-dev.yml` does not read
   them.

6. Verify the Tailscale auth key can connect a GitHub Actions runner to the dev
   host. No public SSH port is necessary. Restrict the key to the dev host and
   rotate it through the normal GitHub environment-secret process.

## Deploying a change

The workflow is manual. It does not deploy from pull requests automatically.
The trigger block in `.github/workflows/deploy-dev.yml` is commented out
(PLAT-03 pause), so the workflow currently cannot run. When re-enabled, run
**Actions → Deploy development environment**, select a branch or tag, and enter
`deploy-dev`. The workflow builds immutable GHCR images, connects with SSH over
Tailscale using only development environment secrets, migrates the dev
database, re-runs the idempotent demo seed, and verifies the VPS loopback
readiness endpoint.

AMP can create or update the ordinary GitHub PR for code review. It needs no
VPS, Cloudflare, or production secret. A human with the GitHub Actions
permission and the development environment secrets performs the optional
deployment.

## Resetting disposable state

Confirm first that all dev data may be discarded. Then run the following on the
dev host. This removes the dev database and object bytes. It does not touch
production volumes.

```sh
cd /opt/sheetbase-dev
docker compose -f compose.dev.yaml --env-file .env.development down -v
```

The next development deployment recreates the database, applies migrations, and
seeds the default user and demo data.
