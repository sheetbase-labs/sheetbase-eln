# Migration workflow

PostgreSQL is authoritative. Every durable schema change arrives as a reviewed
migration; nobody hand-edits a shared database.

## Baseline

`drizzle/0000_baseline.sql` is the schema and seed data of the first 574
migrations (0000 to 0573), squashed in October 2026 while there were no live
users or databases. Comments in the code that cite "former migration NNNN"
point at that history: `git log --diff-filter=D --name-only -- drizzle` on the
commit before the squash lists the old files, and `git show <commit>^:drizzle/<file>`
reads one. Databases created before the squash cannot be upgraded in place;
recreate them with `pnpm db:fresh`.

To re-squash later, apply the journal to an empty database, `pg_dump` the
result (excluding the `drizzle` schema), split it into statements separated by
`--> statement-breakpoint`, then load the baseline into a second empty database
and diff the two dumps.

## Naming and ordering

Migrations 0000 to 0108 are numbered and listed in `drizzle/meta/_journal.json`,
which is now frozen. Every later migration is a file named
`<YYYYMMDDHHMMSS>_<snake_case>.sql` (UTC) with **no journal entry**:

```bash
pnpm db:new add_widget_table   # creates drizzle/20261106230800_add_widget_table.sql
```

Two branches that each add a migration never touch the same file or line, so
nothing is renumbered when another PR merges first. `scripts/lib/migrations.mjs`
lists them (numbered, then timestamped in name order) and applies them.

- The runner recognises an applied migration by the hash of its SQL, the same
  value Drizzle recorded in `drizzle.__drizzle_migrations`. An existing
  database, the live demo included, therefore carries on where it was and
  nothing is re-run. A migration that merges after a newer one is still applied.
- The recorded `created_at` of a timestamped migration is a number above every
  numbered one that rises with its timestamp, so "newest applied" still means
  "newest migration" for Diagnostics, the health check and the upgrade backup.
- CI runs `pnpm db:check-order`: a PR fails if a migration it adds sorts before
  a newer one on `main` that touches the same table, function, view or policy
  (order would decide the end state), if it adds a numbered migration, or if it
  edits the journal. A late migration about different objects passes with a
  notice and needs no rebase. For a real overlap, rename the file with a fresh
  timestamp (`pnpm db:new`, then move your SQL across).
- Never edit or rename a migration that is on `main`.

## Rules

1. One migration per logical change. Do not batch unrelated changes.
2. Never edit a migration that has been applied anywhere (any developer's
   database, CI, staging). Make a new migration that moves the schema forward.
3. Schema is declared in `src/db/schema.ts` (Drizzle). Raw SQL belongs in
   migrations only when Drizzle cannot express it (roles, RLS policies,
   grants, functions). Add such SQL with `pnpm db:new`.
4. Every migration must apply cleanly to an empty database. The fresh-database
   check below is part of done, not an optional extra.
5. Migrations run as an explicit step (`pnpm db:migrate`, or the `migrate`
   service in `compose.deploy.yaml`), never from inside the running app. The one
   exception is the `Dockerfile.railway` image, whose start command applies them
   before serving; take a backup first when you redeploy it.

## Normal flow

```bash
# 1. Edit src/db/schema.ts

# 2. Create the migration and write the SQL. Plain `pnpm db:generate` cannot diff
#    here - there is no committed snapshot baseline - so it emits a full-schema
#    migration; do not use it.
pnpm db:new <change>

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

`pnpm db:migrate` applies the migrations listed by `scripts/lib/migrations.mjs`. It does not read
`drizzle/meta/*_snapshot.json`.

`pnpm db:generate` diffs `src/db/schema.ts` against the **latest** snapshot.
Kit writes a full-database JSON file on each generate, so each snapshot is a
complete schema dump that grows with the schema — the 270 files once committed
here came to 203 MB and 6.8M lines.

This repository:

- commits SQL for every journal entry (required);
- commits the frozen `_journal.json` (required, numbered migrations only);
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

# 2. Create an empty migration and write the SQL by hand
pnpm db:new <change>

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

Drizzle's own migrator applied only the journal entries whose `when` was **newer than
the newest `created_at` recorded in `drizzle.__drizzle_migrations`**; Sheetbase's
runner now matches by hash instead, so this can no longer skip a migration, but
the advice stands. Applying a
later migration manually (correctly, even) advances that watermark, so the next
`pnpm db:migrate` reports success while applying **nothing** and every earlier
pending migration stays unapplied. The database then drifts silently and features
fail with `column ... does not exist` from PostgREST rather than a migration
error — this cost an afternoon on 11 October 2026, when a hand-applied `0430` left
`0424`'s `api.instruments.intake_method` missing and the instrument registry
returning HTTP 400 with the ledger showing 386 of 429 entries.

Use `pnpm db:migrate` (and `pnpm db:new` for a new migration) and
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
