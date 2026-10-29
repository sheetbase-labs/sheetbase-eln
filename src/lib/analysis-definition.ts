/**
 * SCI-02 — reusable, reproducible analysis definitions.
 *
 * An `AnalysisDefinition` is a versioned JSONB object (the analysis
 * counterpart of the ChartSpec): it references canonical Datasets
 * (`api.datasets`, decision 0037) — exactly one in this version — binds
 * inputs by stable Dataset Schema Version `fieldId`, names every transform
 * and parameter explicitly, and is executed by the pure `runAnalysis` so a
 * rerun against the same rows is bit-identical. Saved definitions live in
 * `api.analysis_definitions`; notebook analysis blocks (SCI-03) reference
 * them by id and pin immutable Dataset Versions as evidence.
 *
 * Deliberately narrow per the roadmap: two kinds — grouped descriptive
 * statistics and polynomial least-squares regression (degree 1–4 covers
 * linear fits and curve fitting) with optional monotonic log transforms.
 *
 * R5-STUDIO-01: every result states the method it ran (`method`), the runtime
 * that produced it, and the assumption checks that were run, each with an
 * explicit pass/warn/fail/not_checked status. A failed check is reported as
 * it stands — no result is auto-corrected, transformed or hidden, and a check
 * that cannot be run says so rather than reporting a pass.
 */

import { CURVE_MODELS, curveEc50, curveInverse, fitCurve } from './curve-fit'
import type { CurveFit, CurveModel, CurveParameterEstimate } from './curve-fit'
import {
  breuschPaganTest,
  brownForsytheTest,
  jarqueBeraTest,
  olsFitWithInference,
  oneWayAnova,
  polyEval,
  summaryStats,
  tCritical95,
  tTwoSidedP,
} from './stats'
import type { LinearModelFit, OneWayAnovaResult, SummaryStats } from './stats'
import { buildFlagIndex, isValueFlagged } from './dataset-flags'
import type { DatasetValueFlag } from './dataset-flags'
import { CHART_ROW_ID_KEY } from './visualisation-pipeline'

import type { ChartColumn, ChartSpec, DatasetRef } from './chart-spec'
import { t } from '#/copy'

export const ANALYSIS_DEFINITION_VERSION = 1 as const
export const ANALYSIS_KINDS = ['descriptive', 'regression', 'curve'] as const
/**
 * What a notebook analysis block may hold: a statistic, a chart, or a
 * statistic with a chart beside it. `chart` is not a statistic, so the
 * statistics runner never sees it; the block shows its chart instead.
 */
export const ANALYSIS_BLOCK_KINDS = [...ANALYSIS_KINDS, 'chart'] as const

export const COLUMN_TRANSFORMS = ['none', 'log10', 'ln'] as const
export type ColumnTransform = (typeof COLUMN_TRANSFORMS)[number]

export const MAX_DEGREE = 4 as const

// ---------------------------------------------------------------------------
// R5-STUDIO-01 — the method contract
//
// A scientific result must name its method, its runner and its checks. The
// method definition version is recorded with frozen evidence (migration 0426,
// `freeze_analysis_block`), so a citation keeps describing the method it was
// computed under even after this kernel changes; bump it whenever a reported
// quantity changes meaning and add the matching recorded value in the freeze
// RPC.
// ---------------------------------------------------------------------------

export const ANALYSIS_METHOD_VERSION = 1 as const

/** Runtime identity of the kernel that produces every reported quantity. */
export const ANALYSIS_RUNNER = 'sheetbase-analysis-kernel@1' as const

export const ANALYSIS_METHOD_IDS = [
  'descriptive',
  'linear_model',
  'one_way_anova',
  'logistic_curve',
] as const
export type AnalysisMethodId = (typeof ANALYSIS_METHOD_IDS)[number]

export type AssumptionCheckStatus = 'pass' | 'warn' | 'fail' | 'not_checked'

/**
 * One assumption or design check reported alongside a result. `fail` and
 * `not_checked` are first-class: a violated assumption is visible and never
 * corrected for the analyst, and a test the data cannot support says so.
 */
export interface AssumptionCheck {
  id: string
  label: string
  status: AssumptionCheckStatus
  /**
   * The fit's group when the analysis fits one model per group, so a check
   * belongs to the model it describes. Absent for single-model results.
   */
  group?: string
  /** The check's statistic, when it is a formal test. */
  statistic?: number
  /** The check's p-value, when it is a formal test. */
  pValue?: number
  detail: string
  /** What an analyst may do about a failure. Never applied automatically. */
  remedy?: string
}

/** Identity of the statistical method a result was computed under. */
export interface AnalysisMethod {
  id: AnalysisMethodId
  /** Method-definition version, recorded with frozen evidence. */
  version: number
  label: string
  /** What the method reports and what it assumes, in one sentence. */
  statement: string
  /** Runtime identity — the kernel that produced the numbers. */
  runner: string
}

/**
 * The method a definition runs, stated before any number is read. The
 * descriptive kind makes no distributional claim; a grouped descriptive
 * definition reports a one-way ANOVA; a regression definition reports a
 * least-squares linear model with per-term inference.
 */
export function analysisMethodFor(
  definition: AnalysisDefinition,
): AnalysisMethod {
  const base = { version: ANALYSIS_METHOD_VERSION, runner: ANALYSIS_RUNNER }
  if (definition.kind === 'descriptive') {
    if (definition.group)
      return {
        ...base,
        id: 'one_way_anova',
        label: t('data.analysisDefinition.oneWayAnova'),
        statement: t('data.analysisDefinition.oneWayFixedEffects'),
      }
    return {
      ...base,
      id: 'descriptive',
      label: t('data.analysisDefinition.descriptiveStatistics'),
      statement: t('data.analysisDefinition.groupedSummaryStatisticsModel'),
    }
  }
  if (definition.kind === 'curve') {
    const model = definition.model ?? '4pl'
    return {
      ...base,
      id: 'logistic_curve',
      label:
        model === '5pl'
          ? t('data.analysisDefinition.fiveParameterLogisticFit')
          : t('data.analysisDefinition.fourParameterLogisticFit'),
      statement: t('data.analysisDefinition.logisticCurveStatement', {
        model: model === '5pl' ? '5PL' : '4PL',
      }),
    }
  }
  const degree = definition.degree ?? 1
  return {
    ...base,
    id: 'linear_model',
    label:
      degree === 1
        ? t('data.analysisDefinition.linearModelOrdinaryLeast')
        : t('data.analysisDefinition.polynomialLinearModelDegree', { degree }),
    statement: t('data.analysisDefinition.ordinaryLeastSquaresFit', { degree }),
  }
}

/** A binding to a field of a Dataset Schema Version (identical to charts).
 * fieldId is authoritative; labels are presentation metadata only. */
export interface AnalysisFieldBinding {
  fieldId: string
}

interface AnalysisDefinitionBase {
  definitionVersion: typeof ANALYSIS_DEFINITION_VERSION
  /** Exactly one input dataset; multi-dataset composition is out of scope. */
  datasets: DatasetRef[]
  /**
   * A chart shown beside the statistic. It reads the same single dataset; the
   * freeze pins one Dataset Version that proves both. Absent on definitions
   * saved before the merge, which stay valid unchanged.
   */
  chart?: ChartSpec | null
}

export interface DescriptiveDefinition extends AnalysisDefinitionBase {
  kind: 'descriptive'
  /** The measured column the statistics summarise. */
  value: AnalysisFieldBinding
  /** Optional categorical column; absent means one group over all rows. */
  group?: AnalysisFieldBinding | null
}

export interface RegressionDefinition extends AnalysisDefinitionBase {
  kind: 'regression'
  outcome: AnalysisFieldBinding
  predictor: AnalysisFieldBinding
  /** Polynomial degree; defaults to 1 when absent (validator mirrors this). */
  degree?: number
  /** Monotonic transforms applied before fitting (never back-transformed). */
  outcomeTransform?: ColumnTransform
  predictorTransform?: ColumnTransform
  /** Optional categorical column for parallel per-group fits. */
  group?: AnalysisFieldBinding | null
}

/**
 * A dose-response or standard curve: a four- or five-parameter logistic fitted
 * to the rows that have a dose (the standards), then used to read back every
 * row that has a response but no dose (the unknowns).
 */
export interface CurveDefinition extends AnalysisDefinitionBase {
  kind: 'curve'
  /** The dose or concentration column. Rows with none are the unknowns. */
  dose: AnalysisFieldBinding
  /** The measured response column. */
  response: AnalysisFieldBinding
  /** 4PL when absent. */
  model?: CurveModel
  /** Optional column that names each read-back row (a sample or well). */
  label?: AnalysisFieldBinding | null
  /** Optional categorical column for one curve per group (e.g. per plate). */
  group?: AnalysisFieldBinding | null
}

export type AnalysisDefinition =
  DescriptiveDefinition | RegressionDefinition | CurveDefinition

/** A saved analysis that is only a chart. */
export interface ChartDefinition {
  definitionVersion: typeof ANALYSIS_DEFINITION_VERSION
  datasets: DatasetRef[]
  kind: 'chart'
  chart: ChartSpec
}

/** Everything a notebook analysis block can run or show. */
export type AnalysisBlockDefinition = AnalysisDefinition | ChartDefinition

/** The statistic and the chart a block definition holds; either may be absent. */
export function analysisBlockParts(definition: AnalysisBlockDefinition): {
  statistic: AnalysisDefinition | null
  chart: ChartSpec | null
} {
  return {
    statistic: definition.kind === 'chart' ? null : definition,
    chart: definition.chart ?? null,
  }
}

// ---------------------------------------------------------------------------
// Execution results
// ---------------------------------------------------------------------------

export interface DescriptiveRow {
  group: string
  /** Rows dropped because the measured value was missing or non-numeric. */
  missing: number
  stats: SummaryStats
}

export interface RegressionFitRow {
  group: string
  n: number
  degree: number
  coefficients: number[]
  r2: number
  rmse: number
  equation: string
  /** Residual degrees of freedom, n − (degree + 1). */
  dfResidual: number
  /** Residual standard error; null when there is no residual df. */
  sigma: number | null
  /** Adjusted R²; null when there is no residual df. */
  adjR2: number | null
  /** Overall F over every non-intercept term; null when not estimable. */
  f: number | null
  /** Upper-tail p-value of the overall F; null when not estimable. */
  fP: number | null
  /** Term table in the fitted predictor space: intercept first. */
  terms: LinearModelTerm[]
}

/** One row of the reported term table, in the fitted (transformed) space. */
export interface LinearModelTerm {
  /** `Intercept`, `x`, `x²`, … — the predictor transform is named in the term. */
  term: string
  estimate: number
  /** Standard error; null when the fit has no residual variance to estimate it. */
  se: number | null
  /** Two-sided 95% confidence interval; null when not estimable. */
  ci95: { lo: number; hi: number } | null
  /** t statistic; null when not estimable. */
  t: number | null
  /** Two-sided p-value; null when not estimable. */
  p: number | null
}

export interface DescriptiveResult {
  kind: 'descriptive'
  method: AnalysisMethod
  checks: AssumptionCheck[]
  /** Groups appear in codepoint-sorted order; single-run analyses use 'all'. */
  rows: DescriptiveRow[]
  /**
   * One-way ANOVA over the groups, when the definition groups and the data
   * supports the test. Null otherwise — the checks state why.
   */
  anova: OneWayAnovaResult | null
}

export interface RegressionResult {
  kind: 'regression'
  method: AnalysisMethod
  checks: AssumptionCheck[]
  /** Groups appear in codepoint-sorted order; single-run analyses use 'all'. */
  rows: RegressionFitRow[]
}

/** One row read back through the fitted curve. */
export interface CurveReadBack {
  role: 'standard' | 'unknown'
  /** The row's label column, when one is bound. */
  label: string | null
  /** The dose the row was prepared at; null for an unknown. */
  dose: number | null
  response: number
  /** The dose the curve gives for this response; null when off the curve. */
  concentration: number | null
  /** Back-calculated ÷ nominal, as a percentage; standards only. */
  recovery: number | null
  /**
   * Where the answer sits: within the standards, beyond the highest or lowest
   * standard (extrapolated), or off the curve (no dose gives this response).
   */
  status: 'in_range' | 'above_range' | 'below_range' | 'off_curve'
}

export interface CurveFitRow {
  group: string
  model: CurveModel
  /** Standards used in the fit. */
  n: number
  parameters: CurveParameterEstimate[]
  r2: number
  rmse: number
  dfResidual: number
  sigma: number | null
  /** Dose at the half-way response: an IC50 when the response falls. */
  ec50: number
  ec50Ci95: { lo: number; hi: number } | null
  /** EC50 for a rising curve, IC50 for a falling one. */
  ecLabel: 'EC50' | 'IC50'
  falling: boolean
  /** Lowest and highest dose among the standards. */
  range: { min: number; max: number }
  /** The fitted curve with its numbers in it. */
  equation: string
  readBack: CurveReadBack[]
}

export interface CurveResult {
  kind: 'curve'
  method: AnalysisMethod
  checks: AssumptionCheck[]
  /** Groups appear in codepoint-sorted order; single-curve runs use 'all'. */
  rows: CurveFitRow[]
}

export type AnalysisResult = DescriptiveResult | RegressionResult | CurveResult

/** Honest execution states instead of silent empty tables. */
export type AnalysisError =
  | { code: 'missing_field'; fields: string[] }
  | { code: 'empty_dataset' }
  /** The analysis is a chart only; there is no statistic to compute. */
  | { code: 'no_statistic' }
  | { code: 'insufficient_data'; group: string; needed: number }
  | { code: 'singular_fit'; group: string }
  /** The logistic curve could not be fitted to this group's standards. */
  | { code: 'curve_not_fitted'; group: string; needed: number }
  | {
      code: 'nonpositive_transform'
      field: 'outcome' | 'predictor'
      count: number
    }
  | { code: 'no_numeric_values'; field: string }
  /**
   * Frozen evidence records a method-definition version this build cannot
   * reproduce. The pinned numbers are not shown: they could not honestly be
   * presented as the cited method's results.
   */
  | { code: 'method_mismatch'; recorded: number; current: number }

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type AnalysisDefinitionError = {
  code:
    | 'invalid_shape'
    | 'missing_field'
    | 'unsupported_dataset_count'
    | 'invalid_value'
    | 'unsupported_kind'
    | 'unsupported_definition_version'
  field?: string
  message: string
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

function validateBinding(
  v: unknown,
  field: string,
  required: boolean,
): AnalysisDefinitionError[] {
  if (v === null || v === undefined) {
    return required
      ? [{ code: 'missing_field', field, message: `${field} is required` }]
      : []
  }
  if (!isObject(v))
    return [
      { code: 'invalid_shape', field, message: `${field} must be an object` },
    ]
  const errors: AnalysisDefinitionError[] = []
  if (!isUuid(v.fieldId))
    errors.push({
      code: 'invalid_value',
      field: `${field}.fieldId`,
      message: `${field}.fieldId must be a UUID`,
    })
  return errors
}

/**
 * The chart a definition carries. Structural only: it must name the same single
 * dataset the definition does and bind a y field. Chart-type rules stay with the
 * chart spec validator that draws it.
 */
function validateCompanionChart(
  v: Record<string, unknown>,
  required: boolean,
): AnalysisDefinitionError[] {
  const chart = v.chart
  if (chart === undefined || chart === null) {
    return required
      ? [
          {
            code: 'missing_field',
            field: 'chart',
            message: t('data.analysisDefinition.chartRequired'),
          },
        ]
      : []
  }
  if (!isObject(chart))
    return [
      {
        code: 'invalid_shape',
        field: 'chart',
        message: t('data.analysisDefinition.chartMustObject'),
      },
    ]
  const errors: AnalysisDefinitionError[] = []
  const datasets = chart.datasets
  const own = Array.isArray(v.datasets) ? v.datasets[0] : undefined
  if (
    !Array.isArray(datasets) ||
    datasets.length !== 1 ||
    !isObject(datasets[0]) ||
    !isObject(own) ||
    datasets[0].datasetId !== own.datasetId
  )
    errors.push({
      code: 'unsupported_dataset_count',
      field: 'chart.datasets',
      message: t('data.analysisDefinition.chartMustReadSame'),
    })
  const fields = isObject(chart.fields) ? chart.fields : null
  errors.push(...validateBinding(fields?.y, 'chart.fields.y', true))
  return errors
}

/**
 * Structural validation only. Dataset reference integrity against live
 * Datasets is the database's job (mirrored in validate_scientific_block).
 */
export function validateAnalysisDefinition(
  v: unknown,
): AnalysisDefinitionError[] {
  if (!isObject(v))
    return [
      {
        code: 'invalid_shape',
        field: 'definition',
        message: t('data.analysisDefinition.definitionMustObject'),
      },
    ]
  const errors: AnalysisDefinitionError[] = []

  if (v.definitionVersion !== ANALYSIS_DEFINITION_VERSION)
    errors.push({
      code: 'unsupported_definition_version',
      field: 'definitionVersion',
      message: `definitionVersion must be ${ANALYSIS_DEFINITION_VERSION}`,
    })

  if (!Array.isArray(v.datasets) || v.datasets.length !== 1)
    errors.push({
      code: 'unsupported_dataset_count',
      field: 'datasets',
      message: 'datasets must contain exactly one dataset',
    })
  else if (!isObject(v.datasets[0]) || !isUuid(v.datasets[0].datasetId))
    errors.push({
      code: 'invalid_value',
      field: 'datasets[0].datasetId',
      message: 'datasets[0].datasetId must be a UUID',
    })

  const kind = v.kind
  if (
    typeof kind !== 'string' ||
    !(ANALYSIS_BLOCK_KINDS as readonly string[]).includes(kind)
  ) {
    errors.push({
      code: 'unsupported_kind',
      field: 'kind',
      message: `kind must be one of ${ANALYSIS_BLOCK_KINDS.join(', ')}`,
    })
    return errors
  }

  errors.push(...validateCompanionChart(v, kind === 'chart'))

  if (kind === 'chart') {
    // Nothing to bind: the chart is the whole analysis.
  } else if (kind === 'descriptive') {
    errors.push(...validateBinding(v.value, 'value', true))
    errors.push(...validateBinding(v.group ?? null, 'group', false))
  } else if (kind === 'curve') {
    errors.push(...validateBinding(v.dose, 'dose', true))
    errors.push(...validateBinding(v.response, 'response', true))
    errors.push(...validateBinding(v.label ?? null, 'label', false))
    errors.push(...validateBinding(v.group ?? null, 'group', false))
    if (
      v.model !== undefined &&
      !(CURVE_MODELS as readonly string[]).includes(v.model as string)
    )
      errors.push({
        code: 'invalid_value',
        field: 'model',
        message: `model must be one of ${CURVE_MODELS.join(', ')}`,
      })
  } else {
    errors.push(...validateBinding(v.outcome, 'outcome', true))
    errors.push(...validateBinding(v.predictor, 'predictor', true))
    errors.push(...validateBinding(v.group ?? null, 'group', false))
    if (
      v.degree !== undefined &&
      (typeof v.degree !== 'number' ||
        !Number.isInteger(v.degree) ||
        v.degree < 1 ||
        v.degree > MAX_DEGREE)
    )
      errors.push({
        code: 'invalid_value',
        field: 'degree',
        message: `degree must be an integer between 1 and ${MAX_DEGREE}`,
      })
    for (const key of ['outcomeTransform', 'predictorTransform'] as const) {
      const tv = v[key]
      if (
        tv !== undefined &&
        tv !== null &&
        !(COLUMN_TRANSFORMS as readonly string[]).includes(tv as string)
      )
        errors.push({
          code: 'invalid_value',
          field: key,
          message: `${key} must be one of ${COLUMN_TRANSFORMS.join(', ')}`,
        })
    }
  }
  return errors
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

function groupRows(
  rows: Record<string, unknown>[],
  fieldId: string | null,
): Map<string, Record<string, unknown>[]> {
  const groups = new Map<string, Record<string, unknown>[]>()
  for (const row of rows) {
    const key = fieldId ? String(row[fieldId] ?? '—') : 'all'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(row)
  }
  return new Map(
    Array.from(groups.entries()).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    ),
  )
}

function toNumeric(rowValues: unknown[]): {
  values: number[]
  missing: number
} {
  let missing = 0
  const values: number[] = []
  for (const v of rowValues) {
    if (typeof v === 'number' && Number.isFinite(v)) values.push(v)
    else if (
      typeof v === 'string' &&
      v.trim() !== '' &&
      Number.isFinite(Number(v))
    )
      values.push(Number(v))
    else missing += 1
  }
  return { values, missing }
}

/**
 * Execute a validated definition against dataset rows. Deterministic:
 * grouping order is codepoint-sorted and every statistic is a pure function
 * of the input values.
 */
export function runAnalysis(
  definition: AnalysisBlockDefinition,
  columns: ChartColumn[],
  rows: Record<string, unknown>[],
  flags: readonly DatasetValueFlag[] = [],
): { ok: true; result: AnalysisResult } | { ok: false; error: AnalysisError } {
  // A chart-only analysis has no statistic to run; its chart is drawn by the
  // block. Callers that show both read `analysisBlockParts` first.
  if (definition.kind === 'chart')
    return { ok: false, error: { code: 'no_statistic' } }
  // DSET-01.2 — a row whose analysed field is flagged is excluded by default.
  // The count travels into the reported checks: an exclusion is stated, never
  // silently applied.
  let excludedRows = 0
  if (flags.length > 0) {
    const usedFields = (
      definition.kind === 'descriptive'
        ? [definition.value, definition.group]
        : definition.kind === 'curve'
          ? [
              definition.dose,
              definition.response,
              definition.label,
              definition.group,
            ]
          : [definition.outcome, definition.predictor, definition.group]
    )
      .map((binding) => binding?.fieldId)
      .filter((fieldId): fieldId is string => typeof fieldId === 'string')
    if (usedFields.length > 0) {
      const index = buildFlagIndex(flags)
      rows = rows.filter((row) => {
        const rowId = row[CHART_ROW_ID_KEY]
        if (typeof rowId !== 'string') return true
        const flagged = usedFields.some((fieldId) =>
          isValueFlagged(index, rowId, fieldId),
        )
        if (flagged) excludedRows += 1
        return !flagged
      })
    }
  }
  if (rows.length === 0) return { ok: false, error: { code: 'empty_dataset' } }

  // The stable fieldId is the only key that resolves a binding; a missing
  // or retired field surfaces as missing_field instead of a name-based
  // rebind to whatever column happens to match a label.
  const resolve = (binding: AnalysisFieldBinding | null | undefined) =>
    binding ? (columns.find((c) => c.id === binding.fieldId) ?? null) : null

  if (definition.kind === 'descriptive') {
    const valueCol = resolve(definition.value)
    if (!valueCol)
      return { ok: false, error: { code: 'missing_field', fields: ['value'] } }
    const groupCol = resolve(definition.group ?? null)
    if (definition.group && !groupCol)
      return { ok: false, error: { code: 'missing_field', fields: ['group'] } }

    const outRows: DescriptiveRow[] = []
    const anovaGroups: Array<{ group: string; values: number[] }> = []
    for (const [key, group] of groupRows(rows, groupCol?.id ?? null)) {
      const { values, missing } = toNumeric(group.map((r) => r[valueCol.id]))
      const stats = summaryStats(values)
      if (!stats) continue
      outRows.push({ group: key, missing, stats })
      anovaGroups.push({ group: key, values })
    }
    if (outRows.length === 0)
      return {
        ok: false,
        error: { code: 'no_numeric_values', field: valueCol.id },
      }

    // Grouped descriptive statistics ARE a one-way ANOVA; ungrouped ones make
    // no distributional claim. Either way the method and every check it ran
    // travel with the numbers.
    const method = analysisMethodFor(definition)
    const checks: AssumptionCheck[] = []
    let anova: OneWayAnovaResult | null = null
    if (method.id === 'one_way_anova') {
      anova = oneWayAnova(anovaGroups)
      checks.push(
        ...(anova
          ? anovaAssumptionChecks(anova, anovaGroups)
          : [anovaUndefinedCheck(anovaGroups)]),
      )
    }
    pushExcludedRowsCheck(checks, excludedRows)
    return {
      ok: true,
      result: { kind: 'descriptive', method, checks, rows: outRows, anova },
    }
  }

  if (definition.kind === 'curve')
    return runCurve(definition, resolve, rows, excludedRows)

  // Regression.
  const outcomeCol = resolve(definition.outcome)
  const predictorCol = resolve(definition.predictor)
  const groupCol = resolve(definition.group ?? null)
  const missingCols: string[] = []
  if (!outcomeCol) missingCols.push('outcome')
  if (!predictorCol) missingCols.push('predictor')
  if (definition.group && !groupCol) missingCols.push('group')
  if (missingCols.length > 0)
    return { ok: false, error: { code: 'missing_field', fields: missingCols } }

  const degree = definition.degree ?? 1
  const outcomeTransform = definition.outcomeTransform ?? 'none'
  const predictorTransform = definition.predictorTransform ?? 'none'
  const outRows: RegressionFitRow[] = []
  const checks: AssumptionCheck[] = []
  for (const [key, group] of groupRows(rows, groupCol?.id ?? null)) {
    // Pair jointly so one missing side drops the whole observation rather
    // than silently shifting the alignment between predictor and outcome.
    const pairs: Array<[number, number]> = []
    for (const row of group) {
      const px = toNumeric([row[predictorCol!.id]]).values
      const py = toNumeric([row[outcomeCol!.id]]).values
      if (px.length === 1 && py.length === 1) pairs.push([px[0], py[0]])
    }
    if (pairs.length < degree + 1)
      return {
        ok: false,
        error: { code: 'insufficient_data', group: key, needed: degree + 1 },
      }

    // Log transforms drop a non-positive value together with its pair so
    // the fit stays aligned; the count is reported honestly.
    let predictorDropped = 0
    let outcomeDropped = 0
    const xs: number[] = []
    const ys: number[] = []
    for (const [x, y] of pairs) {
      if (predictorTransform !== 'none' && x <= 0) {
        predictorDropped += 1
        continue
      }
      if (outcomeTransform !== 'none' && y <= 0) {
        outcomeDropped += 1
        continue
      }
      xs.push(
        predictorTransform === 'none'
          ? x
          : TRANSFORM_FNS[predictorTransform](x),
      )
      ys.push(
        outcomeTransform === 'none' ? y : TRANSFORM_FNS[outcomeTransform](y),
      )
    }
    if (predictorDropped > 0 || outcomeDropped > 0) {
      const field = predictorDropped > 0 ? 'predictor' : 'outcome'
      return {
        ok: false,
        error: {
          code: 'nonpositive_transform',
          field,
          count: Math.max(predictorDropped, outcomeDropped),
        },
      }
    }
    if (xs.length < degree + 1)
      return {
        ok: false,
        error: { code: 'insufficient_data', group: key, needed: degree + 1 },
      }

    const fit = olsFitWithInference(xs, ys, degree)
    if (!fit) return { ok: false, error: { code: 'singular_fit', group: key } }
    const predictorSpace = spaceLabel('x', predictorTransform)
    const coefficientTerms = fit.coefficients
      .map((c, d) =>
        d === 0
          ? formatCoef(c)
          : `${formatCoef(c)}·${predictorSpace}${d > 1 ? superscript(d) : ''}`,
      )
      .reverse()
      .join(' + ')
    outRows.push({
      group: key,
      n: xs.length,
      degree,
      coefficients: fit.coefficients,
      r2: fit.r2,
      rmse: fit.rmse,
      equation: `${spaceLabel('y', outcomeTransform)} = ${coefficientTerms}`,
      dfResidual: fit.dfResidual,
      sigma: fit.sigma,
      adjR2: fit.adjR2,
      f: fit.f,
      fP: fit.fP,
      terms: linearModelTerms(fit, predictorTransform),
    })
    const fitted = ys.map((y, i) => y - fit.residuals[i])
    // A grouped definition fits one model per group, so each check names the
    // group whose model it describes.
    checks.push(
      ...linearModelChecks({
        fit,
        xs,
        fitted,
        degree,
        predictorTransform,
        outcomeTransform,
      }).map((check) => (definition.group ? { ...check, group: key } : check)),
    )
  }
  if (outRows.length === 0)
    return {
      ok: false,
      error: { code: 'no_numeric_values', field: outcomeCol!.id },
    }
  pushExcludedRowsCheck(checks, excludedRows)
  return {
    ok: true,
    result: {
      kind: 'regression',
      method: analysisMethodFor(definition),
      checks,
      rows: outRows,
    },
  }
}

// ---------------------------------------------------------------------------
// Dose-response and standard curves
// ---------------------------------------------------------------------------

/** A standard read back within this band of its nominal dose is accurate. */
const RECOVERY_BAND = { lo: 80, hi: 120 } as const

function curveEquation(fit: CurveFit): string {
  const { A, B, C, D, G } = fit.params
  const base = `1 + (x / ${formatCoef(C)})^${formatCoef(B)}`
  return fit.model === '5pl'
    ? `y = ${formatCoef(D)} + (${formatCoef(A)} − ${formatCoef(D)}) / (${base})^${formatCoef(G)}`
    : `y = ${formatCoef(D)} + (${formatCoef(A)} − ${formatCoef(D)}) / (${base})`
}

function readBackStatus(
  concentration: number | null,
  range: { min: number; max: number },
): CurveReadBack['status'] {
  if (concentration === null) return 'off_curve'
  if (concentration < range.min) return 'below_range'
  if (concentration > range.max) return 'above_range'
  return 'in_range'
}

function curveChecks(input: {
  fit: CurveFit
  range: { min: number; max: number }
  responses: number[]
  readBack: CurveReadBack[]
  zeroDose: number
}): AssumptionCheck[] {
  const { fit, range, responses, readBack, zeroDose } = input
  const checks: AssumptionCheck[] = []

  checks.push({
    id: 'curve_converged',
    label: t('data.analysisDefinition.curveConverged'),
    status: fit.converged ? 'pass' : 'fail',
    detail: t('data.analysisDefinition.curveConvergedDetail', {
      iterations: fit.iterations,
    }),
    ...(fit.converged
      ? {}
      : { remedy: t('data.analysisDefinition.curveConvergedRemedy') }),
  })

  if (fit.dfResidual === 0)
    checks.push({
      id: 'curve_uncertainty',
      label: t('data.analysisDefinition.curveUncertainty'),
      status: 'warn',
      detail: t('data.analysisDefinition.curveUncertaintyDetail', {
        n: fit.n,
      }),
      remedy: t('data.analysisDefinition.curveUncertaintyRemedy'),
    })

  const inside = fit.ec50 >= range.min && fit.ec50 <= range.max
  checks.push({
    id: 'curve_midpoint_inside',
    label: t('data.analysisDefinition.curveMidpointInside', {
      ecLabel: fit.falling ? 'IC50' : 'EC50',
    }),
    status: inside ? 'pass' : 'warn',
    detail: t('data.analysisDefinition.curveMidpointDetail', {
      ec50: formatQuantity(fit.ec50),
      min: formatQuantity(range.min),
      max: formatQuantity(range.max),
    }),
    ...(inside
      ? {}
      : { remedy: t('data.analysisDefinition.curveMidpointRemedy') }),
  })

  // Both plateaus should be backed by data; an asymptote far beyond every
  // observed response is an extrapolation, not a measurement.
  const low = Math.min(...responses)
  const high = Math.max(...responses)
  const span = Math.max(high - low, 1e-12)
  const unsupported = [fit.params.A, fit.params.D].filter(
    (value) => value < low - 0.25 * span || value > high + 0.25 * span,
  ).length
  checks.push({
    id: 'curve_plateaus',
    label: t('data.analysisDefinition.curvePlateaus'),
    status: unsupported === 0 ? 'pass' : 'warn',
    detail:
      unsupported === 0
        ? t('data.analysisDefinition.curvePlateausDetail')
        : t('data.analysisDefinition.curvePlateausMissing', {
            count: unsupported,
          }),
    ...(unsupported === 0
      ? {}
      : { remedy: t('data.analysisDefinition.curvePlateausRemedy') }),
  })

  const standards = readBack.filter(
    (r) => r.role === 'standard' && r.recovery !== null,
  )
  if (standards.length > 0) {
    const off = standards.filter(
      (r) => r.recovery! < RECOVERY_BAND.lo || r.recovery! > RECOVERY_BAND.hi,
    ).length
    checks.push({
      id: 'curve_standard_recovery',
      label: t('data.analysisDefinition.curveRecovery'),
      status: off === 0 ? 'pass' : 'warn',
      detail: t('data.analysisDefinition.curveRecoveryDetail', {
        off,
        total: standards.length,
        lo: RECOVERY_BAND.lo,
        hi: RECOVERY_BAND.hi,
      }),
      ...(off === 0
        ? {}
        : { remedy: t('data.analysisDefinition.curveRecoveryRemedy') }),
    })
  }

  const unknowns = readBack.filter((r) => r.role === 'unknown')
  if (unknowns.length > 0) {
    const outside = unknowns.filter((r) => r.status !== 'in_range').length
    checks.push({
      id: 'curve_unknowns_inside',
      label: t('data.analysisDefinition.curveUnknownsInside'),
      status: outside === 0 ? 'pass' : 'warn',
      detail: t('data.analysisDefinition.curveUnknownsDetail', {
        outside,
        total: unknowns.length,
      }),
      ...(outside === 0
        ? {}
        : { remedy: t('data.analysisDefinition.curveUnknownsRemedy') }),
    })
  }

  if (zeroDose > 0)
    checks.push({
      id: 'curve_zero_dose',
      label: t('data.analysisDefinition.curveZeroDose'),
      status: 'pass',
      detail: t('data.analysisDefinition.curveZeroDoseDetail', {
        count: zeroDose,
      }),
    })
  return checks
}

function runCurve(
  definition: CurveDefinition,
  resolve: (
    binding: AnalysisFieldBinding | null | undefined,
  ) => ChartColumn | null,
  rows: Record<string, unknown>[],
  excludedRows: number,
): { ok: true; result: AnalysisResult } | { ok: false; error: AnalysisError } {
  const doseCol = resolve(definition.dose)
  const responseCol = resolve(definition.response)
  const labelCol = resolve(definition.label ?? null)
  const groupCol = resolve(definition.group ?? null)
  const missingCols: string[] = []
  if (!doseCol) missingCols.push('dose')
  if (!responseCol) missingCols.push('response')
  if (definition.label && !labelCol) missingCols.push('label')
  if (definition.group && !groupCol) missingCols.push('group')
  if (missingCols.length > 0)
    return { ok: false, error: { code: 'missing_field', fields: missingCols } }

  const model = definition.model ?? '4pl'
  const needed = model === '5pl' ? 5 : 4
  const outRows: CurveFitRow[] = []
  const checks: AssumptionCheck[] = []

  for (const [key, group] of groupRows(rows, groupCol?.id ?? null)) {
    const standards: Array<{
      label: string | null
      dose: number
      response: number
    }> = []
    const unknowns: Array<{ label: string | null; response: number }> = []
    let zeroDose = 0
    for (const row of group) {
      const response = toNumeric([row[responseCol!.id]]).values
      if (response.length !== 1) continue
      const labelCell = labelCol ? row[labelCol.id] : null
      const label =
        labelCell === null || labelCell === undefined || labelCell === ''
          ? null
          : String(labelCell)
      const dose = toNumeric([row[doseCol!.id]]).values
      if (dose.length === 1 && dose[0] > 0)
        standards.push({ label, dose: dose[0], response: response[0] })
      else if (dose.length === 1) zeroDose += 1
      else unknowns.push({ label, response: response[0] })
    }
    if (standards.length < needed)
      return {
        ok: false,
        error: { code: 'insufficient_data', group: key, needed },
      }

    const fit = fitCurve(
      standards.map((s) => s.dose),
      standards.map((s) => s.response),
      model,
    )
    if (!fit)
      return {
        ok: false,
        error: { code: 'curve_not_fitted', group: key, needed },
      }

    const range = {
      min: Math.min(...standards.map((s) => s.dose)),
      max: Math.max(...standards.map((s) => s.dose)),
    }
    const readBack: CurveReadBack[] = [
      ...standards.map((s) => {
        const concentration = curveInverse(fit.params, s.response, model)
        return {
          role: 'standard' as const,
          label: s.label,
          dose: s.dose,
          response: s.response,
          concentration,
          recovery:
            concentration === null ? null : (concentration / s.dose) * 100,
          status: readBackStatus(concentration, range),
        }
      }),
      ...unknowns.map((u) => {
        const concentration = curveInverse(fit.params, u.response, model)
        return {
          role: 'unknown' as const,
          label: u.label,
          dose: null,
          response: u.response,
          concentration,
          recovery: null,
          status: readBackStatus(concentration, range),
        }
      }),
    ]
    outRows.push({
      group: key,
      model,
      n: fit.n,
      parameters: fit.estimates,
      r2: fit.r2,
      rmse: fit.rmse,
      dfResidual: fit.dfResidual,
      sigma: fit.sigma,
      ec50: curveEc50(fit.params, model),
      ec50Ci95: fit.ec50Ci95,
      ecLabel: fit.falling ? 'IC50' : 'EC50',
      falling: fit.falling,
      range,
      equation: curveEquation(fit),
      readBack,
    })
    checks.push(
      ...curveChecks({
        fit,
        range,
        responses: standards.map((s) => s.response),
        readBack,
        zeroDose,
      }).map((check) => (definition.group ? { ...check, group: key } : check)),
    )
  }
  if (outRows.length === 0)
    return {
      ok: false,
      error: { code: 'no_numeric_values', field: responseCol!.id },
    }
  pushExcludedRowsCheck(checks, excludedRows)
  return {
    ok: true,
    result: {
      kind: 'curve',
      method: analysisMethodFor(definition),
      checks,
      rows: outRows,
    },
  }
}

// ---------------------------------------------------------------------------
// R5-STUDIO-01 — method statements, term tables and assumption checks
// ---------------------------------------------------------------------------

const TRANSFORM_LABEL: Record<Exclude<ColumnTransform, 'none'>, string> = {
  log10: 'log10',
  ln: 'ln',
}

/** `x`, `ln(x)`, `log10(x)` — the space a fit and its checks describe. */
function spaceLabel(base: string, transform: ColumnTransform): string {
  return transform === 'none' ? base : `${TRANSFORM_LABEL[transform]}(${base})`
}

function termLabel(power: number, predictorTransform: ColumnTransform): string {
  if (power === 0) return t('data.analysisDefinition.intercept')
  const base = spaceLabel('x', predictorTransform)
  return power === 1 ? base : `${base}${superscript(power)}`
}

/**
 * Term table in the fitted predictor space. The 95% intervals come off the
 * kernel's deterministic t table, the same table the descriptive mean
 * intervals use. `se`, `t`, `p` and the interval are null when the fit has no
 * residual variance to estimate them from: a fit with zero residual variance
 * reports its estimates exactly and says so rather than dividing by zero.
 */
function linearModelTerms(
  fit: LinearModelFit,
  predictorTransform: ColumnTransform,
): LinearModelTerm[] {
  const tCritical = tCritical95(fit.dfResidual)
  return fit.coefficients.map((estimate, power) => {
    const term = termLabel(power, predictorTransform)
    if (fit.sigma === null || fit.sigma === 0) {
      return {
        term,
        estimate,
        se: fit.sigma === 0 ? 0 : null,
        ci95: null,
        t: null,
        p: null,
      }
    }
    const variance = fit.covariance[power]?.[power] ?? Number.NaN
    if (!(variance > 0) || !Number.isFinite(variance))
      return { term, estimate, se: null, ci95: null, t: null, p: null }
    const se = Math.sqrt(variance)
    const tStat = estimate / se
    return {
      term,
      estimate,
      se,
      ci95: { lo: estimate - tCritical * se, hi: estimate + tCritical * se },
      t: tStat,
      p: tTwoSidedP(tStat, fit.dfResidual),
    }
  })
}

interface LinearModelCheckInput {
  fit: LinearModelFit
  xs: number[]
  /** Fitted values, in observation order (ys[i] − residuals[i]). */
  fitted: number[]
  degree: number
  predictorTransform: ColumnTransform
  outcomeTransform: ColumnTransform
}

/**
 * The assumption and design checks a least-squares fit can actually run.
 * Formal tests report their statistic and p-value; structural checks that the
 * data cannot support report `not_checked` with the reason. A failed check is
 * reported as it stands — nothing is transformed, dropped or corrected.
 */
function linearModelChecks(input: LinearModelCheckInput): AssumptionCheck[] {
  const { fit, xs, fitted, degree } = input
  const n = fit.residuals.length
  const checks: AssumptionCheck[] = []

  const normality = jarqueBeraTest(fit.residuals)
  if (!normality)
    checks.push({
      id: 'residual_normality',
      label: t('data.analysisDefinition.residualsNormal'),
      status: 'not_checked',
      detail: t('data.analysisDefinition.jarqueBeraNeedsLeast', { n }),
    })
  else
    checks.push({
      id: 'residual_normality',
      label: t('data.analysisDefinition.residualsNormal'),
      status:
        normality.p < 0.01 ? 'fail' : normality.p < 0.05 ? 'warn' : 'pass',
      statistic: normality.statistic,
      pValue: normality.p,
      detail: t('data.analysisDefinition.jarqueBeraResidualsSkewness', {
        value: formatQuantity(normality.statistic),
        n,
        value2: formatQuantity(normality.skewness),
        value3: formatQuantity(normality.excessKurtosis),
        value4: formatPValue(normality.p),
      }),
      ...(normality.p < 0.05
        ? {
            remedy: t(
              'data.analysisDefinition.inspectResidualsConsiderTransform',
            ),
          }
        : {}),
    })

  const heteroscedasticity = breuschPaganTest(fitted, fit.residuals)
  if (!heteroscedasticity)
    checks.push({
      id: 'constant_variance',
      label: t('data.analysisDefinition.residualVarianceConstant'),
      status: 'not_checked',
      detail: t('data.analysisDefinition.breuschPaganNeedsLeast'),
    })
  else
    checks.push({
      id: 'constant_variance',
      label: t('data.analysisDefinition.residualVarianceConstant'),
      status: heteroscedasticity.p < 0.05 ? 'fail' : 'pass',
      statistic: heteroscedasticity.statistic,
      pValue: heteroscedasticity.p,
      detail: t('data.analysisDefinition.breuschPaganAgainstFitted', {
        value: formatQuantity(heteroscedasticity.statistic),
        df: heteroscedasticity.df,
        value2: formatPValue(heteroscedasticity.p),
      }),
      ...(heteroscedasticity.p < 0.05
        ? {
            remedy: t('data.analysisDefinition.residualSpreadChangesFitted'),
          }
        : {}),
    })

  checks.push(independentObservationsCheck())

  const distinct = new Set(xs).size
  checks.push(
    distinct === n
      ? {
          id: 'replicate_predictor_values',
          label: t('data.analysisDefinition.replicatesSeparateLackFit'),
          status: 'warn',
          detail: t('data.analysisDefinition.allPredictorValuesDistinct', {
            n,
          }),
        }
      : {
          id: 'replicate_predictor_values',
          label: t('data.analysisDefinition.replicatesSeparateLackFit'),
          status: 'pass',
          detail: `${n - distinct} of ${n} predictor values repeat, so pure error is separable from lack of fit.`,
        },
  )

  const cooks = fit.maxCooksDistance
  checks.push(
    cooks === null
      ? {
          id: 'influence',
          label: t('data.analysisDefinition.singleObservationDrivesFit'),
          status: 'not_checked',
          detail: t('data.analysisDefinition.cookSDistanceNeeds'),
        }
      : {
          id: 'influence',
          label: t('data.analysisDefinition.singleObservationDrivesFit'),
          status: cooks > 1 ? 'warn' : 'pass',
          statistic: cooks,
          detail: t('data.analysisDefinition.largestCookSDistance', {
            value: formatQuantity(cooks),
            value2:
              cooks > 1 ? ' — above the conventional threshold of 1.' : '.',
          }),
          ...(cooks > 1
            ? {
                remedy: t(
                  'data.analysisDefinition.checkInfluentialObservationAgainst',
                ),
              }
            : {}),
        },
  )

  checks.push(
    fit.dfResidual < 5
      ? {
          id: 'residual_df',
          label: t('data.analysisDefinition.enoughResidualDegreesFreedom'),
          status: 'warn',
          detail: `${fit.dfResidual} residual df for ${degree + 1} term(s); treat p-values as a guide.`,
        }
      : {
          id: 'residual_df',
          label: t('data.analysisDefinition.enoughResidualDegreesFreedom'),
          status: 'pass',
          detail: `${fit.dfResidual} residual df for ${degree + 1} term(s).`,
        },
  )

  const transforms = [
    input.predictorTransform === 'none'
      ? null
      : `the predictor transform ${TRANSFORM_LABEL[input.predictorTransform]}`,
    input.outcomeTransform === 'none'
      ? null
      : `the outcome transform ${TRANSFORM_LABEL[input.outcomeTransform]}`,
  ].filter((part): part is string => part !== null)
  if (transforms.length > 0)
    checks.push({
      id: 'transform_scope',
      label: t('data.analysisDefinition.transformAppropriate'),
      status: 'not_checked',
      detail: `${transforms.join(' and ')} ${transforms.length > 1 ? 'are' : 'is'} applied before fitting and never back-transformed. The checks above are computed in that transformed space; none of them verifies that the transform is the right one.`,
    })

  return checks
}

function independentObservationsCheck(): AssumptionCheck {
  return {
    id: 'independent_observations',
    label: t('data.analysisDefinition.observationsIndependent'),
    status: 'not_checked',
    detail: t('data.analysisDefinition.rowsTreatedIndependentObservations'),
  }
}

/** Why `oneWayAnova` refused to run, stated as a visible not-checked entry. */
function anovaUndefinedCheck(
  groups: Array<{ group: string; values: number[] }>,
): AssumptionCheck {
  const used = groups.filter((entry) => entry.values.length > 0)
  const total = used.reduce((acc, entry) => acc + entry.values.length, 0)
  const reason =
    used.length < 2
      ? `only ${used.length} group(s) hold values; the F test needs at least two`
      : total - used.length < 1
        ? `the groups hold ${total} observation(s) in total, leaving no within-group degrees of freedom`
        : 'every group is perfectly constant, so there is no within-group variance'
  return {
    id: 'anova_defined',
    label: t('data.analysisDefinition.oneWayAnovaDefined'),
    status: 'not_checked',
    detail: t('data.analysisDefinition.fTestRun', { reason }),
  }
}

function anovaAssumptionChecks(
  anova: OneWayAnovaResult,
  groups: Array<{ group: string; values: number[] }>,
): AssumptionCheck[] {
  const used = groups.filter((entry) => entry.values.length > 0)
  const residuals = used.flatMap((entry) => {
    const mean =
      entry.values.reduce((acc, v) => acc + v, 0) / entry.values.length
    return entry.values.map((v) => v - mean)
  })
  const checks: AssumptionCheck[] = []

  const normality = jarqueBeraTest(residuals)
  if (!normality)
    checks.push({
      id: 'residual_normality',
      label: t('data.analysisDefinition.residualsNormal'),
      status: 'not_checked',
      detail: t('data.analysisDefinition.jarqueBeraNeedsLeast2', {
        length: residuals.length,
      }),
    })
  else
    checks.push({
      id: 'residual_normality',
      label: t('data.analysisDefinition.residualsNormal'),
      status:
        normality.p < 0.01 ? 'fail' : normality.p < 0.05 ? 'warn' : 'pass',
      statistic: normality.statistic,
      pValue: normality.p,
      detail: t('data.analysisDefinition.jarqueBeraWithinGroup', {
        value: formatQuantity(normality.statistic),
        length: residuals.length,
        value2: formatQuantity(normality.skewness),
        value3: formatQuantity(normality.excessKurtosis),
        value4: formatPValue(normality.p),
      }),
      ...(normality.p < 0.05
        ? {
            remedy: t('data.analysisDefinition.inspectWithinGroupResiduals'),
          }
        : {}),
    })

  const variance = brownForsytheTest(used)
  if (!variance)
    checks.push({
      id: 'equal_variance',
      label: t('data.analysisDefinition.equalVarianceEveryGroup'),
      status: 'not_checked',
      detail: t('data.analysisDefinition.brownForsytheNeedsTwo'),
    })
  else
    checks.push({
      id: 'equal_variance',
      label: t('data.analysisDefinition.equalVarianceEveryGroup'),
      status: variance.p < 0.05 ? 'fail' : 'pass',
      statistic: variance.f,
      pValue: variance.p,
      detail: t('data.analysisDefinition.brownForsytheMedianCentred', {
        df1: variance.df1,
        df2: variance.df2,
        value: formatQuantity(variance.f),
        value2: formatPValue(variance.p),
      }),
      ...(variance.p < 0.05
        ? {
            remedy: t('data.analysisDefinition.groupSpreadsDifferVariance'),
          }
        : {}),
    })

  checks.push(independentObservationsCheck())

  const smallest = anova.groups.reduce(
    (min, group) => Math.min(min, group.n),
    Number.POSITIVE_INFINITY,
  )
  checks.push(
    smallest < 2
      ? {
          id: 'group_sizes',
          label: t('data.analysisDefinition.everyGroupHasReplicate'),
          status: 'warn',
          detail: t('data.analysisDefinition.smallestGroupHasObservation', {
            count: smallest,
          }),
        }
      : {
          id: 'group_sizes',
          label: t('data.analysisDefinition.everyGroupHasReplicate'),
          status: 'pass',
          detail: t('data.analysisDefinition.everyGroupHasLeast', { smallest }),
        },
  )
  return checks
}

/** An exclusion is stated in the checks; it is never re-included silently. */
function pushExcludedRowsCheck(
  checks: AssumptionCheck[],
  excludedRows: number,
): void {
  if (excludedRows === 0) return
  checks.push({
    id: 'excluded_rows',
    label: t('data.analysisDefinition.flaggedRowsExcluded'),
    status: 'warn',
    detail: `${excludedRows} row(s) were excluded because a value this analysis uses is flagged. Exclusions stay excluded — nothing is re-included or corrected automatically.`,
  })
}

function formatQuantity(value: number): string {
  if (!Number.isFinite(value)) return t('data.analysisDefinition.notEstimable')
  return Number(value.toPrecision(4)).toString()
}

function formatPValue(value: number): string {
  if (!Number.isFinite(value)) return t('data.analysisDefinition.notEstimable')
  return value < 0.001 ? '< 0.001' : Number(value.toPrecision(3)).toString()
}

/**
 * A citable sentence describing what was run, over how many observations,
 * with which checks passed or failed. Deterministic: the same result always
 * produces the same text, so a Methods section can be re-derived from frozen
 * evidence instead of retyped.
 */
export function analysisMethodsText(result: AnalysisResult): string {
  const { method } = result
  const parts: string[] = [
    `${method.label} (${method.runner}, method v${method.version}).`,
  ]

  if (result.kind === 'descriptive') {
    const observations = result.rows.reduce((acc, row) => acc + row.stats.n, 0)
    parts.push(`n = ${observations} across ${result.rows.length} group(s).`)
    const anova = result.anova
    if (anova) {
      parts.push(
        t('data.analysisDefinition.oneWayAnovaF', {
          dfBetween: anova.dfBetween,
          dfWithin: anova.dfWithin,
          value: formatQuantity(anova.f),
          value2: formatPValue(anova.p),
          value3: formatQuantity(anova.etaSquared),
        }),
      )
      parts.push(
        t('data.analysisDefinition.groupMeans', {
          join: anova.groups
            .map(
              (group) =>
                `${group.group} ${formatQuantity(group.mean)} (n = ${group.n}${group.ci95 ? `, 95% CI ${formatQuantity(group.ci95.lo)}–${formatQuantity(group.ci95.hi)}` : ''})`,
            )
            .join('; '),
        }),
      )
    } else {
      parts.push(t('data.analysisDefinition.modelFittedSoP'))
    }
  } else if (result.kind === 'curve') {
    for (const row of result.rows) {
      const scope = row.group === 'all' ? '' : `group ${row.group}: `
      const unknowns = row.readBack.filter((r) => r.role === 'unknown')
      parts.push(
        t('data.analysisDefinition.curveMethodsFit', {
          scope,
          n: row.n,
          model: row.model === '5pl' ? '5PL' : '4PL',
          r2: formatQuantity(row.r2),
          ecLabel: row.ecLabel,
          ec50: formatQuantity(row.ec50),
          ci: row.ec50Ci95
            ? ` [${formatQuantity(row.ec50Ci95.lo)}, ${formatQuantity(row.ec50Ci95.hi)}]`
            : '',
          parameters: row.parameters
            .map((p) => `${p.name} ${formatQuantity(p.estimate)}`)
            .join(', '),
          unknowns: unknowns.length,
          inRange: unknowns.filter((r) => r.status === 'in_range').length,
        }),
      )
    }
  } else {
    for (const row of result.rows) {
      const scope = row.group === 'all' ? '' : `group ${row.group}: `
      parts.push(
        `${scope}n = ${row.n}; R² = ${formatQuantity(row.r2)}` +
          (row.adjR2 === null
            ? ''
            : t('data.analysisDefinition.adjusted', {
                value: formatQuantity(row.adjR2),
              })) +
          `; residual σ = ${formatQuantity(row.sigma ?? Number.NaN)} on ${row.dfResidual} df` +
          (row.f === null || row.fP === null
            ? ''
            : `; overall F(${row.degree}, ${row.dfResidual}) = ${formatQuantity(row.f)}, p = ${formatPValue(row.fP)}`) +
          '.',
      )
      parts.push(
        `${scope}Terms (estimate, 95% CI): ${row.terms
          .map(
            (term) =>
              `${term.term} ${formatQuantity(term.estimate)}${
                term.ci95
                  ? ` [${formatQuantity(term.ci95.lo)}, ${formatQuantity(term.ci95.hi)}]`
                  : ''
              }${term.p === null ? '' : `, p = ${formatPValue(term.p)}`}`,
          )
          .join('; ')}.`,
      )
    }
  }

  if (result.checks.length > 0)
    parts.push(
      t('data.analysisDefinition.checks', {
        join: result.checks
          .map(
            (check) =>
              `${check.group ? `Group ${check.group} ` : ''}${check.label} — ${check.status.replace('_', ' ')}${
                check.pValue === undefined
                  ? ''
                  : ` (p = ${formatPValue(check.pValue)})`
              }`,
          )
          .join('; '),
      }),
    )
  return parts.join(' ')
}

export const TRANSFORM_FNS: Record<
  Exclude<ColumnTransform, 'none'>,
  (v: number) => number
> = {
  log10: Math.log10,
  ln: Math.log,
}

/**
 * Sample a fitted polynomial across the predictor range so the fit renders
 * as a smooth curve next to the observations (SCI-02 → SCI-01 link).
 * Deterministic: `samples` evenly spaced points inclusive of both ends.
 */
export function regressionFitCurve(
  coefficients: number[],
  xRange: { min: number; max: number },
  samples = 50,
): Array<{ x: number; y: number }> {
  if (coefficients.length === 0 || samples < 2) return []
  const { min, max } = xRange
  const span = max - min || 1
  return Array.from({ length: samples }, (_, i) => {
    const x = min + (span * i) / (samples - 1)
    return { x, y: polyEval(coefficients, x) }
  })
}

function formatCoef(c: number): string {
  return Number(c.toPrecision(6)).toString()
}

function superscript(n: number): string {
  const sup = ['⁰', '¹', '²', '³', '⁴']
  return sup[n] ?? `^${n}`
}

export { summaryStats }
