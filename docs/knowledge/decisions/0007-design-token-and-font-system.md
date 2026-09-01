# 0007. Design token and font system

- **Status:** accepted
- **Date:** 2026-07-18
- **Ticket:** UI-001

## Context

Phase 1 shipped the API and identity layers with a placeholder Tailwind/shadcn
token set. Phase 2 needs a production UI system that matches `DESIGN.md`, the
brand guide mockup and the now-retired `sheetbase-ui-system-v2` concept
before any screen-level work begins. The token contract had to be settled
before UI-002 onwards so components, screens and the visual review page all
read from one source of truth.

Forces in conflict:

- Use the brand's marketing blue (#2563EB) or the concept system's slightly
  softer signal blue — they are close but not identical.
- OKLCH token values (matching the concept system and modern shadcn) versus
  hex values (matching the brand guide).
- Compact density by shrinking text versus shrinking spacing only.
- Hand-written contrast claims versus measured WCAG 2.2 AA evidence.

## Decision

1. **Token format: OKLCH.** `src/styles.css` defines semantic tokens in OKLCH
   to match the concept system and Tailwind v4 / shadcn defaults. The brand
   guide hex values are the source for the sRGB equivalents but are not used
   directly in product code.
2. **Fonts.** Instrument Sans Variable for headings and display; Inter Variable
   for body, controls and data. Both loaded locally via `@fontsource-variable`
   so the review page and product work offline and without a network font
   service. `--font-display` and `--font-sans` are the only font tokens.
3. **Primary.** A single decisive blue, `oklch(0.55 0.19 255)` in light and
   `oklch(0.68 0.16 255)` in dark. The chart palette (`--chart-1`..`--chart-5`)
   is an ordered sequence, not a free choice.
4. **Density.** `comfortable` (16px root) and `compact` (15px root) via
   `data-density` on `<html>`. Compact tightens the 8-point grid; it does not
   shrink text below the DESIGN.md baseline (12px caption, 13px data, 14px
   body) because component text sizes are fixed in rem relative to the root.
5. **Destructive red.** Darkened from the brand guide value to
   `oklch(0.55 0.21 27)` (light) and `oklch(0.57 0.21 27)` (dark) so that
   white destructive-foreground text passes WCAG 2.2 AA at normal size. The
   brand guide's brighter red remains available for large status badges where
   3:1 applies.
6. **Contrast evidence.** `src/lib/contrast.ts` converts OKLCH → sRGB → WCAG
   relative luminance → contrast ratio. `src/lib/contrast.test.ts` is the
   authoritative AA check for both themes; the `/foundations` review page
   computes ratios from the same util so the page can never show a ratio that
   disagrees with the test.

## Consequences

- Components must use semantic tokens (`bg-primary`, `text-muted-foreground`,
  etc.), never literal palette values. The `/foundations` page is the review
  surface for this rule.
- Adding a new semantic colour requires updating `src/styles.css`, the contrast
  test for any text-bearing pair, and the `/foundations` review page.
- Dark mode is a parallel token set that preserves the same hierarchy, not a
  simple inversion. Both themes are tested.
- The destructive red is intentionally not the brand guide's marketing red.
  Marketing materials may use the brighter red; product UI uses the darker,
  AA-passing token.
- Font loading is bundled, not fetched from a CDN. A new font requires adding a
  `@fontsource-variable` package and a token, not a `<link>` tag.
