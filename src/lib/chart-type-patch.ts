import type { ChartSpec, ChartType } from './chart-spec'

/**
 * What changes in a chart spec when its type changes: fields and options that
 * mean nothing for the new type are cleared. The chart trigger refuses a spec
 * that keeps them, and `tests/db/chart-type-patch.test.ts` feeds every type
 * through it.
 */
export function chartTypePatch(spec: ChartSpec, next: ChartType): Partial<ChartSpec> {
  const fields = { ...spec.fields }
  let overlays = spec.overlays
  let typeParams: ChartSpec['typeParams'] = {}

  if (next === 'histogram' || next === 'box') {
    fields.x = null
    typeParams =
      next === 'box'
        ? { box: { showOutliers: true } }
        : { histogram: { bins: 10 } }
  } else if (next === 'heatmap') {
    fields.series = null
    fields.color = null
    fields.size = null
    overlays = { errorBars: null }
    typeParams = {
      heatmap: { aggregate: 'count', valueField: null, xBins: 10, yBins: 10 },
    }
  }

  const display = ['line', 'scatter', 'bar'].includes(next)
    ? spec.display
    : { ...spec.display, annotations: [] }

  return { type: next, fields, overlays, typeParams, display }
}
