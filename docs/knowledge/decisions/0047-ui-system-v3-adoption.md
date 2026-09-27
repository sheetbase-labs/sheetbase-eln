# 0047. UI system v3 adoption

- **Status:** proposed
- **Date:** 2026-09-27
- **Ticket:** Roadmap 4, DSYS-02
- **Amends (if accepted):** ADR-0007 colour values, font tokens and density; ADR-0009 application shell anatomy

## Context

A complete design for the product now exists: 126 screens and a design system
(tokens, brand book, component guidelines), vendored at
[`../design/ui-system-v3/`](../design/ui-system-v3/README.md). It keeps the
direction of ADR-0007 (cool neutrals, one decisive blue, Instrument Sans over
Inter, measured contrast) but changes concrete values, adds a monospace face for
record IDs, adds status, wash and chart tokens, fixes a single dense text scale
(13px interface text), and defines a different application shell and
information architecture from ADR-0009.

The design also ships a canvas implementation (`bundle.js`, `bundle.css`) that
mounts components as `window.Sheetbase.*`. It is untyped, reads a global React,
styles through class and inline style strings and synchronises theme with
`postMessage` between frames.

Forces:

- One visual source of truth versus two partly overlapping token sets.
- Reusing the canvas code for speed versus keeping typed components, Radix
  focus management, contrast evidence and Storybook review.
- Replacing the interface in one step versus migrating while the product keeps
  working.

## Decision

1. **Source of truth.** `design/ui-system-v3/design-system/tokens.json` and its
   README are the visual source of truth for product UI. `src/styles.css` is the
   implementation and is kept in step with it.
2. **Format stays OKLCH.** Values are converted from the design's hex to OKLCH,
   as ADR-0007 requires, and every text-bearing pair is added to
   `src/lib/contrast.test.ts`.
3. **Fonts.** Instrument Sans (headings), Inter (interface and data) and
   JetBrains Mono (record IDs and machine values only), all loaded locally via
   `@fontsource`.
4. **Density.** The design's single density replaces ADR-0007's comfortable and
   compact modes. Interface text is 13px, labels and captions 12px, prose
   14/22px; spacing is not reduced below the design's scale.
5. **No canvas code in the product.** `bundle.js` and `bundle.css` are
   reference only. Components are re-implemented in `src/components/` on the
   existing shadcn/Radix/Tailwind stack and in `sheetbase-components`, keeping their typed props aligned with
   the design's `index.d.ts` where that does not conflict with Radix.
6. **Shell.** The design's shell (44px top bar, 232px navigation with a 48px
   rail, page header, tabs, 300px inspector) replaces ADR-0009's shell.
7. **Theme.** One per-user appearance setting (System, Light, Dark), applied
   through the existing `.dark` class. The design's `data-theme` attribute and
   cross-frame broadcast are not adopted.
8. **Replacement, not coexistence.** Screens migrate route by route; each
   migrated route deletes its superseded components. No legacy UI flag.
9. **Exact parity is the acceptance bar.** Each screen must match its design
   screen, verified by comparing the running route with a render of the design
   screen (`pnpm design:render`, vendored canvas runtime, local fonts) on a seed
   that reproduces the design's data. Differences are resolved by changing the
   code, or by changing the design first; there is no list of accepted
   exceptions.
10. **Full capability.** A screen is accepted only with every control it shows
    working. Capabilities that need a decision are decided within Roadmap 4.
11. **Component packages.** Grids, charts and the filter builder use our
    `sheetbase-components` packages (`sheetbase-table`,
    `sheetbase-explorer`, `sheetbase-advanced-search`), themed to v3 in their
    own repository (ADR-0048 for the grid).

## Consequences

- Every existing screen changes look when the tokens and primitives land,
  before any screen is rebuilt. Visual regressions in untouched screens are
  expected and are fixed by the screen's own migration task, not by holding
  back tokens.
- Adding a colour now means updating the design system first, then
  `src/styles.css`, the contrast test and `/foundations`.
- Components not in the design (for example specialist plate or planner views)
  must use the v3 tokens and primitives or be retired (Roadmap 4, SHELL-04).
- Updating the design snapshot is a reviewed change with checksums, and screens
  that change become migration work items.
- Rejecting this ADR leaves ADR-0007 and ADR-0009 in force; Roadmap 4's
  capability tasks remain valid but would be built in the current UI.

## Review evidence (2026-09-27)

Reviewed against the vendored design and the current code before acceptance.
No blocking discrepancy was found; the owner accepts by setting the status.

- **Tokens.** `design-system/tokens.json` has 50 colour tokens with light and
  dark values and the size tokens topbar 44px, nav 232px, inspector 300px,
  row 32px (sheet 28px) and control 28px, with radius sm 4 / md 6 / lg 10. The
  mapping in [`../roadmap-4/DESIGN_ADOPTION.md`](../roadmap-4/DESIGN_ADOPTION.md)
  covers them and names the tokens `src/styles.css` lacks (`--faint-foreground`,
  `--border-subtle`, `--danger-wash`, the status washes and text, `--chart-grid`,
  `--chart-axis`, `--review`, `--analysis`, `--row-hover`, `--skeleton`,
  `--highlight`).
- **Existing tokens.** `src/styles.css` already defines `--success`, `--warning`,
  `--ring`, `--chart-1..5` and `--violet`; `--violet` is used in 35 places and is
  renamed to `--review` by DSYS-02.3, the literal-colour cleanup step.
- **Fonts.** `@fontsource-variable/instrument-sans`, `inter` and `jetbrains-mono`
  are already dependencies, so decision item 3 needs no new font package.
- **Density.** `src/components/theme-provider.tsx` and `src/styles.css` implement
  ADR-0007's `comfortable`/`compact` modes through `data-density`; DSYS-02.2
  removes them, as decision item 4 requires.
- **Contrast.** `src/lib/contrast.ts` and `src/lib/contrast.test.ts` exist and are
  the evidence path for every text-bearing pair (decision item 2).
- **Components.** `design-system/components/index.d.ts` exports 27 components
  (Button, Menu, MenuItem, MenuSep, MenuLabel, Tooltip, Toast, Banner, Notice,
  EmptyState, Skeleton, Kbd, Avatar, Segmented, Status, Dot, Source, Diff, Tag,
  Chip, Choice, Stepper, Tree, TreeItem, Secret, Icon, theme); DSYS-03/04 map
  them onto `src/components`.
- **Packages.** `sheetbase-table`, `sheetbase-explorer` and
  `sheetbase-advanced-search` are the names in
  [`../roadmap-4/tasks/COMP.md`](../roadmap-4/tasks/COMP.md); none are in the ELN
  `package.json` yet, which is the expected pre-COMP baseline.
- **Renders.** `pnpm design:render` produces light and dark PNGs from the
  vendored snapshot (DSYS-01); that is the exact-parity reference in decision
  item 9.

The owner decision is recorded by changing **Status** above to `accepted` with
the date; this review does not accept it.
