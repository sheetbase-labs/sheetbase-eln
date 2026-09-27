# Seed and fixture conventions

Reproducible test data: anyone can build the same local environment, rerun
seeds safely, and reset cleanly when things get strange.

## The two kinds of seed data

**Minimal fixtures** (`pnpm db:seed`) — the smallest set of rows the product
and integration tests assume can exist: one user, one workspace with owner
membership, one project. Defined in `src/db/seed/run.ts` as `fixtureSteps`,
using the stable identities in `src/db/seed/identities.ts`.

**Demonstration data** (`pnpm db:seed:demo`) — the richer Virus Stability
example used to explore and demo the product. Lives in `demoSteps`, separate
from fixtures, and only applied when explicitly requested. The demo Sheet is
a CORE-03 ad-hoc Sheet Instance with six local fields and 32 stability rows,
created through `insert_sheet_instance_block` and
`mutate_sheet_instance_local_state`. It is not a scientific table.

**Design data** (`pnpm db:seed:design`) — the people, workspaces, projects,
records and values the UI system v3 design screens show, used by the visual
parity suite (Roadmap 4, DSYS-05). Lives in `src/db/seed/design.ts` as
`designSteps`, on a fixed clock (Friday 25 September 2026, Europe/London) so
relative times render as the design does. Only applied with `--design`.

Rules:

- Tests never assert against demonstration data. Tests create the rows they
  need and clean them up; they may assume nothing beyond an empty, migrated
  database unless they seeded fixtures themselves.
- Fixture rows are for humans and for explicit integration-test setup. Tests
  that need their own user/workspace create fresh ones with unique keys
  rather than mutating fixtures — parallel runs must not collide.
- Demonstration data is built through ordinary capabilities where possible,
  not through back-door inserts that bypass constraints (see SCI-009).

## Stable identities

Seed rows use fixed UUIDs from `src/db/seed/identities.ts`:

- Every seed UUID starts with `00000000-` so seeded data is recognisable in
  dumps, screenshots and logs.
- `…0001`–`…00ff` is the fixture range (user, workspace, project).
- `…0100`–`…01ff` is the Virus Stability demonstration range.
- Human-facing keys are stable too: `owner@sheetbase.test`,
  `fixture-workspace`, `fixture-project`, `virus-stability`.

Never reuse a retired seed identity for a different record.

## Idempotency

Every seed step upserts on a stable key (`ON CONFLICT … DO UPDATE` on the
identity column). Rerunning `pnpm db:seed` must converge to the same state,
never duplicate rows. A seed step that cannot be made idempotent does not
belong in the runner — fix the underlying uniqueness constraint first.

## Resetting the local development database

```bash
pnpm db:reset    # drop and recreate the local database, empty
pnpm db:fresh    # reset + migrate + seed in one command
pnpm db:fresh --demo  # the same, including demonstration data
```

`pnpm db:reset` is guarded (`src/db/reset-guard.ts`): it refuses anything
that is not a local `sheetbase` or `sheetbase_test` database on localhost.
It never touches staging or production — it cannot reach them, because it
only accepts localhost URLs. Destruction is limited to the database named in
your local `DATABASE_URL`; nothing else on the server is dropped.

## Fresh-database verification

One documented flow proves an empty database becomes usable:

```bash
pnpm services:up
pnpm db:fresh
```

Expected output: the database is dropped and recreated, every migration
applies in order (or a clear "no migrations yet" note before the first schema
lands), seed steps run and report by name, and the command exits zero.
`docs/development/migrations.md` covers the matching schema-side check
(`pnpm db:generate` must produce nothing afterwards).

## Adding seed data

1. Allocate the next UUID in the correct range in
   `src/db/seed/identities.ts` and add any human-facing key.
2. Add an idempotent step to `fixtureSteps` or `demoSteps` in
   `src/db/seed/run.ts`.
3. Extend `src/db/seed/identities.test.ts` if a new range or rule appears.
4. Verify with `pnpm db:fresh` run twice — the second run must report the
   same converged state with no duplicates.
