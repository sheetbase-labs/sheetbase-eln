# 0048. Sheet grid on sheetbase-table

- **Status:** proposed
- **Date:** 2026-09-27
- **Ticket:** Roadmap 4, COMP-06
- **Amends (if accepted):** ADR-0021 (HyperFormula trust and persistence) and ADR-0022 (cross-sheet formula resolution) where they name the client grid

## Context

The ELN's grids run on Handsontable, a licensed third-party grid, with
HyperFormula evaluating formulas both in the browser grid and on the server
(`calculation.server.ts`, `formula-write.server.ts`). UI system v3 needs grid
states Handsontable renders only with heavy customisation (source group
headers, planned, unsynced, conflict and diff cells). We own
`sheetbase-table`, a virtualised spreadsheet designed for record-bound cells
with its own formula tokenizer, parser, bytecode and worker evaluator.

Two formula engines that can disagree on a value are not acceptable in a
product whose values become signed evidence.

## Decision

1. `sheetbase-table` replaces Handsontable for every ELN grid.
2. **The server remains the formula authority.** Persisted and cited values
   are those computed on the server, as today.
3. **One engine.** Choose, as the first step of COMP-06, between:
   - **(a)** the grid displays server-computed values for calculated cells and
     uses its own engine only for live preview while a formula is being
     edited, with the server value replacing the preview on save; or
   - **(b)** the server adopts the `sheetbase-table` engine (it is
     framework-independent and has no generated-code evaluation) in place of
     HyperFormula, after a compatibility suite over the existing formula
     fixtures passes.

   The chosen option and its compatibility evidence are recorded in this ADR
   before it is accepted.

4. Write paths do not change: bound cells write through canonical sheet RPCs
   with expected revisions; local and calculated columns keep their owners.

## Consequences

- The Handsontable licence and dependency are removed.
- Grid visuals and behaviour are controlled in our own package, so v3 parity
  is achieved at source.
- Option (b) removes HyperFormula but requires proving function-by-function
  compatibility (the table engine supports a smaller function set today);
  option (a) keeps two engines but confines the client one to non-authoritative
  preview.
