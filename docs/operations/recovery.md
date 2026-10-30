# Recover a populated Sheetbase database and object store

For one workspace's own export, scheduled backups and restore, see
[Workspace export and backups](workspace-export-and-backups.md). This page is
for recovering a whole deployment.

Use a replacement database and object store. Never replay a dump into the
running deployment. Application rollback is a separate procedure in
[Deployment](deployment.md#promotion-and-rollback).

## Produce a complete backup set

Inject the target's existing credentials through its approved secret source,
then run `pnpm backup:run` from the matching checkout. Do not put credentials
in command arguments or retained logs.

The producer writes a gzipped SQL dump, an object-volume archive and a
version-2 manifest under `SHEETBASE_BACKUP_DIR`, default `/opt/sheetbase/backups`.
The manifest records the set prefix, timestamps, sizes and SHA-256 hashes.
It records `permissions: preserved` because `pg_dump` retains owners, grants,
revocations and default privileges. It does not dump cluster passwords or
copy source superuser attributes.

`latest.json` advances atomically only after both streams finish and their
sizes and hashes verify. A failed producer exits non-zero. It may leave a
partial set, but never publishes that partial set as the latest success.
The directory is `0700`; backup files and reports are `0600`.

The default Docker transport reads the database container and the existing
`object-storage` volume in the selected Compose project. It refuses a missing
volume rather than creating an empty replacement. Project selection is
`SHEETBASE_COMPOSE_PROJECT`, then `COMPOSE_PROJECT_NAME`, then `sheetbase-deploy`.
`POSTGRES_USER` and `POSTGRES_DB` identify the database. Retention defaults to
14 days through `SHEETBASE_BACKUP_RETENTION_DAYS` and removes whole older sets.
Concurrent producers in one store fail closed on `.backup.lock`. After a host
crash, confirm that no producer is running before removing a stale lock.

`SHEETBASE_BACKUP_INCLUDE_OBJECTS=false` is available for explicit database-only
diagnostics. Such sets are not accepted by deployment, the full drill or the
recovery monitor. Old no-owner/no-ACL sets are not version-2 recovery evidence.
Make a new complete backup instead of relabelling an old manifest.

For a local PostgreSQL and a temporary object store, set
`SHEETBASE_BACKUP_LOCAL=true` and `SHEETBASE_BACKUP_OBJECT_DIR` to the store.
The producer then uses `pg_dump` with the standard libpq environment, including
`PGHOST`, `PGPORT`, `PGPASSWORD` or a protected password file. This is a test
transport, not evidence that Docker volumes have been restored.

## Require a backup before migration

`pnpm deploy:plan` remains read-only. `pnpm deploy:apply` runs the producer,
requires a fresh manifest from that invocation, verifies both artifact hashes,
then starts the migration service. A failed or incomplete backup prevents
migration and rollout. The controller forces the Docker transport and object
archive on this path. Neither local-mode nor database-only environment settings
bypass the gate.

Both `scripts/release.sh` and the deliberate manual deployment path call this
controller. This change does not dispatch a deployment or alter its approval
contract. Keep the pre-existing database container and object volume available
before applying, including during first-install preparation. There is no
"skip backup" override for an existing deployment.

A SQL snapshot and a tar archive are not an atomic cross-store snapshot.
Before taking a recovery set, arrange an approved write/cleanup pause or prove
that immutable keys referenced by the SQL snapshot remain retained until the
archive finishes. The repository does not stop shared traffic or storage
cleanup automatically. A backup gate alone does not prove that operational
coordination or off-host durability exists.

## Run the populated restore drill

Run the drill from the matching, reviewed checkout against a trusted set:

```bash
pnpm backup:restore-drill -- \
  --manifest backups/sheetbase-20260828T030000Z-manifest.json \
  --self-test
```

The manifest selects both artifacts from its own directory. `--dump` is a
shorthand that derives the matching manifest name. Independent `--objects`
paths are no longer accepted. The drill rejects invalid hashes, incomplete
sets and invalid gzip before restoring. The manifest is an integrity check,
not an authenticated signature. An attacker who can replace the dump and
manifest controls the SQL. Protect backups and run drills only on isolated,
trusted hosts with no production secrets.

The default drill starts a uniquely named disposable PostgreSQL container.
It bootstraps `docker/db/init/00-roles.sh` in the administrative database,
including the pipeline sandbox password. It then creates a separate empty
database owned by `migrator`. Bootstrapping inside the restore database would
pre-create `api` and collide with the dump's schema creation.

The canonical bootstrap reconstructs request, migration, formula and sandbox
roles. A source bootstrap identity not in that skeleton is recreated as
`NOLOGIN NOSUPERUSER NOBYPASSRLS`, not as a copy of the source administrator.
Unknown custom owners or grantees cause restore to fail. Review and provision
any such identities explicitly with their required privileges. Do not add
superuser grants to make a restore pass.

The drill restores with `ON_ERROR_STOP`, checks migration bookkeeping, tables,
RPCs, RLS flags, migrator ownership, request grants and unprivileged roles.
It opens a separate **authenticator login** to exercise request-role access:

- An owner reads an existing record and creates a project inside a rolled-back transaction.
- A viewer reads an explicitly shared record but cannot update it.
- The owner's claims switched to a workspace they do not belong to cannot read that record or create a project there.

This full drill needs representative populated witnesses: two workspaces, an
owner-led record, and an active viewer with explicit project View. Private
draft experiments are not viewer witnesses. Missing witnesses fail with an
evidence gap; an empty migrated database is not reported as populated recovery.
Do not add actors or weaken permissions in production just to satisfy a drill.
Use an approved populated rehearsal set when production lacks these cases.

The drill creates its extraction directory and rejects archive traversal,
links and special files. Every active `api.file_objects` row and every frozen
`internal.revision_file_objects` reference must have a regular file with the
same size and SHA-256. A missing checksum is a failure. Deleted live objects
without frozen references do not require bytes. Extra archive files are allowed.
The `--self-test` control proves truncated-gzip detection. The regression suite
also proves detection of same-size attachment changes after an archive hash
has been recomputed, and of lost restored SELECT permissions.

Use `--local` in an orb without Docker. Put the PostgreSQL 18 tools, including
`initdb`, `pg_ctl`, `psql` and `pg_dump`, on `PATH`. This mode starts a fresh
cluster under a private temporary directory with Unix-socket-only connections.
It does not restore into the orb's existing database. Both modes clean up their
own replacement by default. `--keep` retains it for inspection and prints its
location; the operator must stop and remove the retained replacement afterwards.

The last result is written atomically to `restore-drill.json` beside the set,
or to `SHEETBASE_DRILL_REPORT_PATH`. Failures write `ok: false`; non-zero exits
cannot leave a prior success looking current when the report path is writable.
Retain the JSON verification output with the selected manifest and release record.

## Detect missing and stale evidence

An operator must schedule `node --import tsx scripts/recovery-check.ts` separately
from backups and drills. Configure these positive limits in seconds from the
approved operational policy. The repository supplies no RPO or RTO defaults:

- `SHEETBASE_BACKUP_MAX_AGE_SECONDS`
- `SHEETBASE_DRILL_MAX_AGE_SECONDS`
- `SHEETBASE_RECOVERY_CHECK_MAX_AGE_SECONDS`, the monitor heartbeat limit

Also set `SHEETBASE_BACKUP_DIR`, `SHEETBASE_READINESS_URL` and
`SHEETBASE_METRICS_TEXTFILE_DIR`. Set `SHEETBASE_DRILL_REPORT_PATH` if the report
does not live in the backup directory. Use the deployed readiness URL ending
in `/api/health/ready`, not `/api/metrics`. The checker verifies the complete
latest set, the age and status of the last drill, and HTTP readiness with
compatible migrations. Missing files, failed runs, corrupt sets, future dates,
stale evidence, invalid JSON and readiness failures produce unhealthy gauges
and a non-zero exit.

The checker atomically writes `sheetbase_recovery.prom` as `0644` in a dedicated
collector directory. Do not expose the private backup directory to a scraper.
The rules in `deploy/alerts.yml` detect unhealthy or absent gauges and a stale
checker heartbeat, even if the last readiness result was green. Scope the rules
to each deployment's collector. A fleet needs expected-target labels so that
one healthy deployment cannot hide a missing deployment's series.

The checker reads and hashes the full set. Choose its cadence with backup
size and storage I/O in mind. A fresh successful drill proves its selected
set, not every later nightly set. Alert delivery, scheduling and scrape access
are external configuration, not established by committing these rules.

## Complete the operator handoff before reconnecting traffic

The operator and release owner still need to approve and record:

1. The off-host destination, separate failure domain, access roles, encryption
   key custody, copy verification and deletion/retention policy. Do not send
   their credentials to an agent or put them in the repository.
2. Backup/drill schedules, alert-age limits, the monitored targets, on-call
   recipients and a test alert that reaches those recipients.
3. RPO and RTO based on accepted data-loss and outage limits. The old runbook's
   initial numbers are not acceptance evidence or newly approved objectives.
4. A coordinated write/cleanup pause or verified immutable-byte retention
   during backup, plus the permissions needed for the replacement services.
5. A populated Docker restore with the real storage backend, compatible
   artifact, PostgREST and application. Prove `/api/health/ready`, sign-in,
   frozen results and attachment downloads before switching traffic.
6. A recovery from the off-host copy with measured elapsed time and an
   approved traffic switch. On-host copies cannot survive loss of their VPS.

Nothing in this runbook authorises shared-host changes or deployment. The
repository regression runs against real local PostgreSQL and temporary stores;
it does not certify a Docker restore, off-host recovery or production readiness.

## Reproduce repository acceptance

The database regression needs the PostgreSQL 18 server and client tools on
the test host (`pg_config --bindir` must locate `initdb`, `pg_ctl`, `psql` and
`pg_dump`). A Docker-only database service does not supply those host tools.

```bash
pnpm exec vitest run --config vitest.db.config.ts tests/db/restore-verification.test.ts --maxWorkers=1
pnpm exec vitest run scripts/recovery-check.test.ts tests/config/deployment.test.ts tests/config/plat-02.test.ts src/lib/backup.test.ts src/lib/deployment-plan.test.ts
promtool check rules deploy/alerts.yml
promtool test rules deploy/alerts.test.yml
```

The populated regression runs the real producer and local drill, checks a
frozen numeric result of `-7.5`, reads the version list through the restored
request role and compares extracted attachment bytes. It also exercises
permissions and tamper controls. Deployment tests substitute only the Docker
transport to prove the pre-migration ordering and failure gate. Recovery-check
tests use a local HTTP server for healthy and failing readiness responses.
The Prometheus rule tests cover missing evidence, healthy probes, unhealthy
probes and a stale monitor heartbeat. Their synthetic age values are test
inputs, not an operational policy.
