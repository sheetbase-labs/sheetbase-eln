# Testing layers

Five layers, each answering a different question. A ticket's definition of
done names the layers it must touch; not every ticket needs all five.

| Layer                | Question it answers                                                                                 | Tooling                                                 | Lives in                                  | Command             |
| -------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------- | ------------------- |
| Unit                 | Does this pure function do what it says?                                                            | Vitest                                                  | `src/**/*.test.ts` next to the unit       | `pnpm test`         |
| Component            | Does this component render and respond correctly (states, keyboard, labels)?                        | Vitest + Testing Library + jsdom                        | `src/**/*.test.tsx` next to the component | `pnpm test`         |
| Database integration | Do migrations, constraints, grants and RLS policies behave against real PostgreSQL?                 | Vitest (node environment) against a disposable database | `tests/db/`                               | `pnpm test:db`      |
| API contract         | Does the HTTP boundary keep its promises: auth, validation, error envelopes, RLS through PostgREST? | Vitest against a running local service stack            | `tests/api/`                              | `pnpm test:api`     |
| Browser workflow     | Does the whole user journey work in a real browser?                                                 | Playwright                                              | `tests/browser/`                          | `pnpm test:browser` |

Status today: all five layers are wired. Unit and component tests run through
`pnpm test` in jsdom. Database integration uses `pnpm test:db`: a migrated
template database is built once per run and each vitest worker clones it into
its own `sheetbase_test_<worker>`, so files run in parallel (about a minute for
the whole layer). The local Postgres runs with `synchronous_commit`, `fsync` and
`full_page_writes` off: it is a disposable development database, and those
settings halve the layer's runtime. API contracts use `pnpm test:api` against the running PostgREST
stack created for each test file, with a fresh random migrated database and an
ephemeral PostgREST process. No pre-running PostgREST or application is needed
for this layer. Browser workflows use `pnpm test:browser` (two workers); the Playwright
configuration starts an isolated application server and the tests create and
remove their own authenticated fixtures.

`pnpm test:parity` compares the app against the DSYS-01 reference PNGs. The
references are rendered from the vendored canvases only when those change
(`tsx scripts/design-reference.mts --if-stale`), and the comparisons run
parallel across workers.

The browser layer reads the role URLs from the process environment, not from
`.env.local` — Playwright loads the file for the servers it starts, not for the
test process. Export them first, or the database-backed specs fail with
"Local disposable database required":

```bash
set -a; . ./.env.local; set +a
export PGRST_DB_URI="postgresql://authenticator:${POSTGREST_AUTHENTICATOR_PASSWORD}@localhost:5432/${POSTGRES_DB}"
pnpm test:browser
```

`PGRST_DB_URI` is the one that trips people up: `tests/browser/home-ui.test.ts`
refuses to run without a loopback `PGRST_DB_URI` because its totals assertions
read the database directly.

`tests/db/design-scenarios.test.ts` covers three design screens and provisions
its own `sheetbase_parity_*` database for each. It refuses to run unless
`SHEETBASE_ENV=test`, `SHEETBASE_DEV_AUTH_FREE=false`, and all four role
URLs (`DATABASE_URL`, `MIGRATION_DATABASE_URL`, `PGRST_DB_URI`,
`FORMULA_DATABASE_URL`) are loopback URLs naming that exact database (see
[seeds.md](seeds.md)). A `.env.local` whose `PGRST_DB_URI` names the Compose
host `postgres` fails these three by design; point that variable at the local
port rather than relaxing the guard.

While working a slice, run the file or files that cover it: the full database
layer is for acceptance, not for every change.

CI now runs static checks, unit/component tests, the real PostgreSQL contract
layer, a production build and the complete scientific workflow below. It uses
disposable Compose services and never deploys. A configured workflow is not
evidence that hosted Actions ran successfully. Preserve failure logs and report
account or runner failures separately from local test results.

Full visual-parity acceptance remains separate. The current registry maps 45
screens and leaves 81 pending; the coverage gate must not be bypassed by changing
its tolerance or excluding unaccepted states.

## Complete scientific workflow

After migrating and running `pnpm db:seed:design`, run:

```bash
pnpm exec playwright test tests/browser/journeys/complete-scientific-workflow.test.ts --project=browser --workers=1
```

The test creates a project, independent reviewer and experiment, imports 96 fresh
observations through the UI, declares their source units, analyses the imported
snapshot, saves the analysis and immediately cites it without reloading.
It submits the notebook, approves and signs it as the
reviewer, then reopens the frozen result. It asserts n = 96 and mean = 48.5 for
observations 1 through 96. Those expectations do not use the analysis kernel.
It retains a screenshot of the signed evidence and a trace on failure.

Identity, workspace membership and a native Better Auth credential are trusted
fixtures. Independent verification, certification, project membership and all
scientific work use application operations. This test is not OAuth/IdP,
email-enrolment, instrument hardware, full-population scale, whole-programme
usability or production acceptance. The subsystem suites cover their separate
contracts; human scientist observation and operator recovery drills still need
their own evidence.

## Rules that apply at every layer

- **Isolation over seeding.** Tests create the data they need and clean up
  after themselves. They never depend on demonstration seed data
  (see `FND-003` in `TODO.md`).
- **Fixtures are stable and minimal.** Shared fixtures use the stable
  identities defined in the seed conventions; rich demo data is for humans,
  not assertions.
- **Failure paths are first-class.** Every ticket tests the successful path
  and the most important failure or isolation path (permission denied,
  stale version, invalid payload, cross-workspace access).
- **No live third parties.** Tests never call GitHub, object storage or any
  external service. Boundaries are faked at the adapter, not by recording
  real responses.
- **Focused while developing, full before done.** Run the file or layer you
  are changing while working; `pnpm validate` (which includes `pnpm test`)
  must pass before a ticket is marked complete.

## Conventions per layer

### Unit and component

- One behaviour per test name: `it('rejects a stale version')`, not
  `it('works')`.
- Component tests assert accessible behaviour (roles, labels, keyboard), not
  implementation details.
- Loading, empty, error and permission states each get a test when the
  component owns them.

### Database integration

- Run against a database created for the test run, migrated from scratch —
  never against the development database.
- Prove grants and RLS with real roles: connect as the role under test, not
  as a superuser pretending.
- Cross-workspace isolation is a mandatory test shape, not an edge case.

### API contract

- Exercise the same-origin boundary the browser uses, plus PostgREST
  directly where the contract is exposed to external credentials.
- Assert stable error categories and envelopes, not exact message text.
- Assert that anonymous and wrong-workspace requests fail with the documented
  status and reveal nothing.

### Browser workflow

- Reserved for acceptance proofs (`ELN-008`, `DATA-006`, `REV-008`) and the
  few journeys where a component test cannot demonstrate the outcome
  (multi-tab liveness, real navigation, focus across the shell).
- Keep them few, deterministic and independent of execution order.

## Phase 1 fresh-environment proof (API-007)

`pnpm test:phase1` runs the Phase 1 exit gate from `ROADMAP.md` in one
target. It lives at `tests/db/phase1-proof.test.ts` and proves, against a
freshly dropped/recreated/migrated `sheetbase_test`:

- every migration applies cleanly to an empty database and the expected
  workspace-owned tables exist;
- an authenticated browser-session claim can create and read a project
  through the same `api.create_project` RPC the UI uses;
- a scoped external credential can read the same project through the
  `api_client` role + RLS, after the proxy verifies the token, re-checks
  revocation at use time and enforces scope;
- anonymous access with missing or malformed claims returns no data and
  rejects inserts;
- a second workspace cannot read or mutate the first workspace's project,
  through either the browser path or an external credential;
- an external token whose `workspace_id` claim was tampered to another
  workspace is rejected;
- no resources are left outside the proof's two workspaces.

Failures in this target identify the broken boundary directly: a migration
failure fails in `prepareTestDatabase`, an RLS failure fails in the
isolation cases, a scope failure fails in the external-credential case.

Run the full DB suite (`pnpm test:db`) to also cover AUTH-003 claim
contracts, AUTH-004 RLS, API-004 RPC, API-005 credential exchange and the
API-005 follow-up external-path integration.

## Phase 4 sheet-and-formula proof (DATA-006)

`pnpm test:phase4` runs the stable Phase 4 workflow across the component,
database, real PostgREST and real-browser layers. It proves that a Virus
Stability notebook can own two managed sheets; typed columns, units,
validation, CSV import, literals and durable formulas survive display-name
changes; within-sheet and cross-sheet calculations use stable identities;
validation, stale-version, circular-reference and stale-cache states remain
explicit; and an attributed external API edit reaches both sheet grids
and their dependent calculation results through the live-event stream.

The browser proof inserts a short-lived Better Auth session directly, just as
the OAuth callback would after provider consent. It never contacts GitHub and
removes its user, workspace, generated resources and events after the run.

## Installed SDK and pipeline acceptance

Use the PostgreSQL 18 roles and environment from the
[orb setup](orb-setup.md). Install the locked Node dependencies through the
trusted GitHub Packages npmrc. Keep its credential outside the repository.
Put PostgREST **14.5**, `uv`, `npm`, and Python 3.10 or newer on `PATH`.
Package builds need access to the configured Python package index or its cache.

Run the following tests in **one Vitest invocation**. Separate concurrent DB
invocations reuse worker database names and can terminate each other's sessions.

```sh
uv venv /tmp/sheetbase-acceptance-python
uv pip install --python /tmp/sheetbase-acceptance-python/bin/python pandas numpy
PIPELINE_ACCEPTANCE_PYTHON=/tmp/sheetbase-acceptance-python/bin/python \
  pnpm test:db tests/db/sdk-installed.test.ts tests/db/webhook-recovery.test.ts \
  tests/db/webhooks.test.ts tests/db/webhook-admin.test.ts \
  tests/db/pipelines.test.ts tests/db/pipeline-confirm.test.ts \
  tests/db/pipeline-propose-mode.test.ts tests/db/pipeline-sandbox.test.ts
```

`sdk-installed.test.ts` builds and packs the TypeScript SDK, installs its tarball
in a temporary directory, and installs the Python wheel into a fresh virtual
environment. It starts the actual Vite application and PostgREST on loopback
ports against its disposable database. Neither SDK uses a mocked transport.
The tests prove row commits, idempotent replay, stale-revision refusal and retry,
workspace and scope isolation, live personal-token permissions and membership,
service-credential revocation with a cached JWT, and denial of human attestation.
The test removes its temporary package installations and stops both servers.
It does not publish either package or use an external receiver.

The Python case in `pipelines.test.ts` runs the existing worker source
with the selected interpreter, then chains its actual rows through the real SQL
sandbox. A draft trial leaves no runs, logs, or manifests. A published run
stores a Dataset Version with checked values and a verified signed manifest. The runtime pin in this
test identifies the local worker source, **not an OCI image**. Docker isolation,
broker authentication, and availability of deployed digest-pinned images need
the separate container acceptance in `docs/operations/pipeline-python.md`.
Without `PIPELINE_ACCEPTANCE_PYTHON`, the worker uses `python3`, which must have
pandas and NumPy installed. Missing packages fail the case rather than skip it.
The same invocation covers SQL trial, confirm/resume, proposal, queue recovery,
output, and manifest tests. A passing local run does not establish hosted CI or release
acceptance.

`webhook-recovery.test.ts` uses real PostgreSQL for retained-event reconciliation,
overlapping-worker ownership, rollback, and LISTEN reconnection. Only its
outbound HTTP adapter is simulated. It verifies receiver deduplication after an
accepted delivery loses its result commit. HTTPS egress policy has separate
tests in `src/lib/webhook-http.server.test.ts`.
