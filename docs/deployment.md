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
secret source is `secret-manager`, and artifact plus migration identities are
immutable. Before it listens, the production adapter also runs the readiness
contract against the target database, so an incompatible artifact cannot serve
traffic. Development keeps explicit `local`/`untracked` defaults.

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

`Dockerfile` has no default base image. The caller must supply a Node image by
digest, and the build records the release version, source revision, and latest
Drizzle journal version as OCI metadata. The build refuses a dirty Git worktree,
so the recorded revision identifies the source bytes copied into the image.

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

1. Run `drizzle-kit migrate` as a one-shot service and stop on failure.
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

## Promotion and rollback

Promote the exact staging application and PostgREST digests; rebuilding between
environments creates a different release. Production uses a separate secret
scope and database even when its non-secret configuration matches staging.

Application rollback is permitted only when the previous artifact's expected
migration equals the database's current migration. If it differs, readiness will
reject the old artifact, so stop traffic and roll forward. Database restore is
not an REL-001 rollback mechanism; backup and restore rehearsal belongs to
REL-002 and must exist before wider release.

Record the decision maker, source and target environments, artifact digests,
migration version, readiness evidence, and rollback decision for every promotion.

## Outstanding real-environment proof

Before REL-001 can close, provision staging outside this repository, inject real
managed secrets, deploy a clean registry artifact by digest, and retain the
successful migration and readiness evidence. Local tests and a deployment plan
do not satisfy that acceptance item.
