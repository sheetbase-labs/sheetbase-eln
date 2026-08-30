# Recovery: backups, restore and disaster recovery

PLAT-01. A backup is incomplete until restore is proven. This document is
the canonical reference for what Sheetbase backs up, how a restore works,
how restore is proven, and the recovery objectives. Deployment rollback is a
different mechanism; see
[`deployment.md`](deployment.md#promotion-and-rollback).

## Which state matters

Sheetbase has exactly two durable state surfaces:

| Surface        | Contents                                                                                                                        | Backed up by                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| PostgreSQL     | All domain data: workspaces, records, datasets, sheets, revisions, evidence, file metadata, connector runs, audit/change events | `pg_dump` (plain SQL, gzipped) |
| Object storage | File bytes referenced by `api.file_objects`                                                                                     | volume tar archive             |

Everything else (images, code, configuration templates, PostgREST) is
reproducible from the immutable artifact. Only these two surfaces need
backup.

## Backup policy

| Aspect             | Policy                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------- |
| What               | Full logical `pg_dump` of the database + full object-storage archive                     |
| Frequency          | Nightly cron on the VPS, plus a run before every deployment                              |
| Retention          | 14 days of backup sets (whole sets pruned, never one lone dump)                          |
| Location           | `/opt/sheetbase/backups` on the VPS                                                      |
| Encryption         | At rest by the VPS disk; see the note below                                              |
| Failure visibility | Script exits non-zero and emits a JSON error line; `latest.json` age exposes missed runs |

Each run produces one **backup set** with a shared timestamp prefix:

```text
sheetbase-20260828T030000Z-db.sql.gz      # PostgreSQL, gzip
sheetbase-20260828T030000Z-objects.tar.gz # object-storage volume
sheetbase-20260828T030000Z-manifest.json  # sizes, sha256 checksums, duration
latest.json                               # pointer to the newest successful set
```

The manifest checksums make silent corruption detectable before a restore
attempt. The age of `latest.json` against the nightly schedule is the
missed-backup signal.

Run a backup manually:

```bash
cd /opt/sheetbase
set -a; . ./.env.production; set +a
pnpm backup:run
```

Configuration:

| Variable                              | Default                  | Purpose                            |
| ------------------------------------- | ------------------------ | ---------------------------------- |
| `SHEETBASE_COMPOSE_PROJECT`           | `sheetbase-deploy`       | Compose project name               |
| `SHEETBASE_BACKUP_DIR`                | `/opt/sheetbase/backups` | Backup directory                   |
| `SHEETBASE_BACKUP_RETENTION_DAYS`     | `14`                     | Days of backup sets to keep        |
| `SHEETBASE_BACKUP_INCLUDE_OBJECTS`    | —                        | Set `false` to skip the storage archive |

**File permissions:** the backup runner creates the backup directory `0700`
and every dump, archive, and manifest `0600`. Only the file owner reads
backups. Backups contain the entire scientific record.

**Encryption note:** backups live on the same encrypted-at-rest VPS volume
as the live database. Transport and at-rest protections are identical to the
primary. Dedicated backup encryption (separate key, off-host copy) is PLAT-03
work and is not duplicated here. Until an off-VPS copy exists, loss of the
VPS volume destroys both primary and backups. The RPO/RTO assumptions below
reflect this limitation.

## Restore procedure

Do not restore in place against the running deployment. Always restore into
a _replacement_ database or container:

1. Stop the app container (keep PostgreSQL) or provision a fresh PostgreSQL
   container.
2. Create an empty database and bootstrap the role skeleton
   (`docker/db/init/00-roles.sh`). Production roles are created at container
   init, not by migrations. Restored function bodies reference them.
3. Restore:
   `gunzip -dc <set>-db.sql.gz | psql -v ON_ERROR_STOP=1 -d <db>`
4. Run the drill checks (below) before you point the app at the database.
5. Restart the app container. `/api/health/ready` must report migration
   compatibility before traffic resumes.

## Restore drill (proof)

`pnpm backup:restore-drill` proves a backup recreates **usable Sheetbase
state**, not only that a file exists:

```bash
pnpm backup:restore-drill -- \
  --dump  backups/sheetbase-20260828T030000Z-db.sql.gz \
  --objects backups/sheetbase-20260828T030000Z-objects.tar.gz \
  --self-test
```

The drill:

1. Rejects truncated or corrupt gzip immediately (`--self-test` proves this
   by truncating a copy and requiring the drill to fail).
2. Restores the dump into a **disposable** PostgreSQL container (never the
   active development or production database). It bootstraps the same role
   skeleton that production uses.
3. Verifies the restored state (`src/lib/restore-verification.ts`):
   migration journal applied, every core domain table present, RLS enabled
   on them, core RPC surface present, row counts reported.
4. When an object archive is supplied, verifies that every active
   `file_objects` row has matching bytes of matching size in the archive.
5. Exits non-zero when any check fails.

Evidence from a passing drill (99 restored tables, empty test workspace
set):

```json
{"message":"restore drill passed","verification":{"ok":true,"counts":{...}}}
```

Run the drill after every backup-configuration change. Also run it
periodically (monthly is the initial objective) against the newest nightly
set.

## Recovery objectives (initial, evidence-based)

These are initial engineering objectives for a single-VPS deployment. They
are not contractual guarantees. They are revised when operational evidence
exists.

| Objective | Target                                                                      | Assumptions                                                                                                                                       |
| --------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RPO**   | ≤ 24 h (nightly backup) + pre-deploy backup reduces release-window exposure | Single VPS; no WAL archiving/PITR yet. Accepting up to one day of data loss is a deliberate trade-off until usage justifies continuous archiving. |
| **RTO**   | ≤ 4 h                                                                       | One competent engineer, runbook available, backups on-host. Dominated by restore + verification (~minutes) and operator response time.            |

When these objectives become insufficient, the escalation path is: off-VPS
backup copies, WAL archiving for point-in-time recovery, and automated
drills. Build these only when evidence of real usage exists.

## Rollback vs restore

| Situation                                                                                          | Mechanism                                                                                                                          | Reference       |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| New app artifact misbehaves, schema unchanged or old artifact's expected migration matches applied | Application rollback (redeploy previous `@sha256` digest)                                                                          | `deployment.md` |
| Migration applied but incompatible with old artifact                                               | Forward-fix migration (new migration that restores compatibility); rollback of the artifact alone will fail its own readiness gate | `deployment.md` |
| Data corrupted/lost (bad release, operator error, storage failure)                                 | Database **restore** from backup set into replacement, then redeploy compatible artifact                                           | this document   |
