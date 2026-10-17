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

That writes `<pair>-<column>-<theme>.png` — for example
`notebook-sortable-ours-light.png` and `quantity-field-theirs-dark.png` — one per
pair per column per theme, which is the appearance evidence ADR-0055 decision 5
asks for. Appearance is evidence, not the verdict.

The 5,000-row fixture is not an axe target in either engine. One axe pass over
~25,000 nodes per column takes minutes — measured at 5 minutes plus in jsdom and
14.6 minutes for four cases in Chromium — without exercising a rule that the same
component's smaller fixture does not already exercise. That fixture _is_ rendered
in both columns in the browser run and measured for overflow; it is the layout
and cost fixture. If a pair's accessibility changes with list length, add the
fixture back and accept the runtime.

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
   that means the same `notebook-block-reorder.tsx` modules the document uses
   (`NotebookBlockList`, `NotebookBlockRow`, `NotebookBlockHandle`) — and the
   candidate's row chrome is restyled to Sheetbase tokens, because an
   adoption means restyling anyway. **One exception:** where the adoption lands
   in the same change as the comparison, the `ours` column renders the
   implementation that change replaces — vendored into the pair, because the
   file is deleted — and both the pair's comment and the row's limits say so.
   The empty-state pair (`empty-state`) is the case; a pair whose "before" no
   longer exists should not be added otherwise.

5. **Run the checklist** (the commands above), then write the pair's row in the
   comparison record: what we use now, what the candidate offers, each side's
   checklist result, the decision and the reason. A row with no decision is not
   a record, and an adoption without a row may not ship.

   The browser spec runs its generic checks — axe, appearance, Tab order, the
   three screen states and density — against every pair in its `PAIRS` list, and
   fails while the page offers a pair that list does not name. Add the pair's id
   there, and keep the reorder, pointer-drag and 5,000-row tests on the pair that
   reorders rows. Pin whatever the row's decision rests on in a test beside the
   pair (`pairs/<pair>.test.tsx`), so the measurement can be re-run from the
   repository rather than believed.

## Adopting the candidate a pair measures

A candidate that is adopted becomes what the repository uses, so the pair can no
longer compare two mechanisms. Do not retire it silently, and do not leave it
claiming a mechanism the repository no longer ships. The move that keeps both
the evidence and the honesty is:

- re-point our side at the **shipped integration** of the adopted component, so
  the column keeps measuring the code the product renders;
- re-label the other side as the **reference** — the registry item as published,
  with the integration fix-up it was adopted with — and say so in the pair's
  header and its `job` line;
- keep the pair registered. What it measures then is the integration against the
  reference: container semantics, handle placement, restyling, the accessibility
  fix-up. That is where an adoption's regressions actually appear;
- keep the **original** comparison as history in the record row — its revision,
  its measurements and its conditions — rather than overwriting it with the
  adopted state. Row 1 is that case.

The original comparison stays reproducible from the repository alone, at the
revision the row records: check that revision out and its pair, its fixtures and
its measurements are the ones it was measured with. Reproducibility does not
require an obsolete production mechanism to stay executable at HEAD — ADR-0055
decision 4 requires the opposite.

## When a candidate cannot be registered

A pair may only be registered if both columns pass the axe suite: the runbook's
rule is that a violation fails there with no allow-list. A candidate that cannot
pass it in any composition a consumer could ship is **not adoptable**, and its
measurements belong in the comparison record rather than in `pairs/index.ts` —
registering it would either leave `pnpm test` red or ask the suite to tolerate a
violation it exists to catch.

ReUI's `stepper` is the worked example (`component-comparison-record.md`, row 2).
It was installed from the pinned registry, restyled and placed like any other
candidate, then measured three ways without being registered: its structure and
axe result pinned in `component-compare.a11y.test.tsx` (a numbered pin — S1 — in
the same style as C1), the shipped contract run end to end with the candidate
composed in the import flow, and its appearance captured in Storybook. The pin
renders both sides on the same input, so the comparison is reproducible from the
repository alone even though the harness route has no page for it.

## Pair three — the file pick (`import-file-upload`)

Added by workstream B5, which adopts the item in the screens that take a file
(the import flow's upload step, the parser-settings test-file upload, the
instrument ingestion panel and the notebook's file block).

- **Item:** `@reui/use-file-upload`, from the pinned base-nova registry. It is a
  _hook_, not a component — `registry:hook`, whose registry `target` is
  `hooks/use-file-upload.ts` — and it landed at
  `src/components/reui/use-file-upload.ts`, so every registry item stays in the
  one directory ADR-0055 decision 2 names and inside the scoped lint relaxation.
  Install command, read from the item's own page: `npx shadcn@latest add
@reui/use-file-upload`. The item declares no dependencies, and it imports no
  `cn`, so there was no import path to re-point.
- **Shipping integration:** `src/components/v3/ui/file-drop.tsx`. The field holds
  one file at a time, which is what the four call sites need, and takes the
  caller's transport as `onFile`, its validation policy as `validate`, and its
  reason for being disabled as `disabledReason`.
- **The integration fix-up this pair needs.** The hook's `accept` option defaults
  to `"*"` and it writes `accept="*"` onto the input. A wildcard that no file
  type matches is how the attribute reads to a browser dialog and to
  `user-event`'s `upload`, which filters a pick by the input's `accept`: every
  file is dropped before the hook sees it, and the screen looks broken with no
  error anywhere. The field passes its own `accept` _after_ the spread, so the
  attribute is omitted when the caller has none. If you compose the hook
  yourself, do the same.
- **What the pair is.** The fixture's rows are the queued files, built as real
  `File` objects; every fourth starts failed, so a failure and its retry are on
  screen. The first attempt at any file fails once, so the retry a reader clicks
  resolves it. Both columns use that one stand-in transport. The candidate
  column composes the registry item, because the shipping field takes one file
  and a queue is what this pair measures; the pre-adoption column is the shipped
  hand-rolled picker, frozen because the change that adopted the item deleted the
  product's copy.
- **Keyboard route:** in the shipping field the route is the "Choose file"
  button, and the hidden input is `sr-only` with `tabIndex={-1}` — the vendor's
  own examples render it that way, so nothing had to be resolved for axe here.
- **Appearance evidence:** `file-upload-ours-light.png`,
  `file-upload-ours-dark.png`, `file-upload-theirs-light.png`,
  `file-upload-theirs-dark.png`, plus `file-upload-dropped.png` for the
  candidate after a real drop.
- **What to run:** the two vitest suites and the browser spec, as above. The pair
  is selected in the page's own Pair control (`import-file-upload`).

## What this harness does not do

- **A per-test timeout is `test.setTimeout()`, not a third argument.** This
  repository's Playwright ignores `test(title, body, timeout)`, so a test that
  needs more than the config's 30 s fails at 30 s with
  `Test timeout of 30000ms exceeded` while reporting the assertion it was on.
- **The notebook pair cannot be measured at 5,000 rows.** Both of its columns
  mount a rich row per row — ours is the shipped notebook list, where every row
  is a block frame with its own editor surface — so the page never reaches a
  reportable state inside a sane budget. The bulk check runs on a pair whose
  columns are light (`shortcut-keys`) and the notebook pair's density is measured
  at 1440×900 and 390×844 with the long-labels fixture. Row 1a records the limit.

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
