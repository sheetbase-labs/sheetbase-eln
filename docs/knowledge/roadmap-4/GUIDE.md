---
title: Roadmap 4 — developer guide
status: proposed
last_reviewed: 2026-09-27
---

# Roadmap 4 developer guide

Read this before picking up any Roadmap 4 task. It explains how the codebase
is put together, how a Roadmap 4 task flows from design screen to merged PR,
the recipes most tasks reuse, the words the task files use, and the checklist
every PR must pass. The task files assume you have read it.

## 1. Before your first task

1. Read, in order: [`../NEXT.md`](../NEXT.md), [`README.md`](README.md),
   [`DESIGN_ADOPTION.md`](DESIGN_ADOPTION.md), [`PROGRAMME_MAP.md`](PROGRAMME_MAP.md),
   [`../product/core-concepts.md`](../product/core-concepts.md).
2. Read the repository rules in `AGENTS.md` at the root and the development
   docs in `docs/development/`: `local-dev-quickstart.md`,
   `conventions.md`, `migrations.md`, `database-access.md`, `testing.md`,
   `seeds.md`.
3. Get the app running locally:

   ```bash
   pnpm install --frozen-lockfile
   git submodule update --init .agent/design
   cp .env.example .env.local        # fill in values; set SHEETBASE_DEV_AUTH_FREE=true locally
   pnpm services:up                  # PostgreSQL + PostgREST in Docker
   pnpm db:fresh --demo              # reset, migrate, seed demo data
   pnpm dev                          # http://localhost:3000
   ```

   In an Amp orb, follow `docs/development/orb-setup.md` instead of Docker.

4. Render the design so you can see the target:

   ```bash
   pnpm design:render                # all 126 screens → tests/visual/design-reference/
   pnpm design:render Main Notebook  # just these
   ```

   Set `CHROMIUM_PATH` if Playwright's own browser is not installed.

5. Run the checks once so you know they pass before you change anything:
   `pnpm check && pnpm lint && pnpm typecheck && pnpm test`.

## 2. How the system is put together

```text
Browser (React, TanStack Router + Query)
   │  src/routes/*.tsx           one file per URL
   │  src/components/**          UI; primitives in src/components/ui
   │  src/lib/**/data.ts         typed calls + query keys, one module per area
   ▼
Same-origin proxy  /api/db/*     src/routes/api/db/$.ts (adds the signed JWT)
   ▼
PostgREST                        exposes only the `api` schema
   ▼
PostgreSQL                       tables, views and RPC functions in `api`;
                                 row-level security (RLS) on every workspace table;
                                 private tables in `internal`
```

Rules that follow from this:

- **The database decides.** Permissions, locks, required fields and state
  changes are enforced in PostgreSQL (RLS policies and RPC functions). UI
  checks only improve messages. A task that shows a rule on screen must enforce
  it in the database and prove it with a database test.
- **Writes go through RPCs** (`api.<verb>_<noun>` functions) whenever more than
  one row or any rule is involved. The browser calls them with
  `client.rpc('name', { p_arg: … })` from a `src/lib/**/data.ts` module.
- **Server-only work** (pipelines, calculations, exports, email) lives in
  `*.server.ts` files and `src/routes/api/**` handlers.
- **Everything that changes emits a change event** with
  `internal.emit_change_event(...)` so open screens update live (see
  `src/lib/live-events.ts`) and pipelines can trigger on it.

## 3. How a Roadmap 4 task flows

Most tasks rebuild one or more design screens together with the capability
behind them.

1. **Read the task** and every design screen it lists. Render them
   (`pnpm design:render <Screen>`), open the PNGs, and open
   `docs/knowledge/design/ui-system-v3/screen-text/<Screen>.txt` for the exact
   words. Open the `.dc.html` to see which design component each part uses
   (`Sheetbase.Button`, `Sheetbase.Status` and so on) and which states exist.
2. **Read the "Start here" files** in the task. Trace the current behaviour
   from route → data module → RPC/table → tests before changing anything.
3. **Plan the PRs.** Each task lists its steps; each step is sized to be one
   reviewable PR. Database first, then data module, then UI, then parity.
4. **Database changes** (if any): recipe 5.1–5.3, with a database test.
5. **Data module**: recipe 5.4.
6. **Route and components**: recipes 5.5–5.6, using v3 primitives and tokens
   only (no literal colours, sizes or fonts).
7. **Seed the design data** the screen shows (recipe 5.8), so the screen can be
   compared on identical content.
8. **Parity**: add the screen to the parity suite (recipe 5.9) and make it pass
   in light and dark.
9. **Delete what you replaced** in the same PR: old components, routes,
   stories and tests that only covered them.
10. **Run the PR checklist** (section 7) and open the PR with the task ID in the
    title, for example `WORK-01: server-side work items`.

## 4. Where things are

| Need                            | Look in                                                                                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Database schema (Drizzle)       | `src/db/schema.ts`                                                                                                                                                       |
| Migrations (SQL, in order)      | `drizzle/NNNN_name.sql`, journal in `drizzle/meta/_journal.json`                                                                                                         |
| RLS and claim helpers           | `api.current_workspace_id()`, `api.current_user_id()`, `api.is_workspace_member()`, `api.is_workspace_writer()`, `api.has_capability()` (search `drizzle/` for examples) |
| Capabilities mirrored in the UI | `src/lib/capability.ts` (`hasCapability`)                                                                                                                                |
| Browser data client             | `src/lib/data-client.ts` (`createDataClient`, `client.rpc`, `client.get`)                                                                                                |
| Data modules and query keys     | `src/lib/<area>/data.ts` or `src/lib/<area>-data.ts`, e.g. `src/lib/pipelines/data.ts` (`pipelineQueryKeys`)                                                             |
| Routes                          | `src/routes/**` (generated tree `src/routeTree.gen.ts`)                                                                                                                  |
| Shell                           | `src/components/app-shell.tsx` (replaced in SHELL-01)                                                                                                                    |
| UI primitives                   | `src/components/ui/*` (shadcn/Radix), exported from `src/components/ui/index.ts`                                                                                         |
| Tokens                          | `src/styles.css` (becomes v3 in DSYS-02)                                                                                                                                 |
| Storybook stories               | `src/stories/*.stories.tsx`, run `pnpm storybook`                                                                                                                        |
| Change events                   | `internal.emit_change_event` in SQL; `src/lib/event-catalogue.ts`, `src/lib/live-events.ts`                                                                              |
| Seeds                           | `src/db/seed/run.ts`, identities in `src/db/seed/identities.ts`                                                                                                          |
| Tests                           | unit/component next to code; `tests/db/`, `tests/api/`, `tests/browser/`                                                                                                 |
| Design reference                | `docs/knowledge/design/ui-system-v3/`                                                                                                                                    |
| Grid, charts, filters packages  | `sheetbase-labs/sheetbase-components` repository                                                                                                                         |

## 5. Recipes

### 5.1 Add or change a table

1. Edit `src/db/schema.ts` following `docs/development/conventions.md`
   (plural snake_case, `id uuid`, `workspace_id` with index, `created_at`
   defaults, named `chk_`/`uq_`/`idx_` constraints).
2. `pnpm db:generate` and read every line of the generated SQL.
3. RLS, grants and triggers cannot be generated: add a custom migration
   (recipe 5.2) in the same PR that enables RLS and adds `SELECT/INSERT/...`
   policies using the claim helpers. Copy the shape of an existing table, for
   example the calendar tables (search `drizzle/` for `calendar_bookings`).
4. `pnpm db:migrate`, then prove a fresh database works:
   `pnpm services:purge && pnpm services:up && pnpm db:migrate && pnpm db:generate`
   (the last command must produce nothing).

### 5.2 Add an RPC (server function)

1. `pnpm drizzle-kit generate --custom --name <verb_noun>` creates an empty
   numbered SQL file in `drizzle/`.
2. Write `CREATE OR REPLACE FUNCTION api.<verb_noun>(p_workspace_id uuid, …)`
   modelled on an existing one (for example `api.start_pipeline_run` in
   `drizzle/0169_pipeline_manual_invocations.sql`):
   - `SECURITY DEFINER`, `SET search_path = ''`, every object schema-qualified;
   - first lines check the caller: `api.current_workspace_id()` matches the
     argument, then `api.is_workspace_writer(...)` or
     `api.has_capability(...)`;
   - raise errors with `RAISE EXCEPTION '...' USING ERRCODE = 'SBnnn'`, using
     the next unused code (find the highest with
     `grep -rhoE "'SB[0-9]{3}'" drizzle src | sort -u | tail`);
   - emit a change event with `PERFORM internal.emit_change_event(...)`;
   - `REVOKE ALL ... FROM PUBLIC; GRANT EXECUTE ... TO authenticated` (and
     `api_client` if external API clients may call it).
3. End the file with `NOTIFY pgrst, 'reload schema';`.
4. Never edit a migration that has been merged; add a new one.

### 5.3 Database test

Add `tests/db/<task-id>-<topic>.test.ts`. Use `prepareTestDatabase()` from
`tests/db/helpers.ts` and connect as real roles, as `tests/db/calendar.test.ts`
does (`asAuthenticated(userId, workspaceId)`). Every database test covers:
the success path, a denied caller (`expectDenied`), a user from another
workspace seeing nothing, and any stale-version or invalid-input path. Run
with `pnpm test:db`.

### 5.4 Data module

In `src/lib/<area>/data.ts`: wire types (snake_case, as returned) in
`types.ts`, one exported async function per read or RPC taking a
`DataClient`, and a `<area>QueryKeys` object. Add unit tests for any mapping
or validation. Components call these through TanStack Query
(`useQuery({ queryKey, queryFn })`); never call `fetch` directly.

### 5.5 Route

Create `src/routes/<path>.tsx` with `createFileRoute`, redirecting to
`/sign-in` in `beforeLoad` when there is no auth context (copy
`src/routes/pipelines.tsx`). Tabs are child routes. Run
`pnpm generate-routes` and commit the updated `src/routeTree.gen.ts`.

### 5.6 Component

Build from `src/components/ui` primitives and the v3 components (DSYS-03/04).
Use tokens and type utilities only. Every component owns its loading, empty,
error and no-permission states. Add a component test for behaviour (roles,
labels, keyboard) and a story for each state.

### 5.7 Browser test

For whole journeys, add `tests/browser/<task-id>-<topic>.test.ts` (Playwright).
Tests create and remove their own data; they never rely on demo seed data.

### 5.8 Design seed data

The design screens show one consistent scenario. When your screen shows data
that the design seed (DSYS-05) does not create yet, add it in the design seed
step through RPCs (never direct inserts), with stable IDs in
`src/db/seed/identities.ts`, and check that `pnpm db:fresh --design` (added by DSYS-05) run twice
converges.

### 5.9 Parity test

After DSYS-06 exists: add an entry for each design screen your route covers
(route, signed-in user, state to drive into, frame size) to the parity suite,
run `pnpm design:render <Screen>` and `pnpm test:parity <Screen>` (added by
DSYS-06), and fix
the route until it passes in light and dark. Never loosen the tolerance or add
an exception; if the design is wrong, change the design first.

### 5.10 Change `sheetbase-components`

Make the change in the `sheetbase-components` repository with its own tests
(`bun run test`, `bun run lint`, `bun run typecheck`, table
`bun run test:e2e`), release a new lockstep version (COMP-05), then bump the
version in the ELN in a separate PR that runs the parity suite. To try an
unreleased change locally, use a pnpm `link:` override and never commit it.

## 6. Words the task files use

| Term               | Meaning                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| v3, the design     | UI system v3: the vendored screens and design system in `docs/knowledge/design/ui-system-v3/`                  |
| Design screen      | One `.dc.html` board in the design canvas, e.g. `Notebook.dc.html`                                             |
| Render             | The PNG of a design screen produced by `pnpm design:render`                                                    |
| Parity             | The route looks identical to the render on the design seed, in both themes                                     |
| Design seed        | Seed data that reproduces every value on the design screens (DSYS-05)                                          |
| Token              | A named design value (colour, size, font) defined once in `src/styles.css`                                     |
| RPC                | A PostgreSQL function in the `api` schema called through PostgREST at `/rpc/<name>`                            |
| Canonical RPC      | The one RPC that owns a kind of write; other code (UI, pipelines, API) must use it rather than writing tables  |
| RLS                | Row-level security: PostgreSQL policies deciding which rows a caller can see or change                         |
| Claims             | Values from the signed request token (`sub`, `workspace_id`) read in SQL via `api.current_*()`                 |
| Capability         | A named permission checked by `api.has_capability` (e.g. `schema.publish`)                                     |
| Expected revision  | The version number a caller last saw; a write with an out-of-date one is rejected instead of overwriting       |
| Change event       | A row in `api.change_events` announcing a change; drives live updates and event-triggered pipelines            |
| Record             | A durable object with a stable ID such as `EXP-0142`, `SMP-2231`                                               |
| Revision           | An immutable copy of a record's content at submit, sign or amend, with an integrity digest (content hash)      |
| Frozen evidence    | What a signed revision cites (revision plus dataset snapshots); it never changes                               |
| Dataset / snapshot | A dataset is rows under a schema; a snapshot (`dataset_versions`) is an immutable version of those rows (S-15) |
| Model / schema     | The definition of a kind of record or measurement: fields, types, units, rules, versions                       |
| Sheet (instance)   | A working grid inside a notebook or on its own; columns may come from datasets, records, formulas or be local  |
| Local column       | A sheet column that exists only in that sheet until promoted into a dataset                                    |
| Bound grid         | A grid whose cells map to record fields; edits are writes through RPCs rather than local data                  |
| Work item          | Something waiting on a person, shown in the Inbox (WORK-01)                                                    |
| ADR                | Architecture decision record in `docs/knowledge/decisions/`; "proposed" until accepted                         |

## 7. PR checklist

Copy into the PR description and tick each line.

```markdown
- [ ] Title starts with the task ID; description links the task and lists the design screens covered
- [ ] Every rule shown on screen is enforced in the database and covered by a DB test (success, denied, other workspace, stale/invalid)
- [ ] New migrations apply to an empty database; `pnpm db:generate` produces nothing afterwards
- [ ] Data changes emit change events; open screens update without reload
- [ ] UI uses v3 tokens and components only (no literal colours, fonts or sizes)
- [ ] Loading, empty, error and no-permission states implemented and tested
- [ ] Copy matches the design's screen text exactly
- [ ] Design seed extended for everything the screen shows; `pnpm db:fresh --design` runs twice cleanly
- [ ] Parity test added and passing in light and dark
- [ ] Keyboard and focus behaviour match `FocusOrder` and `Shortcuts`; axe check passes
- [ ] Superseded components, routes, stories and tests deleted
- [ ] `pnpm validate` passes; `pnpm test:db` passes if SQL changed; browser tests pass if journeys changed
- [ ] Docs updated where behaviour or contracts changed (subsystem docs, ADR if a durable decision was made)
```

## 8. When you are stuck

- A task says "after DEC-nn": do not start until that decision is accepted;
  pick another task.
- The design and the data model disagree: stop and raise it on the task; do not
  invent a field or fake a value to make the screen match.
- A step is bigger than one reviewable PR: split it and note the split in the
  task file.
- A test fails that your change did not touch: check whether it fails on
  `main`; report it rather than skipping or loosening it.
