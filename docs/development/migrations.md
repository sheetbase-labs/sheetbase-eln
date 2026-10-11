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

# 2. Prepare the migration. Plain `pnpm db:generate` cannot diff here - there is no
#    committed snapshot baseline - so it emits a full-schema migration. Use --custom
#    and write the SQL, or let Drizzle write it and then delete the unrelated bulk.
pnpm db:generate --custom --name <change>

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

# Confirm the history applies to an empty database. This is the check that matters:
# every migration runs in order with no error. Do not use plain `pnpm db:generate`
# here - with no committed snapshot it always reports a full-schema migration.
pnpm test:db
```

The database test layer builds a fresh template by replaying the whole journal,
so a green `pnpm test:db` proves the history applies cleanly. If a migration
errors, the history and the declared schema disagree. Fix before marking the
ticket complete.

## Snapshots

`pnpm db:migrate` applies `_journal.json` plus `{tag}.sql`. It does not read
`drizzle/meta/*_snapshot.json`.

`pnpm db:generate` diffs `src/db/schema.ts` against the **latest** snapshot.
Kit writes a full-database JSON file on each generate, so each snapshot is a
complete schema dump that grows with the schema — the 270 files once committed
here came to 203 MB and 6.8M lines.

This repository:

- commits SQL for every journal entry (required);
- commits `_journal.json` (required);
- does **not** commit snapshots at all (`drizzle/meta/*_snapshot.json` is
  gitignored). Kit writes them locally on each generate; they are working
  state, not history.

**Consequence, and the reason for the rule above.** With no committed
snapshot, `pnpm db:generate` has no baseline to diff against and emits a
_full-schema_ migration describing the entire database. That is not a usable
migration. It was also true before the snapshots were removed: they had drifted
far behind `src/db/schema.ts` (271 snapshots for 420 journal entries, because
the `--custom` migrations never wrote one), so `generate` emitted a full-schema
migration even with all of them present.

**So schema changes take the custom path**, which needs no snapshot at all:

```bash
# 1. Edit src/db/schema.ts for anything Drizzle can express,
#    or write the change as SQL directly.

# 2. Prepare an empty migration and write the SQL by hand
pnpm db:generate --custom --name <change>

# 3. Review every line, then apply and verify as in the normal flow
pnpm db:migrate
```

Do not run plain `pnpm db:generate` expecting a diff, and do not treat its
output as a migration. The check the normal flow relies on is `pnpm test:db`
replaying the whole journal against an empty database, not the old "must
produce no new migration" rule, which the absent baseline makes meaningless.

`0110_core_schema_snapshot_checkpoint.sql` is a no-op kept for the migration
sequence. Do not replace it with `CREATE TABLE` for objects those migrations
already created.

## Never apply a migration by hand

Drizzle's migrator applies only the journal entries whose `when` is **newer than
the newest `created_at` recorded in `drizzle.__drizzle_migrations`**. Applying a
later migration manually (correctly, even) advances that watermark, so the next
`pnpm db:migrate` reports success while applying **nothing** and every earlier
pending migration stays unapplied. The database then drifts silently and features
fail with `column ... does not exist` from PostgREST rather than a migration
error — this cost an afternoon on 11 October 2026, when a hand-applied `0430` left
`0424`'s `api.instruments.intake_method` missing and the instrument registry
returning HTTP 400 with the ledger showing 386 of 429 entries.

Use `pnpm db:migrate` (or `pnpm db:generate --custom` for a new migration) and
let the migrator own the ledger. If the ledger has already been advanced out of
order, the repair is `pnpm db:fresh` — a reset that replays the whole history.

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
