---
title: UI System v2 — Historical Design Concept
status: historical
last_reviewed: 2026-08-30
related:
  - DESIGN.md
  - PRODUCT.md
  - Concepts/sheetbase-ui-system-v2
---

# UI System v2 — Historical Design Concept

This document preserves the durable design intent from the standalone `Concepts/sheetbase-ui-system-v2` prototype.

The **current canonical visual implementation guidance remains root [`DESIGN.md`](../../../DESIGN.md)** and the accepted design ADRs. This historical concept is useful because it records the original component-system structure and product-design rules that informed the current application.

## Prototype purpose

The UI v2 concept was created to define the UI language before feature screens were built. It used TanStack Start, React, Tailwind, shadcn-style repository-owned components and Radix primitives.

The prototype application acted as a visual catalogue / Storybook-style reference rather than the production Sheetbase application.

## Five design layers

The concept organised the UI system into:

1. **Foundations** — semantic colour, typography, spacing, radius, elevation and motion.
2. **UI primitives** — general controls such as buttons, inputs, dialogs, menus, tables and navigation.
3. **Scientific components** — reusable domain components such as status, record links, notebook blocks, charts, plate maps, approvals and audit trails.
4. **Product patterns** — approved arrangements for registries, inspectors, forms and scientific application states.
5. **Page templates** — reference compositions for starting product screens.

That layered model remains useful when deciding whether a new UI element belongs in the design system or only one screen.

## Durable rules from the concept

- Use semantic design tokens rather than literal presentation values in feature components.
- Compose an existing primitive before creating another primitive.
- A scientific component should encode reusable domain meaning, not merely screen-specific layout.
- Keep product page headings compact; Sheetbase is an information-dense application rather than a marketing site.
- Instrument Sans was chosen for headings and Inter for body/data.
- Interactive components require keyboard operation and visible focus.
- A table is not a spreadsheet merely because it displays rows/columns; spreadsheet editing, selection, formulas and validation are intentional capabilities.
- Desktop inspectors belong at stable edges of the workspace and can collapse into sheets/modal surfaces at narrower widths.
- Reusable status components should use controlled semantic vocabulary rather than arbitrary visual states.

## Component lifecycle idea

The prototype proposed component maturity states:

- `draft` — API/visual behaviour still being explored;
- `beta` — usable in prototypes, changes require migration awareness;
- `stable` — reusable product component with explicit review for breaking changes.

The exact lifecycle mechanism is not a current canonical contract, but the distinction between experimental and product-grade components remains useful.

## Design direction that survived into the product

The concept strongly reinforced ideas now present in `PRODUCT.md` and `DESIGN.md`:

- calm density;
- work-first layouts;
- compact application chrome;
- stable left navigation / central work / right inspector structure;
- semantic colour rather than decoration;
- scientific components that look like part of one product;
- avoidance of large marketing-scale headings and sparse dashboard cards;
- keyboard accessibility and information continuity.

## Historical prototype location

The runnable prototype remains under:

`Concepts/sheetbase-ui-system-v2/`

It is a historical visual/code reference, not a second production design system. New product work should follow the current application components, `PRODUCT.md`, `DESIGN.md` and accepted design ADRs first.