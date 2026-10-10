# 0048. Sheet grid on sheetbase-table

- **Status:** accepted
- **Date:** 2026-09-27
- **Ticket:** Roadmap 4, COMP-06
- **Amends:** ADR-0021 (HyperFormula trust and persistence) and ADR-0022 (cross-sheet formula resolution) where they name the client grid

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

## Compatibility evidence (2026-09-27)

Spike for COMP-06: run the ELN's formula fixtures and a representative corpus
of the required function profile through both engines and compare.

**Method.** A corpus of 146 distinct formulas — the fixture formulas
(`formula-ir.test.ts`, `calculation.server.test.ts`, `test:phase4`: `=A1*2`,
`=1/0`, `=RAND()`, `SUM/IF/AND/ROUND/LOG10`, `**` and cross-sheet refs) plus a
representative call for each required function both engines expose — evaluated
in HyperFormula 3.3.0 with the ELN profile
(`src/lib/hyperformula-profile.ts`) and in `sheetbase-table`'s engine
(`packages/table/src/engine`) in the components repo. Values, errors and spills
were compared.

**Function coverage.** The ELN profile requires 172 functions
(`SCIENTIFIC_CORE_FUNCTIONS`). `sheetbase-table` exposes 158; 149 overlap.

- 18 required functions are absent: CHISQ.DIST, CHISQ.INV, CHISQ.TEST,
  CONFIDENCE.NORM, CONFIDENCE.T, F.DIST, F.INV, F.TEST, NORM.DIST, NORM.INV,
  NORM.S.DIST, NORM.S.INV, STDEVPA, T.DIST, T.DIST.2T, T.INV, T.INV.2T, T.TEST
  (all statistical distributions).
- 5 required forms are engine special forms rather than registry entries and
  are present: IF, IFERROR, ISERROR, TRUE, FALSE.
- 9 table-only functions are not in the ELN profile: AVERAGEIFS, NOW, RAND,
  RANDBETWEEN, SORT, SORTBY, TODAY, TRUNC, UNIQUE.

**Result.** 121 of 146 corpus formulas agree exactly; the rest fall into:

| Difference        | Example                        | HyperFormula (server)            | sheetbase-table                |
| ----------------- | ------------------------------ | -------------------------------- | ------------------------------ |
| Boolean literals  | `=AND(TRUE,1)`                 | `#NAME?` (needs `TRUE()`)        | `TRUE`                         |
| Date value        | `=DATE(2024,1,31)`             | serial `45322`                   | JS `Date`                      |
| Error surface     | `=1/0`                         | typed object `{value:'#DIV/0!'}` | throws `#DIV/0!`               |
| Number formatting | `=TEXT(1234.5,"#,##0.00")`     | `'#,##0.00'`                     | `'1,234.50'`                   |
| Spill result      | `=TRANSPOSE(A1:A3)`            | matrix `[[3,2,3]]`               | spills; owner cell `3`         |
| Compiled path     | `=SUBSTITUTE("a-b-c","-","+")` | `'a+b+c'`                        | `#VALUE!` (direct call works)  |
| Range in compiled | `=FILTER(A1:A3,A1:A3>1)`       | `[[3],[2],[3]]`                  | `#VALUE!` (direct call works)  |
| Input format      | `=TIMEVALUE("13:30")`          | `0.5625`                         | `#VALUE!` (needs ISO datetime) |

The existing fixtures use only a supported subset (`=A1*2`, `=1/0`, `RAND`,
`SUM/IF/AND/ROUND/LOG10`, cross-sheet refs), so a fixture-only run passes. The
differences above appear across the wider declared profile, which is what
persisted values must satisfy. `**` is normalised to `^` by the ELN before
evaluation and is unsupported by both engines directly.

**Recommendation.** Option (a). Keeping HyperFormula as the server authority
avoids implementing the 18 distribution functions and reconciling boolean
literals, date/error codecs, number formatting and spills in the engine that
produces signed values. The table engine then previews during editing only; the
server value replaces the preview on save. Option (b) stays possible later but
needs the 18 functions plus a parity suite over this corpus and the codec
differences above. The compiled-path gaps for `SUBSTITUTE`/`FILTER` are COMP-06
work either way.

**Owner decision (2026-09-27): option (b).** The server adopts the
`sheetbase-table` engine; HyperFormula and Handsontable are removed. The
existing formula fixtures already pass on the table engine. The following work
is part of COMP-06 and lands with the swap:

- implement the 18 required statistical functions in `sheetbase-table`
  (`packages/table/src/engine/functions-*`);
- reconcile the semantic differences — boolean literals (`TRUE`/`FALSE`), date
  and error codecs, `TEXT` number formatting and spill results — with a parity
  suite over the corpus above;
- fix the compiled-formula path for `SUBSTITUTE` and `FILTER` and align
  `TIMEVALUE` input handling;
- keep ADR-0021/0022's trust, persistence and cross-sheet resolution contracts;
  only the engine changes.

The option (a) recommendation above is retained as the evidence that motivated
this work list; it was not taken.
