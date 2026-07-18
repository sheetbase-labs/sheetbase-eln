# Sheetbase UI System

A standalone component framework for Sheetbase, built with **TanStack Start**, **React 19**, **Tailwind CSS 4**, the **shadcn/ui architecture**, and **Radix UI** primitives.

The application is the main visual catalogue. Storybook is included for isolated component development.

## What is included

- Semantic light and dark themes
- Comfortable and compact density modes
- Instrument Sans headings and Inter body/data typography
- 31 general UI components under `src/components/ui`
- Scientific ELN components under `src/components/sheetbase`
- Foundations, product patterns and page templates
- TanStack Table example
- Recharts scientific visualisation example
- Storybook 10 using the first-party TanStack React framework
- Lint, type-check and production build scripts

## Run the catalogue

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Run Storybook

```bash
npm run storybook
```

Open `http://localhost:6006`.

## Verification

```bash
npm run lint
npm run typecheck
npm run build
npm run build-storybook
```

## Structure

```text
src/
  components/
    ui/           General shadcn-style primitives
    sheetbase/    Scientific and ELN-specific components
  design-system/  Registry and future token metadata
  routes/         Catalogue, patterns and page templates
  stories/        Isolated Storybook examples
```

Read `DESIGN_SYSTEM.md` before adding or changing components.

## Fast viewing versus development

- `OPEN_UI_SYSTEM.command` opens the prebuilt component catalogue and **does not install packages**.
- `OPEN_STORYBOOK.command` opens the same prebuilt catalogue on port 6006.
- `OPEN_TANSTACK_DEV.command` installs dependencies on first use and starts the editable TanStack Start development application.

The package lock uses the public npm registry and dependencies are pinned for repeatable installation.

## Expanded Storybook catalogue

The Storybook build now documents the complete first-pass component system across:

- Foundations: colour, typography, spacing and radius
- UI: buttons, badges, cards, forms, feedback, navigation, overlays, menus, command palette, tables and utilities
- Scientific: status, metrics, properties, record links, notebook blocks, charts, plate maps, approvals, audit trail and TanStack data tables
- Patterns: the scientific notebook block language

Run `OPEN_STORYBOOK.command` to open the component catalogue at http://localhost:6006.
