# Baseline and daily use

Planned at `e5801327`, 2 October 2026. All tasks are proposed. Follow [GUIDE.md](../GUIDE.md). Source inspection supports these gaps with high confidence; runtime failures and hosted CI status have not been re-established.

## R5-BASE-01: reconcile current implementation and task ownership

**Reconciliation update, 2 October 2026:** the Roadmap 4 audit, original-owner
mapping and current-handoff/tracker updates are recorded in
[RECONCILIATION.md](../../../roadmap-4/RECONCILIATION.md) at
`9bbd305c`. This satisfies that documentation slice. Roadmap 5 remains proposed;
confirm the selected extensions and their dependency exits before assigning it.
No hosted CI, merge or deployment status was inferred.

**Outcome:** another developer can identify what is implemented, accepted, deferred and actually next without choosing between contradictory status files. Priority P0, effort M, low risk, no dependencies.

**Current state and scope:** `docs/knowledge/NEXT.md` describes a September baseline; `roadmap-4/NEXT.md` describes active UI-port work; `UI_PORT_SCREENS.md` predates capabilities recorded in `UI_PORT.md` and current code. Accepted ADR-0045/0047/0048 and the record-model decision also need to be reflected correctly. Scope includes these documents, the existing R4 tracker, `sdks/RELEASE.md`, and the requirements named in this proposal's baseline register.

**Steps:**

1. Record branch/SHA and current PR/check evidence if available. Trace each carry-over to its code and original exit; classify implemented, independently accepted, partial, deferred or unverified.
2. Assign exactly one original task owner to each unfinished requirement. Specifically resolve Models-as-Dataset-schema versus ADR-0051 and active grid/formula consumers versus ADR-0048. Do not close a task from its route name or dependency declaration.
3. Reconcile root/current handoff and tracker summaries with that evidence. Record which R5 tasks can proceed and which exact exits block them. Keep old failure evidence dated unless reproduced.

**Verification/exit:** `pnpm roadmap:check`, the existing `tests/unit/roadmap-4-tracker.test.ts`, a local-link check and `git diff --check` pass. Every carry-over row has a current source reference, disposition and owner; contradictory current-status claims are removed. No source implementation, ADR acceptance, merge or deployment is bundled into this task.

## R5-BASE-02: automate a complete scientific release gate

**Outcome:** a clean environment proves the scientific workflow and its permission boundary before release. Priority P0, effort L, medium risk. Depends on BASE-01.

**Current state and scope:** `.github/workflows/ci.yml` runs unit/DB/build and real-service screenshot parity, but excludes functional API/browser suites. `tests/browser-scripts/{screens,crawl,phone}.mjs` suppress maximum-update-depth errors. Scope: CI service setup, test fixtures/helpers, selected current canonical APIs, and narrow fixes demonstrated by these tests. Existing old review-acceptance tests are examples of intent, not automatically valid current contracts.

**Steps:**

1. Create one deterministic fixture using canonical Dataset/Sheet/Record operations, two workspaces and distinct editor/reviewer/viewer sessions. Reuse existing service provisioning; isolate databases and ports.
2. Add `tests/api/roadmap5-workflow.test.ts` and `tests/browser/roadmap5-workflow.spec.ts`: instantiate a template, import rows, edit through a composed Sheet, analyse, submit/review, change live data, reconstruct the frozen result. Assert exact IDs, values, write targets and denied operations.
3. Reproduce the suppressed browser-error class on this path and fix its cause before removing suppression. Do not assert it currently reproduces merely from the ignore rule. Make the new bounded workflow a CI gate, retaining traces and fixture/SHA metadata.

**Verification/exit:** run the new API test with `vitest.api.config.ts`, `pnpm exec playwright test --project=browser tests/browser/roadmap5-workflow.spec.ts`, relevant DB tests and `pnpm validate`. A fresh-stack run passes without network mocks, skipped semantic tests or runtime-error suppression; frozen values remain identical after source edits. Exclude real provider services and unrelated screen coverage expansion.

## R5-BASE-03: guide the first scientific outcome and genuine resumption

**Outcome:** an empty-workspace scientist reaches a useful draft; a returning user resumes their own work. Priority P1, effort M, medium risk. Depends on BASE-01; WORK-02.2 retains ownership of its existing first-run requirement.

**Current state and scope:** `src/routes/index.tsx:117` reads recently updated workspace experiments and renders Home's operational sections. WORK-02 specifies a state-derived first-run checklist. `src/routes/experiments/new.tsx` already creates project experiments and links protocols/materials. Scope: Home data, personal recent-object state, existing project/template entry points, and role-aware setup guidance.

**Steps:** derive next actions from real membership/creation/certification state; make recent work attributable to the person rather than relabel workspace updates; connect an existing approved template to project → experiment → first Dataset entry. Persist only genuine progress, with safe retry/reload. A viewer gets read-only guidance rather than inaccessible create/sign actions.

**Verification/exit:** add `tests/browser/first-scientific-outcome.spec.ts`; run it with `pnpm exec playwright test --project=browser tests/browser/first-scientific-outcome.spec.ts`, affected unit tests and `pnpm validate`. Empty, returning and viewer accounts reach their appropriate outcome; reload does not reset completed work or duplicate objects; the draft uses real canonical IDs. No generic tour, silent demo seeding or new template engine.

## R5-BASE-04: make filtered search complete

**Outcome:** selecting a type/date/archive filter finds every matching accessible object, including those beyond the initial result page. Priority P1, effort M, medium risk. Depends on BASE-01; SRCH-02 remains the implementation owner.

**Current state and scope:** `src/routes/search.tsx:102` requests 100 results, then computes facets and filters locally. `src/lib/search.ts:165` already builds several server filters. Scope: canonical search RPC/migration, search request/query keys, URL state, result counts and pagination. Extend existing `tests/db/{search,data-04-search}.test.ts` and `tests/api/search.test.ts`.

**Steps:** define stable server ordering and page semantics; send the selected filters before applying limits; return permission-scoped counts with the same predicates; wire page navigation and query keys; preserve deep links and an explicit no-results state. Reuse existing indexed result types first.

**Verification/exit:** run the named DB suites sequentially, the API search suite and `pnpm validate`. A fixture with over 100 matches retrieves an item previously outside the first page after filtering; tied rankings do not duplicate/omit records; forbidden objects influence neither results nor counts. No semantic search, extra indexing types or fixture-only facet counts.
