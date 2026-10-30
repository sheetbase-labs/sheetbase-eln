# Sheetbase ELN orb setup

This runbook describes the non-Docker setup used to run Sheetbase ELN in an
Amp orb.

## Prerequisites

- PostgreSQL 18, running as a system service. Docker is not available in
  orbs, so do not use the Compose-based development commands.
- The PostgREST v14.5 Linux static binary on `PATH`.
- Node.js (the exact version in `.node-version`) and pnpm 11.
- `curl`, `tar`, and `cloudflared` for health checks and the public tunnel.

The orb's PostgreSQL cluster is pre-provisioned with the `sheetbase` database,
application roles, and migrations. Confirm PostgreSQL is available before
continuing:

```sh
pg_isready -h localhost -p 5432
```

## Environment

Start from the checked-in example rather than creating the file by hand:

```sh
cp .env.example .env.local
```

Retain the database credentials and development secrets from `.env.example`.
Set or confirm these values in `.env.local`:

```dotenv
# The public origin used by the Cloudflare tunnel (not localhost).
BETTER_AUTH_URL=https://app.sheetbase.co.uk
BETTER_AUTH_SECRET=<value from .env.example>

# Copy these two values from Amp's managed .env; do not commit them.
GITHUB_CLIENT_ID=<Amp-managed value>
GITHUB_CLIENT_SECRET=<Amp-managed value>

PGRST_JWT_SECRET=<value from .env.example>
DATABASE_URL=postgresql://sheetbase:sheetbase@localhost:5432/sheetbase
MIGRATION_DATABASE_URL=postgresql://migrator:migrator-dev-password@localhost:5432/sheetbase
FORMULA_DATABASE_URL=postgresql://formula_runtime:formula-dev-password@localhost:5432/sheetbase
POSTGREST_URL=http://localhost:3001
POSTGREST_ADMIN_URL=http://localhost:3002
```

Also leave the PostgREST settings from `.env.example` in place, particularly
`POSTGRES_DB`, `POSTGREST_AUTHENTICATOR_PASSWORD`, `POSTGREST_PORT`, and
`POSTGREST_ADMIN_PORT`. `.env.local` contains secrets and must not be committed.

## Database and month-scale seed

The month seed targets fixed IDs and therefore expects Gareth's user,
workspace, and owner membership to exist first. Connect with a database role
that can write both the `internal` and `api` schemas, then run:

```sql
INSERT INTO internal."user"
  (id, name, email, "emailVerified", "createdAt", "updatedAt")
VALUES
  ('xB46roJKgzg1CEPqF8JmgkvCMilNGHtn', 'Gareth Price',
   'gareth@oxb.dev', true, now(), now())
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    email = EXCLUDED.email,
    "emailVerified" = true,
    "updatedAt" = now();

INSERT INTO api.workspaces (id, slug, name)
VALUES
  ('798f250c-99bb-4460-9a2a-e9ec98fbecab',
   'gareth', 'Gareth Price Workspace')
ON CONFLICT (id) DO UPDATE
SET slug = EXCLUDED.slug, name = EXCLUDED.name, updated_at = now();

INSERT INTO api.workspace_memberships (workspace_id, user_id, role)
VALUES
  ('798f250c-99bb-4460-9a2a-e9ec98fbecab',
   'xB46roJKgzg1CEPqF8JmgkvCMilNGHtn', 'owner')
ON CONFLICT (workspace_id, user_id) DO UPDATE
SET role = 'owner', suspended_at = NULL, updated_at = now();
```

Then install dependencies, apply any migrations not already present, and seed:

```sh
pnpm install
pnpm db:migrate                 # only if the cluster is behind
pnpm db:seed:month
```

The seed also requires `PGRST_DB_URI` from `.env.local`; for an orb it must use
`localhost`, not Compose's `postgres` hostname.

## PostgREST

Download and install the v14.5 static x86-64 binary (use the matching static
archive instead on another architecture):

```sh
curl -fL -o /tmp/postgrest.tar.xz \
  https://github.com/PostgREST/postgrest/releases/download/v14.5/postgrest-v14.5-linux-static-x86-64.tar.xz
tar -xJf /tmp/postgrest.tar.xz -C /tmp
sudo install -m 0755 /tmp/postgrest /usr/local/bin/postgrest
rm -f /tmp/postgrest /tmp/postgrest.tar.xz
postgrest --version
```

`scripts/postgrest.sh` loads `.env.local`, changes `PGRST_DB_URI` to the orb's
local PostgreSQL service, and sets the required values:

- `PGRST_DB_URI=postgresql://authenticator:<password>@localhost:5432/sheetbase`
- `PGRST_DB_SCHEMAS=api`
- `PGRST_DB_ANON_ROLE=anon`
- `PGRST_JWT_SECRET=<same value as .env.local>`
- `PGRST_SERVER_PORT=3001`
- `PGRST_ADMIN_SERVER_PORT=3002`

Start it as a supervised orb service and check readiness:

```sh
amp orb service start postgrest --command './scripts/postgrest.sh'
curl -f http://127.0.0.1:3002/ready
```

## Build and start Sheetbase

After dependency and database setup:

```sh
pnpm build
amp orb service start prod --command 'PORT=3000 pnpm start'
curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/
```

The final command should print `200` (a redirect may be expected for a route
that requires authentication). Use `amp orb service status prod` and
`amp orb service logs prod` when diagnosing startup failures.

## Cloudflare tunnel

Install the `cloudflared` binary for the orb's architecture and verify it is on
`PATH`. For x86-64 Linux:

```sh
curl -fL -o /tmp/cloudflared \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
sudo install -m 0755 /tmp/cloudflared /usr/local/bin/cloudflared
rm -f /tmp/cloudflared
cloudflared --version
```

Fully stop `cloudflared` in the old orb before starting the tunnel in the new
one; two connectors competing for this hostname can send traffic to the wrong
orb.

```sh
amp orb service start tunnel --command 'cloudflared tunnel run --token <TOKEN>'
curl -sS -o /dev/null -w '%{http_code}' https://app.sheetbase.co.uk/
```

Treat the tunnel token as a secret: obtain it from the managed environment and
do not save it in the repository or shell history.

## Storybook

```sh
# Production static build
pnpm build-storybook
amp orb service start storybook --command 'npx http-server storybook-static -p 6006'

# Or an interactive development server
pnpm storybook
```

## Common issues

| Symptom                                            | Cause and fix                                                                                                                                                                                                                 |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tunnel returns `502`                               | The old orb's `cloudflared` is probably still running. Fully stop its tunnel service, then restart the new orb's tunnel. Also confirm the app is healthy on port 3000.                                                        |
| Sign-in returns `403`                              | `BETTER_AUTH_URL` does not match the request origin. For the tunnel it must be `https://app.sheetbase.co.uk`; rebuild/restart after changing it.                                                                              |
| No seeded data after GitHub sign-in                | Better Auth created a new user and empty workspace. Add that user's `internal."user".id` to `api.workspace_memberships` for workspace `798f250c-99bb-4460-9a2a-e9ec98fbecab` (with the appropriate role), then sign in again. |
| Seed fails while inserting `workspace_memberships` | Gareth's fixed user and workspace do not exist. Run the prerequisite SQL above before `pnpm db:seed:month`.                                                                                                                   |
| PostgREST cannot connect                           | Ensure `PGRST_DB_URI` uses `localhost`, not the Docker-only hostname `postgres`, and verify PostgreSQL and the `authenticator` role are available.                                                                            |
