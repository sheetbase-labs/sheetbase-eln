# A/B component comparison harness

ADR-0055 decision 5 requires evidence before any registry component is adopted,
and decision 4 requires a generic-UI job to be materially better than what the
repository has — a named behaviour missing, or a maintenance burden that is
demonstrably ours. Neither claim can be settled from a screenshot or an
opinion, so this repository carries one surface that renders our implementation
and the candidate side by side, on the same data, under the same checks.

- **Surface:** `/component-compare` (development-only; production redirects to
  `/`, and it carries no business data — the same terms as `/foundations` and
  `/sheetbase-components`).
- **Code:** `src/components/component-compare/`.
- **Results:** [`docs/knowledge/design/component-comparison-record.md`](../knowledge/design/component-comparison-record.md)
  — one row per component, with the checklist result for each side, the
  decision and the reason. That record is the durable part; this page produces
  the evidence it cites.

## Run it

```bash
pnpm dev            # then open http://localhost:3000/component-compare
```

Local development runs auth-free (`SHEETBASE_DEV_AUTH_FREE=true` in
`.env.local`), so no sign-in is needed. The page offers:

| Control   | What it does                                                                                   |
| --------- | ---------------------------------------------------------------------------------------------- |
| Pair      | Which components are being compared (registered in `pairs/index.ts`).                          |
| Fixture   | One of the fixed hostile fixtures below. Both columns render it.                               |
| State     | `ready`, `loading`, `error` or `restricted` — applied to both columns.                         |
| Columns   | `Ours only`, `Theirs only` or `Both`.                                                          |
| Theme     | Light/dark, so a colour question can be answered on the page.                                  |
| Checklist | The fixed checklist, with the control classes this pair does not have marked _not applicable_. |

Both columns are handed **the same scenario object** (one fixture, one state,
one retry callback) — not a copy each. Fixtures are deep-frozen, and the
identity assertion in `component-compare.test.tsx` fails if a column is given
its own copy.

## Fixtures

Fixed in `fixtures.ts`, generated deterministically (the 5,000-row fixture uses
a fixed seed) so a comparison can be reproduced from the repository alone: 0
rows, 1 row, 5,000 rows, very long scientific names and units, mixed types in
one column, a column that is entirely null, and a column of high-precision
values.

## The behavioural checklist

Fixed in `checklist.ts`: keyboard, mouse, state and density, with each item
naming the **control classes** it needs (`reorder`, `sort`, `filter`, `select`,
`resize`, `pagination`). A pair declares which controls its components have; an
item whose control is absent is recorded as _not applicable_, which is a
recorded result rather than a skipped check. A pair cannot narrow the
questions to the ones its candidate happens to pass.

`evidence` on each item says how it is answered:

- **automated** — a test in this repository answers it, and `ref` names it.
- **manual** — a person runs it on this page and the verdict, with its
  observation, is written into the comparison record.

## Automated evidence

```bash
# Structure and roles: both columns, 6 fixtures x 2 sides, 3 states x 2 sides.
# Colour contrast is off here — jsdom does not lay colour out — and on below.
pnpm exec vitest run src/components/component-compare/component-compare.a11y.test.tsx

# Harness contracts (one scenario object to both columns, frozen fixtures,
# keyboard reorder, the state transitions):
pnpm exec vitest run src/components/component-compare/component-compare.test.tsx

# Real engine (~45s): axe with colour contrast ON for both columns in both
# themes, keyboard and pointer reorder, the four state checks, density at
# 1440x900 and 390x844, and the screenshots.
pnpm exec playwright test tests/browser/component-compare.test.ts --project=browser
```

The browser run needs the local service stack (`pnpm services:up`) and the
seeded design users (`pnpm db:fresh`); it signs in as the `gareth` design user
the way every other browser spec does.

Screenshots land in the Playwright test output. To keep them where a reviewer or
a report can point at them:

```bash
COMPONENT_COMPARE_SHOTS=/tmp/component-compare \
  pnpm exec playwright test tests/browser/component-compare.test.ts --project=browser
```

That writes `ours-light.png`, `ours-dark.png`, `theirs-light.png`,
`theirs-dark.png` — one per column per theme, which is the appearance evidence
ADR-0055 decision 5 asks for. Appearance is evidence, not the verdict.

The 5,000-row fixture is not an axe target in either engine. One axe pass over
~25,000 nodes per column takes minutes — measured at 5 minutes plus in jsdom and
14.6 minutes for four cases in Chromium — without exercising a rule that the same
component's smaller fixture does not already exercise. That fixture _is_ rendered
in both columns in the browser run and measured for overflow; it is the layout
and cost fixture. If a pair's accessibility changes with list length, add the
fixture back and accept the runtime.

## Pair notes

Each registered pair, and the things about it a future run has to know.

- **`notebook-sortable`** — the first pair, and the browser spec's default. The
  candidate needed one integration fix-up (its drag handle as a real button, its
  container handed the list's semantics); the measurement and condition C1 are
  in `component-compare.a11y.test.tsx` and in the comparison record.
- **`paging-a-list`** — ours is `src/components/v3/ui/pager.tsx`, theirs the
  stock shadcn `Pagination*`. The columns page through the fixture with the
  pager's own links (`linkFor` also moves the column's page, because the harness
  has one route); the stock column's `href`s are anchors, which is one of the
  reasons the record declines it.
- **`load-more-control`** — theirs is **the deleted implementation**, kept in the
  pair file so the comparison survives the deletion. Its page size is 4, small
  enough that the fixtures' handfuls of rows exercise "more to read", the last
  page and the audit tail's control-less idle state.
- **`list-header`** — ours is `ListHeader`, theirs the inbox header as it was
  hand-composed. The experiments header (count and one full-width action) is the
  same band and is covered by the story, not by the pair, because a column may
  render only one `<header>`.
- **`breadcrumb-trail`** — one trail per column, for the same reason: two
  hand-spelled trails in one column are two same-named `nav` landmarks and axe
  reports `landmark-unique` on the pair rather than on the component.

### Pairs whose components navigate

Four pairs render components that use the router (`Pager`, `Breadcrumb`,
`ListHeader`'s tabs, `LoadMore`'s retry). The two jsdom suites render columns
outside a router, and the real `Link` throws without one, so both files mock
`@tanstack/react-router` with the plain anchor the route suites use, keeping
`aria-disabled` for the disabled state and every other export real. The browser
run uses the real router.

## Adding a pair

1. **Install the candidate from the pinned registry.** `components.json` pins
   `@reui` to the Base UI build (`https://reui.io/r/base-nova/{name}.json`,
   ADR-0055 decision 2). Install it into a scratch directory first: a plain
   install in this repository resolves the item's bare registry dependencies
   into the legacy Radix kit at `#/components/ui`, which decision 1 says is not
   extended.

   ```bash
   mkdir -p /tmp/reui-scratch && cd /tmp/reui-scratch
   # components.json with this repository's aliases and the @reui registry,
   # plus a tsconfig.json with the same `#/*` path, then:
   pnpm dlx shadcn@latest add @reui/<item> --yes
   ```

2. **Place it by hand** under `src/components/reui/<item>.tsx`, and re-point its
   `cn` import from the `cn` package to `#/lib/utils` (the helper that teaches
   tailwind-merge the Sheetbase type scale). Nothing else in the file is edited
   beyond formatting and restyling to Sheetbase tokens; the directory carries
   its own scoped lint relaxation in `eslint.config.js`.

3. **Add the dependencies the CLI chose** at the versions it chose, and
   regenerate `pnpm-lock.yaml`. Keep `@base-ui/react` on the repository's own
   range.

   Then read the item's own semantics before you trust them, and check them in
   axe rather than by eye. The first pair's candidate put `@dnd-kit`'s widget
   role and tab stop (`role="button"`, `tabindex="0"`) on the row container while
   its drag listeners sat on the handle inside it, and rendered that handle as a
   non-focusable `<div>`: axe-clean as published, and keyboard-unreachable for
   the same reason. Rendering the handle as a real `<button>` — the thing an
   integration has to do — turns every row into a widget containing a control,
   which axe reports as `nested-interactive` (serious). The harness column
   resolves it by handing the container the list's own semantics and keeping the
   handle as the single control: an integration fix-up, recorded as a cost of
   adoption rather than hidden in the column. Both halves of that measurement are
   pinned in `component-compare.a11y.test.tsx`. If you have to do this, say so in
   the pair's comment, in the runbook entry for that pair and in the comparison
   record.

4. **Write the two column adapters** in `pairs/<job>.tsx` behind the
   `ComparisonColumnProps` contract, and register the pair in `pairs/index.ts`
   with its `job` and its `controls`. A pair is data; do not add a bespoke
   comparator. Our side renders the code that ships — for the notebook's list
   that means the same `notebook-block-reorder.tsx` hook the document uses —
   and the candidate's row chrome is restyled to Sheetbase tokens, because an
   adoption means restyling anyway.

5. **Run the checklist** (the commands above), then write the pair's row in the
   comparison record: what we use now, what the candidate offers, each side's
   checklist result, the decision and the reason. A row with no decision is not
   a record, and an adoption without a row may not ship.

## What this harness does not do

- It does not decide anything, and it does not gate adoption by itself: axe,
  screenshots and the checklist are evidence for the record.
- `empty`, `loading` and `error` are states of a whole screen, and the harness
  owns them: both columns show the same harness notice, so those checklist items
  measure containment and keyboard order rather than any shipped empty state.
  The notebook does have one — `notebook-document.tsx` renders its own
  "Start this Notebook" panel for a record with no blocks — but a column renders
  the component under comparison, not the whole document. `restricted` is
  component-specific: each column renders its own disabled affordances.
- Pairs are added as screens are touched, not on spec. The catalogue is the
  starting list, never a shortlist.
- The results and the decisions live in
  [`docs/knowledge/design/component-comparison-record.md`](../knowledge/design/component-comparison-record.md),
  one row per component. Read the row before proposing an adoption, and update it
  in the change that adopts.
