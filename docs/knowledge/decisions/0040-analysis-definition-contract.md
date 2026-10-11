# 0040. Reusable analysis definition contract

- **Status:** accepted (amended by 0041: canonical Dataset sources, single
  input Dataset, version-pinned frozen evidence; amended by R5-STUDIO-01:
  every result states its method, its runner and its assumption checks, and
  frozen evidence records the method-definition version it ran under)

## Context

SCI-01 extended the decision-0029 chart contract with distribution and grid
chart types, faceting and annotations. The Analysis Studio can author charts,
but analysis — descriptive statistics, grouping/aggregation, regression and
curve fitting over Sheetbase datasets — has no durable object: results exist
only in browser state, cannot be rerun against fresh rows, and cannot be
traced to explicit inputs. The roadmap requires that "analysis definitions are
not only browser state" while forbidding a second Pipeline architecture or a
giant statistical package.

Forces:

- An analysis must reference stable datasets by UUID and bind columns by
  stable field identity so definitions survive row and column reordering.
  Decision 0041 supersedes the scientific_tables basis with canonical
  Datasets and `field_id` bindings — the same stability rule decision 0029
  fixes for charts, now on the ADR 0037 primitives.
- Results must be reproducible: a rerun of a definition against the same rows
  is deterministic, and every parameter is explicit rather than an implicit
  default.
- Execution must stay narrow: grouped descriptive statistics plus polynomial
  least-squares (degrees 1–4) cover the common cases; anything more specialised
  waits for demonstrated need (SCI-04).
- Notebook blocks (SCI-03) will need to pin exactly which definition version
  produced frozen evidence.

## Decision

1. **An analysis definition is a versioned JSONB object** stored in
   `api.analysis_definitions`, one workspace, one owner, unique per owner name.
   The shape mirrors ChartSpec conventions: `definitionVersion`, a `kind`
   discriminator (`descriptive` | `regression`), stable dataset references and
   named column bindings.

2. **Execution is pure TypeScript.** `runAnalysis(definition, columns, rows)`
   computes everything client-side from explicit inputs; there is no server-side
   analysis engine and no second transformation architecture. Determinism rules:
   groups sort by codepoint order, quantiles use linear interpolation on
   p·(n−1) (matching PostgreSQL `percentile_cont`), and missing values are
   counted per group instead of silently dropped.

3. **Errors are honest states, not partial tables**: missing fields, empty
   datasets, insufficient rows per group, singular fits and non-positive values
   under log transforms each surface a typed execution error.

4. **Provenance rides on the saved row.** Definitions store
   `source_revisions` captured at save time (table id, schema version, dataset
   schema revision) using the same helpers as analysis views, so a later reader
   can detect that a referenced dataset evolved.

5. **The database stays authoritative for identity and integrity**: RLS lets
   workspace members read shared definitions while only the owner mutates their
   own; a trigger bumps `version` on every update and keeps
   `(workspace_id, owner_user_id)` immutable. Version numbers are what notebook
   blocks pin for evidence (SCI-03).

6. **Regression transforms are monotonic and explicit** (`log10`, `ln`) applied
   to outcome or predictor before fitting; they are never back-transformed, so
   reported equations describe the transformed coordinates a reader can
   reproduce.

7. **R5-STUDIO-01 — a result states its method or it is not presented.** Every
   `runAnalysis` result carries an `AnalysisMethod` (`descriptive`,
   `one_way_anova`, `linear_model`; definition version, label, one-sentence
   statement, runtime identity `sheetbase-analysis-kernel@1`) and an ordered
   list of `AssumptionCheck` entries with an explicit
   `pass | warn | fail | not_checked` status. Model scope in this revision: a
   grouped descriptive definition reports a one-way ANOVA (group means with
   95% intervals, F over between/within sums of squares, η²); a regression
   definition reports a least-squares linear model with a per-term table
   (estimate, standard error, 95% interval, t, two-sided p) and an overall F.
   An ungrouped descriptive result states that no model is fitted and no
   p-value is reported. A failing check is reported as it stands — nothing is
   auto-corrected, transformed, weighted or dropped — and a check the data
   cannot support reports `not_checked` with its reason rather than a pass.
   Out of scope for this revision and deliberately deferred: ANCOVA or any
   linear model mixing a categorical factor with a numeric predictor, a
   confidence-level selector (95% is fixed), robust/weighted regression,
   Shapiro–Wilk (Jarque–Bera is used), and post-hoc multiple comparisons.

8. **Where the computation belongs (R5-STUDIO-01).** The reported quantities
   stay in the shared pure-TypeScript kernel of §2 — extended with the Lanczos
   log-gamma, the regularised incomplete beta it needs for t and F p-values,
   the coefficient covariance, and closed-form Brown–Forsythe, Jarque–Bera and
   Breusch–Pagan tests. This is not a browser statistics engine: the kernel is
   deterministic, dependency-free and remains the single authority the live
   studio and frozen reconstruction both execute, so a rerun over the same
   rows reproduces the same numbers. A pinned _server-side_ statistics runtime
   is deferred pending an owner deployment decision; the method's `runner`
   identity makes that switch explicit and reviewable when it happens. The
   analysis-method definition version is recorded in frozen evidence
   (`methodVersion`, migration 0426) and mirrored by
   `ANALYSIS_METHOD_VERSION`; reconstruction withholds the numbers when the
   recorded version differs from the one this build computes, instead of
   silently recomputing under a method the citation never named.

## Consequences

- Migration 0125 adds the table, trigger and RLS; no new event types (ordinary
  PostgREST mutations through `/api/db`).
- The statistics kernel (`src/lib/stats.ts`) is deliberately small: summaries,
  quantiles, and OLS over centred/scaled predictors expanded back to raw-space
  coefficients (0041). Degrees above four are rejected at validation because
  conditioning degrades quickly.
- Notebook analysis blocks reuse this contract directly (SCI-03, amended by
  0041): a block references a definition by UUID; freezing pins the
  definition verbatim plus an immutable Dataset Version of its single input
  dataset — column metadata and provenance, never embedded rows — and frozen
  evidence reconstructs deterministically from the pinned inputs. Only the
  SECURITY DEFINER freeze/unfreeze RPCs may write a frozen payload.
- R5-STUDIO-01 adds no new definition kind, table or event type: the ANOVA is
  the inference half of a grouped descriptive definition, so existing saved
  definitions gain a method statement without a migration of their body. The
  only schema change is the recorded `methodVersion` in the frozen payload
  (migration 0426, re-declaring `freeze_analysis_block`). Payloads frozen
  before it report the method version as unrecorded. Exports carry the method
  and every check in the CSV provenance header (`analysisExportStamp`), so an
  exported result still describes the model it ran. `src/lib/stats.ts` grows
  to the sampling distributions and diagnostics above but stays
  dependency-free.
