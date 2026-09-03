# Sheetbase Table Engine — Integration Spike Report

**Branch:** `spike/table-engine-integration`
**Date:** 2026-09-03
**Scope:** Phase 0 of the plan to adopt `sheetbase-table` (github.com/phlohouse/sheetbase-table) as the Sheet rendering + calculation engine, replacing Handsontable + HyperFormula.

---

## 1. Summary

The spike proves the core integration thesis: **a Scientific Table can be read and written through the `sheetbase-table` engine over the existing `/api/db` PostgREST boundary, with typed filters, server sorting, optimistic per-row versions, and revision conflicts — in ~250 lines of adapter code.**

What exists on this branch:

| Artifact | Purpose |
| --- | --- |
| `src/lib/sheetbase-table/postgrest-paged-adapter.ts` | Implements `PagedDataAdapter` (read pages, filters, sort, resolve cache) and `DataAdapter` (versioned writes, record creation, revision conflicts) over `DataClient`. |
| `src/lib/sheetbase-table/postgrest-paged-adapter.test.ts` | 5 unit tests: operator mapping, or/and logic, paging + value cache, write RPC shape, revision-conflict mapping. |
| `src/routes/table-spike.tsx` | Auth-guarded route rendering one Scientific Table through `PagedSpreadsheet` + `TableSurface` + `TableControls` (typed filters), `?table=<id>`. |
| `tsconfig.json` path aliases | `sheetbase-table/dev` resolves to the linked source during the spike. |
| `package.json` / `pnpm-lock.yaml` | `sheetbase-table` linked from `../sheetbase-table` via `link:`. |

Verification: adapter unit tests pass (5/5); `tsc --noEmit` clean for both repos; the route type-checks against the generated route tree.

## 2. Architecture fit

The two data models line up almost 1:1:

| Sheetbase | sheetbase-table |
| --- | --- |
| `ScientificTableWire` (`resource_name`, schema_version, typed columns) | `datasetId` + `DatasetHeaderConfig.fields` |
| `ScientificRowWire` (`id`, `version`, dynamic fields) | `DatasetPage.records` (`recordId` + values), per-row optimistic versions |
| `ScientificEdit` (`rowId, expectedVersion, values`) | `RecordFieldWrite` → `apply_scientific_row_changes` RPC |
| Column `logical_type` | `CellDataType` (text/integer/decimal→number, boolean, date, category→options, reference→relationship) |
| Column `unit`, `validation`, `format` | **not yet mapped** — needs the field-metadata seam (Phase 2) |
| `formula_results` (server-calculated, provenance-tracked) | engine-calculated values (client-side) — **see §5, the big open question** |
| Revision conflicts | `RevisionConflictError` → the engine's visible conflict path |

Write-path detail: the adapter captures each row's `version` at page load, sends `expectedVersion` with every edit, and maps per-cell rejections to the engine's rejected-write rendering. Version mismatches throw `RevisionConflictError`, which drives the engine's visible conflict UI.

## 3. What the spike demonstrates

1. **Paging + hydration** over PostgREST with the same viewport-aligned contract the million-row demo uses.
2. **Typed filters round-trip** to PostgREST: `eq`, `neq`, `gt/gte/lt/lte`, `contains`→`ilike.*v*`, `startsWith`, `in.(…)`, `isNull`, `notNull`, `between`→`and=(…)`, `withinLastDays`→computed date window, `or` logic via a single `or=(…)` expression.
3. **Optimistic writes** with per-row `expectedVersion`, accepted/rejected mapping, and conflict surfacing.
4. **The ELN extension seams work against real host data**: the route mounts `TableSurface` + `PagedSpreadsheet` + `TableControls` with a `datasetHeader` derived from the live column metadata.

## 4. Formula parity (engine gap analysis)

Sheetbase's `hyperformula-profile.ts` allows ~110 functions. The sheetbase-table engine currently implements ~20 (`SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT`, `COUNTA`, `IF`, `AND`, `OR`, `NOT`, `ABS`, `SQRT`, `ROUND`, `DATE`, `YEAR`, `MONTH`, `DAY`, `HOUR`, `MINUTE`, `SECOND`, `XLOOKUP`, `MATCH`, `SEQUENCE` spills).

Gap tiers:

| Tier | Functions | Effort |
| --- | --- | --- |
| 1 — trivial math (≤1 day) | `PRODUCT`, `SUMSQ`, `SIGN`, `MOD`, `POWER`, `EXP`, `LN`, `LOG`, `LOG10`, `ROUNDDOWN`, `ROUNDUP`, `INT`, `PI`, `SIN/COS/TAN/ASIN/ACOS/ATAN/ATAN2`, `DEGREES`, `RADIANS`, `CEILING`, `FLOOR`, `MROUND`, `GEOMEAN`, `HARMEAN` | direct ports |
| 2 — logic/errors (≤1 day) | `IFS`, `IFERROR`, `IFNA`, `NA`, `ISBLANK`, `ISERROR`, `ISNA`, `ISNUMBER`, `ISTEXT`, `INDEX` | direct ports |
| 3 — statistics (2–4 days) | `MEDIAN`, `STDEV.S/P`, `VAR.S/P`, `PERCENTILE`, `QUARTILE`, `LARGE`, `SMALL`, `CORREL`, `PEARSON`, `RSQ`, `COVARIANCE.S/P`, `SUMIF`, `SUMIFS`, `AVERAGEIF`, `COUNTIF`, `COUNTIFS` | moderate; array-aware |
| 4 — scientific distributions (1–2 weeks) | `NORM.DIST/INV`, `NORM.S.DIST/INV`, `T.DIST/INV`, `CHISQ.DIST/INV/TEST`, `F.DIST/INV/TEST`, `T.TEST`, `STDEVA/VARPA` family, `SKEW`, `CONFIDENCE.*` | need incomplete-gamma/beta implementations or a stats dependency |

**Recommendation:** Tiers 1–2 immediately after spike sign-off; Tier 3 before broad rollout; Tier 4 only for sheets that actually use them (survey real usage from `formula_results` first).

## 5. The big open question — calculation authority

Sheetbase treats formulas as **first-class server objects**: `formulas` + `formula_results` tables, engine-versioned, provenance-tracked, computed by deterministic server Pipelines. The sheetbase-table engine calculates **client-side**.

Three candidate models:

1. **Engine as renderer only (recommended first step):** the table renders `formula_results.calculated_value` for formula cells (read-only) and lets the server Pipeline own calculation. The engine's client formula bar can still evaluate *draft* formulas for instant feedback before commit. Lowest risk; preserves provenance/audit exactly.
2. **Engine as calculation authority:** migrate the formula pipeline to use the engine's bytecode/worker execution server-side (it already has a Web Worker executor and topological batching). Bigger change; collapses two calculation stacks into one; needs parity Tier 4 to be complete first.
3. **Hybrid:** engine calculates simple local formulas; complex/dep-tracked formulas stay server-side. Not recommended — two semantics for "what is a formula" is the worst of both.

The spike uses model 1 for the spike surface (it renders raw row values; formula cells would render through `formula_results`).

## 6. Gaps and risks found during the spike

| # | Finding | Severity | Where it lands |
| --- | --- | --- | --- |
| 1 | **Strict-tsconfig hygiene**: importing the library's source under Sheetbase's `noUnusedLocals` / Node-typing config surfaced 5 type errors. Fixed in `fix/typecheck-hygiene` (sheetbase-table PR). | Low (fixed) | sheetbase-table |
| 2 | **Category fields store option IDs**, display labels resolved client-side. The engine's option editor expects labels. Needs a label-resolution seam (a small `renderCell`/editor adapter or engine-side option objects). | Medium | extension layer |
| 3 | **`or` filters with values containing commas** are not expressible in the current `or=(…)` mapping (PostgREST escaping limitation). | Low | adapter, follow-up |
| 4 | **Row counts**: `client.count` adds one round trip per page fetch. Acceptable; can collapse into the list call by reading `Content-Range` when the proxy passes it through. | Low | adapter |
| 5 | **Calculation authority** unresolved (§5). | High (design) | roadmap decision |
| 6 | **Units**: Sheetbase columns carry `unit` metadata; the engine has no unit-aware display. Phase 2 field-metadata seam. | Medium | sheetbase-table |
| 7 | **Worker asset**: the published lib build references a separate `calculation.worker-*.js` asset; hosts bundling from source (as this spike does) avoid the issue, npm consumers need a verified path. | Medium | sheetbase-table build config |
| 8 | **Package publishing**: spike uses `link:` + tsconfig path alias; real adoption needs a published package (or vendored workspace package) with the `./dev` source export dropped. | Low | release management |

## 7. Recommended next steps

1. **Review this report; decide on calculation authority model (§5).** Everything else depends on it.
2. Merge the spike branch as the adapter foundation (or keep it unmerged as reference until the flag-swap decision).
3. sheetbase-table side (small PRs):
   - Tier 1–2 formula ports.
   - Field-metadata seam for `unit`/`format` (presentation-state v2 exercise — the migration pipeline from #7 is the vehicle).
   - Option-label resolution seam for category/reference fields.
4. Sheetbase side:
   - Swap `scientific-sheet-block.tsx`'s grid internals behind a `?engine=table` flag using this adapter (the spike route is the reference implementation).
   - Add Playwright coverage comparing both engines on the same fixture dataset.
5. Only after parity confidence: remove Handsontable + HyperFormula from the dependency tree.

## 8. How to run the spike

```bash
# terminal 1 — services (Postgres + PostgREST) and the app
cd sheetbase && pnpm services:up && pnpm db:migrate && pnpm db:seed:demo && pnpm dev

# open http://localhost:3000/table-spike and paste a Scientific Table ID
# (a table ID is visible in the Datasets explorer URL/state)
```

Tests: `bun run vitest run src/lib/sheetbase-table/postgrest-paged-adapter.test.ts`
