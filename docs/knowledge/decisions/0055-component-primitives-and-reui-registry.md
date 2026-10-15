# 0055. Component primitives, and the ReUI registry contract

- **Status:** accepted
- **Date:** 2026-10-15
- **Ticket:** Notebook editing and component-supply proposals, revision 2 (`plans/notebook-editor-and-reui.html`)
- **Relates to:** ADR-0008 (core shadcn primitives), ADR-0011 (scientific status and relationship components), ADR-0047 (UI system v3 adoption), ADR-0048 (sheet grid on `sheetbase-table`); supersedes the Radix clauses of ADR-0047 and the DESIGN.md §5 statement on primitives

## Context

The repository contains two component generations, and the written rules
describe the older one.

- `src/components/ui/**` is the legacy shadcn kit built on the unified `radix-ui`
  package. After the roadmap-4 UI port it backs only the internal `/foundations`
  and `/docs/$name` routes.
- `src/components/v3/ui/**` is the forward kit, built on `@base-ui/react`. Every
  ported product screen composes it, and an adoption guard test
  (`src/components/v3/ui/component-adoption.test.ts`) blocks app code from
  importing the legacy kit wherever a v3 twin exists.

The written rules still said Radix: `DESIGN.md` §5 stated that all components are
"built on Radix primitives", and ADR-0047 described re-implementation on "the
existing shadcn/Radix/Tailwind stack". Under ADR-0001 a reversal supersedes
rather than edits history, so this ADR records the correction instead.

Separately, the ReUI registry was configured as
`@reui → https://reui.io/r/radix-nova/{name}.json` — the Radix build of a library
that serves every component twice — and ReUI was adopted once (an event calendar,
`3b0951fd`, `1b915579`) and then deleted with the legacy-shell routes it was used
on (`9ced9f6d`, `UI_PORT.md:189-193`). That removal was a route-retirement
consequence, not an assessment of the library. No comparison record survived, so
the reason for the second attempt being better than the first could not be
reconstructed from the repository.

## Decision

1. **New components are built on Base UI primitives.** The v3 kit is the forward
   vocabulary and the adoption guard already enforces it. The Radix kit is not
   extended, and new work does not add to it.

2. **The ReUI registry is pinned to the Base UI build:**
   `@reui → https://reui.io/r/base-nova/{name}.json`. ReUI items are installed
   with the shadcn CLI, are copy-and-own source, and land under
   `src/components/reui/**`. That directory is not edited beyond import-path
   fixes and restyling to Sheetbase tokens, which is why it carries its own
   scoped lint relaxation.

3. **Free and open-source items only.** Nothing in the current proposals needs a
   paid tier. Tiptap's Notion-like template (Start plan) and ReUI's Pro blocks
   are out of scope.

4. **ReUI is a supplier for generic UI jobs, never for scientific surfaces.**
   Where ReUI has a component for a job the repository hand-rolled, it is
   evaluated; the catalogue is the starting list, not a shortlist. An adoption
   must satisfy all five of:

   - it serves a generic UI job (grid, sort, upload, steps, dates, empty, tree);
   - the hand-rolled version is materially worse, not merely different — a named
     behaviour is missing, or the maintenance burden is demonstrably ours;
   - it is restyled to Sheetbase tokens and passes the colour check, axe and the
     adoption guard;
   - it replaces the old component in the same change, with no parallel
     implementation left behind;
   - where the screen is in the design set, its parity row is updated; where it
     is not, a story plus a browser test stands in.

5. **Evidence, not preference.** A ReUI comparison is recorded as one row per
   component: what we use now, what ReUI offers, a fixed behavioural checklist
   run against both on identical hostile fixtures (empty, single, 5,000 rows,
   long scientific names, nulls, high precision), axe with no violations, and
   the decision with its reason. Appearance screenshots are evidence; they are
   not the verdict.

6. **Excluded from substitution.** The sheet grid stays
   `@sheetbase-labs/sheetbase-table` (ADR-0048) — a generic data grid cannot host
   formulas, write-back or evidence pinning. The figure renderers stay in-house
   because frozen-evidence reconstruction and the design-parity gate pin them.
   The scientific status vocabulary stays with its own components and ADR-0011.
   Anything the `@sheetbase-labs/sheetbase-advanced-search` filter builder owns
   is reconciled before any ReUI filter component is considered.

## Consequences

- `DESIGN.md` §5 now states the Base UI base and names the legacy kit's remaining
  scope; ADR-0047's stack clause is superseded here rather than rewritten.
- The registry pin is `base-nova`, so an installed component's imports match the
  kit it will sit beside. Installs that pull `cn` from the `cn` package rather
  than `#/lib/utils` bring that dependency with them.
- TanStack Table v9 is a prerequisite for the ReUI data grid; the repository is
  on v8.21.3 and the migration is a workstream in its own right, verified per
  grid by hand.
- The comparison record is the durable part of this decision. Its absence is what
  made the earlier adoption unreadable, so the record outranks the component
  choice in importance.
- This decision does not authorise any adoption, any roadmap task or any change
  to a scientific surface.
