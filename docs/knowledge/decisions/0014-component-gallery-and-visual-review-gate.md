# 0014. Component gallery and visual review gate

- **Status:** accepted
- **Date:** 2026-07-19
- **Ticket:** UI-008

## Context

Phase 2 produced productionised components (UI-002 through UI-007) but the
only place to see them together was the `/foundations` token page, which was
public, token-focused, and did not systematically cover the states a
scientist meets (default, dense, dark, loading, empty, error, disabled,
locked, permission-restricted). Reviewers had no canonical, repeatable way
to compare production against `Mockups/` and the concept system, and there
was no automated accessibility check or stable screenshot path.

Forces:

- The catalogue must use production components with typed, review-only data;
  it must not become a second Storybook with its own fixtures.
- The review surface must not ship to end users in production.
- Reviewers need both themes and both densities, automated a11y, and stable
  screenshots of the highest-value compositions.

## Decision

1. **`/foundations` is the canonical catalogue and visual review gate.** It
   is the single development-only surface that renders every Phase 2
   production component across its states. Sections: colour, typography,
   spacing, icons, core primitives, record header & inspector, notebook &
   visualisation frames, audit trail & approval workflow, scientific status
   & relationships, application shell, component states matrix, contrast
   checks, and a how-to-review guide.

2. **Development-only gate.** The route's `beforeLoad` throws a redirect to
   `/` when `import.meta.env.PROD` is true, so no review surface ships to
   end users. It carries no business data either way.

3. **States matrix.** A dedicated section renders default, loading, empty,
   error, disabled, locked, permission-restricted and read-only states on
   representative production components, with realistic scientific values
   (identifiers like `EXP-2174`, `PR-118`, `RP-0091`; units like `TU/mL`,
   `cells/mL`; large counts like `1,284,506`; long compound names). Dark and
   compact variants are reachable via the header toggles.

4. **Automated accessibility checks.** `src/routes/foundations.a11y.test.tsx`
   runs axe-core against the same production components in their catalogue
   states (audit/approval, scientific status & relationships, notebook &
   visualisation frames, disabled/error/form). Colour-contrast is excluded
   (jsdom does not lay out colour) and is covered by the dedicated contrast
   grid section. This gate already surfaced and fixed a real
   `aria-allowed-attr` bug: `PlateMap` now puts `aria-selected` on the
   `gridcell` rather than the inner `button`.

5. **Stable screenshots.** `pnpm screenshot:gallery` runs an optional
   Playwright script (`scripts/screenshot-gallery.mts`) that captures each
   section in light/dark and compact variants of the highest-value
   compositions to `.amp/in/artifacts/gallery/`. It is a dev tool, not part
   of `pnpm validate`; reviewers run it against `pnpm dev`.

6. **Review procedure.** The catalogue ends with a "How to review against
   mockups and concepts" section that documents the dev-only URL, the
   comparison against `Mockups/` and
   `Concepts/sheetbase-ui-system-v2/src/components/sheetbase/`, theme/density
   toggles, `pnpm test` for a11y, and `pnpm screenshot:gallery` for stable
   screenshots.

## Consequences

- `/foundations` is the canonical visual review gate for Phase 2; every new
  production component update should add or update its section here.
- The catalogue never ships to production (`beforeLoad` redirect).
- `axe-core` and `playwright` are devDependencies; `playwright`'s browser
  binary is installed on demand (`npx playwright install chromium`) and is
  not required for `pnpm validate`.
- `PlateMap`'s `aria-selected` moved from the button to the `gridcell`; the
  UI-006 test was updated to query the `gridcell`.
- Phase 2 is complete; Phase 3 (ELN-001) can begin.
