import type { ChartColumn, ChartSpec } from './chart-spec'
import { chartUnitSymbol } from './chart-spec'

/** The chart a view is known by: its first. */
export function primaryChart(view: { charts: ChartSpec[] }): ChartSpec {
  return view.charts[0]
}

/** An analysis holds at most this many charts . */
export const ANALYSIS_MAX_CHARTS = 8

const NUMERIC_TYPES = ['integer', 'decimal', 'quantity', 'number']

export function numericColumns(columns: readonly ChartColumn[]): ChartColumn[] {
  return columns.filter((c) => NUMERIC_TYPES.includes(c.logicalType))
}

/** "Step yield (%)": a column's label with its unit, as an axis title. */
export function axisTitle(column: ChartColumn): string {
  const unit = chartUnitSymbol(column.unit)
  return unit ? `${column.label} (${unit})` : column.label
}

/** What a chart is called in the list: its Y axis title. */
export function chartTitle(spec: ChartSpec): string {
  return spec.display?.axes?.y?.label ?? 'Chart'
}

/**
 * The same chart plotting another column on Y. The old column's reference
 * lines are dropped: a limit for turbidity means nothing on step yield.
 */
export function withYColumn(spec: ChartSpec, column: ChartColumn): ChartSpec {
  const unit = chartUnitSymbol(column.unit)
  return {
    ...spec,
    fields: { ...spec.fields, y: { fieldId: column.id } },
    display: {
      ...spec.display,
      axes: {
        ...spec.display.axes,
        y: { ...spec.display.axes.y, label: axisTitle(column), unit },
      },
    },
    overlays: { ...spec.overlays, references: [] },
  }
}

/**
 * A new chart beside the existing ones: the first chart's shape, on the first
 * numeric column that no chart plots yet. Null when every column is plotted.
 */
export function nextChart(
  charts: readonly ChartSpec[],
  columns: readonly ChartColumn[],
): ChartSpec | null {
  const used = new Set(charts.map((c) => c.fields?.y?.fieldId))
  const x = charts[0]?.fields?.x?.fieldId
  if (x) used.add(x)
  const free = numericColumns(columns).find((c) => !used.has(c.id))
  return free && charts[0] ? withYColumn(charts[0], free) : null
}
