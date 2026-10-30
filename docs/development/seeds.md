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

**Design data** (`pnpm db:seed:design`) is the incomplete fixture for the
original 126-screen UI system v3 canvas, used by the visual parity suite
(Roadmap 4, DSYS-05). It lives in `src/db/seed/design.ts` as `designSteps`
and runs only with `--design`. `DESIGN_CLOCK` is Friday 25 September 2026,
09:40 Europe/London. It does not control every RPC's database clock.

The design steps also seed the states the parity screens need: the working and
empty sheets (SHT-0019/SHT-0020, via `create_sheet_instance`), the review
lifecycle (preview → `submit_record_revision` → `run_revision_checks` →
`approve_review`/`request_changes_on_review` → `sign_revision`, plus a
`create_amendment` for the frozen-vs-live history), project folders and files,
integrations and API tokens, the client portal (shares, reports and messages),
and the first design protocol's frozen version, which `create_protocol_version`
takes from the record's own blocks and `set_protocol_version_status` puts in
review so read-and-acknowledge training has an exact version to record against.
Some steps use canonical RPCs, but direct business-table writes,
timestamp overrides and manufactured webhook deliveries remain. These are
DSYS-05 authority gaps, not accepted ways to reproduce the design. A
successful CLI run does not establish the task's original exit.

Protocol content resolves the protocol by its canonical identifier and uses
`insert_block`. Folder and file steps resolve the project by its workspace
and key, records by project and identifier, and existing uploads by project
and display name. They reuse returned IDs rather than assuming fixture UUIDs.
Unchanged training states and folder locations are no-ops on reseed. Locked
records stay untouched. Upload metadata remains `missing` until real bytes
are finalised; creating metadata is not evidence that a file exists.

Bench rows resolve active DS-0320 by workspace/display ID and use
`plan_dataset_row`. Existing keyed rows keep their IDs, values and schedules;
archived datasets are left alone. Sample measurements resolve sample identifiers
within the workspace and use `record_sample_measurement`, preserving existing
measurements rather than replacing them. Gareth's follows resolve experiment
identifiers and use `follow_record`, without direct rows or backdated follow
events. New follow and measurement event times are server-generated, not frozen
September evidence. The existing sample values and remaining manufactured
pipeline run are not an all-values or receipt acceptance claim.

Process workspace settings are created through the owner-only
`update_workspace_settings` RPC when absent; its native default is
`Europe/London`. Existing timezone and signature-policy settings are preserved.
AAV9's start date, default reviewer and agreement use the CAS
`update_project_details` authority. On SET0323, the initial project frame supplies
the actual declared leads so the native owner-rule trigger runs before scoped
science. AAV9 access uses `set_project_access_rule`: Priya and Sam have View and
Edit; Mei has View, Edit and Review, as the original Reviewer description
requires. A real QA group grants View to Anna through explicit group membership;
the other two QA people are not invented. These rules are prepared before
custody, not in the later metadata step. There is no all-member or temporary
Gareth Edit grant. Native membership dates are not historical joining evidence.

DatasetExplorer and DatasetsList explicitly name Gareth as DS-0298's creator
and owner; that remains unchanged in his editable Ambr project. No original
creator is specified for DS-0305 or DS-0290, so their fresh creation uses the
actual permitted project lead, Mei. Workspace schema stewardship remains
Gareth's native owner authority, separate from scientific dataset creation.
Reseeding does not relabel existing dataset or audit identities. These bounded
repairs do not make the full seed green: SET0323's structured Dataset-link
policy rejects the canonical null record FK, including a link between a
readable/editable AAV9 experiment and its readable Dataset. Authority repair is
required; never fill a record FK with a Dataset UUID or bypass its policy.

The five original ProjectDetail milestones use `create_study_task`, with
workspace/project-scoped title lookup and returned experiment identities.
Target dates and progress are planning inputs, not release receipts. No
deliverables are fabricated: there is no product creation authority for them.
Old fixture milestones are not deleted or relabelled on an existing database.

On fresh creation, DS-0311 includes DatasetCompare's nine displayed readings,
including 61.5 NTU, the 12.4/12.1 NTU repeats, the 5.4/5.5 × 10¹⁰ ELISA
readings, blanks and standards. Unrecorded measurements stay null. The real
row-batch rule generates the single system flag with a 0–50 NTU threshold;
the seed no longer adds an unrelated manual capsid-titre flag. Existing
dataset rows, active schemas and frozen snapshots are not rewritten. This
does not reproduce S-14/S-15's historical transition, row numbering or times.
Generated values outside those displayed readings remain unverified against
the original canvas.

The agent service credential and the Plate-map exporter (Mei) and Jupyter
(Gareth) personal tokens use native `createCredential` and
`emitCredentialAuditEvent` in one transaction. Before reuse or issuance, the
seed validates the signed fixture cookie through Better Auth, checks current
persisted workspace membership, and requires owner authority for service
credentials. Workspace selection uses `set_active_workspace`, not a forged
context. Existing named credentials retain their IDs, hashes, expiry and usage
history; malformed legacy placeholder credentials require a fresh fixture DB.
New IDs, random prefixes, hashes and audit dates are native; secrets are
discarded, never logged or stored. The seed does not backdate last use or mint
an already-expired Stability export token. Its September expiry/refusal
history remains blocked on operation-clock authority. The credential DB test
captures new secrets only in memory to exercise real exchange and JWT
verification, audit rollback, authority/session denials and reseed convergence.

The live signing fixture uses native Better Auth credentials and a signed
session cookie. It sets a password only when no credential exists, verifies
the identity through a different existing Fixture Owner, and obtains real
password step-up tokens for certification and each new signature. Reseeding
resumes an approved-but-unsigned submission without rewriting decisions or
existing signatures. Live signature IDs and times come from the database.
Never replace them with historical canvas IDs or dates, insert grants, or
fabricate verification or provider assurances.

### Isolated screen preparation

`prepareDesignScenario(db, screen)` in `src/db/seed/design.ts` prepares
`ReviewSign`, `SettingsSignature` or `HomeFirstRun`. It is not a seed step and
does not change the CLI sequence: `pnpm db:seed` applies the fixture steps, and
`pnpm db:seed:design` adds the design steps and the dev-session step on top (48
steps at the time of writing; `--demo` and `--month` add their own). The caller
provisions each database newly, applies the full migrations and runs the design
seed first.

| Screen            | Exact database                        | App / PostgREST / admin ports |
| ----------------- | ------------------------------------- | ----------------------------- |
| ReviewSign        | `sheetbase_parity_review_sign`        | 3300 / 3301 / 3302            |
| SettingsSignature | `sheetbase_parity_settings_signature` | 3310 / 3311 / 3312            |
| HomeFirstRun      | `sheetbase_parity_home_first_run`     | 3320 / 3321 / 3322            |

Preparation requires `SHEETBASE_ENV=test` and
`SHEETBASE_DEV_AUTH_FREE=false`. The supplied pool connection and every role
URL (`DATABASE_URL`, `MIGRATION_DATABASE_URL`, `PGRST_DB_URI`,
`FORMULA_DATABASE_URL`) must use PostgreSQL on loopback and name the exact
selected database. Default databases, including `sheetbase_test`, are refused.
Keep `BETTER_AUTH_URL` aligned with the dedicated app's request origin.

Run preparations serially. Point the dedicated app and PostgREST at the same
validated database. Do not use `postgrest.sh`: it reconstructs the default
database from `.env.local`. Start PostgREST with explicit role URL, schema,
JWT, API-port and admin-port environment settings instead. Capture light and
dark states serially from the same preparation without reseeding. Stop both
dedicated services before disposing only that exact database. Do not reuse a
prepared database for another screen.

The return value contains actual user, session, project and, for ReviewSign,
submission/revision identities, plus the route and prerequisite assertions.
ReviewSign creates a canonical amendment and a new approved unsigned round;
existing signatures remain intact. SettingsSignature provisions Sam's missing
native fixture password and independent Gareth verification, never
certification or replacement credentials. HomeFirstRun accepts a real Gareth
invitation and grants AAV9 Editor access, without personal views, scientific
activity, owned experiments or certification. Auth user/session bootstrap is
explicit fixture setup, not product enrolment or identity acceptance.

These preparations use real server dates. They do not reproduce historical
September dates or authorize a clock override. HomeFirstRun retains the
assigned project even while the current checklist incorrectly treats assignment
as opening and reports 2/4 rather than the original 1/4. Keep that semantic
parity gap visible; never remove access to conceal it.

`pnpm design:coverage` checks exact identifiers in canonical identity columns
within the four design workspaces. It counts every identifier family and
exits non-zero for any unmatched screen identifier, missing required family,
or missing required anchor. Unknown authorities count as misses. A mention
in another record's title and an identifier in another workspace cannot
satisfy coverage. `--report-only` prints the same misses without failing.

This is **identifier coverage only**. Scientific values, units, names, dates,
counts, audit history, receipts and screen states still need independent
authority-backed coverage. Zero identifier misses alone does not meet
DSYS-05's all-values exit. The immutable `canvas/` and `screen-text/` under
`docs/knowledge/design/ui-system-v3/` remain the reference, not app-3 or
current application screenshots.

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

## Instrument files in the demo

The design seed tells one instrument story: the TB-02 turbidimeter gets new
firmware, two files fail, an admin describes the new layout as a parser, and
one file is tried again while the other is still waiting. The files' text is in
`src/db/seed/demo-files.json`. The seed writes them to the local object store,
and `scripts/stage-demo-files.mjs` (run by the Railway image's start command,
on the auth-free demo only) puts them into the app's file storage (the database), which the
seed does not share. "Try again" reads the file from that store.
