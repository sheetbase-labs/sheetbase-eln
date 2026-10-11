# Execution and acceptance guide

This guide applies to every task in this corpus. Read it with
[FINDINGS.md](FINDINGS.md), [PROGRAMME_MAP.md](PROGRAMME_MAP.md) and the stream
specification for the task in hand. The audit was taken at ELN `10a84a42` on
11 October 2026; it is not an instruction to implement everything at once.

## Establish the checkout

Run from the `sheetbase-eln` repository, not its workspace parent:

```bash
git status --short
git rev-parse HEAD
git diff --stat 10a84a42..HEAD -- src tests docs/knowledge
```

Re-read each task's current-state references against the current source. The
audit cites files that move: confirm the evidence still holds before building on
it, and stop to revise the task if a premise or canonical contract has changed.
Preserve unrelated local work. Use a scoped `GWP/` branch or worktree for
implementation. Do not merge, publish or deploy from this corpus.

Read root `AGENTS.md`, `docs/knowledge/NEXT.md`,
`docs/knowledge/agent/workflows.md`, the
[product-design skill](../../../.agent/design/skills/product-design/SKILL.md)
with [design guidance](../../../.agent/design/design.md), the governing ADRs,
and the Roadmap 4 task that owns any behaviour being extended.

The interface reference is a working copy of the app-3 UI-only build at
`/Users/garethprice/Developer/sheetbase/sheetbase-app-ui-only`. It is **not a git
checkout**: cite it by file path and re-read it at the time of the work, and
never copy its fixture data, its `?state=` query affordances or its components
wholesale.

## Implementation conventions

- Reuse `src/components/v3/` and the v3 shell. Do not add a second kit, a second
  theme mechanism or a parallel layout system.
- Browser data uses the same-origin `/api/db` proxy through `DataClient`, or
  authenticated server functions. PostgreSQL RLS and canonical mutation RPCs
  enforce rules; a screen never decides permissions.
- Prefer an existing read model or RPC. R5-SURF-01 and R5-SURF-02 are surfaces
  over data the repository already writes (`dataset_imports`, `change_events`
  with the reusable `ObjectHistoryTimeline`, project membership and scopes); if a
  new query is genuinely needed, add it at the canonical boundary rather than
  reading tables from the browser.
- Keep empty, denied, stale, unavailable, partial and failed states explicit.
  Never replace a service failure or an unbuilt capability with plausible
  fixture data. An unbuilt capability says it is unbuilt, driven by the
  deployment's capability flags (`src/lib/capabilities.ts`).
- UI work uses the Sheetbase design guidance with Impeccable and is checked on a
  real render at desktop, laptop, tablet and phone widths — the four widths the
  adopted shell already supports.
- Accessibility and keyboard parity are part of the task, not a follow-up: the
  adopted components carry a keyboard model, and drag-and-drop affordances need
  a keyboard path (see R5-STUDIO-02).
- Do not add `?state=` parameters to product routes to make a design state
  visible. If a state needs driving for parity, extend
  `tests/visual/state-driver.ts`.

## Verification commands

Run the layers that cover the change, then the repository gates once.

| Layer                  | Command from the ELN root      | Interpretation                                                                        |
| ---------------------- | ------------------------------ | ------------------------------------------------------------------------------------- |
| Format                 | `pnpm check`                   | Exit 0                                                                                |
| Lint                   | `pnpm lint`                    | Exit 0; report existing warnings accurately                                           |
| Types                  | `pnpm typecheck`               | Exit 0                                                                                |
| Focused unit/component | `pnpm test <named files>`      | Cases pass; no no-tests shortcut                                                      |
| Database               | `pnpm test:db tests/db/<file>` | Real PostgreSQL against a disposable database                                         |
| Full gates             | `pnpm validate`                | Formatting, lint, typecheck, unit and build                                           |
| Database layer         | `pnpm test:db`                 | Run when the change touches SQL, permissions or seeds                                 |
| Visual parity          | `pnpm test:parity`             | Only where a task claims design parity; the corpus records no visual-acceptance claim |

Local database note: `tests/db/design-scenarios.test.ts` refuses to run unless
`SHEETBASE_ENV=test`, `SHEETBASE_DEV_AUTH_FREE=false` and all four role URLs are
loopback URLs naming its own `sheetbase_parity_*` database. `.env.local`'s
`PGRST_DB_URI` must name the Compose host `postgres` for the local PostgREST
container, so pass a loopback override for that variable on the DB layer run;
see [testing.md](../../development/testing.md).

## Acceptance discipline

- A task is accepted when its stated exit is met on the current source and the
  evidence is recorded with the commit, the roles used and the states exercised.
  Screens existing is not acceptance.
- Distinguish implementation merged, acceptance verified, deployment observed and
  deferred scope in every completion claim.
- Hosted CI has never executed on this repository (PLAT-03: the account cannot
  run hosted-runner jobs). Do not cite hosted checks as evidence in either
  direction; the local gates and the recorded acceptance run are the evidence.
- Roadmap 4's reconciliation limits still apply. Completing a task in this
  corpus does not certify the product for release, and the deferred visual and
  browser layers remain separate acceptance work.
