# Reproducible analysis

Planned at `e5801327`, 2 October 2026. Read [GUIDE.md](../GUIDE.md), ADR-0040/0041, `src/lib/analysis-definition.ts`, `src/lib/chart-data.ts` and the Sheet composition contracts. Reuse ChartSpec, the pure scientific kernels and immutable Dataset Versions. Current limitations are high-confidence source observations; proposed execution and capture architecture needs a bounded design step.

## R5-SCI-01: analyse complete datasets beyond browser limits

**Outcome:** a scientist receives statistics for the complete eligible Dataset and can reconstruct them after submission. Priority P1, effort XL, high risk. Depends on BASE-02 and agreed workload fixtures; coordinate those with CAP-02 without making infrastructure development circular.

**Current state and scope:** `src/lib/chart-data.ts:40` limits live/frozen analysis to 10,000 rows and `:415` refuses larger frozen reconstruction. Existing analysis refuses to treat truncated rows as complete, which must be preserved. Scope: execution of current descriptive/regression definitions, result provenance, data retrieval, cancellation/resource bounds, and Notebook live/frozen rendering. No new statistical method in this task.

**Steps:**

1. Choose a server execution path after comparing the existing Pipeline executor with a bounded analysis service. Reuse canonical input/result/version contracts and the existing pure kernels; do not fork calculation semantics. Specify authorization, cancellation, resource limits and method-version identity.
2. Implement descriptive statistics first, then existing regression. Pin input Dataset Versions. Persist/reconstruct full-data results with included, excluded and missing counts; return separately labelled display samples or aggregates.
3. Update live and frozen consumers together. Add numerical equivalence fixtures and a case whose decisive outlier occurs after row 10,000. Record floating-point tolerance per algorithm where byte equivalence is inappropriate.

**Verification/exit:** extend `src/lib/{analysis-definition,chart-data}.test.ts`; add `tests/db/full-data-analysis.test.ts` and a browser workflow; run those and `pnpm validate`. Proposed 100,000-row input produces complete counts/statistics, small-data parity and unchanged frozen results after source edits. Failure/cancellation cannot expose partial results as complete. Stop if full source rows would be embedded into Notebook JSON or display sampling becomes analysis sampling.

## R5-SCI-02: extend existing Sheet materialization for reproducible analysis

**Outcome:** the scientist deliberately selects composed/local/calculated columns for a reproducible analysis snapshot. Priority P2, effort XL, high risk. Carry-over from SHEET-05, plus any agreed extensions. Depends on BASE-02 and disposition of the active COMP/formula contract; require a new decision only if the existing materialization contract must change architecturally. SCI-01 is required to advertise larger captured inputs, not to prototype a bounded snapshot.

**Current state and scope (reconciled at `9bbd305c`):** materialization already exists in `src/lib/sheet-materialization-data.ts:86`, `drizzle/0089_core_0314_sheet_materialisation.sql:41` and `src/components/sheet/canonical-sheet-lifecycle-panel.tsx:310`. It supports an active Definition-backed Sheet, local fields and trusted current calculations; revision, preview-digest and idempotency checks protect canonical Dataset/snapshot creation with provenance. `src/lib/analysis-definition.ts` still accepts one Dataset. SHEET-05 already requires multi-source analysis. Scope is the gap between that existing path and the chosen composed-analysis workflow, not a new capture engine.

**Steps:**

1. Exercise existing preview/materialize with the two-Dataset fixture. Record exactly which selected/local/calculated fields and source identities are retained, including its Definition-backed restriction. Define only the missing semantics under SHEET-05; use a new ADR only for a genuine change to durable authority.
2. Extend the existing permission-checked materialization path where needed for consistent paged source state, field selection and complete lineage. Keep its trusted calculation, revision, digest and idempotency checks. Specify missing joins, duplicate identities, unavailable inputs and changed revisions explicitly; reuse its join machinery.
3. Complete the deliberate preview/materialize-to-analysis handoff using the resulting canonical Dataset Version. Preserve exploratory field history, and pass the same output to existing analysis/Pipeline inputs.

**Verification/exit:** extend existing Sheet materialization/composition tests before adding focused analysis-handoff tests; run the affected suites and `pnpm validate`. A two-Dataset Definition-backed Sheet with local/calculated columns yields traceable frozen evidence; subsequent source/label/formula edits cannot alter it. Revoked sources deny materialization; replay is idempotent. No automatic promotion, second join/materialization engine or new generic Sheet Version. Existing SHEET-05 acceptance owns the carry-over.

## R5-SCI-03: compare pinned experiments and method changes

**Outcome:** a scientist compares selected experiment results and can explain whether a difference came from inputs, exclusions or analysis configuration. Priority P2, effort L, high risk. Depends on SCI-01 and SCI-02.

**Current state and scope:** existing analysis definitions and Dataset-version comparison supply the core primitives, while analysis input remains single-Dataset. This task adds a bounded workflow over explicitly captured canonical input, not arbitrary federated queries. Scope: selected experiments/input versions, common field/unit mapping, one existing descriptive/regression method, saved comparison configuration, result differences and Notebook citation.

**Steps:** choose two compatible experiment fixtures and bind identity using stable fields; require explicit unit/category alignment; execute each pinned analysis through SCI-01; show sample counts, exclusions, method parameters and output differences; save/cite the comparison and offer an explicit rerun against newer inputs.

**Verification/exit:** add `src/lib/analysis-comparison.test.ts`, DB persistence and browser comparison cases; run those and `pnpm validate`. Renaming a label preserves binding; incompatible units or schemas block comparison; rerunning creates a distinct result with a clear difference report; the original cited comparison remains unchanged. Novel statistics, automatic causal explanations and hidden cross-study joins are excluded. If existing comparison code already covers a slice, extend it and narrow this task.
