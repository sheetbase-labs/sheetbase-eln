/**
 * SCI-004 — Chart specification model and validation (decision 0029).
 *
 * A `chart` notebook block carries a `ChartSpec` on its JSONB payload. This
 * module is the application-boundary source of truth for the spec shape: the
 * block validator (`src/lib/blocks`) delegates chart-payload validation here,
 * the DB trigger (`validate_scientific_block`) mirrors the structural rules,
 * and the renderer/preview consume the typed shapes.
 *
 * The spec is intentionally generic: it references stable datasets
 * (`scientific_tables`) by UUID, maps fields by `{ columnId, fieldName }`,
 * keeps filters/transformations/overlays explicit and reproducible, and
 * confines chart-type-specific logic to the `type` discriminator. No
 * chart-type-specific or dataset-specific columns live in shared
 * infrastructure.
 */

/** Approved chart-series palette from DESIGN.md (cool scientific system). */
export const CHART_PALETTE = [
  '#006EDC', // Laboratory Blue
  '#00A659', // Success Green
  '#9B61EA', // Analysis Violet
  '#00A3BB', // Analysis Cyan
  '#E8A200', // Warning Amber
] as const

export type ChartPaletteColor = (typeof CHART_PALETTE)[number]

export const CHART_TYPES = ['line', 'scatter', 'bar'] as const
export type ChartType = (typeof CHART_TYPES)[number]

export const AXIS_SCALES = ['linear', 'log'] as const
export type AxisScale = (typeof AXIS_SCALES)[number]

export const FILTER_OPS = [
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'between',
] as const
export type FilterOp = (typeof FILTER_OPS)[number]

export const TRANSFORMATION_KINDS = ['aggregate', 'bin', 'normalise'] as const
export type TransformationKind = (typeof TRANSFORMATION_KINDS)[number]

export const ERROR_BAR_BASES = ['sd', 'se', 'range', 'custom'] as const
export type ErrorBarBasis = (typeof ERROR_BAR_BASES)[number]

export const CHART_SPEC_VERSION = 1 as const

/** A binding to a column of a scientific table. columnId is authoritative. */
export interface FieldBinding {
  columnId: string
  fieldName: string
}

export interface DatasetRef {
  tableId: string
}

export interface ChartFilter {
  columnId: string
  fieldName: string
  op: FilterOp
  value: unknown
}

export interface Transformation {
  kind: TransformationKind
  /** Explicit, reproducible parameters. Kept opaque but must be an object. */
  params: Record<string, unknown>
}

export interface AxisDisplay {
  label?: string
  scale: AxisScale
  unit?: string
}

export interface SeriesDisplay {
  identifier: string
  label: string
  color: string
}

export interface ErrorBarsOverlay {
  columnId: string
  fieldName: string
  basis: ErrorBarBasis
  multiplier?: number
}

export interface ChartDisplay {
  axes: { x: AxisDisplay; y: AxisDisplay }
  series: SeriesDisplay[]
  legend?: { visible: boolean }
  annotations?: unknown[]
}

export interface ChartSpec {
  specVersion: number
  type: ChartType
  datasets: DatasetRef[]
  fields: {
    x: FieldBinding | null
    y: FieldBinding
    series: FieldBinding | null
    color: FieldBinding | null
    size: FieldBinding | null
  }
  filters: ChartFilter[]
  transformations: Transformation[]
  display: ChartDisplay
  overlays: {
    errorBars: ErrorBarsOverlay | null
  }
}

/** Frozen chart payload — see ADR 0029 §5. */
export interface FrozenDatasetProvenance {
  tableId: string
  schemaVersion: number
  rowCount: number
  checksum: string
}

export interface FrozenChartColumn {
  columnId: string
  fieldName: string
  label: string
  unit?: unknown
  logicalType: string
}

export interface FrozenChartPoint {
  x: number | null
  y: number | null
  yError?: number | null
  label?: string
}

export interface FrozenChartSeries {
  identifier: string
  label: string
  color: string
  points: FrozenChartPoint[]
}

export interface FrozenChartData {
  columns: FrozenChartColumn[]
  rows: Record<string, unknown>[]
  series: FrozenChartSeries[]
}

export interface FrozenChart {
  revisionId: string | null
  frozenAt: string
  frozenByUserId: string
  datasetProvenance: FrozenDatasetProvenance[]
  data: FrozenChartData
}

/** The chart block payload (payload_schema_version 1). */
export interface ChartBlockPayload {
  title?: string
  spec?: ChartSpec
  provenance?: string
  frozen?: FrozenChart | null
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type ChartSpecError = {
  code:
    | 'invalid_shape'
    | 'missing_field'
    | 'invalid_value'
    | 'invalid_dataset_reference'
    | 'invalid_palette'
    | 'unsupported_type'
    | 'unsupported_spec_version'
  field?: string
  message: string
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

function isOneOf<T extends string>(v: unknown, allowed: readonly T[]): v is T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v)
}

function validateFieldBinding(v: unknown, field: string): ChartSpecError[] {
  if (v === null) return []
  if (!isObject(v))
    return [
      {
        code: 'invalid_shape',
        field,
        message: `${field} must be a field binding or null`,
      },
    ]
  if (!isUuid(v.columnId))
    return [
      {
        code: 'invalid_value',
        field: `${field}.columnId`,
        message: `${field}.columnId must be a UUID`,
      },
    ]
  if (!isNonEmptyString(v.fieldName))
    return [
      {
        code: 'missing_field',
        field: `${field}.fieldName`,
        message: `${field}.fieldName is required`,
      },
    ]
  return []
}

function validateAxisDisplay(v: unknown, field: string): ChartSpecError[] {
  if (!isObject(v))
    return [
      {
        code: 'invalid_shape',
        field,
        message: `${field} must be an object`,
      },
    ]
  const errors: ChartSpecError[] = []
  if (v.label !== undefined && v.label !== null && typeof v.label !== 'string')
    errors.push({
      code: 'invalid_value',
      field: `${field}.label`,
      message: `${field}.label must be a string when present`,
    })
  if (!isOneOf(v.scale, AXIS_SCALES))
    errors.push({
      code: 'invalid_value',
      field: `${field}.scale`,
      message: `${field}.scale must be one of ${AXIS_SCALES.join(', ')}`,
    })
  if (v.unit !== undefined && typeof v.unit !== 'string')
    errors.push({
      code: 'invalid_value',
      field: `${field}.unit`,
      message: `${field}.unit must be a string when present`,
    })
  return errors
}

/**
 * Validate a `ChartSpec` (the `spec` field of a chart block payload).
 * Does not check dataset reference integrity against the database — that is
 * the DB trigger's job — but checks structural validity, palette, and
 * chart-type-specific required fields.
 */
export function validateChartSpec(spec: unknown): ChartSpecError[] {
  if (!isObject(spec))
    return [
      {
        code: 'invalid_shape',
        field: 'spec',
        message: 'spec must be an object',
      },
    ]
  const errors: ChartSpecError[] = []

  if (spec.specVersion !== CHART_SPEC_VERSION)
    errors.push({
      code: 'unsupported_spec_version',
      field: 'spec.specVersion',
      message: `spec.specVersion must be ${CHART_SPEC_VERSION}`,
    })

  if (!isOneOf(spec.type, CHART_TYPES))
    errors.push({
      code: 'unsupported_type',
      field: 'spec.type',
      message: `spec.type must be one of ${CHART_TYPES.join(', ')}`,
    })

  const datasets = spec.datasets
  if (!Array.isArray(datasets) || datasets.length === 0)
    errors.push({
      code: 'missing_field',
      field: 'spec.datasets',
      message: 'spec.datasets must be a non-empty array',
    })
  else
    datasets.forEach((d, i) => {
      if (!isObject(d) || !isUuid(d.tableId))
        errors.push({
          code: 'invalid_dataset_reference',
          field: `spec.datasets[${i}].tableId`,
          message: `datasets[${i}].tableId must be a UUID`,
        })
    })

  const fields = spec.fields
  if (!isObject(fields))
    errors.push({
      code: 'invalid_shape',
      field: 'spec.fields',
      message: 'spec.fields must be an object',
    })
  else {
    const type = isOneOf(spec.type, CHART_TYPES) ? spec.type : null
    // y is always required.
    errors.push(...validateFieldBinding(fields.y, 'spec.fields.y'))
    if (fields.y === null || fields.y === undefined)
      errors.push({
        code: 'missing_field',
        field: 'spec.fields.y',
        message: 'spec.fields.y is required',
      })
    // x is required for line and bar; optional for scatter.
    if (type === 'line' || type === 'bar') {
      if (fields.x === null || fields.x === undefined)
        errors.push({
          code: 'missing_field',
          field: 'spec.fields.x',
          message: `spec.fields.x is required for ${type} charts`,
        })
      else errors.push(...validateFieldBinding(fields.x, 'spec.fields.x'))
    } else {
      errors.push(...validateFieldBinding(fields.x, 'spec.fields.x'))
    }
    errors.push(...validateFieldBinding(fields.series, 'spec.fields.series'))
    errors.push(...validateFieldBinding(fields.color, 'spec.fields.color'))
    errors.push(...validateFieldBinding(fields.size, 'spec.fields.size'))
  }

  // filters
  const filters = spec.filters
  if (!Array.isArray(filters))
    errors.push({
      code: 'invalid_shape',
      field: 'spec.filters',
      message: 'spec.filters must be an array',
    })
  else
    filters.forEach((f, i) => {
      if (!isObject(f) || !isUuid(f.columnId) || !isNonEmptyString(f.fieldName))
        errors.push({
          code: 'invalid_value',
          field: `spec.filters[${i}]`,
          message: `filters[${i}] must reference a column`,
        })
      if (!isOneOf(f?.op, FILTER_OPS))
        errors.push({
          code: 'invalid_value',
          field: `spec.filters[${i}].op`,
          message: `filters[${i}].op must be one of ${FILTER_OPS.join(', ')}`,
        })
    })

  // transformations
  const transformations = spec.transformations
  if (!Array.isArray(transformations))
    errors.push({
      code: 'invalid_shape',
      field: 'spec.transformations',
      message: 'spec.transformations must be an array',
    })
  else
    transformations.forEach((t, i) => {
      if (!isObject(t) || !isOneOf(t.kind, TRANSFORMATION_KINDS))
        errors.push({
          code: 'invalid_value',
          field: `spec.transformations[${i}].kind`,
          message: `transformations[${i}].kind must be one of ${TRANSFORMATION_KINDS.join(', ')}`,
        })
      if (isObject(t) && !isObject(t.params))
        errors.push({
          code: 'invalid_value',
          field: `spec.transformations[${i}].params`,
          message: `transformations[${i}].params must be an object`,
        })
    })

  // display
  const display = spec.display
  if (!isObject(display))
    errors.push({
      code: 'invalid_shape',
      field: 'spec.display',
      message: 'spec.display must be an object',
    })
  else {
    if (!isObject(display.axes))
      errors.push({
        code: 'invalid_shape',
        field: 'spec.display.axes',
        message: 'spec.display.axes must be an object',
      })
    else {
      errors.push(...validateAxisDisplay(display.axes.x, 'spec.display.axes.x'))
      errors.push(...validateAxisDisplay(display.axes.y, 'spec.display.axes.y'))
    }
    const series = display.series
    if (!Array.isArray(series))
      errors.push({
        code: 'invalid_shape',
        field: 'spec.display.series',
        message: 'spec.display.series must be an array',
      })
    else
      series.forEach((s, i) => {
        if (
          !isObject(s) ||
          !isNonEmptyString(s.identifier) ||
          !isNonEmptyString(s.label) ||
          typeof s.color !== 'string'
        )
          errors.push({
            code: 'invalid_value',
            field: `spec.display.series[${i}]`,
            message: `series[${i}] must have identifier, label and color`,
          })
        else if (
          !(CHART_PALETTE as readonly string[]).some(
            (c) => c.toLowerCase() === String(s.color).toLowerCase(),
          )
        )
          errors.push({
            code: 'invalid_palette',
            field: `spec.display.series[${i}].color`,
            message: `series[${i}].color must be from the approved palette`,
          })
      })
  }

  // overlays
  const overlays = spec.overlays
  if (!isObject(overlays))
    errors.push({
      code: 'invalid_shape',
      field: 'spec.overlays',
      message: 'spec.overlays must be an object',
    })
  else if (overlays.errorBars !== null && overlays.errorBars !== undefined) {
    const eb = overlays.errorBars
    if (
      !isObject(eb) ||
      !isUuid(eb.columnId) ||
      !isNonEmptyString(eb.fieldName) ||
      !isOneOf(eb.basis, ERROR_BAR_BASES)
    )
      errors.push({
        code: 'invalid_value',
        field: 'spec.overlays.errorBars',
        message:
          'overlays.errorBars must name a column and a basis (sd, se, range, custom)',
      })
    if (isObject(eb) && eb.multiplier !== undefined) {
      if (
        typeof eb.multiplier !== 'number' ||
        !Number.isFinite(eb.multiplier) ||
        eb.multiplier <= 0
      )
        errors.push({
          code: 'invalid_value',
          field: 'spec.overlays.errorBars.multiplier',
          message: 'errorBars.multiplier must be a positive finite number',
        })
    }
  }

  return errors
}

/**
 * Validate a full chart block payload (the `payload` of a `chart` block).
 * An empty draft `{}` is valid (no spec yet). Returns field-level errors.
 */
export function validateChartPayload(payload: unknown): ChartSpecError[] {
  if (!isObject(payload))
    return [{ code: 'invalid_shape', message: 'payload must be an object' }]
  if (Object.keys(payload).length === 0) return []
  const errors: ChartSpecError[] = []
  if (!isNonEmptyString(payload.title))
    errors.push({
      code: 'missing_field',
      field: 'title',
      message: 'title is required',
    })
  if (payload.spec === undefined || payload.spec === null)
    errors.push({
      code: 'missing_field',
      field: 'spec',
      message: 'spec is required',
    })
  else errors.push(...validateChartSpec(payload.spec))
  if (
    payload.provenance !== undefined &&
    payload.provenance !== null &&
    typeof payload.provenance !== 'string'
  )
    errors.push({
      code: 'invalid_value',
      field: 'provenance',
      message: 'provenance must be a string when present',
    })
  if (payload.frozen !== undefined && payload.frozen !== null) {
    if (!isObject(payload.frozen))
      errors.push({
        code: 'invalid_shape',
        field: 'frozen',
        message: 'frozen must be an object when present',
      })
    // Frozen payload structural checks: must carry provenance + data.
    const f = payload.frozen as Record<string, unknown>
    if (isObject(f)) {
      if (!isNonEmptyString(f.frozenAt))
        errors.push({
          code: 'missing_field',
          field: 'frozen.frozenAt',
          message: 'frozen.frozenAt is required',
        })
      if (!isNonEmptyString(f.frozenByUserId))
        errors.push({
          code: 'missing_field',
          field: 'frozen.frozenByUserId',
          message: 'frozen.frozenByUserId is required',
        })
      if (!Array.isArray(f.datasetProvenance))
        errors.push({
          code: 'invalid_shape',
          field: 'frozen.datasetProvenance',
          message: 'frozen.datasetProvenance must be an array',
        })
      if (!isObject(f.data))
        errors.push({
          code: 'invalid_shape',
          field: 'frozen.data',
          message: 'frozen.data must be an object',
        })
    }
  }
  return errors
}

// ---------------------------------------------------------------------------
// Data materialisation: apply filters + transformations to dataset rows and
// build the series the renderer plots. Pure functions so live and frozen
// paths share one implementation and stay reproducible.
// ---------------------------------------------------------------------------

/** A column metadata shape sufficient for materialisation/rendering. */
export interface ChartColumn {
  id: string
  fieldName: string
  label: string
  logicalType: string
  unit?: unknown
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  if (typeof v === 'boolean') return v ? 1 : 0
  return null
}

/** Apply a single filter predicate to a row. */
export function rowMatchesFilter(
  row: Record<string, unknown>,
  filter: ChartFilter,
): boolean {
  const value = row[filter.fieldName]
  const num = toNumber(value)
  switch (filter.op) {
    case 'eq':
      return value === filter.value
    case 'ne':
      return value !== filter.value
    case 'gt':
      return num !== null && filter.value !== null && num > Number(filter.value)
    case 'gte':
      return (
        num !== null && filter.value !== null && num >= Number(filter.value)
      )
    case 'lt':
      return num !== null && filter.value !== null && num < Number(filter.value)
    case 'lte':
      return (
        num !== null && filter.value !== null && num <= Number(filter.value)
      )
    case 'in':
      return Array.isArray(filter.value) && filter.value.includes(value)
    case 'between': {
      if (!Array.isArray(filter.value) || filter.value.length !== 2)
        return false
      const lo = toNumber(filter.value[0])
      const hi = toNumber(filter.value[1])
      return (
        num !== null && lo !== null && hi !== null && num >= lo && num <= hi
      )
    }
    default:
      return false
  }
}

export function applyFilters(
  rows: Record<string, unknown>[],
  filters: ChartFilter[],
): Record<string, unknown>[] {
  if (filters.length === 0) return rows
  return rows.filter((row) => filters.every((f) => rowMatchesFilter(row, f)))
}

/**
 * Resolve a column label/unit from metadata, falling back to fieldName.
 * Used by the renderer and the frozen snapshot.
 */
export function resolveColumn(
  columns: ChartColumn[],
  binding: { columnId: string; fieldName: string } | null,
): ChartColumn | null {
  if (!binding) return null
  return (
    columns.find(
      (c) => c.id === binding.columnId && c.fieldName === binding.fieldName,
    ) ??
    columns.find((c) => c.id === binding.columnId) ??
    columns.find((c) => c.fieldName === binding.fieldName) ??
    null
  )
}

/** Render-time state the chart surfaces honestly instead of blank axes. */
export type ChartRenderState =
  | { kind: 'ok' }
  | { kind: 'missing_dataset' }
  | { kind: 'missing_field'; fields: string[] }
  | { kind: 'empty_dataset' }
  | { kind: 'log_scale_invalid'; axis: 'x' | 'y'; invalidCount: number }
  | { kind: 'stale'; detail: string }

export interface MaterialisedSeries {
  identifier: string
  label: string
  color: string
  points: FrozenChartPoint[]
}

export interface MaterialisedChart {
  state: ChartRenderState
  columns: ChartColumn[]
  rows: Record<string, unknown>[]
  series: MaterialisedSeries[]
  xLabel: string
  yLabel: string
  xUnit: string | undefined
  yUnit: string | undefined
}

/**
 * Materialise a chart from a spec and the dataset's columns + rows. Shared by
 * the live renderer (re-reads rows) and the freeze RPC (stores the result).
 * Detects missing fields, empty datasets and log-scale invalid values.
 */
export function materialiseChart(
  spec: ChartSpec,
  columns: ChartColumn[],
  rows: Record<string, unknown>[],
): MaterialisedChart {
  const xCol = resolveColumn(columns, spec.fields.x)
  const yCol = resolveColumn(columns, spec.fields.y)
  const seriesCol = resolveColumn(columns, spec.fields.series)
  const errorCol = spec.overlays.errorBars
    ? resolveColumn(columns, spec.overlays.errorBars)
    : null

  const missing: string[] = []
  if (spec.fields.x && !xCol) missing.push('x')
  if (!yCol) missing.push('y')
  if (spec.fields.series && !seriesCol) missing.push('series')
  if (spec.overlays.errorBars && !errorCol) missing.push('errorBars')

  const xLabel =
    xCol?.label ?? spec.display.axes.x.label ?? spec.fields.x?.fieldName ?? 'x'
  const yLabel =
    yCol?.label ?? spec.display.axes.y.label ?? spec.fields.y.fieldName
  const xUnit =
    typeof xCol?.unit === 'object' && xCol.unit && 'symbol' in xCol.unit
      ? String((xCol.unit as { symbol: string }).symbol)
      : spec.display.axes.x.unit
  const yUnit =
    typeof yCol?.unit === 'object' && yCol.unit && 'symbol' in yCol.unit
      ? String((yCol.unit as { symbol: string }).symbol)
      : spec.display.axes.y.unit

  if (missing.length > 0)
    return {
      state: { kind: 'missing_field', fields: missing },
      columns,
      rows: [],
      series: [],
      xLabel,
      yLabel,
      xUnit,
      yUnit,
    }

  const filtered = applyFilters(rows, spec.filters)
  if (filtered.length === 0)
    return {
      state: { kind: 'empty_dataset' },
      columns,
      rows: [],
      series: [],
      xLabel,
      yLabel,
      xUnit,
      yUnit,
    }

  // Build series groups.
  const groups = new Map<string, Record<string, unknown>[]>()
  const order: string[] = []
  for (const row of filtered) {
    const key = seriesCol ? String(row[seriesCol.fieldName] ?? '—') : 'all'
    if (!groups.has(key)) {
      groups.set(key, [])
      order.push(key)
    }
    groups.get(key)!.push(row)
  }

  const paletteLookup = new Map(
    spec.display.series.map((s) => [s.identifier, s]),
  )
  const series: MaterialisedSeries[] = order.map((key, i) => {
    const configured = paletteLookup.get(key)
    const color = (
      configured?.color ?? CHART_PALETTE[i % CHART_PALETTE.length]
    ).toLowerCase()
    const label = configured?.label ?? key
    const points: FrozenChartPoint[] = groups.get(key)!.map((row, rowIndex) => {
      const x = xCol ? toNumber(row[xCol.fieldName]) : rowIndex + 1
      const y = yCol ? toNumber(row[yCol.fieldName]) : null
      const yError = errorCol ? toNumber(row[errorCol.fieldName]) : undefined
      return { x, y, yError: yError ?? null, label: key }
    })
    return { identifier: key, label, color, points }
  })

  // Log-scale validation: a log axis with non-positive values is invalid.
  for (const axis of ['x', 'y'] as const) {
    if (spec.display.axes[axis].scale !== 'log') continue
    const col = axis === 'x' ? xCol : yCol
    if (!col) continue
    const invalid = series.reduce(
      (acc, s) =>
        acc +
        s.points.filter((p) => {
          const v = axis === 'x' ? p.x : p.y
          return v !== null && v <= 0
        }).length,
      0,
    )
    if (invalid > 0)
      return {
        state: { kind: 'log_scale_invalid', axis, invalidCount: invalid },
        columns,
        rows: filtered,
        series,
        xLabel,
        yLabel,
        xUnit,
        yUnit,
      }
  }

  return {
    state: { kind: 'ok' },
    columns,
    rows: filtered,
    series,
    xLabel,
    yLabel,
    xUnit,
    yUnit,
  }
}

/** Format a scientific number with SI-prefixed exponents and significant
 * digits, per DESIGN.md's scientific number formatting. */
export function formatScientific(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  if (v === 0) return '0'
  const abs = Math.abs(v)
  if (abs >= 1e4 || abs < 1e-3) {
    // Exponential with 2 significant digits.
    return v.toExponential(2).replace('e+', 'e').replace('e-0', 'e-')
  }
  // Up to 3 significant digits otherwise.
  if (Number.isInteger(v)) return v.toString()
  return Number(v.toPrecision(3)).toString()
}
