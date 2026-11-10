import { t } from '#/copy'
import { CARTESIAN_CHART_TYPES } from '#/lib/chart-spec'
import type { ChartColumn, ChartSpec, FieldBinding } from '#/lib/chart-spec'

/** A type change clears only bindings and options the new type cannot use. */
export function changeAuthoringType(
  spec: ChartSpec,
  numericColumns: ChartColumn[],
  next: ChartSpec['type'],
): ChartSpec {
  const fields = { ...spec.fields }
  let overlays = spec.overlays
  let typeParams: ChartSpec['typeParams'] = {}

  if (
    next === 'histogram' ||
    next === 'box' ||
    next === 'violin' ||
    next === 'strip'
  ) {
    fields.x = next === 'strip' || next === 'violin' ? spec.fields.x : null

    if (next === 'box') typeParams = { box: { showOutliers: true } }
    else if (next === 'histogram') typeParams = { histogram: { bins: 10 } }
    else if (next === 'strip') typeParams = { strip: { jitter: 0.18 } }
    else typeParams = {}
  } else if (next === 'heatmap') {
    fields.x =
      fields.x ?? (numericColumns[0] ? { fieldId: numericColumns[0].id } : null)
    fields.series = null
    fields.color = null
    fields.size = null
    overlays = { errorBars: null }
    typeParams = {
      heatmap: { aggregate: 'count', valueField: null, xBins: 10, yBins: 10 },
    }
  }

  const display = CARTESIAN_CHART_TYPES.includes(next)
    ? spec.display
    : { ...spec.display, annotations: [] }

  return { ...spec, type: next, fields, overlays, typeParams, display }
}

/** Dropdowns and role assignment share this binding transition. */
export function changeAuthoringField(
  spec: ChartSpec,
  columns: ChartColumn[],
  key: 'x' | 'y' | 'series' | 'color' | 'size' | 'facet',
  fieldId: string,
): ChartSpec {
  const column = columns.find((candidate) => candidate.id === fieldId)
  const binding: FieldBinding | null = column ? { fieldId: column.id } : null
  const fields = { ...spec.fields, [key]: binding }

  const transformations = spec.transformations.map((transformation) => {
    if (transformation.kind === 'aggregate') {
      return {
        ...transformation,
        params: {
          ...transformation.params,
          xField: fields.x?.fieldId ?? null,
          yField: fields.y.fieldId,
          seriesField: fields.series?.fieldId ?? null,
        },
      }
    }

    if (transformation.kind === 'normalise') {
      return {
        ...transformation,
        params: {
          ...transformation.params,
          yField: fields.y.fieldId,
          seriesField: fields.series?.fieldId ?? null,
        },
      }
    }

    return transformation
  })

  const display = { ...spec.display }

  if (key === 'x') {
    display.axes = {
      ...display.axes,
      x: {
        ...display.axes.x,
        label: column?.label ?? t('data.chartConfigurator.row'),
        unit: column ? display.axes.x.unit : undefined,
      },
    }
  }

  if (key === 'y' && column) {
    display.axes = {
      ...display.axes,
      y: { ...display.axes.y, label: column.label },
    }
  }

  const overlays =
    spec.overlays.errorBars &&
    (spec.overlays.errorBars.fieldId === fields.x?.fieldId ||
      spec.overlays.errorBars.fieldId === fields.y.fieldId)
      ? { ...spec.overlays, errorBars: null }
      : spec.overlays

  return { ...spec, fields, transformations, display, overlays }
}
