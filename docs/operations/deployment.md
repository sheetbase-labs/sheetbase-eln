# Deployment contract

REL-001 defines how one immutable Sheetbase artifact moves between environments.
It does not claim that a staging deployment has happened; that requires current
infrastructure evidence and remains the final open REL-001 acceptance item.

## Environment boundaries

| Boundary        | Development                     | Test                         | Staging                                     | Production                                     |
| --------------- | ------------------------------- | ---------------------------- | ------------------------------------------- | ---------------------------------------------- |
| Purpose         | Interactive local work          | Isolated automated checks    | Release rehearsal with production shape     | Approved user traffic                          |
| `SHEETBASE_ENV` | `development`                   | `test`                       | `staging`                                   | `production`                                   |
| Secrets         | `.env.local`, never committed   | Ephemeral test values        | Injected by a secret manager                | Injected by a separate production secret scope |
| Artifact        | Local source or image           | Locally built test artifact  | Registry image selected by `@sha256` digest | The exact digest accepted in staging           |
| Database        | Local disposable database       | Per-run disposable database  | Dedicated staging database                  | Dedicated production database                  |
| Object bytes    | Local filesystem                | Temporary isolated directory | Dedicated staging storage                   | Dedicated production storage                   |
| OAuth origin    | Local callback                  | Test callback or stub        | Staging HTTPS callback                      | Production HTTPS callback                      |
| Data            | Fixtures and optional demo data | Test-owned fixtures only     | Approved demonstration data only            | Production records                             |

The server rejects staging or production startup unless the authentication
origin is HTTPS, service URLs are non-local, GitHub OAuth is configured, the
secret source is managed for that environment, and artifact plus migration
identities are immutable. Before it listens, the production adapter also runs
the readiness contract against the target database, so an incompatible
artifact cannot serve traffic. Development keeps explicit `local`/`untracked`
defaults.

## Secret management and rotation

The deployment platform's secret manager is authoritative. It injects values
into the deployment process environment immediately before `compose.deploy.yaml`
is evaluated. Do not generate an environment file, put secret values in image
arguments or labels, paste them into tickets, or retain them in deployment
evidence.

Keep separate staging and production scopes for:

- `DATABASE_URL`, `MIGRATION_DATABASE_URL`, and `FORMULA_DATABASE_URL`;
- `BETTER_AUTH_SECRET`, `GITHUB_CLIENT_ID`, and `GITHUB_CLIENT_SECRET`;
- `PGRST_DB_URI` and `PGRST_JWT_SECRET`;
- future object-storage credentials when the S3 backend is implemented.

Rotate database credentials by creating the replacement credential, granting
the same narrow role, updating the secret manager, rolling the affected service,
proving readiness, and then revoking the old credential. Rotate OAuth credentials
the same way where the provider permits overlap. `BETTER_AUTH_SECRET` and
`PGRST_JWT_SECRET` invalidate existing sessions or tokens, so schedule a single
coordinated app/PostgREST rollout, announce the re-authentication window, verify
new authentication, then revoke the old value. Record the rotation date, operator,
secret name, affected environment, and evidence link, but never the value.

Rotate immediately after suspected exposure, an operator's access removal, or
a provider alert. Otherwise review OAuth and database credentials every 90 days
and the signing secrets every 180 days. The release owner tracks the next review
date in the deployment system.

## Build an immutable artifact

`Dockerfile` uses `ARG NODE_IMAGE` with a mutable default of `node:22-alpine`
to prevent a Dockerfile lint warning when the file is inspected without build
args. The CI workflow always overrides this with an immutable `@sha256` digest
via `--build-arg`. The build records the release version, source revision, and
latest Drizzle journal version as OCI metadata. The build refuses a dirty Git
worktree, so the recorded revision identifies the source bytes copied into the
image.

### CI workflow (GitHub Actions)

The `.github/workflows/deploy.yml` workflow runs on every push to `main`. It:

0. **Release gate (`verify` job, PLAT-01):** typecheck, lint, unit tests,
   database integration tests (against a service PostgreSQL with the same
   role skeleton as Compose) and a production build must all pass before any
   image is built. A red gate blocks the release; there is no override
   switch. The API/browser contract layers (`pnpm test:api`,
   `pnpm test:browser`) additionally require the pinned PostgREST service and
   run outside this gate — they are not claimed as CI gates here.
1. Resolves `node:22-alpine` to its immutable digest via `docker inspect`,
   producing `node:22-alpine@sha256:<64-hex>`.
2. Sets `SHEETBASE_ARTIFACT_VERSION` to the immutable commit SHA
   (`${{ github.sha }}`), never a mutable short SHA, branch name, or run number.
3. Runs `pnpm artifact:build` with the resolved digest and SHA-based version.
4. Pushes the application and PostgREST images to GHCR, then resolves
   and publishes their immutable registry digests.

The workflow does **not** run `pnpm generate-routes` — the route tree is
committed. Deployment is a separate step via SSH over Tailscale.

### Local build (for testing)

```bash
export SHEETBASE_NODE_IMAGE='node@sha256:<verified-node-image-digest>'
export SHEETBASE_ARTIFACT_VERSION='<release-version>'
export SHEETBASE_ARTIFACT_TAG='<registry>/sheetbase:<release-version>'
pnpm artifact:build
```

Publish through the approved registry workflow, resolve its registry digest,
and use `<registry>/sheetbase@sha256:<digest>` for deployment. Never promote a
tag. The build command prints the local image ID and migration identity; those
are build evidence, not staging evidence.

The custom PostgREST image must also be published and selected by digest. The
deployment planner rejects mutable application and PostgREST references.

### Hosted surfaces today

The environment model above is the supported _contract_. The surfaces that
actually exist today are production (`app.sheetbase.co.uk`, deployed
automatically from `main`) and the disposable development surface
(`dev.sheetbase.co.uk`, manual dispatch). Test/CI exists as the workflow gate
environment. Staging is defined but not provisioned; it becomes real only
when infrastructure evidence exists (see "Outstanding real-environment
proof"). Nothing in the application branches on `SHEETBASE_ENV=staging`
beyond the deployed-environment validation rules.

### Configuration that varies / must not vary

- **Varies per environment:** database and PostgREST URLs, OAuth callback
  origin, secret values, storage backend location, `SHEETBASE_ENV`,
  `SHEETBASE_SECRET_SOURCE`, artifact identity values.
- **Must not vary:** the artifact (one digest promoted, never rebuilt per
  environment), the migration set (pinned in the image), the application's
  validation rules, and the public API contract. A new environment is new
  configuration, not new application behaviour.

## Migration strategy

Migrations are Drizzle/PostgreSQL migrations in `drizzle/` — the one
migration mechanism; no second path exists.

- **When:** migrations run as part of every deployment, ordered before the
  new application starts (`migrate` one-shot service → `app` starts only
  after PostgREST is healthy → app listens only after its own readiness
  contract succeeds).
- **Who:** the deployment controller (`scripts/deploy.ts`), never an
  operator's shell. Production deployment cannot depend on someone
  remembering to run SQL. Local development uses `pnpm db:migrate`.
- **Execution:** local and Compose migration commands use
  `scripts/migrate-once.mjs`. The runner loads `.env.local` and `.env`
  without replacing environment credentials, then selects
  `MIGRATION_DATABASE_URL` with `DATABASE_URL` as the fallback. The connection
  must use the `migrator` role on a database owned by `migrator`.
- **Concurrency:** the migrate runner (`scripts/migrate-once.mjs`) holds a
  PostgreSQL advisory lock for the duration, so concurrent migrators
  (e.g. a retried deploy overlapping the first) serialise instead of racing
  on the journal. The lock is session-scoped, so a crashed migrator cannot
  wedge future releases.
- **Guarded backfills:** the runner calls stock Drizzle ORM `migrate` on
  the same dedicated connection that holds the lock. That session sets
  `sheetbase.sheet_instance_write=rpc-v1`, allowing historical Sheet Instance
  backfills such as migration 0255 through the enabled write guard.
  Drizzle owns the migration transaction and journal hashes. Published SQL
  remains unchanged. The runner closes the connection in `finally` on success
  or failure. No application pool, role setting, database setting, or request
  permission receives this context.
- **Failure behaviour:** a failed migration aborts the deployment before the
  app starts; the old app container keeps serving with the old artifact
  against the old-compatible database.
- **Partially-applied releases:** the readiness gate proves the exact
  artifact version, digest and applied migration version before the rollout
  is accepted; a mismatch isolates the rejected app container.
- **Irreversible migrations:** Drizzle migrations are not reversible by
  design. Destructive schema changes require a forward-fix migration that
  restores compatibility with the previous artifact before the old artifact
  can be re-deployed; otherwise database restore applies (see
  [`recovery.md`](recovery.md)).

## Feature flags

Deliberately deferred. Sheetbase has no current deployment need: releases
are low-frequency, the development surface is disposable, and the product
direction removes superseded paths rather than gating them. Revisit only
when a concrete need exists (e.g. a risky migration needing staged rollout
or a tenant-visible rollout). Do not build generic flag machinery because
PLAT-01 mentions the word.

## Plan and apply

Load the non-secret release identifiers and inject secrets from the target
environment's manager. Keep the selected application image available to the
local Docker engine before planning. The planner reads the version, revision,
and expected migration from that immutable image's OCI labels, compares the
migration with the latest `when` value in `drizzle/meta/_journal.json`, and
derives `SHEETBASE_ARTIFACT_DIGEST` from `SHEETBASE_APP_IMAGE`. Operators do not
provide replacement version or migration values.

```bash
pnpm deploy:plan
pnpm deploy:apply
```

The apply path is intentionally ordered:

1. Run `node scripts/migrate-once.mjs` as a one-shot service and stop on failure.
2. Start the selected application digest only after PostgREST is healthy; the
   server does not listen until its own readiness contract succeeds.
3. Poll the public HTTPS readiness endpoint for at most 60 seconds.
4. Accept the rollout only when readiness reports the expected artifact version,
   artifact digest, and exact applied migration version.

The readiness endpoint must share the configured `BETTER_AUTH_URL` origin. If
container startup or the public readiness proof fails, the deployment command
removes the rejected application container so it cannot receive traffic.

The final JSON output is the minimum deployment evidence. Store it with the
release record together with the image registry attestations and migration logs.

## Releasing without GitHub Actions (`pnpm release:local`)

The GitHub Actions workflows are the release path of choice when the account
can run them. A deployment whose GitHub account **cannot run Actions jobs**
(GitHub-hosted runner billing/limit blocks) still releases through the same
controller with `scripts/release.sh` — run it **on the VPS** from
`/opt/sheetbase`:

> **Status:** the `.github/workflows/deploy.yml` and
> `deploy-dev.yml` triggers are **paused** (their `on:` blocks are commented
> out) because the account cannot run hosted-runner jobs. The local release
> path below is the canonical release path while that is the case; uncomment
> the `on:` blocks to re-enable the Actions path when runners are available.

```bash
cd /opt/sheetbase
git fetch origin main
set -a; . ./.env.production; set +a
RELEASE_SHA=<full-40-hex-commit-sha> pnpm release:local
```

The script is deliberately the same contract as the CI pipeline, executed
locally:

1. **Clean detached checkout** of the exact release commit (a dirty worktree
   aborts).
2. **Enforced release gate** on the VPS: typecheck, lint, unit tests,
   production dependency audit (`pnpm audit --prod --audit-level=high`),
   database tests against a **disposable PostgreSQL container** (production
   database never touched), and a production build. Any failure aborts before
   an image is built.
3. **Immutable artifacts without a registry:** the Node base image is
   resolved to its `@sha256` digest, then the app and PostgREST images are
   built locally and referenced as `name@sha256:<image-id>` — the Docker
   engine resolves these content-addressed references locally, so no registry
   or GitHub dependency exists. The OCI labels still carry the release version
   (= commit SHA), source revision and expected migration.
4. `pnpm deploy:plan` then `pnpm deploy:apply` — the same controller:
   migrate → start app → readiness verification of the exact artifact
   version, digest and migration.

The release evidence is the controller's JSON output plus the gate log, stored
with the release record. GitHub-hosted workflows (`deploy.yml`,
`security.yml`) remain valid when runners are available; this script is what
makes the release independent of their availability.

### Development surface

The disposable development surface (`dev.sheetbase.co.uk`) uses the same
local-build idea against `compose.dev.yaml` with its auth-free fixture
environment; see `docs/development/dev-environment.md`.

### First-deploy and Cloudflare hostname sequencing

The deployment apply path verifies **local container health** before any
public hostname is expected to serve traffic:

1. `docker compose run --rm migrate` applies migrations (one-shot, stops on
   failure). The migrate service waits for PostgreSQL's healthcheck.
2. `docker compose up -d --wait app` starts the app container only after
   PostgREST's healthcheck passes (`depends_on: service_healthy`).
3. The app container's own healthcheck polls `http://localhost:3000/api/health/ready`.
4. `deploy.ts` polls the public HTTPS readiness URL for at most 60 seconds.

The Cloudflare hostname (`app.sheetbase.co.uk`) is configured as a **manual
one-time external step** that should only be activated after the local app
healthcheck is green. The tunnel routes the public hostname to the local port;
it does not participate in the deployment health sequencing. If the tunnel is
activated before the app is healthy, Cloudflare will return 502 until the app
passes its readiness check.

## Clean checkout and route generation

`src/routeTree.gen.ts` is committed to the repository. The CI workflow and
`.agents/setup` do **not** run `pnpm generate-routes` when the committed file
exists. This keeps a clean checkout clean, which is required by the artifact
build's `assertCleanBuildSource` check.

Developers must regenerate and commit the route tree after adding, removing, or
renaming route files:

```bash
pnpm generate-routes
git add src/routeTree.gen.ts
git commit -m "chore: regenerate route tree"
```

`.env.production` is gitignored. Production secrets are injected by the secret
manager at deploy time, never committed to the repository.

## Promotion and rollback

Promote the exact staging application and PostgREST digests; rebuilding between
environments creates a different release. Production uses a separate secret
scope and database even when its non-secret configuration matches staging.

Application rollback is permitted only when the previous artifact's expected
migration equals the database's current migration. If it differs, readiness will
reject the old artifact, so stop traffic and roll forward with a forward-fix
migration. Database restore is not an REL-001 rollback mechanism; backups,
restore procedure, restore drills and RPO/RTO objectives are documented in
[`recovery.md`](recovery.md) and must exist before wider release. The nightly
audit-trail verification (DEC-04, 06:00) is documented in
[`audit-verification.md`](audit-verification.md).

Record the decision maker, source and target environments, artifact digests,
migration version, readiness evidence, and rollback decision for every promotion.

## Outstanding real-environment proof

Before REL-001 can close, provision staging outside this repository, inject real
managed secrets, deploy a clean registry artifact by digest, and retain the
successful migration and readiness evidence. Local tests and a deployment plan
do not satisfy that acceptance item.

Hosted delivery is limited to production (`app.sheetbase.co.uk` from `main`)
and the disposable development surface (`dev.sheetbase.co.uk` via manual
dispatch). See [`docs/development/dev-environment.md`](../development/dev-environment.md) for the
auth-free development deploy.
