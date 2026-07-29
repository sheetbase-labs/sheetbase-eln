# Amp orb setup guide

How to stand up a full Sheetbase environment on an Amp orb, including the
Cloudflare tunnel for the production domain.

## 1. Start the database and API

```bash
pnpm install
amp orb service start db --command 'docker compose up postgres postgrest'
```

Wait for both to be healthy:

```bash
amp orb service status db
```

PostgREST listens on `:3001` (API) and `:3002` (admin). Postgres on `:5432`.

## 2. Run migrations

```bash
pnpm db:migrate
```

## 3. Seed the database

Minimal fixtures only:

```bash
pnpm db:seed
```

Month-scale realistic data (~30 days of lab usage):

```bash
pnpm db:seed:month
```

## 4. Environment variables

The orb's fresh checkout will NOT have `.env.local` (it is gitignored). You
must create it with the production values. The critical variables that differ
from the `.env.example` defaults:

| Variable | Why it matters |
|----------|---------------|
| `BETTER_AUTH_URL` | Must be `https://app.sheetbase.co.uk` for OAuth callbacks to work through the tunnel |
| `BETTER_AUTH_SECRET` | Session signing secret — must match across restarts |
| `GITHUB_CLIENT_ID` | OAuth app client ID registered with GitHub |
| `GITHUB_CLIENT_SECRET` | OAuth app client secret |
| `PGRST_JWT_SECRET` | PostgREST JWT signing — must be 32+ characters |
| `POSTGREST_AUTHENTICATOR_PASSWORD` | Must match the password set during `docker/db/init` |
| `PGRST_DB_URI` | Must use `postgres` as host (compose service name), not `localhost` |

All other variables can use the `.env.example` dev defaults. Copy
`.env.example` to `.env.local` and override the values above.

## 5. Build and start the production server

```bash
pnpm build
amp orb service start prod --command 'PORT=3000 pnpm start'
```

The production server (`scripts/start-prod.mjs`) serves SSR from
`dist/server/server.js` and static assets from `dist/client/`. It loads
`.env` and `.env.local` automatically.

Verify locally:

```bash
curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/
# Should return 307 (redirect to /sign-in) or 200
```

## 6. Cloudflare tunnel

The domain `app.sheetbase.co.uk` is served via a Cloudflare named tunnel that
forwards to `http://localhost:3000` on the orb.

### Starting the tunnel

You need the tunnel token. If another orb is running the tunnel, stop it
there first:

```bash
# On the old orb:
amp orb service stop cloudflared
# Or kill the process directly:
kill <pid>
# Verify it's stopped — check systemd too, as amp orb services auto-restart:
systemctl is-active amp-svc-cloudflared.service
# If still active:
amp orb service stop cloudflared
```

Then on the new orb:

```bash
amp orb service start tunnel --command 'cloudflared tunnel run --token <TOKEN>'
```

### Verifying the tunnel

```bash
curl -sS -o /dev/null -w '%{http_code}' https://app.sheetbase.co.uk/
# Should return 307 or 200, not 502
```

A `502` means either:
- The old orb's cloudflared is still holding tunnel connections (stop it fully,
  including the systemd service)
- The production server on port 3000 isn't running

### How the tunnel works

The Cloudflare tunnel uses a token-based named tunnel (`cloudflared tunnel run
--token <TOKEN>`). Cloudflare's edge routes `app.sheetbase.co.uk` to whichever
cloudflared instance has active connections registered. Only one instance
should run at a time. The tunnel config maps the hostname to
`http://localhost:3000`.

## 7. Verify the full stack

```bash
# Database
psql "$DATABASE_URL" -c "SELECT count(*) FROM api.records;"

# PostgREST
curl -sS http://localhost:3001/ -o /dev/null -w '%{http_code}'

# App (local)
curl -sS http://127.0.0.1:3000/ -o /dev/null -w '%{http_code}'

# App (through Cloudflare)
curl -sS https://app.sheetbase.co.uk/ -o /dev/null -w '%{http_code}'

# CSS assets load
curl -sS -o /dev/null -w '%{http_code}' https://app.sheetbase.co.uk/assets/styles-*.css
```

## 8. Month-scale seed

The month-scale seed (`pnpm db:seed:month`) populates the workspace with
realistic data: 7 users, 5 projects, 30 experiments, 10 samples, 5 reagents,
150+ notebook blocks, 30 calendar bookings, 40 planner tasks, 15 instrument
runs, 8 review submissions, 3 reports, and 250+ change events.

It is additive and idempotent — rerunning converges to the same state without
duplicating rows. It targets the workspace that owns the seeded projects. See
`src/db/seed/month.ts` for implementation details.

## Common issues

### No CSS / unstyled page
The production server must serve static assets from `dist/client/`. The
`scripts/start-prod.mjs` script handles this — make sure you're using it
(`pnpm start`), not a raw `node dist/server/server.js`.

### 502 through Cloudflare
Another cloudflared instance is likely still running. Stop it fully on the
old orb, including the systemd service (`amp orb service stop cloudflared`).

### OAuth redirect mismatch
`BETTER_AUTH_URL` in `.env.local` must be `https://app.sheetbase.co.uk` (not
an orb portal URL) for GitHub OAuth callbacks to work.

### Database connection errors
`PGRST_DB_URI` must use `postgres` as the host (the compose service name),
not `localhost`. The app connects to PostgREST at `localhost:3001`.
