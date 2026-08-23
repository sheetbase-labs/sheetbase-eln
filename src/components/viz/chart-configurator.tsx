import {
  BarChart3,
  Box,
  Grid3x3,
  LineChart as LineChartIcon,
  Plus,
  ScatterChart,
  Trash2,
} from 'lucide-react'
import type { ReactNode } from 'react'

import {
  Button,
  ButtonGroup,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  Select,
} from '#/components/ui'
import {
  CARTESIAN_CHART_TYPES,
  CHART_TYPES,
  HEATMAP_AGGREGATES,
  MAX_ANNOTATIONS,
} from '#/lib/chart-spec'
import type { ChartAnnotation, ChartSpec, FieldBinding } from '#/lib/chart-spec'
import type { ScientificTableWire } from '#/lib/scientific-sheet-data'

export interface ChartConfiguratorProps {
  table: ScientificTableWire
  spec: ChartSpec
  onSpecChange: (spec: ChartSpec) => void
  idPrefix?: string
}

/** Controlled chart authoring controls shared by every full-size chart surface. */
export function ChartConfigurator({
  table,
  spec,
  onSpecChange,
  idPrefix = 'chart',
}: ChartConfiguratorProps) {
  const numericColumns = table.columns.filter(
    (column) =>
      column.logical_type === 'decimal' || column.logical_type === 'integer',
  )
  const categoryColumns = table.columns.filter((column) =>
    ['category', 'text', 'boolean'].includes(column.logical_type),
  )
  const errorColumns = numericColumns.filter(
    (column) =>
      column.id !== spec.fields.x?.columnId &&
      column.id !== spec.fields.y.columnId &&
      /\b(sd|se|sem|error|ci|confidence|deviation)\b/i.test(
        `${column.label} ${column.field_name}`,
      ),
  )
  const aggregateTransform = spec.transformations.find(
    (transformation) => transformation.kind === 'aggregate',
  )
  const normaliseTransform = spec.transformations.find(
    (transformation) => transformation.kind === 'normalise',
  )

  function update(patch: Partial<ChartSpec>) {
    onSpecChange({ ...spec, ...patch })
  }

  const TYPE_ICONS: Record<ChartSpec['type'], ReactNode> = {
    line: <LineChartIcon className="size-3.5" aria-hidden />,
    scatter: <ScatterChart className="size-3.5" aria-hidden />,
    bar: <BarChart3 className="size-3.5" aria-hidden />,
    histogram: <BarChart3 className="size-3.5 rotate-90" aria-hidden />,
    box: <Box className="size-3.5" aria-hidden />,
    heatmap: <Grid3x3 className="size-3.5" aria-hidden />,
  }

  /** Switching types keeps the spec coherent: fields that carry no meaning
   * for the new type are cleared and stale type-specific params dropped. */
  function setType(next: ChartSpec['type']) {
    const fields = { ...spec.fields }
    let overlays = spec.overlays
    let typeParams: ChartSpec['typeParams'] = {}
    if (next === 'histogram' || next === 'box') {
      fields.x = null
      if (next === 'box') typeParams = { box: { showOutliers: true } }
      else typeParams = { histogram: { bins: 10 } }
    } else if (next === 'heatmap') {
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
    update({
      type: next,
      fields,
      overlays,
      typeParams,
      display,
    })
  }

  function updateHistogramParams(
    patch: Partial<{ bins: number; binWidth: number }>,
  ) {
    update({
      typeParams: {
        ...spec.typeParams,
        histogram: { ...(spec.typeParams.histogram ?? {}), ...patch },
      },
    })
  }

  function updateHeatmapParams(
    patch: Partial<NonNullable<ChartSpec['typeParams']['heatmap']>>,
  ) {
    update({
      typeParams: {
        ...spec.typeParams,
        heatmap: {
          aggregate: 'count',
          valueField: null,
          ...(spec.typeParams.heatmap ?? {}),
          ...patch,
        },
      },
    })
  }

  function setAnnotations(annotations: ChartAnnotation[]) {
    update({ display: { ...spec.display, annotations } })
  }

  function setField(
    key: 'x' | 'y' | 'series' | 'color' | 'size' | 'facet',
    columnId: string,
  ) {
    const column = table.columns.find((candidate) => candidate.id === columnId)
    const binding: FieldBinding | null = column
      ? { columnId: column.id, fieldName: column.field_name }
      : null
    const fields = { ...spec.fields, [key]: binding }
    const transformations = spec.transformations.map((transformation) => {
      if (transformation.kind === 'aggregate') {
        return {
          ...transformation,
          params: {
            ...transformation.params,
            xField: fields.x?.fieldName ?? null,
            yField: fields.y.fieldName,
            seriesField: fields.series?.fieldName ?? null,
          },
        }
      }
      if (transformation.kind === 'normalise') {
        return {
          ...transformation,
          params: {
            ...transformation.params,
            yField: fields.y.fieldName,
            seriesField: fields.series?.fieldName ?? null,
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
          label: column?.label ?? 'Row',
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
      (spec.overlays.errorBars.columnId === fields.x?.columnId ||
        spec.overlays.errorBars.columnId === fields.y.columnId)
        ? { ...spec.overlays, errorBars: null }
        : spec.overlays
    onSpecChange({ ...spec, fields, transformations, display, overlays })
  }

  function setTransformation(kind: 'aggregate' | 'normalise', value: string) {
    const others = spec.transformations.filter(
      (transformation) => transformation.kind !== kind,
    )
    if (!value) return update({ transformations: others })
    update({
      transformations: [
        ...others,
        kind === 'aggregate'
          ? {
              kind,
              params: {
                function: value,
                xField: spec.fields.x?.fieldName ?? null,
                yField: spec.fields.y.fieldName,
                seriesField: spec.fields.series?.fieldName ?? null,
              },
            }
          : {
              kind,
              params: {
                method: value,
                yField: spec.fields.y.fieldName,
                seriesField: spec.fields.series?.fieldName ?? null,
              },
            },
      ],
    })
  }

  function setErrorBarColumn(columnId: string) {
    if (!columnId) {
      return update({ overlays: { ...spec.overlays, errorBars: null } })
    }
    const column = errorColumns.find((candidate) => candidate.id === columnId)
    if (!column) return
    update({
      overlays: {
        ...spec.overlays,
        errorBars: {
          columnId: column.id,
          fieldName: column.field_name,
          basis: 'custom',
          multiplier: 1,
        },
      },
    })
  }

  // Histograms and box plots measure fields.y directly (no x mapping);
  // heatmaps use x/y as grid dimensions and never group by series.
  const showXField = spec.type !== 'histogram' && spec.type !== 'box'
  const showSeriesField = spec.type !== 'heatmap'
  const yLabel =
    spec.type === 'heatmap'
      ? 'Y dimension'
      : spec.type === 'histogram' || spec.type === 'box'
        ? 'Measured value'
        : 'Y-axis'
  const fields = [
    ...(showXField
      ? [
          {
            key: 'x' as const,
            label: 'X-axis',
            ariaLabel: 'X axis field',
            columns: numericColumns,
            empty: '(none — row index)',
            value: spec.fields.x?.columnId ?? '',
          },
        ]
      : []),
    {
      key: 'y' as const,
      label: yLabel,
      ariaLabel: 'Y axis field',
      columns: numericColumns,
      value: spec.fields.y.columnId,
    },
    ...(showSeriesField
      ? [
          {
            key: 'series' as const,
            label: 'Series',
            ariaLabel: 'Group by series',
            columns: categoryColumns,
            empty: 'No split',
            value: spec.fields.series?.columnId ?? '',
          },
        ]
      : []),
  ]

  return (
    <div
      className="shrink-0 space-y-2.5 border-b pb-3"
      aria-labelledby={`${idPrefix}-controls-title`}
    >
      <h2 id={`${idPrefix}-controls-title`} className="sr-only">
        Chart configuration
      </h2>
      <FieldGroup className="flex flex-wrap items-end gap-3">
        <Field className="min-w-fit shrink-0">
          <FieldLabel>Chart type</FieldLabel>
          <ButtonGroup role="radiogroup" aria-label="Chart type">
            {CHART_TYPES.map((type) => (
              <Button
                key={type}
                type="button"
                variant={spec.type === type ? 'default' : 'outline'}
                size="sm"
                role="radio"
                aria-checked={spec.type === type}
                onClick={() => setType(type)}
                className="gap-1.5 capitalize"
              >
                {TYPE_ICONS[type]}
                {type}
              </Button>
            ))}
          </ButtonGroup>
        </Field>
        {fields.map((field) => (
          <Field key={field.key} className="min-w-36 flex-1">
            <FieldLabel htmlFor={`${idPrefix}-${field.key}`}>
              {field.label}
            </FieldLabel>
            <Select
              id={`${idPrefix}-${field.key}`}
              aria-label={field.ariaLabel}
              value={field.value}
              onChange={(event) => setField(field.key, event.target.value)}
              className="h-8 bg-background"
            >
              {field.empty ? <option value="">{field.empty}</option> : null}
              {field.columns.map((column) => (
                <option key={column.id} value={column.id}>
                  {column.label}
                </option>
              ))}
            </Select>
          </Field>
        ))}
      </FieldGroup>
      <FieldGroup className="flex flex-wrap items-end gap-3 pt-2.5">
        <Field className="min-w-36 flex-1">
          <FieldLabel htmlFor={`${idPrefix}-aggregation`}>
            Aggregation
          </FieldLabel>
          <Select
            id={`${idPrefix}-aggregation`}
            aria-label="Aggregation function"
            value={
              typeof aggregateTransform?.params.function === 'string'
                ? aggregateTransform.params.function
                : ''
            }
            onChange={(event) =>
              setTransformation('aggregate', event.target.value)
            }
            className="h-8 bg-background"
          >
            <option value="">None (raw rows)</option>
            <option value="mean">Mean (by x)</option>
            <option value="sum">Sum (by x)</option>
            <option value="min">Minimum (by x)</option>
            <option value="max">Maximum (by x)</option>
            <option value="count">Count (by x)</option>
          </Select>
        </Field>
        <Field className="min-w-36 flex-1">
          <FieldLabel htmlFor={`${idPrefix}-normalisation`}>
            Normalisation
          </FieldLabel>
          <Select
            id={`${idPrefix}-normalisation`}
            aria-label="Normalisation method"
            value={
              typeof normaliseTransform?.params.method === 'string'
                ? normaliseTransform.params.method
                : ''
            }
            onChange={(event) =>
              setTransformation('normalise', event.target.value)
            }
            className="h-8 bg-background"
          >
            <option value="">None</option>
            <option value="percent_of_max">Percent of maximum</option>
            <option value="z_score">Z-score</option>
          </Select>
        </Field>
        {errorColumns.length ? (
          <Field className="min-w-40 flex-1">
            <FieldLabel htmlFor={`${idPrefix}-error-column`}>
              Error bars
            </FieldLabel>
            <Select
              id={`${idPrefix}-error-column`}
              aria-label="Error bar column"
              value={spec.overlays.errorBars?.columnId ?? ''}
              onChange={(event) => setErrorBarColumn(event.target.value)}
              className="h-8 bg-background"
            >
              <option value="">None</option>
              {errorColumns.map((column) => (
                <option key={column.id} value={column.id}>
                  {column.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </FieldGroup>
      {spec.type === 'histogram' ? (
        <FieldGroup className="flex flex-wrap items-end gap-3 pt-2.5">
          <Field className="min-w-32 flex-1">
            <FieldLabel htmlFor={`${idPrefix}-histogram-bins`}>Bins</FieldLabel>
            <Input
              id={`${idPrefix}-histogram-bins`}
              aria-label="Histogram bin count"
              type="number"
              min={1}
              max={200}
              value={
                spec.typeParams.histogram?.binWidth !== undefined
                  ? ''
                  : (spec.typeParams.histogram?.bins ?? 10)
              }
              onChange={(event) =>
                updateHistogramParams({
                  bins: Math.max(1, Number(event.target.value) || 1),
                  binWidth: undefined,
                })
              }
              className="h-8 bg-background"
            />
          </Field>
          <Field className="min-w-32 flex-1">
            <FieldLabel htmlFor={`${idPrefix}-histogram-bin-width`}>
              Bin width (overrides bins)
            </FieldLabel>
            <Input
              id={`${idPrefix}-histogram-bin-width`}
              aria-label="Histogram bin width"
              type="number"
              min={0}
              step="any"
              value={spec.typeParams.histogram?.binWidth ?? ''}
              onChange={(event) =>
                updateHistogramParams({
                  binWidth:
                    event.target.value === ''
                      ? undefined
                      : Number(event.target.value),
                })
              }
              className="h-8 bg-background"
            />
          </Field>
        </FieldGroup>
      ) : null}
      {spec.type === 'heatmap' ? (
        <FieldGroup className="flex flex-wrap items-end gap-3 pt-2.5">
          <Field className="min-w-36 flex-1">
            <FieldLabel htmlFor={`${idPrefix}-heatmap-aggregate`}>
              Cell value
            </FieldLabel>
            <Select
              id={`${idPrefix}-heatmap-aggregate`}
              aria-label="Heatmap cell aggregation"
              value={spec.typeParams.heatmap?.aggregate ?? 'count'}
              onChange={(event) => {
                const aggregate = event.target.value as NonNullable<
                  ChartSpec['typeParams']['heatmap']
                >['aggregate']
                updateHeatmapParams(
                  aggregate === 'count'
                    ? { aggregate, valueField: null }
                    : {
                        aggregate,
                        valueField:
                          spec.typeParams.heatmap?.valueField ?? spec.fields.y,
                      },
                )
              }}
              className="h-8 bg-background"
            >
              {HEATMAP_AGGREGATES.map((a) => (
                <option key={a} value={a}>
                  {a === 'count' ? 'Row count' : `${a} of value field`}
                </option>
              ))}
            </Select>
          </Field>
          {(spec.typeParams.heatmap?.aggregate ?? 'count') !== 'count' ? (
            <Field className="min-w-36 flex-1">
              <FieldLabel htmlFor={`${idPrefix}-heatmap-value-field`}>
                Value field
              </FieldLabel>
              <Select
                id={`${idPrefix}-heatmap-value-field`}
                aria-label="Heatmap value field"
                value={spec.typeParams.heatmap?.valueField?.columnId ?? ''}
                onChange={(event) => {
                  const column = table.columns.find(
                    (candidate) => candidate.id === event.target.value,
                  )
                  updateHeatmapParams({
                    valueField: column
                      ? { columnId: column.id, fieldName: column.field_name }
                      : null,
                  })
                }}
                className="h-8 bg-background"
              >
                <option value="">Select a numeric column</option>
                {numericColumns.map((column) => (
                  <option key={column.id} value={column.id}>
                    {column.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field className="min-w-24">
            <FieldLabel htmlFor={`${idPrefix}-heatmap-xbins`}>
              X bins
            </FieldLabel>
            <Input
              id={`${idPrefix}-heatmap-xbins`}
              aria-label="Heatmap x bin count"
              type="number"
              min={2}
              max={100}
              value={spec.typeParams.heatmap?.xBins ?? 10}
              onChange={(event) =>
                updateHeatmapParams({
                  xBins: Math.max(2, Number(event.target.value) || 10),
                })
              }
              className="h-8 bg-background"
            />
          </Field>
          <Field className="min-w-24">
            <FieldLabel htmlFor={`${idPrefix}-heatmap-ybins`}>
              Y bins
            </FieldLabel>
            <Input
              id={`${idPrefix}-heatmap-ybins`}
              aria-label="Heatmap y bin count"
              type="number"
              min={2}
              max={100}
              value={spec.typeParams.heatmap?.yBins ?? 10}
              onChange={(event) =>
                updateHeatmapParams({
                  yBins: Math.max(2, Number(event.target.value) || 10),
                })
              }
              className="h-8 bg-background"
            />
          </Field>
        </FieldGroup>
      ) : null}
      <FieldGroup className="flex flex-wrap items-end gap-3 pt-2.5">
        <Field className="min-w-40 flex-1">
          <FieldLabel htmlFor={`${idPrefix}-facet`}>
            Facet by (optional)
          </FieldLabel>
          <Select
            id={`${idPrefix}-facet`}
            aria-label="Facet column"
            value={spec.fields.facet?.columnId ?? ''}
            onChange={(event) => setField('facet', event.target.value)}
            className="h-8 bg-background"
          >
            <option value="">No facets</option>
            {categoryColumns.map((column) => (
              <option key={column.id} value={column.id}>
                {column.label}
              </option>
            ))}
          </Select>
        </Field>
      </FieldGroup>
      {CARTESIAN_CHART_TYPES.includes(spec.type) ? (
        <div className="space-y-2 pt-2.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">
              Annotations ({(spec.display.annotations ?? []).length}/
              {MAX_ANNOTATIONS})
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={
                (spec.display.annotations ?? []).length >= MAX_ANNOTATIONS
              }
              onClick={() =>
                setAnnotations([
                  ...(spec.display.annotations ?? []),
                  { x: 0, y: 0, label: 'New annotation' },
                ])
              }
            >
              <Plus /> Add annotation
            </Button>
          </div>
          {(spec.display.annotations ?? []).map((annotation, i) => (
            <div key={i} className="flex items-end gap-2">
              <Field className="w-20">
                <FieldLabel htmlFor={`${idPrefix}-ann-${i}-x`}>X</FieldLabel>
                <Input
                  id={`${idPrefix}-ann-${i}-x`}
                  aria-label={`Annotation ${i + 1} x`}
                  type="number"
                  step="any"
                  value={annotation.x}
                  onChange={(event) =>
                    setAnnotations(
                      (spec.display.annotations ?? []).map((a, j) =>
                        j === i ? { ...a, x: Number(event.target.value) } : a,
                      ),
                    )
                  }
                  className="h-8 bg-background"
                />
              </Field>
              <Field className="w-20">
                <FieldLabel htmlFor={`${idPrefix}-ann-${i}-y`}>Y</FieldLabel>
                <Input
                  id={`${idPrefix}-ann-${i}-y`}
                  aria-label={`Annotation ${i + 1} y`}
                  type="number"
                  step="any"
                  value={annotation.y}
                  onChange={(event) =>
                    setAnnotations(
                      (spec.display.annotations ?? []).map((a, j) =>
                        j === i ? { ...a, y: Number(event.target.value) } : a,
                      ),
                    )
                  }
                  className="h-8 bg-background"
                />
              </Field>
              <Field className="flex-1">
                <FieldLabel htmlFor={`${idPrefix}-ann-${i}-label`}>
                  Label
                </FieldLabel>
                <Input
                  id={`${idPrefix}-ann-${i}-label`}
                  aria-label={`Annotation ${i + 1} label`}
                  value={annotation.label}
                  onChange={(event) =>
                    setAnnotations(
                      (spec.display.annotations ?? []).map((a, j) =>
                        j === i ? { ...a, label: event.target.value } : a,
                      ),
                    )
                  }
                  className="h-8 bg-background"
                />
              </Field>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove annotation ${i + 1}`}
                onClick={() =>
                  setAnnotations(
                    (spec.display.annotations ?? []).filter((_, j) => j !== i),
                  )
                }
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
