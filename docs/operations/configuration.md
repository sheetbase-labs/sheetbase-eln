# Configuration reference

Sheetbase is configured with environment variables. `.env.example` is the
template for local development; `compose.deploy.yaml` passes the same names to a
deployed app. Variables the app validates are in `src/env.server.ts`, which is
the source of truth if this page and the code ever differ.

"Required" means the app will not start without it. Secrets come from a secret
manager in staging and production; never commit them.

## Database and API

| Variable                               | Default                          | What it does                                                                              |
| -------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------- |
| `DATABASE_URL`                         | required                         | The app's database login.                                                                 |
| `FORMULA_DATABASE_URL`                 | required                         | Narrow login used only to write calculated values.                                        |
| `PIPELINE_SANDBOX_DATABASE_URL`        | none                             | Login for untrusted pipeline SQL. Without it, SQL pipeline steps fail with a clear error. |
| `MIGRATION_DATABASE_URL`               | none                             | Login that applies migrations (`pnpm db:migrate`).                                        |
| `POSTGRES_*`, `*_PASSWORD`             | dev values                       | Passwords the Postgres container uses to create its roles on first start.                 |
| `PGRST_DB_URI`, `PGRST_JWT_SECRET`     | required                         | How PostgREST reaches Postgres, and the secret (32+ characters) shared with the app.      |
| `POSTGREST_URL`, `POSTGREST_ADMIN_URL` | `http://localhost:3001`, `:3002` | Where the app finds PostgREST. Server side only.                                          |
| `DB_POOL_MAX`                          | `10`                             | Most connections the app keeps open per login.                                            |

## Sign-in

| Variable                                                                        | Default                 | What it does                                                                                                 |
| ------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| `BETTER_AUTH_SECRET`                                                            | required                | Signs sessions (32+ characters).                                                                             |
| `BETTER_AUTH_URL`                                                               | `http://localhost:3000` | The public address of the app. HTTPS in production.                                                          |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`                                      | none                    | GitHub sign-in.                                                                                              |
| `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_PROVIDER_NAME` | none, `Company SSO`     | Company single sign-on. Set the first three to switch it on.                                                 |
| `EMAIL_LOGIN_ENABLED`                                                           | `false`                 | Emailed one-time sign-in link. Needs `SMTP_HOST`.                                                            |
| `EMAIL_LOGIN_ALLOWED_DOMAINS`                                                   | none                    | Comma-separated domains whose new people may create an account by link. Existing accounts can always use it. |

Production and staging need GitHub or OIDC. See
[Authentication](authentication.md).

## Email

`SMTP_HOST` (empty turns email off), `SMTP_PORT` (587), `SMTP_USER`,
`SMTP_PASS`, `SMTP_FROM`. Port 465 uses TLS from the start; any other port
requires STARTTLS.

## Files and backups

| Variable                                                                                                           | Default                                            | What it does                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `FILE_STORAGE_BACKEND`                                                                                             | `database`                                         | `database`, `s3` or `local`. `compose.deploy.yaml` defaults to `local`, on a volume.                                           |
| `FILE_STORAGE_DIR`                                                                                                 | `./.storage/objects`                               | Folder for `local`.                                                                                                            |
| `FILE_STORAGE_S3_BUCKET`, `_ENDPOINT`, `_REGION`, `_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY`, `_PREFIX`, `_PATH_STYLE` | none, none, `us-east-1`, none, none, empty, `true` | S3-compatible storage. See [File storage](file-storage.md).                                                                    |
| `SHEETBASE_BACKUP_S3_BUCKET` and the same suffixes                                                                 | as above                                           | Where scheduled backups go. Unset, they follow the files. See [Workspace export and backups](workspace-export-and-backups.md). |
| `SHEETBASE_SCHEDULER_ENABLED`                                                                                      | on                                                 | Set `false` on a replica that should not run scheduled jobs.                                                                   |
| `SHEETBASE_BACKUP_DIR`, `SHEETBASE_BACKUPS_BY_HOST`                                                                | none                                               | Tell the go-live checks where `pnpm backup:run` writes, or that your host takes the backups.                                   |

## Deployment identity

`SHEETBASE_ENV` (`development`, `test`, `staging`, `production`),
`SHEETBASE_SECRET_SOURCE`, `SHEETBASE_ARTIFACT_VERSION`,
`SHEETBASE_ARTIFACT_DIGEST` and `SHEETBASE_EXPECTED_MIGRATION` are set by the
release, not by hand. `SHEETBASE_DEV_AUTH_FREE` skips sign-in for a throwaway
development database and is refused in staging and production. See
[Deployment](deployment.md).

## Features and limits

| Variable                                                                            | What it does                                                                                             |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `SHEETBASE_SQL_HOST`, `_PORT`, `_DATABASE`                                          | Where members' read-only SQL logins connect. See [Data access](data-access.md).                          |
| `SHEETBASE_METRICS_TOKEN`                                                           | 32+ character bearer token for `/api/metrics`. Without it the endpoint is off in staging and production. |
| `SHEETBASE_RATE_LIMIT_MAX`, `_WINDOW_SECONDS`                                       | Requests per window per person on the data API (600 per 60 seconds).                                     |
| `SHEETBASE_WORKSPACE_STORAGE_QUOTA_BYTES`, `SHEETBASE_WORKSPACE_SEAT_LIMIT`         | Optional limits shown on the Usage screen. Unset means no limit.                                         |
| `PIPELINE_PYTHON_RUNNER_URL`, `PIPELINE_PYTHON_RUNNER_TOKEN`                        | The isolated Python runner. See [Python pipelines](pipeline-python.md).                                  |
| `PIPELINE_MANIFEST_SIGNING_KEY`                                                     | Ed25519 key that signs pipeline run manifests.                                                           |
| `AI_PROVIDER_PROFILES`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | AI providers. See [AI](ai.md).                                                                           |
| `CONNECTOR_ALLOW_PRIVATE_HOSTS`, `CONNECTOR_HOST_ALLOWLIST`                         | Which addresses connectors may call.                                                                     |
| `LIVEBLOCKS_SECRET_KEY`                                                             | Live co-editing. Without it collaboration reports itself off.                                            |
| `SHEETBASE_CAPABILITIES`                                                            | Deployment capability allow-list. Nothing uses it today.                                                 |
