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

export const CHART_TYPES = [
  'line',
  'scatter',
  'bar',
  'histogram',
  'box',
  'heatmap',
] as const
export type ChartType = (typeof CHART_TYPES)[number]

/** Chart types plotted in Cartesian x/y coordinates. */
export const CARTESIAN_CHART_TYPES: readonly ChartType[] = [
  'line',
  'scatter',
  'bar',
]

/** Aggregations available to a heatmap cell. */
export const HEATMAP_AGGREGATES = [
  'count',
  'mean',
  'median',
  'min',
  'max',
] as const
export type HeatmapAggregate = (typeof HEATMAP_AGGREGATES)[number]

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

/** Distribution-display parameters for a histogram spec. */
export interface HistogramParams {
  /** Fixed bin count over the observed range (1–200). */
  bins?: number
  /** Explicit bin width over the observed range; wins over bins. */
  binWidth?: number
}

/** Box-whisker display parameters. Whiskers extend to 1.5×IQR. */
export interface BoxPlotParams {
  showOutliers?: boolean
}

/** Two-dimensional density/intensity grid parameters. */
export interface HeatmapParams {
  xBins?: number
  yBins?: number
  /** Defaults to 'count' when absent (mirrors the validators). */
  aggregate?: HeatmapAggregate
  valueField: FieldBinding | null
}

/** A text label pinned at data coordinates (Cartesian types only). */
export interface ChartAnnotation {
  x: number
  y: number
  label: string
}

export const MAX_ANNOTATIONS = 12 as const
export const MAX_FACETS = 12 as const
export const HEATMAP_MIN_BINS = 2 as const
export const HEATMAP_MAX_BINS = 100 as const
export const HISTOGRAM_MAX_BINS = 200 as const

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
  annotations?: ChartAnnotation[]
}

/** Type-specific, explicitly reproducible parameters. */
export interface ChartTypeParams {
  histogram?: HistogramParams
  box?: BoxPlotParams
  heatmap?: HeatmapParams
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
    facet: FieldBinding | null
  }
  filters: ChartFilter[]
  transformations: Transformation[]
  typeParams: ChartTypeParams
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
  /** Box-whisker statistics when the chart type is `box`. */
  box?: FrozenBoxStats
}

export interface FrozenBoxStats {
  lo: number
  q1: number
  median: number
  q3: number
  hi: number
  outliers: number[]
  n: number
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
  heatmap?: HeatmapMatrix | null
  /** Per-facet panels for frozen faceted cartesian charts (SCI-01). */
  facets?: FrozenFacet[] | null
  /** Total distinct facet values before the MAX_FACETS cap. */
  facetsTotal?: number
}

export interface FrozenFacet {
  value: string
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

function validateBinCount(
  v: unknown,
  field: string,
  max: number,
): ChartSpecError[] {
  if (v === undefined) return []
  if (
    typeof v !== 'number' ||
    !Number.isInteger(v) ||
    v < HEATMAP_MIN_BINS ||
    v > max
  )
    return [
      {
        code: 'invalid_value',
        field,
        message: `${field} must be an integer between ${HEATMAP_MIN_BINS} and ${max}`,
      },
    ]
  return []
}

/** Type-specific parameter validation; absent params mean documented defaults. */
function validateTypeParams(
  v: unknown,
  type: ChartType | null,
): ChartSpecError[] {
  if (v === undefined || v === null) return []
  if (!isObject(v))
    return [
      {
        code: 'invalid_shape',
        field: 'spec.typeParams',
        message: 'spec.typeParams must be an object when present',
      },
    ]
  const errors: ChartSpecError[] = []

  if (v.histogram !== undefined && v.histogram !== null) {
    if (!isObject(v.histogram)) {
      errors.push({
        code: 'invalid_shape',
        field: 'spec.typeParams.histogram',
        message: 'typeParams.histogram must be an object when present',
      })
    } else {
      errors.push(
        ...validateBinCount(
          v.histogram.bins,
          'spec.typeParams.histogram.bins',
          HISTOGRAM_MAX_BINS,
        ),
      )
      if (
        v.histogram.binWidth !== undefined &&
        (typeof v.histogram.binWidth !== 'number' ||
          !Number.isFinite(v.histogram.binWidth) ||
          v.histogram.binWidth <= 0)
      )
        errors.push({
          code: 'invalid_value',
          field: 'spec.typeParams.histogram.binWidth',
          message: 'typeParams.histogram.binWidth must be a positive number',
        })
      if (v.histogram.bins !== undefined && v.histogram.binWidth !== undefined)
        errors.push({
          code: 'invalid_value',
          field: 'spec.typeParams.histogram',
          message:
            'typeParams.histogram accepts bins or binWidth, not both — binWidth wins',
        })
    }
    if (type !== null && type !== 'histogram')
      errors.push({
        code: 'invalid_value',
        field: 'spec.typeParams.histogram',
        message: `typeParams.histogram only applies to histogram charts (got ${type})`,
      })
  }

  if (v.box !== undefined && v.box !== null) {
    if (!isObject(v.box)) {
      errors.push({
        code: 'invalid_shape',
        field: 'spec.typeParams.box',
        message: 'typeParams.box must be an object when present',
      })
    } else if (
      v.box.showOutliers !== undefined &&
      typeof v.box.showOutliers !== 'boolean'
    ) {
      errors.push({
        code: 'invalid_value',
        field: 'spec.typeParams.box.showOutliers',
        message: 'typeParams.box.showOutliers must be a boolean when present',
      })
    }
    if (type !== null && type !== 'box')
      errors.push({
        code: 'invalid_value',
        field: 'spec.typeParams.box',
        message: `typeParams.box only applies to box charts (got ${type})`,
      })
  }

  if (v.heatmap !== undefined && v.heatmap !== null) {
    if (!isObject(v.heatmap)) {
      errors.push({
        code: 'invalid_shape',
        field: 'spec.typeParams.heatmap',
        message: 'typeParams.heatmap must be an object when present',
      })
    } else {
      errors.push(
        ...validateBinCount(
          v.heatmap.xBins,
          'spec.typeParams.heatmap.xBins',
          HEATMAP_MAX_BINS,
        ),
      )
      errors.push(
        ...validateBinCount(
          v.heatmap.yBins,
          'spec.typeParams.heatmap.yBins',
          HEATMAP_MAX_BINS,
        ),
      )
      if (
        v.heatmap.aggregate !== undefined &&
        !isOneOf(v.heatmap.aggregate, HEATMAP_AGGREGATES)
      )
        errors.push({
          code: 'invalid_value',
          field: 'spec.typeParams.heatmap.aggregate',
          message: `typeParams.heatmap.aggregate must be one of ${HEATMAP_AGGREGATES.join(', ')}`,
        })
      // A non-count aggregation over an unnamed value column is ambiguous;
      // the y field is a grid dimension here, not the measured value.
      const effectiveAggregate = isOneOf(
        v.heatmap.aggregate,
        HEATMAP_AGGREGATES,
      )
        ? v.heatmap.aggregate
        : 'count'
      if (
        effectiveAggregate !== 'count' &&
        (v.heatmap.valueField === null ||
          v.heatmap.valueField === undefined ||
          !isObject(v.heatmap.valueField))
      )
        errors.push({
          code: 'missing_field',
          field: 'spec.typeParams.heatmap.valueField',
          message:
            'typeParams.heatmap.valueField is required when aggregating anything but counts',
        })
      errors.push(
        ...validateFieldBinding(
          v.heatmap.valueField ?? null,
          'spec.typeParams.heatmap.valueField',
        ),
      )
    }
    if (type !== null && type !== 'heatmap')
      errors.push({
        code: 'invalid_value',
        field: 'spec.typeParams.heatmap',
        message: `typeParams.heatmap only applies to heatmap charts (got ${type})`,
      })
  }

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
    // Histograms and box plots measure fields.y directly; an x mapping has
    // no meaning and would suggest a dependency that does not exist.
    if (type === 'histogram' || type === 'box') {
      if (fields.x !== null && fields.x !== undefined)
        errors.push({
          code: 'invalid_value',
          field: 'spec.fields.x',
          message: `spec.fields.x must be null for ${type} charts`,
        })
    }
    // Heatmaps plot a value grid, not series; grouping and error overlays
    // are rejected so the cell aggregation stays unambiguous.
    if (type === 'heatmap') {
      for (const key of ['series', 'color', 'size'] as const) {
        if (fields[key] !== null && fields[key] !== undefined)
          errors.push({
            code: 'invalid_value',
            field: `spec.fields.${key}`,
            message: `spec.fields.${key} must be null for heatmap charts`,
          })
      }
    }
    errors.push(...validateFieldBinding(fields.series, 'spec.fields.series'))
    errors.push(...validateFieldBinding(fields.color, 'spec.fields.color'))
    errors.push(...validateFieldBinding(fields.size, 'spec.fields.size'))
    errors.push(...validateFieldBinding(fields.facet, 'spec.fields.facet'))
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

  // Type-specific parameters.
  errors.push(
    ...validateTypeParams(
      spec.typeParams,
      isOneOf(spec.type, CHART_TYPES) ? spec.type : null,
    ),
  )

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
    // Text annotations pinned at data coordinates (Cartesian types only).
    const annotations = display.annotations
    if (annotations !== undefined && annotations !== null) {
      if (!Array.isArray(annotations))
        errors.push({
          code: 'invalid_shape',
          field: 'spec.display.annotations',
          message: 'spec.display.annotations must be an array when present',
        })
      else {
        if (annotations.length > MAX_ANNOTATIONS)
          errors.push({
            code: 'invalid_value',
            field: 'spec.display.annotations',
            message: `spec.display.annotations supports at most ${MAX_ANNOTATIONS} entries`,
          })
        const type = isOneOf(spec.type, CHART_TYPES) ? spec.type : null
        if (
          type !== null &&
          !CARTESIAN_CHART_TYPES.includes(type) &&
          annotations.length > 0
        )
          errors.push({
            code: 'invalid_value',
            field: 'spec.display.annotations',
            message: `annotations are not supported for ${type} charts`,
          })
        annotations.forEach((a, i) => {
          if (
            !isObject(a) ||
            typeof a.x !== 'number' ||
            !Number.isFinite(a.x) ||
            typeof a.y !== 'number' ||
            !Number.isFinite(a.y) ||
            !isNonEmptyString(a.label)
          )
            errors.push({
              code: 'invalid_value',
              field: `spec.display.annotations[${i}]`,
              message:
                'annotations[i] must have finite numeric x/y and a non-empty label',
            })
        })
      }
    }
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

  if (
    isOneOf(spec.type, CHART_TYPES) &&
    spec.type === 'heatmap' &&
    isObject(overlays) &&
    overlays.errorBars !== null &&
    overlays.errorBars !== undefined
  )
    errors.push({
      code: 'invalid_value',
      field: 'spec.overlays.errorBars',
      message: 'overlays.errorBars must be null for heatmap charts',
    })

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

/** Linear-interpolation quantile on an ascending-sorted array. Matches
 * PostgreSQL `percentile_cont` so frozen snapshots and live rendering agree. */
function quantileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN
  const h = (sorted.length - 1) * p
  const lo = Math.floor(h)
  const hi = Math.ceil(h)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo)
}

/** Ascending numeric sort (codepoint-stable, environment-independent). */
function sortNumbers(values: number[]): number[] {
  return [...values].sort((a, b) => a - b)
}

/** Tukey box statistics with 1.5×IQR fences. */
export function boxStats(values: number[]): FrozenBoxStats | null {
  if (values.length === 0) return null
  const sorted = sortNumbers(values)
  const q1 = quantileSorted(sorted, 0.25)
  const median = quantileSorted(sorted, 0.5)
  const q3 = quantileSorted(sorted, 0.75)
  const iqr = q3 - q1
  const fenceLo = q1 - 1.5 * iqr
  const fenceHi = q3 + 1.5 * iqr
  const inliers = sorted.filter((v) => v >= fenceLo && v <= fenceHi)
  const lo = inliers.length > 0 ? inliers[0] : sorted[0]
  const hi =
    inliers.length > 0 ? inliers[inliers.length - 1] : sorted[sorted.length - 1]
  const outliers = sorted.filter((v) => v < fenceLo || v > fenceHi)
  return { lo, q1, median, q3, hi, outliers, n: sorted.length }
}

/** Deterministic histogram bin edges covering [min, max] with `bins` cells. */
function histogramEdges(min: number, max: number, bins: number): number[] {
  if (min === max) {
    // Degenerate range: a single-value distribution still gets one cell.
    const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.5 : 0.5
    return [min - pad, min + pad]
  }
  const width = (max - min) / bins
  return Array.from({ length: bins + 1 }, (_, i) => min + i * width)
}

function isCategoricalColumn(col: ChartColumn | null): boolean {
  if (!col) return false
  return ['category', 'text', 'boolean'].includes(col.logicalType)
}

/** Codepoint-order string sort so keys are deterministic across environments. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
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

/** A heatmap cell: grid position plus the aggregated value and row count. */
export interface HeatmapCell {
  x: number
  y: number
  value: number | null
  count: number
}

export interface HeatmapMatrix {
  xLabels: string[]
  yLabels: string[] | null
  cells: HeatmapCell[]
  min: number | null
  max: number | null
  aggregate: HeatmapAggregate
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
  /** Rows dropped because the mapped value was missing or non-numeric. */
  droppedPoints: number
  /** Shared histogram bin edges when the chart type is `histogram`. */
  bins?: { edges: number[] }
  /** Aggregated value grid when the chart type is `heatmap`. */
  heatmap?: HeatmapMatrix
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
      droppedPoints: 0,
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
      droppedPoints: 0,
    }

  const type = spec.type
  // materialiseChart requires fields.y to resolve (checked above); narrow for
  // the distribution paths that measure y directly.
  if (!yCol)
    return {
      state: { kind: 'missing_field', fields: ['y'] },
      columns,
      rows: [],
      series: [],
      xLabel,
      yLabel,
      xUnit,
      yUnit,
      droppedPoints: 0,
    }
  if (type === 'histogram')
    return materialiseHistogram(spec, yCol, filtered, {
      columns,
      xLabel,
      yLabel,
      xUnit,
      yUnit,
    })
  if (type === 'box')
    return materialiseBoxPlot(spec, yCol, filtered, {
      columns,
      xLabel,
      yLabel,
      xUnit,
      yUnit,
    })
  if (type === 'heatmap')
    return materialiseHeatmap(spec, columns, xCol, yCol, filtered, {
      columns,
      xLabel,
      yLabel,
      xUnit,
      yUnit,
    })

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
      const y = toNumber(row[yCol.fieldName])
      const yError = errorCol ? toNumber(row[errorCol.fieldName]) : undefined
      return { x, y, yError: yError ?? null, label: key }
    })
    return { identifier: key, label, color, points }
  })

  // Rows whose mapped value is missing or non-numeric are dropped from the
  // plot (recharts skips null points); the count is surfaced so silent gaps
  // never masquerade as data.
  const droppedPoints = series.reduce(
    (acc, s) =>
      acc +
      s.points.filter((p) => p.y === null || (spec.fields.x && p.x === null))
        .length,
    0,
  )

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
        droppedPoints: 0,
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
    droppedPoints,
  }
}

interface MaterialiseMeta {
  columns: ChartColumn[]
  xLabel: string
  yLabel: string
  xUnit: string | undefined
  yUnit: string | undefined
}

function paletteFor(
  spec: ChartSpec,
  key: string,
  index: number,
): { color: string; label: string } {
  const configured = spec.display.series.find((s) => s.identifier === key)
  return {
    color: (
      configured?.color ?? CHART_PALETTE[index % CHART_PALETTE.length]
    ).toLowerCase(),
    label: configured?.label ?? key,
  }
}

/**
 * Histogram: shared bin edges across all groups (so overlaid distributions
 * stay comparable), per-group counts per bin. Non-numeric values are dropped
 * and counted, never silently binned as zero.
 */
function materialiseHistogram(
  spec: ChartSpec,
  yCol: ChartColumn,
  filtered: Record<string, unknown>[],
  meta: MaterialiseMeta,
): MaterialisedChart {
  const seriesCol = resolveColumn(meta.columns, spec.fields.series)
  const params = spec.typeParams.histogram ?? {}
  const numeric = filtered
    .map((row) => toNumber(row[yCol.fieldName]))
    .filter((v): v is number => v !== null)
  if (numeric.length === 0)
    return {
      state: { kind: 'ok' },
      ...meta,
      rows: filtered,
      series: [],
      droppedPoints: filtered.length,
    }

  let edges: number[]
  if (params.binWidth !== undefined && params.binWidth > 0) {
    const min = Math.min(...numeric)
    const max = Math.max(...numeric)
    const count = Math.max(1, Math.ceil((max - min) / params.binWidth))
    edges = histogramEdges(min, max + params.binWidth * 0.0001, count)
  } else {
    edges = histogramEdges(
      Math.min(...numeric),
      Math.max(...numeric),
      params.bins ?? 10,
    )
  }
  const width = edges[1] - edges[0]

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

  let droppedPoints = 0
  const series: MaterialisedSeries[] = order.map((key, i) => {
    const { color, label } = paletteFor(spec, key, i)
    const points: FrozenChartPoint[] = []
    for (let b = 0; b < edges.length - 1; b++) {
      points.push({ x: edges[b], y: 0, yError: null, label: key })
    }
    for (const row of groups.get(key)!) {
      const v = toNumber(row[yCol.fieldName])
      if (v === null) {
        droppedPoints++
        continue
      }
      let idx = Math.floor((v - edges[0]) / width)
      if (idx >= edges.length - 1) idx = edges.length - 2 // last bin is inclusive
      if (idx < 0) idx = 0
      points[idx].y = (points[idx].y as number) + 1
    }
    return { identifier: key, label, color, points }
  })

  return {
    state: { kind: 'ok' },
    ...meta,
    rows: filtered,
    series,
    droppedPoints,
    bins: { edges },
  }
}

/**
 * Box plot: one Tukey box per group over fields.y. The point's `x` is the
 * group position; the box statistics ride on the point so frozen snapshots
 * and live rendering share one shape.
 */
function materialiseBoxPlot(
  spec: ChartSpec,
  yCol: ChartColumn,
  filtered: Record<string, unknown>[],
  meta: MaterialiseMeta,
): MaterialisedChart {
  const seriesCol = resolveColumn(meta.columns, spec.fields.series)
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

  let droppedPoints = 0
  const series: MaterialisedSeries[] = order.map((key, i) => {
    const { color, label } = paletteFor(spec, key, i)
    const values: number[] = []
    for (const row of groups.get(key)!) {
      const v = toNumber(row[yCol.fieldName])
      if (v === null) droppedPoints++
      else values.push(v)
    }
    const stats = boxStats(values)
    const points: FrozenChartPoint[] =
      stats === null
        ? []
        : [
            {
              x: i + 1,
              y: stats.median,
              yError: null,
              label: key,
              box: stats,
            },
          ]
    return { identifier: key, label, color, points }
  })

  return {
    state: { kind: 'ok' },
    ...meta,
    rows: filtered,
    series: series.filter((s) => s.points.length > 0),
    droppedPoints,
  }
}

/**
 * Heatmap: aggregate rows into an x×y grid. Categorical dimensions use their
 * distinct sorted values; numeric dimensions are binned. Cell values come
 * from typeParams.heatmap.aggregate over valueField (defaults documented in
 * the validator); `count` needs no value column.
 */
function materialiseHeatmap(
  spec: ChartSpec,
  columns: ChartColumn[],
  xCol: ChartColumn | null,
  yCol: ChartColumn | null,
  filtered: Record<string, unknown>[],
  meta: MaterialiseMeta,
): MaterialisedChart {
  const params = spec.typeParams.heatmap ?? {
    aggregate: 'count' as HeatmapAggregate,
    valueField: null,
  }
  const aggregate: HeatmapAggregate = params.aggregate ?? 'count'
  const valueCol =
    aggregate === 'count' ? null : resolveColumn(columns, params.valueField)
  if (aggregate !== 'count' && !valueCol)
    return {
      state: { kind: 'missing_field', fields: ['value'] },
      ...meta,
      rows: [],
      series: [],
      droppedPoints: 0,
    }

  interface Dim {
    labels: string[]
    indexOf: (value: number | string | null) => number
    categorical: boolean
  }

  function buildDim(
    col: ChartColumn,
    bins: number,
    fieldName: string,
  ): { dim: Dim; dropped: number } {
    if (isCategoricalColumn(col)) {
      const labels = Array.from(
        new Set(filtered.map((r) => String(r[fieldName] ?? '—'))),
      ).sort(compareStrings)
      const index = new Map(labels.map((l, i) => [l, i]))
      return {
        dim: {
          labels,
          categorical: true,
          indexOf: (v) => index.get(String(v ?? '—')) ?? -1,
        },
        dropped: 0,
      }
    }
    const numeric = filtered
      .map((r) => toNumber(r[fieldName]))
      .filter((v): v is number => v !== null)
    let dropped = filtered.length - numeric.length
    const min = numeric.length ? Math.min(...numeric) : 0
    const max = numeric.length ? Math.max(...numeric) : 1
    const edges =
      min === max ? [min - 0.5, max + 0.5] : histogramEdges(min, max, bins)
    const width = edges[1] - edges[0]
    const labels = Array.from({ length: edges.length - 1 }, (_, i) =>
      formatScientific(edges[i]),
    )
    return {
      dim: {
        labels,
        categorical: false,
        indexOf: (v) => {
          if (typeof v !== 'number') return v === null ? -1 : -1
          let idx = Math.floor((v - edges[0]) / width)
          if (idx >= labels.length) idx = labels.length - 1
          if (idx < 0) {
            dropped++
            return -1
          }
          return idx
        },
      },
      dropped,
    }
  }

  const xDef = buildDim(xCol!, params.xBins ?? 10, xCol!.fieldName)
  const yDef = buildDim(yCol!, params.yBins ?? 10, yCol!.fieldName)
  const droppedPoints = xDef.dropped + yDef.dropped

  const cellMap = new Map<
    string,
    { sum: number; n: number; count: number; values: number[] }
  >()
  for (const row of filtered) {
    const xv = xDef.dim.categorical
      ? String(row[xCol!.fieldName] ?? '—')
      : toNumber(row[xCol!.fieldName])
    const yv = yDef.dim.categorical
      ? String(row[yCol!.fieldName] ?? '—')
      : toNumber(row[yCol!.fieldName])
    const xi = xDef.dim.indexOf(xv)
    const yi = yDef.dim.indexOf(yv)
    if (xi < 0 || yi < 0) continue
    const k = `${xi},${yi}`
    const cell = cellMap.get(k) ?? { sum: 0, n: 0, count: 0, values: [] }
    cell.count++
    if (valueCol) {
      const v = toNumber(row[valueCol.fieldName])
      if (v !== null) {
        cell.sum += v
        cell.n++
        cell.values.push(v)
      }
    }
    cellMap.set(k, cell)
  }

  const cells: HeatmapCell[] = []
  let min: number | null = null
  let max: number | null = null
  for (const [k, cell] of cellMap) {
    const [xs, ys] = k.split(',')
    let value: number | null
    switch (aggregate) {
      case 'count':
        value = cell.count
        break
      case 'mean':
        value = cell.n > 0 ? cell.sum / cell.n : null
        break
      case 'median':
        value =
          cell.n > 0 ? quantileSorted(sortNumbers(cell.values), 0.5) : null
        break
      case 'min':
        value = cell.n > 0 ? Math.min(...cell.values) : null
        break
      case 'max':
        value = cell.n > 0 ? Math.max(...cell.values) : null
        break
    }
    cells.push({ x: Number(xs), y: Number(ys), value, count: cell.count })
    if (value !== null) {
      min = min === null ? value : Math.min(min, value)
      max = max === null ? value : Math.max(max, value)
    }
  }
  cells.sort((a, b) => a.x - b.x || a.y - b.y)

  return {
    state: { kind: 'ok' },
    ...meta,
    rows: filtered,
    series: [],
    droppedPoints,
    heatmap: {
      xLabels: xDef.dim.labels,
      yLabels: yDef.dim.labels,
      cells,
      min,
      max,
      aggregate,
    },
  }
}

export interface FacetedChart {
  /** The facet column value this panel plots. */
  value: string
  chart: MaterialisedChart
}

export interface FacetedResult {
  panels: FacetedChart[]
  /** Total distinct facet values before the MAX_FACETS cap. */
  total: number
}

/**
 * Split a chart into small multiples by a facet column. Each panel runs the
 * same spec minus the facet mapping over its partition of the filtered rows.
 * Panels are ordered by codepoint-sorted value and capped at MAX_FACETS;
 * `total` lets the UI surface truncation honestly.
 */
export function materialiseFacetedCharts(
  spec: ChartSpec,
  columns: ChartColumn[],
  rows: Record<string, unknown>[],
): FacetedResult {
  const facetCol = resolveColumn(columns, spec.fields.facet)
  if (!facetCol) return { panels: [], total: 0 }
  const partitioned = applyFilters(rows, spec.filters)
  const groups = new Map<string, Record<string, unknown>[]>()
  for (const row of partitioned) {
    const key = String(row[facetCol.fieldName] ?? '—')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(row)
  }
  const keys = Array.from(groups.keys()).sort(compareStrings)
  const { facet: _facet, ...restFields } = spec.fields
  const panelSpec: ChartSpec = {
    ...spec,
    filters: [],
    fields: { ...restFields, facet: null },
  }
  return {
    panels: keys.slice(0, MAX_FACETS).map((value) => ({
      value,
      chart: materialiseChart(panelSpec, columns, groups.get(value)!),
    })),
    total: keys.length,
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
