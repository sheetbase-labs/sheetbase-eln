/**
 * Publication figure controls: the axis titles, units and ranges, the legend
 * and the caption of a chart spec. Each helper returns a new spec; the display
 * block is the figure's single description, so what is set here is what the
 * live chart, a saved view and an exported figure all read.
 */
import type { ChartSpec, LegendPosition } from '#/lib/chart-spec'

export type FigureAxis = 'x' | 'y'

/** Text from a field: blank means "unset", so the default title returns. */
function textOrUndefined(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

/** A number from a field, or undefined when blank or not a finite number. */
export function parseRangeBound(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function setAxisTitle(
  spec: ChartSpec,
  axis: FigureAxis,
  title: string,
): ChartSpec {
  return withAxis(spec, axis, { label: textOrUndefined(title) })
}

export function setAxisUnit(
  spec: ChartSpec,
  axis: FigureAxis,
  unit: string,
): ChartSpec {
  return withAxis(spec, axis, { unit: textOrUndefined(unit) })
}

export function setAxisBound(
  spec: ChartSpec,
  axis: FigureAxis,
  bound: 'min' | 'max',
  value: string,
): ChartSpec {
  return withAxis(spec, axis, { [bound]: parseRangeBound(value) })
}

/** Why the axis range cannot be drawn, or null when it can. */
export function axisRangeProblem(
  spec: ChartSpec,
  axis: FigureAxis,
): string | null {
  const { min, max, scale } = spec.display.axes[axis]
  if (min !== undefined && max !== undefined && min >= max)
    return 'The minimum must be below the maximum.'
  if (scale === 'log' && ((min ?? 1) <= 0 || (max ?? 1) <= 0))
    return 'A logarithmic axis needs a positive range.'
  return null
}

export function setLegendVisible(spec: ChartSpec, visible: boolean): ChartSpec {
  return {
    ...spec,
    display: {
      ...spec.display,
      legend: { ...spec.display.legend, visible },
    },
  }
}

export function setLegendPosition(
  spec: ChartSpec,
  position: LegendPosition,
): ChartSpec {
  return {
    ...spec,
    display: {
      ...spec.display,
      legend: { visible: position !== 'hidden', position },
    },
  }
}

export function setCaption(spec: ChartSpec, caption: string): ChartSpec {
  return {
    ...spec,
    display: { ...spec.display, caption: textOrUndefined(caption) },
  }
}

/** Whether the figure's legend is shown: on unless the spec says it is not. */
export function legendShown(spec: ChartSpec | null | undefined): boolean {
  const legend = spec?.display.legend
  return legend?.visible !== false && legend?.position !== 'hidden'
}

function withAxis(
  spec: ChartSpec,
  axis: FigureAxis,
  patch: Partial<ChartSpec['display']['axes']['x']>,
): ChartSpec {
  return {
    ...spec,
    display: {
      ...spec.display,
      axes: {
        ...spec.display.axes,
        [axis]: { ...spec.display.axes[axis], ...patch },
      },
    },
  }
}
