# 0008. Core shadcn primitives as source-owned, hardened from the concept system

- **Status:** accepted
- **Date:** 2026-07-18
- **Ticket:** UI-002

## Context

The now-retired `sheetbase-ui-system-v2` prototype defined the intended
variants and styling for the shadcn primitive set. Phase 2 needs
those primitives in production `src/components/ui` with consistent focus,
disabled state, destructive confirmation, keyboard-operable overlays and
programmatic label/description/error wiring — and tests — before UI-003
onwards can build real screens.

Forces:

- Copy the concept files verbatim, or adapt them to the production token
  set (UI-001) and add what the concept system lacks (tests, focus
  consistency, a11y wiring).
- Use the `npx shadcn add` generator or own the source. The project
  convention (FND-002) is source-owned shadcn — the generator is not used.
- Add every primitive the concept system has, or only what the next
  tickets need. TODO.md says "only the primitives needed by the next
  tickets."

## Decision

1. **Source-owned, in `src/components/ui`.** Primitives are first-party
   source, not generated. `src/components/ui/index.ts` is the barrel.
   Imports use `#/components/ui` per `components.json`.
2. **Same variants as the concept system.** Button, badge, field, dialog,
   sheet, dropdown-menu, tabs, table, tooltip, separator, command, input,
   textarea, label, alert-dialog. No new variants, no screen-specific
   variants until two real consumers justify them (TODO.md requirement).
3. **Token-correct, not literal.** Where the concept used literal colours
   (`text-white` on destructive buttons), production uses the semantic
   token (`text-destructive-foreground`) so the AA-passing token from
   UI-001 is the single source of truth. Status badge text colours are
   the AA-passing equivalents in both themes.
4. **Uniform focus.** Every interactive primitive has
   `focus-visible:ring-2 focus-visible:ring-ring/50` with a 2px offset
   against `--background`. The concept's ring coverage was inconsistent;
   production is uniform.
5. **Destructive confirmation = AlertDialog.** `AlertDialog` (role=
   `alertdialog`) is the contract for irreversible actions. Only the
   action and cancel buttons dismiss it. `Dialog` remains for
   non-destructive overlays.
6. **Programmatic field semantics.** `FieldError` has `role="alert"`;
   `Input`/`Textarea` respond to `aria-invalid` with a destructive ring
   and border. Pair `FieldLabel` with an input via `htmlFor`/`id` and
   reference descriptions/errors with `aria-describedby`.
7. **Tests.** Keyboard interaction (ArrowRight tab navigation, Escape on
   Dialog, Cancel/Action on AlertDialog), aria contracts, disabled state,
   `asChild` slotting, and variant rendering are covered in
   `src/components/ui/*.test.tsx` using `@testing-library/user-event`.
8. **Live review.** `/foundations` has a "Core primitives" section
   rendering real instances so reviewers can exercise them in both themes
   and densities without a separate Storybook app.

## Consequences

- New screens import primitives from `#/components/ui`, not from the
  concept system. The concept system remains reference-only.
- Adding a new variant requires updating the CVA in the primitive, the
  `/foundations` showcase, and a test — not editing concept files.
- Adding a new primitive is allowed only when at least one upcoming
  ticket needs it (TODO.md). Avoid pulling the full concept library in
  one pass.
- Destructive actions must use `AlertDialog`. Using `Dialog` for an
  irreversible action is a review fail.
- No Storybook. The `/foundations` route and the UI-008 catalogue route
  are the review surfaces.
