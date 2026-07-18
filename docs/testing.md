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

Status today: unit and component layers are wired (`pnpm test`,
jsdom environment). The database integration layer is wired
(`pnpm test:db`, node environment, fresh migrated `sheetbase_test` per run —
requires `pnpm services:up`). The API and browser layers are defined here so
their conventions exist before the tickets that introduce them (API-004 and
the first browser acceptance proof respectively).

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
