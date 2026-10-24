# Execution and acceptance guide

This guide applies to every task. Read it together with the complete stream specification. The proposal was written against ELN commit `e5801327` on 2 October 2026; it is not an instruction to implement all tasks immediately.

## Establish the checkout

Run from the `sheetbase-eln` repository, not its workspace parent:

```bash
git status --short
git rev-parse HEAD
git diff --stat e5801327..HEAD -- src drizzle tests scripts docs/knowledge .github
```

Compare the named source files with each task's current-state description. Adapt references to ordinary intervening changes; stop and revise the task if its premise or canonical contract has changed. Preserve unrelated local work. Use a scoped `GWP/` branch/worktree for implementation when assigned. Do not merge, publish or deploy from a roadmap proposal.

Read root `AGENTS.md`, `docs/knowledge/NEXT.md`, `docs/knowledge/agent/workflows.md`, the relevant original task, and every governing ADR including later owner amendments. Source code establishes implementation; accepted decisions establish intended contracts. Neither a stale status summary nor a page's existence settles acceptance.

## Implementation conventions

- Browser data uses the same-origin `/api/db` proxy through `DataClient`, or authenticated server functions. Server capabilities, PostgreSQL RLS and canonical mutation RPCs enforce rules.
- Match `src/lib/import-commit.ts`: validate before mutation, pin schema/expected revision, use the canonical commit operation and return row-level errors. Do not invent a feature-specific Dataset writer.
- Match `src/lib/pipelines/data.ts` for typed RPC wrappers and server-owned run identity. Session/actor identity is not supplied as trusted browser input.
- Use stable field, row, Record and version identities. Labels, visible coordinates and file names are presentation, not binding keys.
- Generate schema migrations with the repository workflow. Keep generated SQL/journal/schema consistent; inspect the current migration head before choosing the next migration. No hand-assigned future migration numbers appear in this proposal.
- UI work uses `src/components/v3/` and the repository's Sheetbase design guidance with Impeccable. Inspect actual renders; this proposal makes no visual-completion claim.
- Keep empty, denied, stale, unavailable, partial and failed states explicit. Preserve user input on recoverable errors. Never replace service failure with plausible fixture data.

## Verification commands

These commands were read from package/workflow configuration, not run by the roadmap author. Run only the layers relevant to the assigned change, then the required repository gates once. New test filenames in stream files are proposed deliverables and do not exist merely because the command is listed.

| Layer                 | Command from ELN root                                                               | Required interpretation                                                             |
| --------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Focused unit          | `pnpm exec vitest run <named-test-files>`                                           | Cases pass; no no-tests shortcut                                                    |
| TypeScript            | `pnpm typecheck`                                                                    | Exit 0                                                                              |
| Lint                  | `pnpm lint`                                                                         | Exit 0; report existing warnings accurately                                         |
| Full repository gate  | `pnpm validate`                                                                     | Formatting, lint, typecheck, unit and build pass; not API/browser/DB acceptance     |
| Focused database      | `pnpm exec vitest run --config vitest.db.config.ts <named-test-files>`              | Real PostgreSQL, correct disposable target, no skipped semantic cases               |
| Full database         | `pnpm test:db`                                                                      | Run when changing SQL/permissions; inspect pass/skip totals                         |
| API                   | `pnpm test:api`                                                                     | Running app/PostgREST and dedicated fixture identities                              |
| Browser               | `pnpm test:browser`                                                                 | Functional assertions on the real backend                                           |
| UI regression         | `pnpm test:screens`, `pnpm test:areas`, `pnpm test:phone`, `pnpm test:interactions` | Relevant adopted v3 routes; not a substitute for scientific assertions              |
| Roadmap 4 consistency | `pnpm roadmap:check`                                                                | Use if the implementation updates R4 tracking; do not run sync just to alter status |
| Whitespace            | `git diff --check`                                                                  | Exit 0                                                                              |

Database helpers drop/recreate `sheetbase_test`. Before running them, establish the intended disposable cluster and ensure another worker is not using it. Never target a production database. Service startup, migration and seeding belong to an explicitly disposable environment. Do not print environment secrets in evidence.

The Python broker test is `node --test scripts/test-pipeline-python-runner.mjs`. Real container proof uses `PIPELINE_PYTHON_TEST_IMAGE='<repository>@sha256:<digest>' node --test scripts/test-pipeline-python-container.mjs` with an available reviewed image. Absence of the image can skip tests; a green exit with skipped isolation tests is not acceptance.

## Required evidence for a task

Record the implementation SHA, changed contract, fixture IDs, exact commands and outcomes. Scientific tasks also retain input Dataset Version IDs, schema/field identities, method/runtime versions, row counts, expected/observed values and output digests where applicable. UI tasks retain real renders at desktop and 390px plus keyboard/error-state results.

Every mutation feature needs success, wrong-workspace, denied-role, stale-revision and duplicate/retry cases where applicable. Evidence-boundary features must mutate the live source after submission and prove the earlier result remains unchanged. Restore tests compare restored scientific meaning as well as storage integrity.

Do not accept a test that merely checks a constant, route title or mocked RPC call when the task promises a stored result. Do not suppress runtime errors, loosen assertions or raise snapshot tolerances to achieve a green report.

## Decisions and stopping conditions

Before implementing a new durable contract, record its source of truth, stable identity, lifecycle, permissions, version/freeze behavior and API representation. A new ADR is required only for a real architectural fork, such as changing the authority of existing Sheet materialization; first inspect its current Dataset/snapshot contract. A task's design step is complete when those choices and its acceptance fixtures are explicit.

Stop dependent implementation if it would introduce a second source of scientific values, bypass a capability, mutate published/frozen evidence, expose client-only credentials to a provider, or depend on an unaccepted decision. Continue unrelated work. Escalate a scope change with concrete code evidence rather than improvising a wider redesign.

For performance tasks, proposed starter targets are 100,000 rows and 50 MiB for CSV intake, and complete analysis over at least 100,000 rows. Confirm feasibility with representative instrument fixtures in the task's first step and record hardware, elapsed time and peak memory. Any changed target needs an explicit rationale. Existing small-file format behavior must remain supported; large XLSX is not implicitly promised by a CSV benchmark.

## Handoff

Report what changed, why, exact validation, known limits and unresolved rollout steps. Update one authoritative implementation owner per requirement and the proposal's programme map if this programme has been adopted. Repository-wide activation/promotion of these documents into canonical roadmap knowledge is a separate documentation decision, not inferred from task completion.
