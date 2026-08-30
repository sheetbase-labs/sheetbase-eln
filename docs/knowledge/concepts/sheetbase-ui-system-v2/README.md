# Sheetbase UI System

A standalone historical component framework/prototype for Sheetbase, built with TanStack Start, React, Tailwind and shadcn/Radix-style primitives.

The runnable catalogue remains useful for design archaeology and isolated component exploration, but it is **not** the production design authority.

## Canonical design guidance

For current Sheetbase product/design work use:

- [`../../PRODUCT.md`](../../PRODUCT.md)
- [`../../DESIGN.md`](../../DESIGN.md)
- [`../../design/ui-system-v2.md`](../../design/ui-system-v2.md) for the durable historical ideas extracted from this prototype.

## What is included

- semantic light and dark themes;
- comfortable and compact density modes;
- Instrument Sans headings and Inter body/data typography;
- general UI components;
- scientific ELN components;
- foundations, product patterns and page templates;
- TanStack Table and Recharts examples;
- Storybook catalogue.

## Run the catalogue

```bash
npm install
npm run dev
```

Storybook:

```bash
npm run storybook
```

## Verification

```bash
npm run lint
npm run typecheck
npm run build
npm run build-storybook
```

Do not treat this prototype's component APIs or source tree as a second production implementation. New product work belongs in the main application and follows the canonical knowledge/design documents above.
