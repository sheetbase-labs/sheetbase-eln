# Testing layers

Sheetbase tests run in five layers. Each layer answers one question. A
ticket's definition of done names the layers it must touch. Not every ticket
needs all five layers.

| Layer                | Question it answers                                                                                 | Tooling                                                 | Lives in                                  | Command             |
| -------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------- | ------------------- |
| Unit                 | Does this pure function do what it says?                                                            | Vitest                                                  | `src/**/*.test.ts` next to the unit       | `pnpm test`         |
| Component            | Does this component render and respond correctly (states, keyboard, labels)?                        | Vitest + Testing Library + jsdom                        | `src/**/*.test.tsx` next to the component | `pnpm test`         |
| Database integration | Do migrations, constraints, grants and RLS policies behave against real PostgreSQL?                 | Vitest (node environment) against a disposable database | `tests/db/`                               | `pnpm test:db`      |
| API contract         | Does the HTTP boundary keep its promises: auth, validation, error envelopes, RLS through PostgREST? | Vitest against a running local service stack            | `tests/api/`                              | `pnpm test:api`     |
| Browser workflow     | Does the whole user journey work in a real browser?                                                 | Playwright                                              | `tests/browser/`                          | `pnpm test:browser` |

Status today: all five layers are wired.

- Unit and component tests run through `pnpm test` in jsdom.
- Database integration tests use `pnpm test:db` and a fresh migrated
  `sheetbase_test` database per run.
- API contract tests use `pnpm test:api` against the running PostgREST stack.
- Browser workflow tests use `pnpm test:browser`. The Playwright
  configuration starts an isolated application server. The tests create and
  remove their own authenticated fixtures.

## Rules that apply at every layer

- **Isolation over seeding.** Tests create the data they need and clean up
  after themselves. Tests never depend on demonstration seed data (see
  `FND-003` in `TODO.md`).
- **Fixtures are stable and minimal.** Shared fixtures use the stable
  identities defined in the seed conventions. Rich demo data is for humans,
  not assertions.
- **Failure paths are first-class.** Every ticket tests the successful path
  and the most important failure or isolation path (permission denied, stale
  version, invalid payload, cross-workspace access).
- **No live third parties.** Tests never call GitHub, object storage, or any
  external service. Boundaries are faked at the adapter, not by recording
  real responses.
- **Focused while developing, full before done.** While you work, run the
  file or layer you change. `pnpm validate` (which includes `pnpm test`)
  must pass before a ticket is complete.

## Conventions per layer

### Unit and component

- Name one behavior per test: `it('rejects a stale version')`, not
  `it('works')`.
- Component tests assert accessible behavior (roles, labels, keyboard), not
  implementation details.
- When a component owns loading, empty, error, and permission states, each
  state gets a test.

### Database integration

- Run against a database created for the test run and migrated from scratch.
  Never run against the development database.
- Prove grants and RLS with real roles: connect as the role under test, not
  as a superuser pretending to be that role.
- Cross-workspace isolation is a mandatory test shape, not an edge case.

### API contract

- Exercise the same-origin boundary that the browser uses. Exercise PostgREST
  directly where external credentials see the contract.
- Assert stable error categories and envelopes, not exact message text.
- Assert that anonymous and wrong-workspace requests fail with the documented
  status and reveal nothing.

### Browser workflow

- Reserve these tests for acceptance proofs (`ELN-008`, `DATA-006`,
  `REV-008`) and the few journeys where a component test cannot demonstrate
  the outcome (multi-tab liveness, real navigation, focus across the shell).
- Keep browser tests few, deterministic, and independent of execution order.

## Phase 1 fresh-environment proof (API-007)

`pnpm test:phase1` runs the Phase 1 exit gate from `ROADMAP.md` in one
target. The target lives at `tests/db/phase1-proof.test.ts`. It runs against
a freshly dropped, recreated, and migrated `sheetbase_test` and proves:

- every migration applies cleanly to an empty database, and the expected
  workspace-owned tables exist;
- an authenticated browser-session claim can create and read a project
  through the same `api.create_project` RPC that the UI uses;
- after the proxy verifies the token, re-checks revocation at use time, and
  enforces scope, a scoped external credential can read the same project
  through the `api_client` role + RLS;
- anonymous access with missing or malformed claims returns no data and
  rejects inserts;
- a second workspace cannot read or mutate the first workspace's project,
  through either the browser path or an external credential;
- the system rejects an external token whose `workspace_id` claim was
  tampered to another workspace;
- no resources remain outside the proof's two workspaces.

Failures in this target identify the broken boundary directly: a migration
failure fails in `prepareTestDatabase`, an RLS failure fails in the isolation
cases, a scope failure fails in the external-credential case.

Run the full DB suite (`pnpm test:db`) to also cover AUTH-003 claim
contracts, AUTH-004 RLS, API-004 RPC, API-005 credential exchange, and the
API-005 follow-up external-path integration.

## Phase 4 sheet-and-formula proof (DATA-006)

`pnpm test:phase4` runs the stable Phase 4 workflow across the component,
database, real PostgREST, and real-browser layers. The proof shows:

- a Virus Stability notebook can own two managed sheets;
- typed columns, units, validation, CSV import, literals, and durable
  formulas survive display-name changes;
- within-sheet and cross-sheet calculations use stable identities;
- validation, stale-version, circular-reference, and stale-cache states stay
  explicit;
- an attributed external API edit reaches both Handsontable grids and their
  dependent HyperFormula results through the live-event stream.

The browser proof inserts a short-lived Better Auth session directly, in the
same way that the OAuth callback would after provider consent. It never
contacts GitHub. After the run, it removes its user, workspace, generated
resources, and events.
