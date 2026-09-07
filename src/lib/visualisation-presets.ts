/**
 * SCI-04 — lightweight visualisation presets.
 *
 * A preset is an initialiser for a normal ChartSpec, not a second product.
 * Applying a preset never silently remaps fields by similar names.
 */

import { CHART_PALETTE, CHART_SPEC_VERSION } from './chart-spec'
import type {
  ChartColumn,
  ChartSpec,
  ChartType,
  FieldBinding,
} from './chart-spec'

export const VISUALISATION_PRESET_IDS = [
  'dose_response',
  'time_course',
  'grouped_comparison',
  'distribution',
  'correlation',
] as const
export type VisualisationPresetId = (typeof VISUALISATION_PRESET_IDS)[number]

export interface VisualisationPreset {
  id: VisualisationPresetId
  label: string
  type: ChartType
}

export const VISUALISATION_PRESETS: readonly VisualisationPreset[] = [
  { id: 'dose_response', label: 'Dose response', type: 'scatter_line' },
  { id: 'time_course', label: 'Time course', type: 'line' },
  { id: 'grouped_comparison', label: 'Grouped comparison', type: 'box' },
  { id: 'distribution', label: 'Distribution', type: 'histogram' },
  { id: 'correlation', label: 'Correlation', type: 'scatter' },
]

function binding(column: ChartColumn | undefined): FieldBinding | null {
  return column ? { fieldId: column.id } : null
}

function numericColumns(columns: ChartColumn[]): ChartColumn[] {
  return columns.filter(
    (column) =>
      column.logicalType === 'decimal' || column.logicalType === 'integer',
  )
}

function categoryColumns(columns: ChartColumn[]): ChartColumn[] {
  return columns.filter((column) =>
    ['category', 'text', 'boolean'].includes(column.logicalType),
  )
}

export function emptyChartSpec(datasetId: string): ChartSpec {
  return {
    specVersion: CHART_SPEC_VERSION,
    type: 'scatter',
    datasets: [{ datasetId }],
    fields: {
      x: null,
      y: { fieldId: '00000000-0000-4000-8000-000000000000' },
      series: null,
      color: null,
      size: null,
      facet: null,
      facetRow: null,
      facetCol: null,
      shape: null,
      group: null,
      label: null,
    },
    filters: [],
    transformations: [],
    typeParams: {},
    display: {
      axes: {
        x: { scale: 'linear' },
        y: { scale: 'linear' },
      },
      series: [],
      legend: { visible: true, position: 'right' },
    },
    overlays: { errorBars: null, fit: null, references: [] },
  }
}

/**
 * Deterministic plot-type recommendation from mapped field logical types.
 * The user remains in control; this is a UI hint, not an inference engine.
 */
export function recommendPlotType(input: {
  x: ChartColumn | null
  y: ChartColumn | null
}): ChartType {
  const x = input.x
  const y = input.y
  const yNumeric =
    y !== null && (y.logicalType === 'decimal' || y.logicalType === 'integer')
  const xNumeric =
    x !== null && (x.logicalType === 'decimal' || x.logicalType === 'integer')
  const xCategory =
    x !== null && ['category', 'text', 'boolean'].includes(x.logicalType)
  if (yNumeric && xNumeric) return 'scatter'
  if (yNumeric && xCategory) return 'box'
  if (yNumeric && x === null) return 'histogram'
  if (yNumeric) return 'bar'
  return 'scatter'
}

export function applyVisualisationPreset(input: {
  datasetId: string
  columns: ChartColumn[]
  preset: VisualisationPresetId
}): ChartSpec {
  const numeric = numericColumns(input.columns)
  const cats = categoryColumns(input.columns)
  const y = numeric.at(numeric.length > 1 ? 1 : 0)
  const xNumeric = numeric.length > 1 ? numeric.at(0) : undefined
  const xCat = cats.at(0)
  const base = emptyChartSpec(input.datasetId)
  if (y === undefined) return base

  if (input.preset === 'distribution') {
    return {
      ...base,
      type: 'histogram',
      fields: {
        ...base.fields,
        x: null,
        y: { fieldId: y.id },
        series: binding(xCat),
      },
      typeParams: { histogram: { bins: 12 } },
      display: {
        ...base.display,
        axes: {
          x: { label: y.label, scale: 'linear' },
          y: { label: 'Count', scale: 'linear' },
        },
        series:
          xCat === undefined
            ? [{ identifier: 'all', label: y.label, color: CHART_PALETTE[0] }]
            : [],
      },
    }
  }

  if (input.preset === 'grouped_comparison') {
    return {
      ...base,
      type: 'box',
      fields: {
        ...base.fields,
        x: null,
        y: { fieldId: y.id },
        series: binding(xCat),
      },
      typeParams: { box: { showOutliers: true } },
      display: {
        ...base.display,
        axes: {
          x: { label: xCat?.label ?? 'Group', scale: 'linear' },
          y: { label: y.label, scale: 'linear' },
        },
      },
    }
  }

  const x =
    input.preset === 'correlation' || input.preset === 'dose_response'
      ? xNumeric
      : (xNumeric ?? xCat)
  const type: ChartType =
    input.preset === 'time_course'
      ? 'line'
      : input.preset === 'dose_response'
        ? 'scatter_line'
        : 'scatter'
  return {
    ...base,
    type,
    fields: {
      ...base.fields,
      x: binding(x),
      y: { fieldId: y.id },
      series: binding(xCat),
      color: binding(xCat),
    },
    display: {
      ...base.display,
      axes: {
        x: { label: x?.label ?? 'Row', scale: 'linear' },
        y: { label: y.label, scale: 'linear' },
      },
    },
  }
}
