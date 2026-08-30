# Migration workflow

PostgreSQL is the source of truth. Every durable schema change arrives as a
reviewed migration. Nobody hand-edits a shared database.

## Rules

1. Make one migration per logical change. Do not batch unrelated changes.
2. Never edit a migration that has been applied anywhere. "Applied anywhere"
   includes any developer database, CI, and staging. Make a new migration
   that moves the schema forward.
3. Declare the schema in `src/db/schema.ts` (Drizzle). Put raw SQL in
   migrations only when Drizzle cannot express it (roles, RLS policies,
   grants, functions). Add this SQL through `drizzle-kit generate --custom`
   and keep it in the same migration sequence.
4. Every migration must apply cleanly to an empty database. The
   fresh-database check below is part of done, not optional.
5. Migrations run as an explicit step (`pnpm db:migrate`). They never run at
   application start.

## Normal flow

```bash
# 1. Edit src/db/schema.ts

# 2. Generate the migration
pnpm db:generate

# 3. Review the generated SQL in drizzle/ — every line.
#    Check types, constraints, indexes, and unintended drops.
#    Check for data loss on existing columns. Regenerate if it is wrong.

# 4. Apply the migration to your local database
pnpm db:migrate

# 5. Verify against a fresh database (below)

# 6. Commit the schema and the migration together
```

## Verify against a fresh database

A migration is proven only when it applies to an empty database:

```bash
# Destroy and recreate the local data volume (local only — read the
# reset notes in docs/seeds.md before you do this with data you care about)
pnpm services:purge
pnpm services:up

# Apply the full migration history from scratch
pnpm db:migrate

# Confirm the schema matches the migration history
pnpm db:generate   # must produce no new migration
```

If the last step generates a new migration, the committed history and the
declared schema disagree. Fix the mismatch before you complete the ticket.

## Snapshots

`pnpm db:migrate` applies `_journal.json` plus `{tag}.sql`. It does not read
`drizzle/meta/*_snapshot.json`.

`pnpm db:generate` diffs `src/db/schema.ts` against the **latest** snapshot.
Kit writes a full-database JSON file on each generate. Intermediate snapshots
are optional copies, not runtime history.

This repository:

- commits the SQL for every journal entry (required);
- commits `_journal.json` (required);
- keeps a sparse snapshot chain: historical pre-CORE files through `0023`,
  the last CORE generate at `0087`, the checkpoint `0110_snapshot.json`, and
  recent generates `0148_snapshot.json` and `0149_snapshot.json`;
- does **not** keep a snapshot for every custom SQL migration
  (`0088`–`0147`).

`0110_core_schema_snapshot_checkpoint.sql` is a no-op. It keeps the journal
and the current generate baseline aligned after CORE custom SQL that Kit did
not snapshot. Do not replace it with `CREATE TABLE` for objects those
migrations already created.

When `schema.ts` changes, run `pnpm db:generate` as usual. The new snapshot
chains from the latest snapshot, currently `0149`.

## Rollback and recovery

Drizzle migrations are forward-only. For any migration that drops or
transforms data, record the recovery path in the ticket or the decision log.
The recovery path is either a companion migration that restores the prior
shape, or the backup restore procedure. Destructive migrations without a
recorded recovery note do not merge.

## Environment

`MIGRATION_DATABASE_URL` comes from `.env.local` (see `.env.example`).
`drizzle-kit` prefers `MIGRATION_DATABASE_URL`. It falls back to
`DATABASE_URL`. Check the value before you run destructive verification steps.
