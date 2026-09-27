# DSYS — Design System Adoption

**Status (2026-09-27):** DSYS-01 delivered with the Roadmap 4 proposal; DSYS-02..06 proposed. Adoption depends on [ADR-0047](../../decisions/0047-ui-system-v3-adoption.md) being accepted. Strategy: [`../DESIGN_ADOPTION.md`](../DESIGN_ADOPTION.md).

## Programme goal

Make UI system v3 the product's only visual language by re-implementing its
tokens and components in `src/`, with the same evidence standards as ADR-0007.

## Baseline at `main` `9538f36`

- `src/styles.css` holds OKLCH tokens close to the design (Inter, Instrument
  Sans, blue primary) with two density modes; there is no monospace token,
  no wash/text variants for status colours, and the chart palette differs.
- shadcn primitives in `src/components/ui/` (48 files) and scientific
  components in `src/components/scientific/`, with 87 Storybook stories and the
  `/foundations` review page.
- `src/lib/contrast.ts` and its test are the contrast authority.

## DSYS-01 — Vendor the design reference and render it

**Status:** delivered with this proposal.

### Goal

Put the design in the repository, verbatim and checkable, and make it
renderable without the design canvas so every screen can be used as a test
baseline.

### Exit

`docs/knowledge/design/ui-system-v3/` contains the 126 canvas screens,
`canvas.json`, the design system, the canvas runtime, per-screen text extracts,
a regeneration tool and `SHA256SUMS`, excluded from Prettier so it stays
byte-identical. `pnpm design:render` renders every screen in light and dark
to `tests/visual/design-reference/` using local fonts
(`@fontsource-variable/inter`, `instrument-sans`, `jetbrains-mono`) and no
network; repeated renders are byte-identical.

## DSYS-02 — Tokens

**Status:** proposed; after [DEC-01](DEC.md).

### Goal

`src/styles.css` implements every token in `design-system/tokens.json`.

### Design

`design-system/tokens.json`, `design-system/README.md`; mapping table in
[`../DESIGN_ADOPTION.md`](../DESIGN_ADOPTION.md#1-tokens--dsys-02).

### Scope

- Convert all 50 colour tokens (light and dark) to OKLCH and map them onto the
  existing shadcn names, adding the new semantic tokens.
- Use JetBrains Mono (`@fontsource-variable/jetbrains-mono`, already a
  dependency for the reference renderer) for `--font-mono`.
- Add type utilities for the eight design type styles and layout size tokens.
- Replace the two density modes with the design's single density.
- Set radius (4/6/10px) and the two overlay shadows; remove other shadows.
- Map the `sheetbase-components` theme variables onto these tokens (COMP-01).
- Extend `contrast.test.ts` with every text-bearing pair the README names,
  including `text-faint` on `surface` and `surface-muted`, status text on
  washes, and white on `accent-strong` in both themes.
- Update `/foundations`.

### Start here

- `src/styles.css`: `:root` and `.dark` blocks (semantic variables),
  `@theme inline` (Tailwind names for them), `@layer base` (root font size and
  the `data-density='compact'` rule).
- `src/components/theme-provider.tsx`: theme and density state
  (`sheetbase-theme`, `sheetbase-density` in `localStorage`).
- `src/lib/contrast.ts` and `src/lib/contrast.test.ts`: OKLCH → sRGB →
  contrast ratio, and the per-theme AA pair tests.
- `src/routes/foundations.tsx`: the review page for tokens, type and contrast.
- Design source: `design-system/tokens.json` (50 colours with light and dark
  values, type styles, spacing, radius, shadows, sizes).

### Worked example

This task is written out in full as the model for the others.

1. **Branch.** `git switch -c dsys-02-tokens`.
2. **Generate the values, don't hand-type them.** Write
   `scripts/design-tokens.mts` that reads `tokens.json` and prints, for each
   colour token and theme, the OKLCH value (convert with the inverse of the
   maths already in `src/lib/contrast.ts`; round L to 3 decimals, C to 3, H to
   1). Commit the script so the conversion can be re-run whenever the design
   snapshot changes. Add a unit test that converts three known hexes
   (`#006EDC`, `#0F141C`, `#FDFDFF`) and checks the round trip to within one
   8-bit step.
3. **Rewrite the variable blocks.** In `:root` and `.dark`, set the existing
   shadcn names from the mapping table in
   [`../DESIGN_ADOPTION.md`](../DESIGN_ADOPTION.md) (for example `--background` =
   `bg`, `--primary` = `accent-strong`, `--accent` = `surface-hover`,
   `--ring` = `focus`) and add the new ones (`--selection`, `--link`,
   `--faint-foreground`, `--danger-text`, `--success-wash`, `--review`,
   `--analysis`, `--grid-line`, `--surface-derived`, `--chart-grid`, …). Rename
   `--violet` to `--review` and update its few users
   (`grep -rn "violet" src`). Expose every new variable in `@theme inline` as
   `--color-<name>` so Tailwind utilities like `bg-selection` exist.
4. **Fonts.** Import `@fontsource-variable/jetbrains-mono` at the top of
   `styles.css`; set `--font-mono: 'JetBrains Mono Variable', ui-monospace, monospace`.
5. **Type, spacing, radius, shadow, sizes.** Add `@utility` rules for
   `text-page-title` (Instrument Sans 20/26 600), `text-section` (15/20 600),
   `text-doc-heading` (16/22 600), `text-prose` (14/22), `text-body` (13/18),
   `text-label` (12/16 500), `text-caption` (12/17), `text-id` (JetBrains Mono
   12/16). Set `--radius: 6px` and point `--radius-sm/md/lg` at 4/6/10px. Add
   `--shadow-overlay`, `--shadow-dialog` and the five layout sizes
   (`--topbar-height` 44px, `--nav-width` 232px, `--inspector-width` 300px,
   `--row-height` 32px, `--control-height` 28px).
6. **One density.** Delete the `html[data-density='compact']` rule, the density
   state and setter in `theme-provider.tsx`, and every caller
   (`grep -rn "density" src --include=*.tsx`: app-shell, analysis route,
   data-grid, instrument-monitor, configuration workspace, sheet workspace,
   compare view, a story). Set the root font size so `text-body` is 13px.
7. **Contrast evidence.** In `contrast.test.ts`, replace the pair lists with
   the v3 pairs for both themes: `text`, `text-muted`, `text-faint` on `bg`,
   `surface` and `surface-muted`; `on-accent` on `accent-strong`; `accent` (link)
   on `surface`; `danger-text` on `surface` and `danger-wash`; `warning-text` on
   `surface` and `warning-wash`; `success-text` on `success-wash`;
   `inverse-text` on `inverse-bg`. All need 4.5:1. Run `pnpm test contrast`.
8. **Remove literal colours.** Replace the 225 Tailwind palette classes
   (`grep -rhoE "\b(bg|text|border)-(red|green|blue|amber|yellow|slate|gray|zinc|emerald|violet|purple|sky|orange|rose)-[0-9]{2,3}" src`)
   with semantic tokens. Add an ESLint rule (`no-restricted-syntax` on class
   strings, or a small custom rule) that fails on new palette classes and on
   hex/`rgb(` literals in `src/**/*.tsx`.
9. **Foundations.** Update `/foundations` so its palette, type and contrast
   sections read the new variables and the same pair list as the test.
10. **Screenshot.** Run `pnpm dev`, open `/foundations` and a few busy pages
    (`/`, `/projects`, a notebook) in both themes and attach before/after
    screenshots to the PR. Expect every page to change; that is the point.

### Steps (PRs)

1. Conversion script, variables, fonts, type/radius/shadow/size utilities,
   contrast tests, `/foundations` (steps 2–5, 7, 9).
2. Remove density (step 6).
3. Replace literal colours and add the lint rule (step 8). This one is large;
   split by folder (`src/components/*`, then `src/routes/*`) if it exceeds a
   comfortable review.

### Check it

`pnpm test contrast`, `pnpm lint`, `pnpm typecheck`, `pnpm validate`; `/foundations`
in both themes matches the colours in `pnpm design:render States` side by side.

### Exit

Every design token has one implementation variable; the contrast test passes
for all text pairs in both themes; `/foundations` renders the palette, type
scale and contrast table from the same sources; no product code uses a literal
colour.

## DSYS-03 — Primitives restyled in place

**Status:** proposed.

### Goal

Existing primitives render as the design specifies without changing call
sites.

### Design

`design-system/components/{Button,Menu,Dialog,Field,Tabs,Table,Toast,Banner,EmptyState,Skeleton,Avatar,Status,Icon}/README.md`;
`canvas/States.dc.html` (hover, focus, pressed, disabled, open, invalid,
read-only states); `canvas/FocusOrder.dc.html`.

### Scope

- `Button`: variants primary, secondary, quiet, danger, danger-fill; sizes
  sm 24px, md 28px, lg 44px; icon-only with required `aria-label`; disabled
  keeps its label. Map existing variant names so call sites keep working, then
  rename in one sweep.
- Tabs 36px with a 2px underline; inputs and selects 28px; field label above,
  hint and error below.
- Dropdown and context menus: `surface`, 1px border, `shadow-overlay`,
  destructive items last after a separator.
- Toasts (sonner): bottom centre, 6 s, one at a time, Undo only when
  reversible, failures persist until dismissed.
- Split `Alert` into page-level `Banner` (warn, bad, review washes) and local
  `Notice` (info, warn, bad).
- `StatusBadge` rebased on the nine design tones (dot plus plain text).
- Record table density: 31px header at 12px, 32–33px rows at 13px, right-aligned
  numbers, selected row wash.
- Icon set: port the design's 49 icons to `src/components/icons/` with exact
  paths; replace Lucide where the design has an equivalent.
- Focus ring 2px `focus` with 1px offset everywhere.

### Start here

- `src/components/ui/button.tsx`: `buttonVariants` (today `default`,
  `destructive`, `outline`, `secondary`, `ghost`, `link`, `subtle`; sizes
  `default`, `xs`, `sm`, `lg`, `icon*`). Usage today: `outline` 336, `ghost`
  134, `size="sm"` 358 (`grep -rhoE 'variant="[a-z]+"' src | sort | uniq -c`).
- `src/components/ui/{tabs,input,select,field,dropdown-menu,context-menu,dialog,alert-dialog,alert,tooltip,sonner,empty,skeleton,kbd,avatar,table,toggle-group}.tsx`
  and their stories in `src/stories/`.
- `src/components/scientific/status-badge.tsx` and `data-table.tsx`.
- The design's reference implementation for exact CSS values:
  `design-system/components/bundle.css` (search `.btn`, `.tabs`, `.menu`,
  `.toast`, `.t`, `.dot`) and `bundle.js` (icon paths).

### Steps (PRs)

1. **Icons.** Create `src/components/icons/index.tsx` exporting an `Icon`
   component and a typed name union from the 49 paths in `bundle.js`
   (16×16 viewBox, 1.4 stroke, round caps and joins, `currentColor`,
   `aria-hidden`). Story showing all icons. Replace Lucide imports whose icon
   has a v3 equivalent (154 files import Lucide; do it folder by folder).
2. **Button.** New variants `primary`, `secondary` (default), `quiet`,
   `danger`, `danger-fill`; sizes `sm` 24px, `md` 28px, `lg` 44px, plus
   `iconOnly`. Keep the old names as aliases in this PR (`default`→`primary`,
   `outline`→`secondary`, `ghost`→`quiet`, `destructive`→`danger-fill`), then
   a follow-up PR renames all call sites and removes the aliases. Component
   test: every variant and size renders, disabled keeps its label,
   `iconOnly` without `aria-label` fails a dev-time assertion.
3. **Form controls and tabs.** Inputs/selects 28px, labels above, hint and
   error lines; tabs 36px with 2px underline and counts.
4. **Menus, dialogs, tooltips, toasts.** Values from `bundle.css`; toasts
   bottom centre, 6 s, single visible, Undo only when passed an undo handler,
   `tone="bad"` persists.
5. **Banner and Notice.** Split `alert.tsx`; migrate existing `Alert` uses to
   whichever matches (page-level vs local).
6. **Status and table.** Nine tones on `StatusBadge`; `data-table` density,
   numeric alignment, selected row.
7. **States story.** A Storybook story that lays out every state in
   `canvas/States.dc.html`; compare it with `pnpm design:render States`.

### Check it

`pnpm test src/components/ui`, `pnpm storybook` (visually against the States
render in both themes), `pnpm validate`.

### Exit

The `States` board can be reproduced in Storybook component by component in
both themes; component tests cover variant, size and disabled behaviour;
Lucide usage is limited to icons the design lacks.

## DSYS-04 — New design components

**Status:** proposed.

### Goal

Add the design components the codebase does not have.

### Design

`design-system/components/{Source,ChipTag,Choice,Stepper,Tree,Secret,Notifications,Appearance}/README.md`;
`design-system/components/index.d.ts`.

### Scope

`Source` (dataset, record, calc, local), `Diff` (before/after, legible without
colour), `Tag` (add, chg, del), `Chip` (removable filter with named remove
label), `Choice` (option with consequence line), `Stepper` (3–5 steps, done,
now, failed), `Tree`/`TreeItem` (two levels, `aria-current`), `Secret`
(shown once, copy with toast), `Segmented` appearance switch. Each has typed
props, a story, a component test and an accessibility check.

### Start here

- Props: `design-system/components/index.d.ts`; behaviour: the component
  READMEs listed above; CSS: `bundle.css` (`.src`, `.diff`, `.tag`, `.chip`,
  `.choice`, `.stepper`, `.tree`, `.secret`, `.seg`).
- Existing near-matches to replace or build on:
  `src/components/audit/approval-stepper.tsx`, `src/components/ui/toggle-group.tsx`,
  `src/components/project-navigation-tree.tsx`.

### Steps (PRs)

1. `Source`, `Diff`, `Tag`, `Chip` in `src/components/scientific/` and
   `src/components/ui/`, with stories and tests (Diff must use `<del>`/`<ins>`).
2. `Choice`, `Stepper` (`steps`, `current`, `failed`), `Secret` (copy button
   calls the toast; never re-renders the value after unmount).
3. `Tree`/`TreeItem` (keyboard: ↑↓ move, → expand, ← collapse;
   `aria-current="page"`), `Segmented` for the appearance switch.
4. A mapping table in `src/components/ui/README.md` from every name in
   `index.d.ts` to its product component.

### Check it

`pnpm test`, axe checks in component tests (`jest-axe` style assertions or
Testing Library role queries), stories for every state in both themes.

### Exit

Every component in the design's `index.d.ts` has a product implementation
or a documented mapping to an existing primitive.

## DSYS-05 — Design-data seed

**Status:** proposed.

### Goal

The application can show exactly the data the design screens show.

### Design

Every screen; the text extracts in `design/ui-system-v3/screen-text/` list the
values. The scenario: Process Development workspace (and the Analytical
Development, GMP Manufacturing and Quality Control workspaces in the switcher);
projects PRJ-0181..0217 with clients, stages, leads and milestones;
experiments EXP-0117..0145; datasets DS-0188..0311 with every snapshot, row
and flag shown; samples SMP-1002..2252 with lineage, withdrawals and holds;
materials MAT-0342..0420; protocols PRT-006..024 with versions and training;
templates TPL-006 and the others listed; models MDL-0004..0019 and cell banks
CB-0006..0012; instruments including INS-0007; pipelines PL-0003..0016 with
runs #22, #61, #143..148; tokens, integrations, webhook deliveries, audit
entries, comments, notifications and bookings; people Gareth P., Priya S.,
Mei L., Tom H., Sam R., Anna B. and the CL-017 client users.

### Scope

- `pnpm db:seed:design` creates all of it through canonical RPCs (no direct
  table writes), extending `src/db/seed/`, with a fixed clock of Friday 25
  September 2026 in Europe/London so "09:32", "Yesterday" and "6 days" render
  as in the design.
- A per-screen fixture state (which user is signed in, which row is selected,
  which menu is open) recorded next to the seed so each design screen can be
  reached deterministically.
- A check that fails when a value on a design screen has no seeded source,
  derived from `screen-text/`.

### Start here

- `src/db/seed/run.ts` (`SeedStep`, `fixtureSteps`, `demoSteps`, CLI flags
  `--demo`, `--month`), `src/db/seed/identities.ts` (stable UUID ranges),
  `src/db/seed/month.ts` (a large multi-step example), `docs/development/seeds.md`.
- The values: `docs/knowledge/design/ui-system-v3/screen-text/*.txt`.
- Existing RPCs to call (search `drizzle/` for `CREATE OR REPLACE FUNCTION api.`):
  projects, records, blocks, sheet instances, datasets, samples, reagents,
  calendar, pipelines, API credentials, comments.

### Steps (PRs)

1. **Frame.** Add `designSteps` and a `--design` flag to `run.ts` (and to
   `src/db/fresh.ts`), a new identity range `…0300`–`…0fff` in
   `identities.ts`, a fixed clock (`2026-09-25T09:40:00+01:00`) passed to every
   step so timestamps are deterministic, and the six people plus the four
   workspaces.
2. **One PR per screen group**, following the page order in the design index
   (Workspace, Experiment, Review, Records, Sheets and templates, Analysis and
   search, Pipelines, Models, Settings). Each PR seeds exactly what its screens
   show. Data that needs a capability not built yet is seeded by the task that
   builds that capability (the task's own step list says so).
3. **Screen states.** `tests/visual/design-states.ts` mapping each design
   screen to: route, signed-in user, and actions to reach its state (open a
   menu, select a row, switch tab).
4. **Coverage check.** `scripts/design-seed-coverage.mts`: for each
   `screen-text` line that looks like data (IDs, numbers with units, names,
   dates), check it appears in the seeded database or in fixed UI copy; print
   unmatched values per screen. CI runs it once DSYS-06 exists.

### Check it

`pnpm db:fresh --design` twice (second run changes nothing); open `/` as Gareth
P. and compare with the Main render; the coverage script's unmatched count
goes down with every PR and reaches zero at the end of Roadmap 4.

### Exit

Every value visible on every design screen is produced by the seed through
the real data layer; the check reports no unmatched values.

## DSYS-06 — Visual parity suite

**Status:** proposed.

### Goal

CI fails when a migrated route does not look exactly like its design screen.

### Scope

- A Playwright project (`pnpm test:parity`) that, per design screen: seeds
  (DSYS-05), signs in as the screen's user, opens the route, drives it into the
  screen's state, sets the frame size and theme, and asserts
  `toHaveScreenshot` against the DSYS-01 render as the expected image.
- A fixed, small pixel tolerance for anti-aliasing only; no per-screen
  exceptions.
- Runs in CI on every PR touching UI, `src/styles.css`, the design snapshot or
  a `sheetbase-components` version; renders are produced in the same job.
- A coverage report of design screens with and without a passing parity test;
  Roadmap 4 is complete when all 126 pass.

### Start here

- `playwright.config.ts` (single project today, `tests/browser`,
  dev server on 3100); `scripts/design-reference.mts` (renders);
  `tests/visual/design-states.ts` (from DSYS-05).
- Sign-in for tests: `tests/browser/phase4-proof.test.ts` inserts a short-lived
  Better Auth session for a seeded user; reuse that approach for the six design
  users.

### Steps (PRs)

1. Add a `parity` project to `playwright.config.ts` with `testDir:
tests/visual`, `snapshotPathTemplate:
'{testDir}/design-reference/{arg}{ext}'` so the renders are the expected
   images, `expect.toHaveScreenshot.maxDiffPixelRatio` set once (start at
   `0.001`; never per test), fixed `deviceScaleFactor: 1`, fonts from
   `@fontsource` only, animations disabled. Script `test:parity`: runs
   `pnpm design:render` then the project.
2. `tests/visual/parity.spec.ts` that loops over `design-states.ts`, seeds once
   (`pnpm db:fresh --design` in global setup), signs in, navigates, applies the
   state, sets the viewport and colour scheme, and calls
   `expect(page).toHaveScreenshot('<Screen>-<theme>.png')`. Screens not yet
   migrated are listed as `pending` and reported, not skipped silently.
3. CI job in `.github/workflows/` using the same Chromium build as the renders;
   upload the diff images on failure; print the coverage report
   (passing / pending / failing screens).

### Check it

Change one pixel of padding on a migrated screen and confirm the job fails with
a diff image; revert and confirm it passes.

### Exit

The suite runs in CI with the same Chromium build used for the renders; a
deliberate one-pixel change to a migrated screen fails it.
