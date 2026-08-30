# Local dev quick-start (orb)

This guide shows how to run the app locally in an orb. You can iterate visually
without waiting for a hosted development deploy.

## Prerequisites

`.agents/setup` runs automatically on fresh orb creation. It sets up:

- Node.js 22, pnpm 11
- PostgreSQL 18 cluster + roles + migrations
- PostgREST v14.5 binary
- `.env.local` with `SHEETBASE_DEV_AUTH_FREE=true` and `PGRST_DB_URI` pointed
  at `localhost` (not the Docker hostname `postgres`)
- Demo seed data

If any of these are missing (for example, the orb existed before these setup
steps), run `.agents/setup` manually:

```sh
.agents/setup
```

## Start services

Two supervised services are necessary: PostgREST (API) and the Vite dev server.

```sh
# PostgREST — serves the /api/db/* proxy's upstream on port 3001
amp orb service start postgrest --command './scripts/postgrest.sh'

# Dev server — Vite on port 3000 (or next available if 3000 is taken)
amp orb service start dev --command 'pnpm dev'
```

Verify both services are healthy:

```sh
curl -sf http://127.0.0.1:3002/ready         # PostgREST admin
curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:3000/  # App (should be 200)
```

If the dev server uses a different port (Vite increments the port when 3000 is
busy), check the logs:

```sh
amp orb service logs dev 2>&1 | grep 'Local:'
```

## Get a public portal URL

The user cannot open `localhost:3000` directly. Create a public portal URL:

```sh
amp orb portal http://localhost:3000
# Returns something like https://t-xxxx-p3000.onamp.dev/
```

Share that URL with the user. It survives orb pause/resume as long as the dev
service stays running.

## Take screenshots locally

Use Playwright via `npx tsx` with a script like `.amp/screenshot-samples.ts`:

```sh
npx tsx .amp/screenshot-samples.ts
```

The script navigates to `http://localhost:3000/samples`, waits for data,
captures desktop (1440×900) and 1024px screenshots, and saves them to
`.amp/in/artifacts/`.

To inspect a screenshot in the conversation, use the `view_media` tool. Give it
the artifact path and an objective that describes what to verify.

## After a pause/resume

`.agents/resume` restarts PostgreSQL and PostgREST automatically. The dev
server service also resumes. If anything is missing:

```sh
# Check service status
amp orb service status postgrest
amp orb service status dev

# Restart if needed
amp orb service start postgrest --command './scripts/postgrest.sh'
amp orb service start dev --command 'pnpm dev'
```

## Common issues

| Symptom                                    | Fix                                                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| App redirects to `/sign-in`                | `SHEETBASE_DEV_AUTH_FREE` is not `true` in `.env.local`; restart dev server after you fix the value |
| PostgREST `permission denied for table`    | Normal for anon role without auth; the app proxies with its own client role                         |
| `Port 3000 is in use`                      | A stale Vite process survived; kill it (`kill <pid>`) or use the port Vite picked (check logs)      |
| No data on pages                           | Run `pnpm db:seed:demo` to create fixture data                                                      |
| `postgrest: command not found`             | Run `.agents/setup` or install manually per `docs/orb-setup.md`                                     |
| PostgREST `resource busy (Address in use)` | Another process holds port 3001/3002; stop it then restart the service                              |

## What NOT to do

- Do not use `nohup`, `setsid`, `&`, or tmux to keep servers alive. Amp kills
  them when the CLI updates. Always use `amp orb service start`.
- Do not wait for a hosted development deploy for normal visual iteration.
  Local dev with Playwright screenshots is faster.
- Do not commit `.env.local`. It contains dev secrets.
