# Sheetbase UI system

## Purpose

This repository defines the UI language before feature screens are built. It is a TanStack Start application with repository-owned, shadcn-style components built on Radix primitives.

## Layers

1. **Foundations** — semantic colour, type, spacing, radius, elevation and motion tokens.
2. **UI primitives** — general controls such as buttons, inputs, dialogs, tables and navigation.
3. **Scientific components** — ELN-specific components such as record status, notebook blocks, plate maps and approval workflows.
4. **Product patterns** — approved arrangements for forms, registries, inspectors and application states.
5. **Page templates** — reference compositions used to begin new screens.

## Rules

- Use semantic tokens. Do not place literal hex colours in feature components.
- Compose existing primitives before creating another primitive.
- A new scientific component must encode reusable domain meaning, not merely a screen-specific layout.
- Keep page headings compact. This is an information-dense application, not a marketing site.
- Use Instrument Sans for headings and Inter for body copy and data.
- Every interactive component must support keyboard operation and visible focus.
- A table is not a spreadsheet by default. Add editing, selection and validation deliberately.
- Desktop inspectors become modal sheets at narrow widths.
- Record status values come from the controlled `StatusBadge` vocabulary.

## Component lifecycle

- `draft`: API and visual behaviour are still being explored.
- `beta`: suitable for prototypes; changes require a short migration note.
- `stable`: ready for product screens; breaking API changes require explicit review.

The machine-readable inventory lives in `src/design-system/registry.ts`.
