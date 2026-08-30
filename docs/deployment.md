# Deployment contract

REL-001 defines how one immutable Sheetbase artifact moves between
environments. It does not state that a staging deployment happened. That
proof needs current infrastructure evidence and remains the final open
REL-001 acceptance item.

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

The server rejects staging or production startup unless all of these are
true: the authentication origin is HTTPS, service URLs are non-local, GitHub
OAuth is configured, the secret source is managed for that environment, and
artifact plus migration identities are immutable. Before it listens, the
production adapter also runs the readiness contract against the target
database. An incompatible artifact cannot serve traffic. Development keeps
explicit `local`/`untracked` defaults.

## Secret management and rotation

The deployment platform's secret manager is authoritative. It injects values
into the deployment process environment immediately before
`compose.deploy.yaml` is evaluated. Do not generate an environment file. Do
not put secret values in image arguments or labels. Do not paste them into
tickets. Do not keep them in deployment evidence.

Keep separate staging and production scopes for:

- `DATABASE_URL`, `MIGRATION_DATABASE_URL`, and `FORMULA_DATABASE_URL`;
- `BETTER_AUTH_SECRET`, `GITHUB_CLIENT_ID`, and `GITHUB_CLIENT_SECRET`;
- `PGRST_DB_URI` and `PGRST_JWT_SECRET`;
- future object-storage credentials when the S3 backend is implemented.

Rotate database credentials in this order: create the replacement
credential, grant the same narrow role, update the secret manager, roll the
affected service, prove readiness, then revoke the old credential. Rotate
OAuth credentials the same way where the provider permits overlap.
`BETTER_AUTH_SECRET` and `PGRST_JWT_SECRET` invalidate existing sessions or
tokens. Schedule one coordinated app and PostgREST rollout, announce the
re-authentication window, verify new authentication, then revoke the old
value. Record the rotation date, operator, secret name, affected environment,
and evidence link. Never record the value.

Rotate immediately after suspected exposure, an operator's access removal,
or a provider alert. Otherwise, review OAuth and database credentials every
90 days and the signing secrets every 180 days. The release owner tracks the
next review date in the deployment system.

## Build an immutable artifact

`Dockerfile` uses `ARG NODE_IMAGE` with a mutable default of
`node:22-alpine`. The default prevents a Dockerfile lint warning when the
file is inspected without build args. The CI workflow always overrides the
default with an immutable `@sha256` digest through `--build-arg`. The build
records the release version, source revision, and latest Drizzle journal
version as OCI metadata. The build refuses a dirty Git worktree. The
recorded revision therefore identifies the source bytes copied into the
image.

### CI workflow (GitHub Actions)

The `.github/workflows/deploy.yml` workflow runs on every push to `main`.
It does:

0. **Release gate (`verify` job, PLAT-01):** typecheck, lint, unit tests,
   database integration tests (against a service PostgreSQL with the same
   role skeleton as Compose), a production dependency audit
   (`pnpm audit --prod --audit-level=high`), and a production build must all
   pass before any image is built. A red gate blocks the release. There is no
   override switch. The API and browser contract layers (`pnpm test:api`,
   `pnpm test:browser`) need the pinned PostgREST service and run outside
   this gate. They are not claimed as CI gates here.
1. Resolve `node:22-alpine` to its immutable digest with `docker inspect`.
   The result is `node:22-alpine@sha256:<64-hex>`.
2. Set `SHEETBASE_ARTIFACT_VERSION` to the immutable commit SHA
   (`${{ github.sha }}`). Never use a mutable short SHA, branch name, or run
   number.
3. Run `pnpm artifact:build` with the resolved digest and the SHA-based
   version.
4. Push the application and PostgREST images to GHCR. Then resolve and
   publish their immutable registry digests.

The workflow does **not** run `pnpm generate-routes`. The route tree is
committed. Deployment is a separate step through SSH over Tailscale.

### Local build (for testing)

```bash
export SHEETBASE_NODE_IMAGE='node@sha256:<verified-node-image-digest>'
export SHEETBASE_ARTIFACT_VERSION='<release-version>'
export SHEETBASE_ARTIFACT_TAG='<registry>/sheetbase:<release-version>'
pnpm artifact:build
```

Publish through the approved registry workflow. Resolve its registry digest.
Use `<registry>/sheetbase@sha256:<digest>` for deployment. Never promote a
tag. The build command prints the local image ID and migration identity.
These are build evidence, not staging evidence.

The custom PostgREST image must also be published and selected by digest.
The deployment planner rejects mutable application and PostgREST references.

### Hosted surfaces today

The environment model above is the supported _contract_. The surfaces that
exist today are production (`app.sheetbase.co.uk`) and the disposable
development surface (`dev.sheetbase.co.uk`). The `deploy.yml` and
`deploy-dev.yml` triggers are currently paused, so production releases run
through the local release path (`pnpm release:local` on the VPS). Test/CI
exists as the workflow gate environment. Staging is defined but not
provisioned. It becomes real only when infrastructure evidence exists (see
"Outstanding real-environment proof"). Nothing in the application branches on
`SHEETBASE_ENV=staging` beyond the deployed-environment validation rules and
the metrics endpoint fail-closed access model.

### Configuration that varies and must not vary

- **Varies per environment:** database and PostgREST URLs, OAuth callback
  origin, secret values, storage backend location, `SHEETBASE_ENV`,
  `SHEETBASE_SECRET_SOURCE`, artifact identity values.
- **Must not vary:** the artifact (one digest is promoted; never rebuilt per
  environment), the migration set (pinned in the image), the application's
  validation rules, and the public API contract. A new environment gets new
  configuration, not new application behaviour.

## Migration strategy

Migrations are Drizzle/PostgreSQL migrations in `drizzle/`. This is the one
migration mechanism; no second path exists.

- **When:** migrations run as part of every deployment, before the new
  application starts (`migrate` one-shot service → `app` starts only after
  PostgREST is healthy → the app listens only after its own readiness
  contract succeeds).
- **Who:** the deployment controller (`scripts/deploy.ts`), never an
  operator's shell. Production deployment cannot depend on someone running
  SQL by hand. Local development uses `pnpm db:migrate`.
- **Concurrency:** the migrate runner (`scripts/migrate-once.mjs`) holds a
  PostgreSQL advisory lock for the full duration. Concurrent migrators (for
  example, a retried deploy that overlaps the first) serialise instead of
  racing on the journal. The lock is session-scoped, so a crashed migrator
  cannot block future releases.
- **Failure behaviour:** a failed migration aborts the deployment before the
  app starts. The old app container keeps serving with the old artifact
  against the old-compatible database.
- **Partially applied releases:** the readiness gate proves the exact
  artifact version, digest, and applied migration version before the rollout
  is accepted. A mismatch isolates the rejected app container.
- **Irreversible migrations:** Drizzle migrations are not reversible by
  design. Destructive schema changes need a forward-fix migration that
  restores compatibility with the previous artifact before the old artifact
  can be redeployed. Otherwise, database restore applies (see
  [`recovery.md`](recovery.md)).

## Feature flags

Deferred by decision. Sheetbase has no current deployment need: releases are
low-frequency, the development surface is disposable, and the product
direction removes superseded paths instead of gating them. Revisit only when
a concrete need exists (for example, a risky migration that needs a staged
rollout, or a tenant-visible rollout). Do not build generic flag machinery
because PLAT-01 mentions the word.

## Plan and apply

Load the non-secret release identifiers. Inject secrets from the target
environment's manager. Keep the selected application image available to the
local Docker engine before you plan. The planner reads the version,
revision, and expected migration from that immutable image's OCI labels. It
compares the migration with the latest `when` value in
`drizzle/meta/_journal.json`. It derives `SHEETBASE_ARTIFACT_DIGEST` from
`SHEETBASE_APP_IMAGE`. Operators do not give replacement version or
migration values.

```bash
pnpm deploy:plan
pnpm deploy:apply
```

The apply path runs in this order:

1. Run `drizzle-kit migrate` as a one-shot service and stop on failure.
2. Start the selected application digest only after PostgREST is healthy.
   The server does not listen until its own readiness contract succeeds.
3. Poll the public HTTPS readiness endpoint for at most 60 seconds.
4. Accept the rollout only when readiness reports the expected artifact
   version, artifact digest, and exact applied migration version.

The readiness endpoint must share the configured `BETTER_AUTH_URL` origin.
If container startup or the public readiness proof fails, the deployment
command removes the rejected application container. It then cannot receive
traffic.

The final JSON output is the minimum deployment evidence. Store it with the
release record, together with the image registry attestations and migration
logs.

## Release without GitHub Actions (`pnpm release:local`)

GitHub Actions workflows are the release path of choice when the account can
run them. If the GitHub account **cannot run Actions jobs** (GitHub-hosted
runner billing or limit blocks), release through the same controller with
`scripts/release.sh`. Run it **on the VPS** from `/opt/sheetbase`:

> **Status:** the `.github/workflows/deploy.yml` and `deploy-dev.yml`
> triggers are **paused** (their `on:` blocks are commented out) because the
> account cannot run hosted-runner jobs. The local release path below is the
> canonical release path while that is true. Uncomment the `on:` blocks to
> re-enable the Actions path when runners are available.

```bash
cd /opt/sheetbase
git fetch origin main
set -a; . ./.env.production; set +a
RELEASE_SHA=<full-40-hex-commit-sha> pnpm release:local
```

The script deliberately follows the same contract as the CI pipeline,
executed locally:

1. **Clean detached checkout** of the exact release commit (a dirty worktree
   aborts).
2. **Enforced release gate** on the VPS: typecheck, lint, unit tests,
   production dependency audit (`pnpm audit --prod --audit-level=high`),
   database tests against a **disposable PostgreSQL container** (the
   production database is never touched), and a production build. Any
   failure aborts before an image is built.
3. **Immutable artifacts without a registry:** the Node base image is
   resolved to its `@sha256` digest. The app and PostgREST images are then
   built locally and referenced as `name@sha256:<image-id>`. The Docker
   engine resolves these content-addressed references locally, so no
   registry or GitHub dependency exists. The OCI labels still carry the
   release version (= commit SHA), source revision, and expected migration.
4. `pnpm deploy:plan` and then `pnpm deploy:apply` — the same controller:
   migrate → start app → readiness verification of the exact artifact
   version, digest, and migration.

The release evidence is the controller's JSON output plus the gate log.
Store it with the release record. GitHub-hosted workflows (`deploy.yml`,
`security.yml`) remain valid when runners are available. This script makes
the release independent of their availability.

### Development surface

The disposable development surface (`dev.sheetbase.co.uk`) deploys through
`.github/workflows/deploy-dev.yml` against `compose.dev.yaml` with its
auth-free fixture environment. That workflow builds images, pushes them to
GHCR, and applies them on the development VPS at loopback port 3100 with
migrations, seed data, and a readiness poll. See `docs/dev-environment.md`.

### First deploy and Cloudflare hostname sequencing

The deployment apply path verifies **local container health** before any
public hostname serves traffic:

1. `docker compose run --rm migrate` applies migrations (one-shot, stops on
   failure). The migrate service waits for PostgreSQL's healthcheck.
2. `docker compose up -d --wait app` starts the app container only after
   PostgREST's healthcheck passes (`depends_on: service_healthy`).
3. The app container's own healthcheck polls
   `http://localhost:3000/api/health/ready`.
4. `deploy.ts` polls the public HTTPS readiness URL for at most 60 seconds.

The Cloudflare hostname (`app.sheetbase.co.uk`) is a **manual one-time
external step**. Activate it only after the local app healthcheck is green.
The tunnel routes the public hostname to the local port. It does not take
part in the deployment health sequencing. If the tunnel is active before the
app is healthy, Cloudflare returns 502 until the app passes its readiness
check.

## Clean checkout and route generation

`src/routeTree.gen.ts` is committed to the repository. The CI workflow and
`.agents/setup` do **not** run `pnpm generate-routes` when the committed file
exists. This keeps a clean checkout clean. The artifact build's
`assertCleanBuildSource` check requires this.

Regenerate and commit the route tree after you add, remove, or rename route
files:

```bash
pnpm generate-routes
git add src/routeTree.gen.ts
git commit -m "chore: regenerate route tree"
```

`.env.production` is gitignored. The secret manager injects production
secrets at deploy time. Never commit them to the repository.

## Promotion and rollback

Promote the exact staging application and PostgREST digests. Rebuilding
between environments creates a different release. Production uses a separate
secret scope and database, even when its non-secret configuration matches
staging.

Application rollback is permitted only when the previous artifact's expected
migration equals the database's current migration. If it differs, readiness
rejects the old artifact. Stop traffic and roll forward with a forward-fix
migration. Database restore is not an REL-001 rollback mechanism. Backups,
the restore procedure, restore drills, and RPO/RTO objectives are documented
in [`recovery.md`](recovery.md). They must exist before wider release.

Record the decision maker, source and target environments, artifact digests,
migration version, readiness evidence, and rollback decision for every
promotion.

## Outstanding real-environment proof

Before REL-001 can close: provision staging outside this repository, inject
real managed secrets, deploy a clean registry artifact by digest, and keep
the successful migration and readiness evidence. Local tests and a
deployment plan do not satisfy this acceptance item.

Hosted delivery covers production (`app.sheetbase.co.uk`) and the disposable
development surface (`dev.sheetbase.co.uk` through manual dispatch). Both
Actions triggers are currently paused; re-enable them when hosted runners
are available. See [`docs/dev-environment.md`](dev-environment.md) for the
auth-free development deploy.
