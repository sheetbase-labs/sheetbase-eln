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

### Exit

The suite runs in CI with the same Chromium build used for the renders; a
deliberate one-pixel change to a migrated screen fails it.
