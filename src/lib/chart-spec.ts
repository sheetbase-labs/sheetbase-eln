/**
 * SCI-004 — Chart specification model and validation (decision 0029).
 *
 * A `chart` notebook block carries a `ChartSpec` on its JSONB payload. This
 * module is the application-boundary source of truth for the spec shape: the
 * block validator (`src/lib/blocks`) delegates chart-payload validation here,
 * the DB trigger (`validate_scientific_block`) mirrors the structural rules,
 * and the renderer/preview consume the typed shapes.
 *
 * The spec is intentionally generic: it references canonical Datasets
 * (`api.datasets`, decision 0037) by UUID, binds fields by their stable
 * `dataset_schema_version_fields.field_id`, keeps
 * filters/transformations/overlays explicit and reproducible, and
 * confines chart-type-specific logic to the `type` discriminator. No
 * chart-type-specific or dataset-specific columns live in shared
 * infrastructure.
 */

import { z } from 'zod'
import { t } from '#/copy'
import {
  applyTransformations,
  attachFitOverlay,
  CHART_RECORD_ID_KEY,
  CHART_ROW_ID_KEY,
  gaussianKde,
  groupedNumericSummaries,
  jitterOffset,
  rowMatchesFilterSci04,
  sampleSeriesForRender,
  seriesKeyForRow,
} from './visualisation-pipeline'

// Chart rows carry JSON data, plus missing/non-finite calculated cells. Those
// cells must reach materialisation, which counts them rather than plotting zero.
export type ChartValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ChartValue[]
  | { [fieldId: string]: ChartValue }

export type ChartRow = { [fieldId: string]: ChartValue }

const numberInput = z.union([
  z.number(),
  z.nan(),
  z.literal(Infinity),
  z.literal(-Infinity),
])

const rawObjectInput = z.record(z.string(), z.unknown())

function isInput<Schema extends z.ZodType, Value>(
  schema: Schema,
  value: Value,
): value is Value & z.infer<Schema> {
  return schema.safeParse(value).success
}

export const chartRowSchema: z.ZodType<ChartRow> = z.custom<ChartRow>(
  (value) =>
    isInput(rawObjectInput, value) &&
    Object.values(value).every(
      (cell) => chartValueSchema.safeParse(cell).success,
    ),
)

export const chartValueSchema: z.ZodType<ChartValue> = z.lazy(() =>
  z.union([
    z.string(),
    numberInput,
    z.boolean(),
    z.null(),
    z.undefined(),
    z.array(chartValueSchema),
    chartRowSchema,
  ]),
)

const chartRowsSchema = z.array(chartRowSchema)

function decodeChartRows<Row>(rows: Row[]): ChartRow[] {
  if (isInput(chartRowsSchema, rows)) return rows

  return chartRowsSchema.parse(rows)
}

const stringInput = z.string()
const booleanInput = z.boolean()
const objectInput = z.object({})

function isString<Value>(value: Value): value is Value & string {
  return isInput(stringInput, value)
}

function isNumber<Value>(value: Value): value is Value & number {
  return isInput(numberInput, value)
}

function isBoolean<Value>(value: Value): value is Value & boolean {
  return isInput(booleanInput, value)
}

// These inspection schemas name only the fields each validation stage reads.
// A predicate leaves the original object intact, including extension keys and
// omitted properties. Field validators below retain their ordered diagnostics.
const specInput = z
  .object({
    specVersion: z.unknown(),
    type: z.unknown(),
    datasets: z.unknown(),
    fields: z.unknown(),
    filters: z.unknown(),
    transformations: z.unknown(),
    typeParams: z.unknown(),
    display: z.unknown(),
    overlays: z.unknown(),
  })
  .partial()

const bindingInput = z.object({ fieldId: z.unknown() }).partial()

const datasetInput = z
  .object({ datasetId: z.unknown(), datasetVersionId: z.unknown() })
  .partial()

const fieldsInput = z
  .object({
    x: z.unknown(),
    y: z.unknown(),
    series: z.unknown(),
    color: z.unknown(),
    size: z.unknown(),
    facet: z.unknown(),
    facetRow: z.unknown(),
    facetCol: z.unknown(),
    // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- Inspect the persisted marker-binding key without renaming saved data.
    shape: z.unknown(),
    group: z.unknown(),
    label: z.unknown(),
  })
  .partial()

const filterInput = z
  .object({ fieldId: z.unknown(), op: z.unknown() })
  .partial()

const transformationInput = z
  .object({ kind: z.unknown(), params: z.unknown() })
  .partial()

const axisInput = z
  .object({ label: z.unknown(), scale: z.unknown(), unit: z.unknown() })
  .partial()

const displayInput = z
  .object({ axes: z.unknown(), series: z.unknown(), annotations: z.unknown() })
  .partial()

const axesInput = z.object({ x: z.unknown(), y: z.unknown() }).partial()

const seriesInput = z
  .object({ identifier: z.unknown(), label: z.unknown(), color: z.unknown() })
  .partial()

const annotationInput = z
  .object({ x: z.unknown(), y: z.unknown(), label: z.unknown() })
  .partial()

const overlaysInput = z
  .object({ errorBars: z.unknown(), fit: z.unknown(), references: z.unknown() })
  .partial()

const errorBarsInput = z
  .object({
    basis: z.unknown(),
    source: z.unknown(),
    fieldId: z.unknown(),
    lowerFieldId: z.unknown(),
    upperFieldId: z.unknown(),
    multiplier: z.unknown(),
  })
  .partial()

const fitInput = z
  .object({ method: z.unknown(), degree: z.unknown() })
  .partial()

const referenceInput = z
  .object({
    kind: z.unknown(),
    axis: z.unknown(),
    value: z.unknown(),
    lo: z.unknown(),
    hi: z.unknown(),
    label: z.unknown(),
  })
  .partial()

const typeParamsInput = z
  .object({
    histogram: z.unknown(),
    box: z.unknown(),
    heatmap: z.unknown(),
    bar: z.unknown(),
    strip: z.unknown(),
    summary: z.unknown(),
  })
  .partial()

const histogramInput = z
  .object({ bins: z.unknown(), binWidth: z.unknown() })
  .partial()

const boxInput = z.object({ showOutliers: z.unknown() }).partial()

const heatmapInput = z
  .object({
    xBins: z.unknown(),
    yBins: z.unknown(),
    aggregate: z.unknown(),
    valueField: z.unknown(),
  })
  .partial()

const barInput = z.object({ stacking: z.unknown() }).partial()
const stripInput = z.object({ jitter: z.unknown() }).partial()
const summaryInput = z.object({ statistic: z.unknown() }).partial()

const payloadInput = z
  .object({
    title: z.unknown(),
    spec: z.unknown(),
    provenance: z.unknown(),
    frozen: z.unknown(),
  })
  .partial()

const frozenInput = z
  .object({
    frozenAt: z.unknown(),
    frozenByUserId: z.unknown(),
    datasetProvenance: z.unknown(),
    data: z.unknown(),
  })
  .partial()

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
  'scatter_line',
  'connected_scatter',
  'bar',
  'grouped_bar',
  'stacked_bar',
  'histogram',
  'box',
  'violin',
  'strip',
  'summary',
  'heatmap',
] as const

export type ChartType = (typeof CHART_TYPES)[number]

/** Values use the schema's storage unit, never an unconverted display unit. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Unit metadata is a public raw boundary; inspect its two supported representations without dropping extension keys.
export function chartUnitSymbol(unit: unknown): string | undefined {
  const input = z
    .object({ storageUnit: z.unknown(), symbol: z.unknown() })
    .partial()

  if (!isInput(input, unit)) return undefined

  if (isString(unit.storageUnit)) return unit.storageUnit

  if (isString(unit.symbol)) return unit.symbol

  return undefined
}

/** Authoring controls display stored strings, including future parameter names. */
export function chartStringParameter(value: ChartValue, fallback = ''): string {
  return isString(value) ? value : fallback
}

/** The encoding shelf displays schema labels, not the renderer's storage unit. */
export function chartShelfUnitLabel<Unit>(unit: Unit): string | null {
  if (isString(unit) && unit.trim() !== '') return unit

  if (
    isInput(z.union([objectInput, z.array(z.unknown())]), unit) &&
    'symbol' in unit &&
    isString(unit.symbol) &&
    unit.symbol !== ''
  )
    return unit.symbol

  return null
}

export const CHART_TYPE_LABELS: Record<ChartType, string> = {
  line: t('data.chartTypes.line'),
  scatter: t('data.chartTypes.scatter'),
  scatter_line: t('data.chartTypes.scatter_line'),
  connected_scatter: t('data.chartTypes.connected_scatter'),
  bar: t('data.chartTypes.bar'),
  grouped_bar: t('data.chartTypes.grouped_bar'),
  stacked_bar: t('data.chartTypes.stacked_bar'),
  histogram: t('data.chartTypes.histogram'),
  box: t('data.chartTypes.box'),
  violin: t('data.chartTypes.violin'),
  strip: t('data.chartTypes.strip'),
  summary: t('data.chartTypes.summary'),
  heatmap: t('data.chartTypes.heatmap'),
}

/** Types that require an x encoding. Shared with the DB trigger. */
export const CHART_TYPES_REQUIRING_X: readonly ChartType[] = [
  'line',
  'bar',
  'grouped_bar',
  'stacked_bar',
  'connected_scatter',
  'scatter_line',
  'heatmap',
  'summary',
]

/** Types that measure y only; an x mapping is rejected. */
export const CHART_TYPES_NULL_X: readonly ChartType[] = ['histogram', 'box']

/** Chart types plotted in Cartesian x/y coordinates. */
export const CARTESIAN_CHART_TYPES: readonly ChartType[] = [
  'line',
  'scatter',
  'scatter_line',
  'connected_scatter',
  'bar',
  'grouped_bar',
  'stacked_bar',
  'summary',
]

export const DISTRIBUTION_CHART_TYPES: readonly ChartType[] = [
  'histogram',
  'box',
  'violin',
  'strip',
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

export const BAR_STACKING = ['grouped', 'stacked'] as const

export type BarStacking = (typeof BAR_STACKING)[number]

export const SUMMARY_STATISTICS = ['mean', 'median'] as const

export type SummaryStatistic = (typeof SUMMARY_STATISTICS)[number]

/** Strip-plot jitter is a half-width on the categorical axis, in [0, 1]. */
export const STRIP_JITTER_MIN = 0
export const STRIP_JITTER_MAX = 1

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
  'is_null',
  'not_null',
] as const

export type FilterOp = (typeof FILTER_OPS)[number]

export const TRANSFORMATION_KINDS = [
  'aggregate',
  'bin',
  'normalise',
  'log10',
  'ln',
  'sqrt',
  'abs',
  'percentage',
  'difference',
  'ratio',
] as const

export type TransformationKind = (typeof TRANSFORMATION_KINDS)[number]

export const ERROR_BAR_BASES = [
  'sd',
  'se',
  'sem',
  'ci',
  'range',
  'custom',
] as const

export type ErrorBarBasis = (typeof ERROR_BAR_BASES)[number]

export const ERROR_BAR_SOURCES = ['field', 'computed'] as const

export type ErrorBarSource = (typeof ERROR_BAR_SOURCES)[number]

export const LEGEND_POSITIONS = ['right', 'bottom', 'top', 'hidden'] as const

export type LegendPosition = (typeof LEGEND_POSITIONS)[number]

export const NUMBER_FORMATS = [
  'auto',
  'decimal',
  'sigfig',
  'scientific',
  'percent',
] as const

export type NumberFormatKind = (typeof NUMBER_FORMATS)[number]

export const CATEGORY_ORDER_MODES = [
  'natural',
  'alpha',
  'numeric',
  'explicit',
] as const

export type CategoryOrderMode = (typeof CATEGORY_ORDER_MODES)[number]

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

/** A binding to a field of a Dataset Schema Version. fieldId is authoritative;
 * labels and units are presentation metadata resolved from schema fields,
 * never part of resolution. */
export interface FieldBinding {
  fieldId: string
}

export interface DatasetRef {
  datasetId: string
  /**
   * Read this Dataset Version (a snapshot) instead of the live rows. A chart
   * or analysis on a snapshot keeps drawing the same rows however the dataset
   * changes afterwards.
   */
  datasetVersionId?: string
}

export interface ChartFilter {
  fieldId: string
  op: FilterOp
  value: unknown
}

export interface Transformation {
  kind: TransformationKind
  /** Explicit, reproducible parameters. Kept opaque but must be an object. */
  params: ChartRow
}

export interface AxisDisplay {
  label?: string
  scale: AxisScale
  unit?: string
  min?: number
  max?: number
  reverse?: boolean
  tickFormat?: NumberFormatKind
}

export interface SeriesDisplay {
  identifier: string
  label: string
  color: string
  visible?: boolean
  lineWidth?: number
  pointSize?: number
  // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- Persisted marker encoding is part of ChartSpec and the DB mirror, not a local structural alias.
  shape?: string
}

export interface ErrorBarsOverlay {
  /** How the interval was produced. Never inferred. */
  source?: ErrorBarSource
  fieldId?: string
  lowerFieldId?: string
  upperFieldId?: string
  basis: ErrorBarBasis
  multiplier?: number
  statistic?: 'mean' | 'median'
}

export interface FitOverlay {
  method: 'ols'
  degree?: number
  showBand?: boolean
  showEquation?: boolean
}

export type ReferenceOverlay =
  | { kind: 'hline'; value: number; label: string }
  | { kind: 'vline'; value: number; label: string }
  | {
      kind: 'band'
      axis: 'x' | 'y'
      lo: number
      hi: number
      label: string
    }
  | { kind: 'identity'; label?: string }

export interface ChartDisplay {
  axes: { x: AxisDisplay; y: AxisDisplay }
  series: SeriesDisplay[]
  legend?: { visible: boolean; position?: LegendPosition }
  annotations?: ChartAnnotation[]
  caption?: string
  numberFormat?: { kind: NumberFormatKind; digits?: number }
  categoryOrder?: {
    mode: CategoryOrderMode
    values?: string[]
  }
  palette?: 'categorical' | 'continuous' | 'monochrome'
  gridlines?: boolean
  pointOpacity?: number
}

/** Type-specific, explicitly reproducible parameters. */
export interface ChartTypeParams {
  histogram?: HistogramParams
  box?: BoxPlotParams
  heatmap?: HeatmapParams
  bar?: { stacking?: 'grouped' | 'stacked' }
  strip?: { jitter?: number }
  summary?: { statistic?: 'mean' | 'median' }
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
    facetRow?: FieldBinding | null
    facetCol?: FieldBinding | null
    // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- Stable persisted field-binding key shared with saved charts and the DB mirror.
    shape?: FieldBinding | null
    group?: FieldBinding | null
    label?: FieldBinding | null
  }
  filters: ChartFilter[]
  transformations: Transformation[]
  typeParams: ChartTypeParams
  display: ChartDisplay
  overlays: {
    errorBars: ErrorBarsOverlay | null
    fit?: FitOverlay | null
    references?: ReferenceOverlay[]
  }
}

/** Frozen chart payload — see ADR 0029 §5. */
export interface FrozenDatasetProvenance {
  datasetId: string
  /** Immutable Dataset Version pinned at freeze (SCI-04). */
  datasetVersionId?: string
  /** Numeric version of the pinned Dataset Schema Version. */
  schemaVersionNumber: number
  rowCount: number
  checksum: string
}

export interface FrozenChartColumn {
  fieldId: string
  label: string
  unit?: unknown
  logicalType: string
}

export interface FrozenChartPoint {
  x: number | null
  y: number | null
  yError?: number | null
  yErrorLo?: number | null
  yErrorHi?: number | null
  label?: string
  rowId?: string
  recordId?: string
  size?: number
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
  rows: ChartRow[]
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
  /** Absent on historical evidence, which included every recorded value. */
  exclusionPolicy?: 'include_flagged' | 'exclude_bound_fields'
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

function isNonEmptyString(v: unknown): v is string {
  return isString(v) && v.trim().length > 0
}

function isUuid<Value>(v: Value): v is Value & string {
  return isString(v) && UUID_RE.test(v)
}

function isOneOf<T extends string>(v: unknown, allowed: readonly T[]): v is T {
  return allowed.some((entry) => entry === v)
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This validation stage decodes arbitrary persisted bindings and returns the established field-specific errors.
function validateFieldBinding(v: unknown, field: string): ChartSpecError[] {
  if (v === null || v === undefined) return []

  if (!isInput(bindingInput, v))
    return [
      {
        code: 'invalid_shape',
        field,
        message: `${field} must be a field binding or null`,
      },
    ]

  if (!isUuid(v.fieldId))
    return [
      {
        code: 'invalid_value',
        field: `${field}.fieldId`,
        message: `${field}.fieldId must be a UUID`,
      },
    ]

  return []
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw axis metadata must retain the validator's ordered rejection diagnostics.
function validateAxisDisplay(v: unknown, field: string): ChartSpecError[] {
  if (!isInput(axisInput, v))
    return [
      {
        code: 'invalid_shape',
        field,
        message: `${field} must be an object`,
      },
    ]
  const errors: ChartSpecError[] = []

  if (v.label !== undefined && v.label !== null && !isString(v.label))
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

  if (v.unit !== undefined && !isString(v.unit))
    errors.push({
      code: 'invalid_value',
      field: `${field}.unit`,
      message: `${field}.unit must be a string when present`,
    })

  return errors
}

function validateBinCount(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Decode a raw optional bin count before range validation; do not coerce stored values.
  v: unknown,
  field: string,
  max: number,
): ChartSpecError[] {
  if (v === undefined) return []

  if (!isNumber(v) || !Number.isInteger(v) || v < HEATMAP_MIN_BINS || v > max)
    return [
      {
        code: 'invalid_value',
        field,
        message: `${field} must be an integer between ${HEATMAP_MIN_BINS} and ${max}`,
      },
    ]

  return []
}

function validateReferenceOverlay(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the raw reference-overlay rejection boundary.
  item: unknown,
  field: string,
): ChartSpecError[] {
  if (!isInput(referenceInput, item) || !isNonEmptyString(item.kind))
    return [
      {
        code: 'invalid_value',
        field,
        message:
          'reference overlays must be hline, vline, band or identity with finite numeric values',
      },
    ]

  if (item.kind === 'hline' || item.kind === 'vline') {
    if (
      !isNumber(item.value) ||
      !Number.isFinite(item.value) ||
      !isNonEmptyString(item.label)
    )
      return [
        {
          code: 'invalid_value',
          field,
          message: `${item.kind} references require a finite value and a non-empty label`,
        },
      ]

    return []
  }

  if (item.kind === 'band') {
    if (
      (item.axis !== 'x' && item.axis !== 'y') ||
      !isNumber(item.lo) ||
      !Number.isFinite(item.lo) ||
      !isNumber(item.hi) ||
      !Number.isFinite(item.hi) ||
      !isNonEmptyString(item.label)
    )
      return [
        {
          code: 'invalid_value',
          field,
          message:
            'band references require axis x or y, finite lo/hi and a non-empty label',
        },
      ]

    return []
  }

  if (item.kind === 'identity') {
    if (item.label !== undefined && !isString(item.label))
      return [
        {
          code: 'invalid_value',
          field,
          message:
            'identity references may only include an optional string label',
        },
      ]

    return []
  }

  return [
    {
      code: 'invalid_value',
      field,
      message: 'reference overlay kind must be hline, vline, band or identity',
    },
  ]
}

/** Type-specific parameter validation; absent params mean documented defaults. */
function validateTypeParams(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Inspect raw persisted per-type parameters before their ordered field diagnostics.
  v: unknown,
  type: ChartType | null,
): ChartSpecError[] {
  if (v === undefined || v === null) return []

  if (!isInput(typeParamsInput, v))
    return [
      {
        code: 'invalid_shape',
        field: 'spec.typeParams',
        message: 'spec.typeParams must be an object when present',
      },
    ]
  const errors: ChartSpecError[] = []

  if (v.histogram !== undefined && v.histogram !== null) {
    if (!isInput(histogramInput, v.histogram)) {
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
        (!isNumber(v.histogram.binWidth) ||
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
    if (!isInput(boxInput, v.box)) {
      errors.push({
        code: 'invalid_shape',
        field: 'spec.typeParams.box',
        message: 'typeParams.box must be an object when present',
      })
    } else if (
      v.box.showOutliers !== undefined &&
      !isBoolean(v.box.showOutliers)
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
    if (!isInput(heatmapInput, v.heatmap)) {
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
          !isInput(objectInput, v.heatmap.valueField))
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

  if (v.bar !== undefined && v.bar !== null) {
    if (!isInput(barInput, v.bar)) {
      errors.push({
        code: 'invalid_shape',
        field: 'spec.typeParams.bar',
        message: 'typeParams.bar must be an object when present',
      })
    } else if (
      v.bar.stacking !== undefined &&
      !isOneOf(v.bar.stacking, BAR_STACKING)
    ) {
      errors.push({
        code: 'invalid_value',
        field: 'spec.typeParams.bar.stacking',
        message: `typeParams.bar.stacking must be one of ${BAR_STACKING.join(', ')}`,
      })
    }

    if (
      type !== null &&
      type !== 'bar' &&
      type !== 'grouped_bar' &&
      type !== 'stacked_bar'
    )
      errors.push({
        code: 'invalid_value',
        field: 'spec.typeParams.bar',
        message: `typeParams.bar only applies to bar charts (got ${type})`,
      })
  }

  if (v.strip !== undefined && v.strip !== null) {
    if (!isInput(stripInput, v.strip)) {
      errors.push({
        code: 'invalid_shape',
        field: 'spec.typeParams.strip',
        message: 'typeParams.strip must be an object when present',
      })
    } else if (v.strip.jitter !== undefined) {
      if (
        !isNumber(v.strip.jitter) ||
        !Number.isFinite(v.strip.jitter) ||
        v.strip.jitter < STRIP_JITTER_MIN ||
        v.strip.jitter > STRIP_JITTER_MAX
      )
        errors.push({
          code: 'invalid_value',
          field: 'spec.typeParams.strip.jitter',
          message: `typeParams.strip.jitter must be a finite number between ${STRIP_JITTER_MIN} and ${STRIP_JITTER_MAX}`,
        })
    }

    if (type !== null && type !== 'strip')
      errors.push({
        code: 'invalid_value',
        field: 'spec.typeParams.strip',
        message: `typeParams.strip only applies to strip charts (got ${type})`,
      })
  }

  if (v.summary !== undefined && v.summary !== null) {
    if (!isInput(summaryInput, v.summary)) {
      errors.push({
        code: 'invalid_shape',
        field: 'spec.typeParams.summary',
        message: 'typeParams.summary must be an object when present',
      })
    } else if (
      v.summary.statistic !== undefined &&
      !isOneOf(v.summary.statistic, SUMMARY_STATISTICS)
    ) {
      errors.push({
        code: 'invalid_value',
        field: 'spec.typeParams.summary.statistic',
        message: `typeParams.summary.statistic must be one of ${SUMMARY_STATISTICS.join(', ')}`,
      })
    }

    if (type !== null && type !== 'summary')
      errors.push({
        code: 'invalid_value',
        field: 'spec.typeParams.summary',
        message: `typeParams.summary only applies to summary charts (got ${type})`,
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
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Public persisted-spec validation must diagnose arbitrary input, not require callers to prevalidate with different errors.
export function validateChartSpec(spec: unknown): ChartSpecError[] {
  if (!isInput(specInput, spec))
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
      if (!isInput(datasetInput, d) || !isUuid(d.datasetId))
        errors.push({
          code: 'invalid_dataset_reference',
          field: `spec.datasets[${i}].datasetId`,
          message: `datasets[${i}].datasetId must be a UUID`,
        })
      else if (d.datasetVersionId !== undefined && !isUuid(d.datasetVersionId))
        errors.push({
          code: 'invalid_dataset_reference',
          field: `spec.datasets[${i}].datasetVersionId`,
          message: `datasets[${i}].datasetVersionId must be a UUID`,
        })
    })

  const fields = spec.fields

  if (!isInput(fieldsInput, fields))
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

    if (type !== null && CHART_TYPES_REQUIRING_X.includes(type)) {
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

    if (type !== null && CHART_TYPES_NULL_X.includes(type)) {
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
    errors.push(
      ...validateFieldBinding(fields.facetRow ?? null, 'spec.fields.facetRow'),
    )
    errors.push(
      ...validateFieldBinding(fields.facetCol ?? null, 'spec.fields.facetCol'),
    )
    errors.push(
      ...validateFieldBinding(fields.shape ?? null, 'spec.fields.shape'),
    )
    errors.push(
      ...validateFieldBinding(fields.group ?? null, 'spec.fields.group'),
    )
    errors.push(
      ...validateFieldBinding(fields.label ?? null, 'spec.fields.label'),
    )
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
      if (!isInput(filterInput, f) || !isUuid(f.fieldId))
        errors.push({
          code: 'invalid_value',
          field: `spec.filters[${i}]`,
          message: `filters[${i}] must reference a dataset field`,
        })

      if (!isInput(filterInput, f) || !isOneOf(f.op, FILTER_OPS))
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
    transformations.forEach((item, i) => {
      if (
        !isInput(transformationInput, item) ||
        !isOneOf(item.kind, TRANSFORMATION_KINDS)
      )
        errors.push({
          code: 'invalid_value',
          field: `spec.transformations[${i}].kind`,
          message: `transformations[${i}].kind must be one of ${TRANSFORMATION_KINDS.join(', ')}`,
        })

      if (
        isInput(transformationInput, item) &&
        !isInput(objectInput, item.params)
      )
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

  if (!isInput(displayInput, display))
    errors.push({
      code: 'invalid_shape',
      field: 'spec.display',
      message: 'spec.display must be an object',
    })
  else {
    if (!isInput(axesInput, display.axes))
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
          !isInput(seriesInput, s) ||
          !isNonEmptyString(s.identifier) ||
          !isNonEmptyString(s.label) ||
          !isString(s.color)
        )
          errors.push({
            code: 'invalid_value',
            field: `spec.display.series[${i}]`,
            message: `series[${i}] must have identifier, label and color`,
          })
        else if (
          !CHART_PALETTE.some(
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
            !isInput(annotationInput, a) ||
            !isNumber(a.x) ||
            !Number.isFinite(a.x) ||
            !isNumber(a.y) ||
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

  if (!isInput(overlaysInput, overlays))
    errors.push({
      code: 'invalid_shape',
      field: 'spec.overlays',
      message: 'spec.overlays must be an object',
    })
  else if (overlays.errorBars !== null && overlays.errorBars !== undefined) {
    const eb = overlays.errorBars

    if (!isInput(errorBarsInput, eb) || !isOneOf(eb.basis, ERROR_BAR_BASES))
      errors.push({
        code: 'invalid_value',
        field: 'spec.overlays.errorBars',
        message:
          'overlays.errorBars must name a basis (sd, se, sem, ci, range, custom)',
      })

    if (isInput(errorBarsInput, eb)) {
      if (eb.source === 'field' || eb.source === undefined) {
        const hasField = isUuid(eb.fieldId)
        const hasInterval = isUuid(eb.lowerFieldId) && isUuid(eb.upperFieldId)

        if (!hasField && !hasInterval && eb.source === 'field')
          errors.push({
            code: 'invalid_value',
            field: 'spec.overlays.errorBars',
            message:
              'field error bars require fieldId or lowerFieldId/upperFieldId',
          })

        if (
          eb.fieldId !== undefined &&
          eb.fieldId !== null &&
          !isUuid(eb.fieldId)
        )
          errors.push({
            code: 'invalid_value',
            field: 'spec.overlays.errorBars.fieldId',
            message: 'errorBars.fieldId must be a UUID when present',
          })

        const lowerSet =
          eb.lowerFieldId !== undefined && eb.lowerFieldId !== null

        const upperSet =
          eb.upperFieldId !== undefined && eb.upperFieldId !== null

        if (lowerSet !== upperSet)
          errors.push({
            code: 'invalid_value',
            field: 'spec.overlays.errorBars',
            message:
              'errorBars.lowerFieldId and errorBars.upperFieldId must be provided together',
          })
        else if (
          lowerSet &&
          (!isUuid(eb.lowerFieldId) || !isUuid(eb.upperFieldId))
        )
          errors.push({
            code: 'invalid_value',
            field: 'spec.overlays.errorBars',
            message:
              'errorBars.lowerFieldId and errorBars.upperFieldId must be UUIDs',
          })
      }

      if (eb.multiplier !== undefined) {
        if (
          !isNumber(eb.multiplier) ||
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
  }

  if (
    isInput(overlaysInput, overlays) &&
    overlays.fit !== undefined &&
    overlays.fit !== null
  ) {
    const fit = overlays.fit

    if (
      !isInput(fitInput, fit) ||
      fit.method !== 'ols' ||
      (fit.degree !== undefined &&
        (!isNumber(fit.degree) ||
          !Number.isInteger(fit.degree) ||
          fit.degree < 1 ||
          fit.degree > 4))
    )
      errors.push({
        code: 'invalid_value',
        field: 'spec.overlays.fit',
        message: 'overlays.fit must be OLS with degree 1–4',
      })
  }

  if (
    isInput(overlaysInput, overlays) &&
    overlays.references !== undefined &&
    overlays.references !== null
  ) {
    if (!Array.isArray(overlays.references))
      errors.push({
        code: 'invalid_shape',
        field: 'spec.overlays.references',
        message: 'overlays.references must be an array when present',
      })
    else if (overlays.references.length > MAX_ANNOTATIONS)
      errors.push({
        code: 'invalid_value',
        field: 'spec.overlays.references',
        message: `overlays.references supports at most ${MAX_ANNOTATIONS} entries`,
      })
    else {
      overlays.references.forEach((item, i) => {
        errors.push(
          ...validateReferenceOverlay(item, `spec.overlays.references[${i}]`),
        )
      })
    }
  }

  if (
    isOneOf(spec.type, CHART_TYPES) &&
    spec.type === 'heatmap' &&
    isInput(overlaysInput, overlays) &&
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
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Public block validation decodes the original payload while preserving ordered legacy diagnostics and unknown scientific keys.
export function validateChartPayload(payload: unknown): ChartSpecError[] {
  if (!isInput(payloadInput, payload))
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
    !isString(payload.provenance)
  )
    errors.push({
      code: 'invalid_value',
      field: 'provenance',
      message: 'provenance must be a string when present',
    })

  if (payload.frozen !== undefined && payload.frozen !== null) {
    if (!isInput(frozenInput, payload.frozen))
      errors.push({
        code: 'invalid_shape',
        field: 'frozen',
        message: 'frozen must be an object when present',
      })
    // Frozen payload structural checks: must carry provenance + data.
    const f = payload.frozen

    if (isInput(frozenInput, f)) {
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

      if (!isInput(objectInput, f.data))
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

/**
 * Column metadata sufficient for materialisation/rendering. `id` is the
 * stable Dataset Schema Version `field_id`; runtime rows are keyed by it.
 */
export interface ChartColumn {
  id: string
  label: string
  logicalType: string
  unit?: unknown
}

function toNumber(v: ChartValue): number | null {
  if (isNumber(v)) return Number.isFinite(v) ? v : null

  if (isString(v) && v.trim() !== '') {
    const n = Number(v)

    return Number.isFinite(n) ? n : null
  }

  if (isBoolean(v)) return v ? 1 : 0

  return null
}

function chartCellLabel(value: ChartValue): string {
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- Historical chart labels use native String coercion, including arrays and object-valued categories; JSON encoding would change grouping and saved labels.
  return String(value)
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

export function rowMatchesFilter<Row>(row: Row, filter: ChartFilter): boolean {
  return rowMatchesFilterSci04(chartRowSchema.parse(row), filter)
}

export function applyFilters<Row>(
  input: Row[],
  filters: ChartFilter[],
): ChartRow[] {
  const rows = decodeChartRows(input)

  if (filters.length === 0) return rows

  return rows.filter((row) =>
    filters.every((filter) => rowMatchesFilterSci04(row, filter)),
  )
}

/**
 * Resolve a binding to its column metadata. The stable `fieldId` is the only
 * key that resolves — a missing or retired field surfaces as null so the
 * chart reports `missing_field` instead of silently rebinding by label.
 */
export function resolveColumn(
  columns: ChartColumn[],
  binding: { fieldId: string } | null,
): ChartColumn | null {
  if (!binding) return null

  return columns.find((c) => c.id === binding.fieldId) ?? null
}

const TRANSFORM_FIELD_PARAM_KEYS = [
  'fieldId',
  'xField',
  'yField',
  'seriesField',
] as const

/**
 * Field IDs a ChartSpec actually reads. Freeze metadata and reconstruction
 * must keep this set, including `typeParams.heatmap.valueField`.
 */
export function chartSpecReferencedFieldIds(spec: ChartSpec): string[] {
  const ids = new Set<string>()

  const take = (value: ChartValue) => {
    if (isUuid(value)) ids.add(value)
  }

  const takeBinding = (binding: FieldBinding | null | undefined) => {
    if (binding) take(binding.fieldId)
  }

  takeBinding(spec.fields.x)
  takeBinding(spec.fields.y)
  takeBinding(spec.fields.series)
  takeBinding(spec.fields.color)
  takeBinding(spec.fields.size)
  takeBinding(spec.fields.facet)
  takeBinding(spec.fields.facetRow)
  takeBinding(spec.fields.facetCol)
  takeBinding(spec.fields.shape)
  takeBinding(spec.fields.group)
  takeBinding(spec.fields.label)

  for (const filter of spec.filters) take(filter.fieldId)
  const errorBars = spec.overlays.errorBars

  if (errorBars) {
    take(errorBars.fieldId)
    take(errorBars.lowerFieldId)
    take(errorBars.upperFieldId)
  }

  takeBinding(spec.typeParams.heatmap?.valueField)

  for (const transformation of spec.transformations) {
    for (const key of TRANSFORM_FIELD_PARAM_KEYS) {
      take(transformation.params[key])
    }
  }

  return [...ids].sort()
}

/** Render-time state the chart surfaces honestly instead of blank axes. */
export type ChartRenderState =
  | { kind: 'ok' }
  | { kind: 'missing_dataset' }
  | { kind: 'missing_field'; fields: string[] }
  | { kind: 'dataset_too_large'; rowCount: number; limit: number }
  | { kind: 'empty_dataset' }
  | { kind: 'log_scale_invalid'; axis: 'x' | 'y'; invalidCount: number }
  | { kind: 'stale'; detail: string }

export interface MaterialisedSeries {
  identifier: string
  label: string
  color: string
  points: FrozenChartPoint[]
  /**
   * Render the series as a connected line even inside scatter plots — used
   * by fitted-curve overlays so observations stay dots while the model
   * draws as a smooth dashed curve.
   */
  renderAs?: 'line'
  visible?: boolean
  violin?: Array<{ y: number; d: number }>
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
  rows: ChartRow[]
  series: MaterialisedSeries[]
  xLabel: string
  yLabel: string
  xUnit: string | undefined
  yUnit: string | undefined
  /** Rows dropped because the mapped value was missing or non-numeric. */
  droppedPoints: number
  /** Rows a transform could not apply (log of ≤0, √ of <0, zero ratio). */
  transformInvalidCount?: number
  transformInvalidReasons?: string[]
  /** Shared histogram bin edges when the chart type is `histogram`. */
  bins?: { edges: number[] }
  /** Aggregated value grid when the chart type is `heatmap`. */
  heatmap?: HeatmapMatrix
  fit?: {
    method: 'ols'
    degree: number
    n: number
    coefficients: number[]
    r2: number | null
    equation: string
    band?: Array<{ x: number; lo: number; hi: number }>
    error?: 'insufficient_data' | 'singular_fit'
  }
  sampling?: {
    totalCount: number
    sampledCount: number
    analysisCount: number
  }
  summaries?: Array<{
    group: string
    n: number
    mean: number
    median: number
    sd: number | null
    se: number | null
  }>
}

/**
 * Materialise a chart from a spec and the dataset's columns + rows. Shared by
 * the live renderer (re-reads rows) and the freeze RPC (stores the result).
 * Detects missing fields, empty datasets and log-scale invalid values.
 */
export function materialiseChart<Row>(
  spec: ChartSpec,
  columns: ChartColumn[],
  rows: Row[],
): MaterialisedChart {
  const xCol = resolveColumn(columns, spec.fields.x)
  const yCol = resolveColumn(columns, spec.fields.y)

  const seriesCol =
    resolveColumn(columns, spec.fields.series) ??
    resolveColumn(columns, spec.fields.color ?? null)

  const errorBinding = spec.overlays.errorBars?.fieldId
    ? { fieldId: spec.overlays.errorBars.fieldId }
    : null

  const errorCol = errorBinding ? resolveColumn(columns, errorBinding) : null

  const missing: string[] = []

  if (spec.fields.x && !xCol) missing.push('x')

  if (!yCol) missing.push('y')

  if (spec.fields.series && !resolveColumn(columns, spec.fields.series))
    missing.push('series')

  if (spec.fields.color && !resolveColumn(columns, spec.fields.color))
    missing.push('color')

  if (
    spec.overlays.errorBars &&
    spec.overlays.errorBars.source !== 'computed' &&
    spec.overlays.errorBars.fieldId &&
    !errorCol
  )
    missing.push('errorBars')

  const xLabel = xCol?.label ?? spec.display.axes.x.label ?? 'x'
  const yLabel = yCol?.label ?? spec.display.axes.y.label ?? 'y'
  const xUnit = chartUnitSymbol(xCol?.unit) ?? spec.display.axes.x.unit
  const yUnit = chartUnitSymbol(yCol?.unit) ?? spec.display.axes.y.unit

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
  const transformed = applyTransformations(filtered, spec.transformations, spec)
  const working = decodeChartRows(transformed.rows)
  const transformInvalidCount = transformed.transformInvalid
  const transformInvalidReasons = transformed.reasons

  const withTransforms = (chart: MaterialisedChart) =>
    finishMaterialised(spec, {
      ...chart,
      transformInvalidCount,
      transformInvalidReasons,
    })

  if (working.length === 0)
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
      transformInvalidCount,
      transformInvalidReasons,
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
      transformInvalidCount,
      transformInvalidReasons,
    }

  if (type === 'histogram')
    return withTransforms(
      materialiseHistogram(spec, yCol, working, {
        columns,
        xLabel,
        yLabel,
        xUnit,
        yUnit,
      }),
    )

  if (type === 'box')
    return withTransforms(
      materialiseBoxPlot(spec, yCol, working, {
        columns,
        xLabel,
        yLabel,
        xUnit,
        yUnit,
      }),
    )

  if (type === 'violin')
    return withTransforms(
      materialiseViolin(spec, yCol, working, {
        columns,
        xLabel,
        yLabel,
        xUnit,
        yUnit,
      }),
    )

  if (type === 'strip')
    return withTransforms(
      materialiseStrip(spec, yCol, working, {
        columns,
        xLabel,
        yLabel,
        xUnit,
        yUnit,
      }),
    )

  if (type === 'summary')
    return withTransforms(
      materialiseSummary(spec, yCol, xCol, working, {
        columns,
        xLabel,
        yLabel,
        xUnit,
        yUnit,
      }),
    )

  if (type === 'heatmap')
    return withTransforms(
      materialiseHeatmap(spec, columns, xCol, yCol, working, {
        columns,
        xLabel,
        yLabel,
        xUnit,
        yUnit,
      }),
    )

  // Build series groups.
  const groups = new Map<string, ChartRow[]>()

  for (const row of working) {
    const key = seriesCol
      ? chartCellLabel(row[seriesCol.id] ?? '—')
      : seriesKeyForRow(row, spec)

    const group = groups.get(key) ?? []
    group.push(row)
    groups.set(key, group)
  }

  const paletteLookup = new Map(
    spec.display.series.map((s) => [s.identifier, s]),
  )

  const series: MaterialisedSeries[] = Array.from(groups, ([key, group], i) => {
    const configured = paletteLookup.get(key)

    const color = (
      configured?.color ?? CHART_PALETTE[i % CHART_PALETTE.length]
    ).toLowerCase()

    const label = configured?.label ?? key

    const points: FrozenChartPoint[] = group.map((row, rowIndex) => {
      const x = xCol ? toNumber(row[xCol.id]) : rowIndex + 1
      const y = toNumber(row[yCol.id])
      const yError = errorCol ? toNumber(row[errorCol.id]) : undefined

      const lo =
        spec.overlays.errorBars?.lowerFieldId !== undefined
          ? toNumber(row[spec.overlays.errorBars.lowerFieldId])
          : null

      const hi =
        spec.overlays.errorBars?.upperFieldId !== undefined
          ? toNumber(row[spec.overlays.errorBars.upperFieldId])
          : null

      const sizeCol = resolveColumn(columns, spec.fields.size)
      const size = sizeCol ? toNumber(row[sizeCol.id]) : undefined

      const rowId = isString(row[CHART_ROW_ID_KEY])
        ? String(row[CHART_ROW_ID_KEY])
        : undefined

      const recordId = isString(row[CHART_RECORD_ID_KEY])
        ? String(row[CHART_RECORD_ID_KEY])
        : undefined

      return {
        x,
        y,
        yError: yError ?? null,
        yErrorLo: lo,
        yErrorHi: hi,
        label: key,
        rowId,
        recordId,
        size: size ?? undefined,
      }
    })

    return {
      identifier: key,
      label,
      color,
      points,
      visible: configured?.visible,
    }
  })

  // Rows whose mapped value is missing or non-numeric are dropped from the
  // plot (a null point has no position); the count is surfaced so silent gaps
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
        rows: working,
        series,
        xLabel,
        yLabel,
        xUnit,
        yUnit,
        droppedPoints: 0,
        transformInvalidCount,
        transformInvalidReasons,
      }
  }

  return finishMaterialised(spec, {
    state: { kind: 'ok' },
    columns,
    rows: working,
    series,
    xLabel,
    yLabel,
    xUnit,
    yUnit,
    droppedPoints,
    transformInvalidCount,
    transformInvalidReasons,
  })
}

function finishMaterialised(
  spec: ChartSpec,
  chart: MaterialisedChart,
): MaterialisedChart {
  if (chart.state.kind !== 'ok') return chart
  const withFit = attachFitOverlay(spec, chart.series)
  const sampled = sampleSeriesForRender(withFit.series)

  return {
    ...chart,
    series: sampled.series,
    fit: withFit.fit,
    sampling: sampled.sampling,
  }
}

function materialiseViolin(
  spec: ChartSpec,
  yCol: ChartColumn,
  filtered: ChartRow[],
  meta: MaterialiseMeta,
): MaterialisedChart {
  const seriesCol = resolveColumn(meta.columns, spec.fields.series)
  const groups = new Map<string, number[]>()
  let droppedPoints = 0

  for (const row of filtered) {
    const key = seriesCol ? chartCellLabel(row[seriesCol.id] ?? '—') : 'all'
    const v = toNumber(row[yCol.id])

    if (v === null) {
      droppedPoints++
      continue
    }

    const values = groups.get(key) ?? []
    values.push(v)
    groups.set(key, values)
  }

  const series: MaterialisedSeries[] = Array.from(
    groups,
    ([key, values], i) => {
      const { color, label } = paletteFor(spec, key, i)
      const stats = boxStats(values)
      const density = gaussianKde(values)

      return {
        identifier: key,
        label,
        color,
        violin: density,
        points: stats
          ? [
              {
                x: i + 1,
                y: stats.median,
                yError: null,
                label: key,
                box: stats,
              },
            ]
          : [],
      }
    },
  )

  return {
    state: { kind: 'ok' },
    ...meta,
    rows: filtered,
    series,
    droppedPoints,
  }
}

function materialiseStrip(
  spec: ChartSpec,
  yCol: ChartColumn,
  filtered: ChartRow[],
  meta: MaterialiseMeta,
): MaterialisedChart {
  const seriesCol = resolveColumn(meta.columns, spec.fields.series)
  const groups = new Map<string, ChartRow[]>()

  for (const row of filtered) {
    const key = seriesCol ? chartCellLabel(row[seriesCol.id] ?? '—') : 'all'

    const group = groups.get(key) ?? []
    group.push(row)
    groups.set(key, group)
  }

  let droppedPoints = 0
  const jitter = spec.typeParams.strip?.jitter ?? 0.18

  const series: MaterialisedSeries[] = Array.from(groups, ([key, group], i) => {
    const { color, label } = paletteFor(spec, key, i)
    const points: FrozenChartPoint[] = []

    for (const row of group) {
      const y = toNumber(row[yCol.id])

      if (y === null) {
        droppedPoints++
        continue
      }

      const seed = `${key}:${chartCellLabel(row[CHART_ROW_ID_KEY] ?? y)}`
      points.push({
        x: i + 1 + jitterOffset(seed, jitter),
        y,
        yError: null,
        label: key,
        rowId: isString(row[CHART_ROW_ID_KEY])
          ? String(row[CHART_ROW_ID_KEY])
          : undefined,
      })
    }

    return { identifier: key, label, color, points }
  })

  return {
    state: { kind: 'ok' },
    ...meta,
    rows: filtered,
    series,
    droppedPoints,
  }
}

function materialiseSummary(
  spec: ChartSpec,
  yCol: ChartColumn,
  xCol: ChartColumn | null,
  filtered: ChartRow[],
  meta: MaterialiseMeta,
): MaterialisedChart {
  const summaries = groupedNumericSummaries(
    filtered,
    spec,
    yCol.id,
    xCol?.id ?? null,
  )

  const statistic = spec.typeParams.summary?.statistic ?? 'mean'
  const bySeries = new Map<string, GroupedLike[]>()

  type GroupedLike = (typeof summaries)[number]

  for (const row of summaries) {
    const group = bySeries.get(row.series) ?? []
    group.push(row)
    bySeries.set(row.series, group)
  }

  const order = Array.from(bySeries.keys())

  const series: MaterialisedSeries[] = orderKeys(order).map((key, i) => {
    const { color, label } = paletteFor(spec, key, i)

    const points: FrozenChartPoint[] = (bySeries.get(key) ?? []).map(
      (row, index) => {
        const y = statistic === 'median' ? row.stats.median : row.stats.mean
        const x = toNumber(chartValueSchema.parse(row.x)) ?? index + 1
        const half = (row.interval.hi - row.interval.lo) / 2

        return {
          x,
          y,
          yError: half,
          yErrorLo: row.interval.lo,
          yErrorHi: row.interval.hi,
          label: key,
        }
      },
    )

    return { identifier: key, label, color, points }
  })

  return {
    state: { kind: 'ok' },
    ...meta,
    rows: filtered,
    series,
    droppedPoints: 0,
    summaries: summaries.map((row) => ({
      group: row.key,
      n: row.stats.n,
      mean: row.stats.mean,
      median: row.stats.median,
      sd: row.stats.sd,
      se: row.stats.se,
    })),
  }
}

function orderKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

interface MaterialiseMeta {
  columns: ChartColumn[]
  xLabel: string
  yLabel: string
  xUnit: string | undefined
  yUnit: string | undefined
}

function paletteFor(spec: ChartSpec, key: string, index: number) {
  const configured = spec.display.series.find((s) => s.identifier === key)

  const fallback =
    spec.display.palette === 'monochrome'
      ? CHART_PALETTE[0]
      : CHART_PALETTE[index % CHART_PALETTE.length]

  return {
    color: (configured?.color ?? fallback).toLowerCase(),
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
  filtered: ChartRow[],
  meta: MaterialiseMeta,
): MaterialisedChart {
  const seriesCol = resolveColumn(meta.columns, spec.fields.series)
  const params = spec.typeParams.histogram ?? {}

  const numeric = filtered.flatMap((row) => {
    const value = toNumber(row[yCol.id])

    return value === null ? [] : [value]
  })

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

  const groups = new Map<string, ChartRow[]>()

  for (const row of filtered) {
    const key = seriesCol ? chartCellLabel(row[seriesCol.id] ?? '—') : 'all'

    const group = groups.get(key) ?? []
    group.push(row)
    groups.set(key, group)
  }

  let droppedPoints = 0

  const series: MaterialisedSeries[] = Array.from(groups, ([key, group], i) => {
    const { color, label } = paletteFor(spec, key, i)
    const points: FrozenChartPoint[] = []

    for (let b = 0; b < edges.length - 1; b++) {
      points.push({ x: edges[b], y: 0, yError: null, label: key })
    }

    for (const row of group) {
      const v = toNumber(row[yCol.id])

      if (v === null) {
        droppedPoints++
        continue
      }

      let idx = Math.floor((v - edges[0]) / width)

      if (idx >= edges.length - 1) idx = edges.length - 2 // last bin is inclusive

      if (idx < 0) idx = 0
      points[idx].y = (points[idx].y ?? 0) + 1
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
  filtered: ChartRow[],
  meta: MaterialiseMeta,
): MaterialisedChart {
  const seriesCol = resolveColumn(meta.columns, spec.fields.series)
  const groups = new Map<string, ChartRow[]>()

  for (const row of filtered) {
    const key = seriesCol ? chartCellLabel(row[seriesCol.id] ?? '—') : 'all'

    const group = groups.get(key) ?? []
    group.push(row)
    groups.set(key, group)
  }

  let droppedPoints = 0

  const series: MaterialisedSeries[] = Array.from(groups, ([key, group], i) => {
    const { color, label } = paletteFor(spec, key, i)
    const values: number[] = []

    for (const row of group) {
      const v = toNumber(row[yCol.id])

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
  filtered: ChartRow[],
  meta: MaterialiseMeta,
): MaterialisedChart {
  // The grid needs both dimensions. A heatmap whose X or Y is unmapped (a
  // type switch from histogram/box clears X, and a saved spec may never have
  // mapped one) has no grid to build: report the missing dimension rather
  // than dereferencing a null column.
  if (!xCol || !yCol) {
    const fields: string[] = []

    if (!xCol) fields.push('x')

    if (!yCol) fields.push('y')

    return {
      state: { kind: 'missing_field', fields },
      ...meta,
      rows: [],
      series: [],
      droppedPoints: 0,
    }
  }

  const params: HeatmapParams = spec.typeParams.heatmap ?? {
    aggregate: 'count',
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

  function buildDim(col: ChartColumn, bins: number): Dim {
    if (isCategoricalColumn(col)) {
      const labels = Array.from(
        new Set(filtered.map((r) => chartCellLabel(r[col.id] ?? '—'))),
      ).sort(compareStrings)

      const index = new Map(labels.map((l, i) => [l, i]))

      return {
        labels,
        categorical: true,
        indexOf: (v) => index.get(String(v ?? '—')) ?? -1,
      }
    }

    const numeric = filtered.flatMap((row) => {
      const value = toNumber(row[col.id])

      return value === null ? [] : [value]
    })

    const min = numeric.length ? Math.min(...numeric) : 0
    const max = numeric.length ? Math.max(...numeric) : 1

    const edges =
      min === max ? [min - 0.5, max + 0.5] : histogramEdges(min, max, bins)

    const width = edges[1] - edges[0]

    const labels = Array.from({ length: edges.length - 1 }, (_, i) =>
      formatScientific(edges[i]),
    )

    return {
      labels,
      categorical: false,
      // Pure: bin assignment has no side effects. Omission is counted once
      // per row in the aggregation pass below, never per dimension.
      indexOf: (v) => {
        if (!isNumber(v)) return -1
        let idx = Math.floor((v - edges[0]) / width)

        if (idx >= labels.length) idx = labels.length - 1

        return idx
      },
    }
  }

  const xDim = buildDim(xCol, params.xBins ?? 10)
  const yDim = buildDim(yCol, params.yBins ?? 10)

  const cellMap = new Map<
    string,
    { sum: number; n: number; count: number; values: number[] }
  >()

  let omittedRows = 0

  for (const row of filtered) {
    const xv = xDim.categorical
      ? chartCellLabel(row[xCol.id] ?? '—')
      : toNumber(row[xCol.id])

    const yv = yDim.categorical
      ? chartCellLabel(row[yCol.id] ?? '—')
      : toNumber(row[yCol.id])

    const xi = xDim.indexOf(xv)
    const yi = yDim.indexOf(yv)

    // One row invalid in either dimension is one omitted row — never summed
    // across dimensions.
    if (xi < 0 || yi < 0) {
      omittedRows++
      continue
    }

    const k = `${xi},${yi}`
    const cell = cellMap.get(k) ?? { sum: 0, n: 0, count: 0, values: [] }
    cell.count++

    if (valueCol) {
      const v = toNumber(row[valueCol.id])

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
    droppedPoints: omittedRows,
    heatmap: {
      xLabels: xDim.labels,
      yLabels: yDim.labels,
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
export function materialiseFacetedCharts<Row>(
  spec: ChartSpec,
  columns: ChartColumn[],
  rows: Row[],
): FacetedResult {
  const facetCol = resolveColumn(columns, spec.fields.facet)

  if (!facetCol) return { panels: [], total: 0 }
  const partitioned = applyFilters(rows, spec.filters)
  const groups = new Map<string, ChartRow[]>()

  for (const row of partitioned) {
    const key = chartCellLabel(row[facetCol.id] ?? '—')

    const group = groups.get(key) ?? []
    group.push(row)
    groups.set(key, group)
  }

  const entries = Array.from(groups).sort(([a], [b]) => compareStrings(a, b))
  const { facet: _facet, ...restFields } = spec.fields

  const panelSpec: ChartSpec = {
    ...spec,
    filters: [],
    fields: { ...restFields, facet: null },
  }

  return {
    panels: entries.slice(0, MAX_FACETS).map(([value, group]) => ({
      value,
      chart: materialiseChart(panelSpec, columns, group),
    })),
    total: entries.length,
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
