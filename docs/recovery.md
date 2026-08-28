# Recovery: backups, restore and disaster recovery

PLAT-01. A backup is incomplete until restore is proven. This document is the
canonical reference for what Sheetbase backs up, how a restore works, how
restore is proven, and the recovery objectives. Deployment rollback is a
different mechanism and is documented in
[`deployment.md`](deployment.md#promotion-and-rollback).

## What state matters

Sheetbase has exactly two durable state surfaces:

| Surface        | Contents                                                                                                                        | Backed up by                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| PostgreSQL     | All domain data: workspaces, records, datasets, sheets, revisions, evidence, file metadata, connector runs, audit/change events | `pg_dump` (plain SQL, gzipped) |
| Object storage | File bytes referenced by `api.file_objects`                                                                                     | volume tar archive             |

Everything else (images, code, configuration templates, PostgREST) is
reproducible from the immutable artifact; only these two surfaces need
backup.

## Backup policy

| Aspect             | Policy                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------- |
| What               | Full logical `pg_dump` of the database + full object-storage archive                     |
| Frequency          | Nightly cron on the VPS, plus a run before every deployment                              |
| Retention          | 14 days of backup sets (whole sets pruned, never a lone dump)                            |
| Location           | `/opt/sheetbase/backups` on the VPS                                                      |
| Encryption         | At rest by the VPS disk; see note below                                                  |
| Failure visibility | Script exits non-zero and emits a JSON error line; `latest.json` age exposes missed runs |

Each run produces one **backup set** sharing a timestamp prefix:

```text
sheetbase-20260828T030000Z-db.sql.gz      # PostgreSQL, gzip
sheetbase-20260828T030000Z-objects.tar.gz # object-storage volume
sheetbase-20260828T030000Z-manifest.json  # sizes, sha256 checksums, duration
latest.json                               # pointer to the newest successful set
```

The manifest checksums make silent corruption detectable before a restore is
attempted. The age of `latest.json` against the nightly schedule is the
missed-backup signal.

Run a backup manually:

```bash
cd /opt/sheetbase
set -a; . ./.env.production; set +a
pnpm backup:run
```

Configuration: `SHEETBASE_COMPOSE_PROJECT` (default `sheetbase-deploy`),
`SHEETBASE_BACKUP_DIR` (default `/opt/sheetbase/backups`),
`SHEETBASE_BACKUP_RETENTION_DAYS` (default `14`),
`SHEETBASE_BACKUP_INCLUDE_OBJECTS` (set `false` to skip the storage archive).

**Encryption note:** backups live on the same encrypted-at-rest VPS volume as
the live database, so the transport and at-rest protections are identical to
the primary. Dedicated backup encryption (separate key, off-host copy) is
PLAT-03 work and is deliberately not duplicated here. Until an off-VPS copy
exists, a VPS-volume loss destroys both primary and backups; that limitation
is reflected in the RPO/RTO assumptions below.

## Restore procedure

Restore is always performed into a _replacement_ database/container, never
in place against the running deployment:

1. Stop the app container (keep PostgreSQL) or provision a fresh PostgreSQL
   container.
2. Create an empty database and bootstrap the role skeleton
   (`docker/db/init/00-roles.sh`) — production roles are created at container
   init, not by migrations, and restored function bodies reference them.
3. Restore:
   `gunzip -dc <set>-db.sql.gz | psql -v ON_ERROR_STOP=1 -d <db>`
4. Verify with the drill checks (below) before pointing the app at it.
5. Restart the app container; `/api/health/ready` must report migration
   compatibility before traffic resumes.

## Restore drill (proof)

`pnpm backup:restore-drill` proves a backup recreates **usable Sheetbase
state**, not merely that a file exists:

```bash
pnpm backup:restore-drill -- \
  --dump  backups/sheetbase-20260828T030000Z-db.sql.gz \
  --objects backups/sheetbase-20260828T030000Z-objects.tar.gz \
  --self-test
```

The drill:

1. Rejects truncated/corrupt gzip immediately (`--self-test` proves this by
   truncating a copy and requiring the drill to fail).
2. Restores the dump into a **disposable** PostgreSQL container (never the
   active development or production database), bootstrapping the same role
   skeleton production uses.
3. Verifies the restored state (`src/lib/restore-verification.ts`):
   migration journal applied, every core domain table present, RLS enabled
   on them, core RPC surface present, row counts reported.
4. When an object archive is supplied, verifies every active
   `file_objects` row has matching bytes of matching size in the archive.
5. Exits non-zero on any failed check.

Evidence from a passing drill (restored 99 tables, empty test workspace set):

```json
{"message":"restore drill passed","verification":{"ok":true,"counts":{...}}}
```

Run the drill after every backup-configuration change and periodically
(monthly is the initial objective) against the newest nightly set.

## Recovery objectives (initial, evidence-based)

These are initial engineering objectives for a single-VPS deployment, not
contractual guarantees. They are revised when operational evidence exists.

| Objective | Target                                                                      | Assumptions                                                                                                                                       |
| --------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RPO**   | ≤ 24 h (nightly backup) + pre-deploy backup reduces release-window exposure | Single VPS; no WAL archiving/PITR yet. Accepting up to one day of data loss is a deliberate trade-off until usage justifies continuous archiving. |
| **RTO**   | ≤ 4 h                                                                       | One competent engineer, runbook available, backups on-host. Dominated by restore + verification (~minutes) and operator response time.            |

Escalation path when these objectives become insufficient: off-VPS backup
copies, WAL archiving for point-in-time recovery, and automated drills.
Those require evidence of real usage before they are built.

## Rollback vs restore

| Situation                                                                                          | Mechanism                                                                                                                          | Reference       |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| New app artifact misbehaves, schema unchanged or old artifact's expected migration matches applied | Application rollback (redeploy previous `@sha256` digest)                                                                          | `deployment.md` |
| Migration applied but incompatible with old artifact                                               | Forward-fix migration (new migration that restores compatibility); rollback of the artifact alone will fail its own readiness gate | `deployment.md` |
| Data corrupted/lost (bad release, operator error, storage failure)                                 | Database **restore** from backup set into replacement, then redeploy compatible artifact                                           | this document   |
