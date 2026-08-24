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
 */

import { fitQuality, olsFit, polyEval, summaryStats } from './stats'
import type { SummaryStats } from './stats'

import type { ChartColumn } from './chart-spec'

export const ANALYSIS_DEFINITION_VERSION = 1 as const
export const ANALYSIS_KINDS = ['descriptive', 'regression'] as const
export type AnalysisKind = (typeof ANALYSIS_KINDS)[number]

export const COLUMN_TRANSFORMS = ['none', 'log10', 'ln'] as const
export type ColumnTransform = (typeof COLUMN_TRANSFORMS)[number]

export const MAX_DEGREE = 4 as const

/** A binding to a field of a Dataset Schema Version (identical to charts).
 * fieldId is authoritative; labels are presentation metadata only. */
export interface AnalysisFieldBinding {
  fieldId: string
}

interface AnalysisDefinitionBase {
  definitionVersion: typeof ANALYSIS_DEFINITION_VERSION
  /** Exactly one input dataset; multi-dataset composition is out of scope. */
  datasets: { datasetId: string }[]
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

export type AnalysisDefinition = DescriptiveDefinition | RegressionDefinition

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
}

export interface AnalysisResultBase {
  kind: AnalysisKind
  /** Groups appear in codepoint-sorted order; single-run analyses use 'all'. */
  rows: DescriptiveRow[] | RegressionFitRow[]
}

export type AnalysisResult =
  | { kind: 'descriptive'; rows: DescriptiveRow[] }
  | { kind: 'regression'; rows: RegressionFitRow[] }

/** Honest execution states instead of silent empty tables. */
export type AnalysisError =
  | { code: 'missing_field'; fields: string[] }
  | { code: 'empty_dataset' }
  | { code: 'insufficient_data'; group: string; needed: number }
  | { code: 'singular_fit'; group: string }
  | {
      code: 'nonpositive_transform'
      field: 'outcome' | 'predictor'
      count: number
    }
  | { code: 'no_numeric_values'; field: string }

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
        message: 'definition must be an object',
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
    !(ANALYSIS_KINDS as readonly string[]).includes(kind)
  ) {
    errors.push({
      code: 'unsupported_kind',
      field: 'kind',
      message: `kind must be one of ${ANALYSIS_KINDS.join(', ')}`,
    })
    return errors
  }

  if (kind === 'descriptive') {
    errors.push(...validateBinding(v.value, 'value', true))
    errors.push(...validateBinding(v.group ?? null, 'group', false))
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
      const t = v[key]
      if (
        t !== undefined &&
        t !== null &&
        !(COLUMN_TRANSFORMS as readonly string[]).includes(t as string)
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
  definition: AnalysisDefinition,
  columns: ChartColumn[],
  rows: Record<string, unknown>[],
): { ok: true; result: AnalysisResult } | { ok: false; error: AnalysisError } {
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
    for (const [key, group] of groupRows(rows, groupCol?.id ?? null)) {
      const { values, missing } = toNumeric(group.map((r) => r[valueCol.id]))
      const stats = summaryStats(values)
      if (!stats) continue
      outRows.push({ group: key, missing, stats })
    }
    if (outRows.length === 0)
      return {
        ok: false,
        error: { code: 'no_numeric_values', field: valueCol.id },
      }
    return { ok: true, result: { kind: 'descriptive', rows: outRows } }
  }

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

    const fit = olsFit(xs, ys, degree)
    if (!fit) return { ok: false, error: { code: 'singular_fit', group: key } }
    const quality = fitQuality(xs, ys, fit.coefficients)
    const terms = fit.coefficients
      .map((c, d) =>
        d === 0
          ? formatCoef(c)
          : `${formatCoef(c)}·x${d > 1 ? superscript(d) : ''}`,
      )
      .reverse()
      .join(' + ')
    outRows.push({
      group: key,
      n: xs.length,
      degree,
      coefficients: fit.coefficients,
      r2: quality.r2,
      rmse: quality.rmse,
      equation: `y = ${terms}`,
    })
  }
  if (outRows.length === 0)
    return {
      ok: false,
      error: { code: 'no_numeric_values', field: outcomeCol!.id },
    }
  return { ok: true, result: { kind: 'regression', rows: outRows } }
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
