# Function parity audit — sheetbase-table engine vs `scientific-core-v2`

Sizes the HyperFormula function surface used by Sheetbase sheets against what the
sheetbase-table engine evaluates natively. Feeds the outright engine swap of
`scientific-sheet-block` (no feature flag) and the Phase 2 decision on engine
function expansion.

## Conclusion

**The function gap does not gate the swap.** The decisive fact is calculation
authority, not function count:

- The server already computes every profile function. `formula-write.server.ts`
  builds a server-side HyperFormula instance (`createSheetbaseHyperFormula`,
  HyperFormula 3.3.0, profile `scientific-core-v2`) and persists results into
  `sheet_instance_calculation_results` (read back via
  `read_sheet_instance_calculation_results`).
- The engine swap rides `calculationAuthority="host"` (shipped in
  sheetbase-table#10): the browser stores `=...` inputs as inert text and renders
  host-computed values through hydration. The browser engine never evaluates a
  profile function, so its 21-function surface is sufficient the day the swap lands.
- Side benefit: the swapped surface drops the client-side HyperFormula bundle
  immediately — pulling the Phase 3 bundle payoff forward for this surface.

Engine function expansion therefore moves to Phase 2. It becomes blocking only if
(a) a surface must evaluate client-side (client authority), or (b) Phase 3 removes
server-side HyperFormula in favour of the engine ("one calculation model").

## Numbers

| Surface | Functions |
|---|---|
| `scientific-core-v2` profile (ELN autocomplete + server) | 172 |
| sheetbase-table engine built-ins | 21 |
| Covered today | 20 |
| Engine-only extras | `TODAY` |
| Missing | 152 |

Covered: `ABS, AND, AVERAGE, COUNT, COUNTA, DATE, DAY, IF, MATCH, MAX, MIN, MONTH,
NOT, OR, ROUND, SEQUENCE, SQRT, SUM, XLOOKUP, YEAR`.

## Missing-function tiers

### Tier B1 — math one-liners (45)

`ACOS, ARABIC, ASIN, ATAN, ATAN2, BASE, CEILING, CEILING.MATH, COMBIN, COS,
DECIMAL, DEGREES, EXP, FACT, FACTDOUBLE, FALSE, FLOOR, FLOOR.MATH, GCD, GEOMEAN,
HARMEAN, INT, LARGE, LCM, LN, LOG, LOG10, MEDIAN, MOD, MROUND, PI, POWER, PRODUCT,
RADIANS, ROMAN, ROUNDDOWN, ROUNDUP, SIGN, SIN, SKEW, SKEW.P, SMALL, SUMSQ, TAN,
TRUE`

Each is a `Math.*` call or a small reduce over the existing range expansion.
One PR.

### Tier B2 — criteria aggregation (8)

`AVERAGEIF, COUNTIF, COUNTIFS, SERIESSUM, SUBTOTAL, SUMIF, SUMIFS, SUMPRODUCT`

Needs one shared criteria parser (`">5"`, `"=text"`, wildcards) plus range-wise
iteration instead of flat `expand()`. One PR.

### Tier B3 — text (18)

`CLEAN, CONCATENATE, FIND, LEFT, LEN, LOWER, MID, PROPER, REPLACE, REPT, RIGHT,
SEARCH, SUBSTITUTE, TEXT, TEXTJOIN, TRIM, UPPER, VALUE`

String ops; `TEXT` (number formatting) is the only fiddly one. One PR.

### Tier B4 — date/time (14)

`DATEDIF, DATEVALUE, EDATE, EOMONTH, HOUR, ISOWEEKNUM, MINUTE, NETWORKDAYS,
SECOND, TIME, TIMEVALUE, WEEKDAY, WEEKNUM, WORKDAY`

The engine already has UTC date plumbing (`DATE/YEAR/MONTH/DAY/TODAY`). One PR.

### Tier C — distributions / statistics (41)

`CHISQ.DIST, CHISQ.INV, CHISQ.TEST, CONFIDENCE, CONFIDENCE.NORM, CONFIDENCE.T,
CORREL, COVARIANCE.P, COVARIANCE.S, F.DIST, F.INV, F.TEST, NORM.DIST, NORM.INV,
NORM.S.DIST, NORM.S.INV, PEARSON, PERCENTILE, PERCENTILE.EXC, PERCENTILE.INC,
QUARTILE, QUARTILE.EXC, QUARTILE.INC, RSQ, STDEV, STDEV.P, STDEV.S, STDEVA,
STDEVP, STDEVPA, T.DIST, T.DIST.2T, T.INV, T.INV.2T, T.TEST, VAR, VAR.P, VAR.S,
VARA, VARP, VARPA`

The hard tier: needs real numerics (erf, incomplete beta, gamma) for the `DIST`
families; the descriptive stats (STDEV/VAR/CORREL/PEARSON/RSQ/PERCENTILE) are
straightforward reduces. One to two PRs; only worth doing for Phase 3's
"one calculation model" endgame.

### Tier D — lookup / info / error (26)

`ADDRESS, CHOOSE, COLUMNS, FILTER, HLOOKUP, IFERROR, IFNA, IFS, INDEX, ISBLANK,
ISERROR, ISEVEN, ISLOGICAL, ISNA, ISNONTEXT, ISNUMBER, ISODD, ISREF, ISTEXT, N,
NA, ROWS, SWITCH, TRANSPOSE, VLOOKUP, XOR`

Patterns already exist (`XLOOKUP`, `MATCH`, `SEQUENCE` spill). `IFERROR`/`IFS`
need lazy argument evaluation (special-cased like `IF`, which the evaluator
already does). One PR.

### Expansion total

Roughly five engine PRs bring the engine from 21 to the full 172-function
profile. None block the swap.

## Swap parity checklist (Phase 0)

| Checklist item | Status for the outright swap |
|---|---|
| Function set from autocomplete | Resolved by host authority — server profile unchanged, all 172 still computed |
| Computed values in cells | Hydrate `read_sheet_instance_calculation_results` into the page load path (the real work of the swap) |
| Frozen panes | Engine supports `frozenRows` / `frozenColumns` |
| Record creation from sheets | `PagedDataAdapter.createRecord` implemented by `PostgrestPagedDataAdapter` |
| CSV in/out | Map the surface's existing CSV actions onto the engine's clipboard/parse helpers, or keep the surface's existing CSV code operating on the adapter |
| Optimistic conflicts | Adapter already maps PostgREST version errors to `RevisionConflictError` |
