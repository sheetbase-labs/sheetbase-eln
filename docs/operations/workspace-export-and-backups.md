# Workspace export and backups

A workspace administrator can take everything the workspace holds with them,
and the server keeps scheduled copies. Both produce the same archive, so
there is one thing to understand and one way to restore.

Open **Settings → Backups and export**. Who may open it is chosen under
Members and roles (admins by default).

## The archive

One ZIP file. Nothing in it needs Sheetbase to read.

| Part                             | Contents                                                         |
| -------------------------------- | ---------------------------------------------------------------- |
| `data/<schema>.<table>.ndjson`   | Every row the workspace owns, one JSON document per line.        |
| `files/<workspace>/<file>/<key>` | The bytes of every uploaded file.                                |
| `manifest.json`                  | Counts, a SHA-256 for every part, and what was left out and why. |
| `README.txt`                     | A short description of the layout.                               |

The audit trail (`api.change_events`, with its hash chain), signed revisions,
records, notebooks, datasets, samples, settings and members' names and email
addresses are all in `data/`. Which rows belong to the workspace is worked out
from the database's own foreign keys, so a table added later is exported the day
it exists.

**Never in an archive:** password hashes, sign-in sessions, two-factor secrets,
API key hashes, webhook secrets, connector secrets and invitation tokens. The
manifest lists the tables skipped and the columns dropped.

All rows are read in one repeatable-read transaction, so they agree with each
other. Files are immutable once stored and are read straight afterwards. A file
whose bytes cannot be found in storage is listed in the manifest as `missing`;
a file whose bytes no longer match the hash recorded at upload is listed as
`checksum_mismatch`. The archive is streamed: memory use does not grow with the
size of the workspace.

## Downloading

**Download export** on the page (or `GET /api/export/workspace` while signed in)
makes a fresh archive and streams it. Each download is recorded in the export
receipts (`api.data_exports`, type `workspace`).

## Scheduled backups

Each workspace chooses on the page: on or off, every day or every week, and how
many copies to keep (1 to 90). Until it chooses, a workspace gets a daily backup
and keeps seven. The server checks hourly; one run per workspace at a time (a
second replica simply skips). After a failure it waits six hours before trying
again. Each run, good or failed, is listed on the page with its size, hash and
what it holds, and **Back up now** makes one on demand. Older copies beyond the
limit are deleted, and failed attempts are kept for 30 days.

Diagnostics shows the same: up to date, out of date, failed (with the reason),
or "same database" when copies sit with the data.

### Where copies are written

By default, wherever files are kept (`FILE_STORAGE_BACKEND`): the database, an
S3-compatible service or the server's disk. **A copy stored in the same
database as the data protects against mistakes, not against losing the
database.** To protect against that, point backups at a separate bucket, on any
S3-compatible service and ideally another account or provider:

```
SHEETBASE_BACKUP_S3_BUCKET=sheetbase-backups
SHEETBASE_BACKUP_S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com   # not needed for AWS
SHEETBASE_BACKUP_S3_REGION=auto                                           # us-east-1 by default
SHEETBASE_BACKUP_S3_ACCESS_KEY_ID=...
SHEETBASE_BACKUP_S3_SECRET_ACCESS_KEY=...
SHEETBASE_BACKUP_S3_PREFIX=                                               # optional folder
```

Use a key that can write and delete in that bucket only. This works the same on
any host; nothing here is specific to one provider. Set
`SHEETBASE_SCHEDULER_ENABLED=false` on a replica that should not run backups.

These archives are independent of the operator-level tools in
[Recovery](recovery.md), which dump the whole database and object store with
`pg_dump`. Use those to recover a whole deployment; use an archive to move or
rehearse one workspace, or to keep your data in a form anyone can read.

## Restoring

Restore into an **empty database migrated to the same version**, using the
database login that owns it (restoring switches triggers off for one
transaction, which needs a superuser; the audit trail and signatures arrive
exactly as written and are not recorded again).

```
pnpm workspace:restore --file sheetbase-lab-20261030.zip --dry-run   # check hashes, change nothing
pnpm workspace:restore --file sheetbase-lab-20261030.zip
```

The restore:

1. unpacks the archive to a temporary folder and checks every part against the
   manifest, refusing a changed archive or a path that leaves the folder;
2. writes the files to the configured storage (skipping any already there);
3. inserts every table in one transaction, so a failure leaves the database
   unchanged;
4. refuses if the workspace already exists.

Tables that depend on a secret (API keys, webhook secrets, invitation tokens)
are skipped and named in the report: create them again. People sign in again
through whatever sign-in the deployment uses; their accounts are restored by
name and email.

After restoring, run `pnpm audit:verify` to check the audit trail and signed
revisions came back intact.
