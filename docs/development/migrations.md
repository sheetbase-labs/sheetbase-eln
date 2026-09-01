# Migration workflow

PostgreSQL is authoritative. Every durable schema change arrives as a reviewed
migration; nobody hand-edits a shared database.

## Rules

1. One migration per logical change. Do not batch unrelated changes.
2. Never edit a migration that has been applied anywhere (any developer's
   database, CI, staging). Make a new migration that moves the schema forward.
3. Schema is declared in `src/db/schema.ts` (Drizzle). Raw SQL belongs in
   migrations only when Drizzle cannot express it (roles, RLS policies,
   grants, functions). Add such SQL through `drizzle-kit generate --custom`
   and keep it in the same migration sequence.
4. Every migration must apply cleanly to an empty database. The fresh-database
   check below is part of done, not an optional extra.
5. Migrations run as an explicit step (`pnpm db:migrate`), never implicitly at
   application start.

## Normal flow

```bash
# 1. Edit src/db/schema.ts

# 2. Generate the migration
pnpm db:generate

# 3. Review the generated SQL in drizzle/ — every line.
#    Check: correct types, constraints, indexes, no unintended drops,
#    no data loss on existing columns. Regenerate if it is wrong.

# 4. Apply to your local database
pnpm db:migrate

# 5. Verify from a fresh database (below)

# 6. Commit schema and migration together
```

## Fresh-database verification

A migration is only proven when it applies to an empty database:

```bash
# Destroy and recreate the local data volume (local only — see
# docs/development/seeds.md reset notes before doing this with data you care about)
pnpm services:purge
pnpm services:up

# Apply the full migration history from scratch
pnpm db:migrate

# Confirm the schema matches the migration history
pnpm db:generate   # must produce no new migration
```

If step 6 generates a new migration, the committed history and the declared
schema disagree. Fix before marking the ticket complete.

## Snapshots

`pnpm db:migrate` applies `_journal.json` plus `{tag}.sql`. It does not read
`drizzle/meta/*_snapshot.json`.

`pnpm db:generate` diffs `src/db/schema.ts` against the **latest** snapshot.
Kit writes a full-database JSON file on each generate, so intermediate
snapshots are optional copies, not runtime history.

This repository:

- commits SQL for every journal entry (required);
- commits `_journal.json` (required);
- keeps a sparse snapshot chain: historical pre-CORE files through `0023`,
  the last Kit generate at `0087`, and the current schema checkpoint
  `0110_snapshot.json`;
- does **not** keep a snapshot per custom SQL migration (`0088`–`0109`).

`0110_core_schema_snapshot_checkpoint.sql` is a no-op. It exists so the
journal and the current generate baseline stay aligned after CORE custom SQL
that Kit did not snapshot. Do not replace it with `CREATE TABLE` for objects
those migrations already created.

When `schema.ts` changes, run `pnpm db:generate` as usual. The new snapshot
will chain from `0110`.

## Rollback and recovery notes

Drizzle migrations are forward-only. For any migration that drops or
transforms data, record the recovery path in the ticket or the decision log:
either a companion migration that restores the prior shape, or the backup
restore procedure. Destructive migrations without a recorded recovery note do
not merge.

## Environment

`DATABASE_URL` comes from `.env.local` (see `.env.example`). Migrations run
against whatever `DATABASE_URL` points at — check it before running
destructive verification steps.
