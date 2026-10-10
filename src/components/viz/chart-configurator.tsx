import {
  BarChart3,
  Grid3x3,
  LineChart as LineChartIcon,
  ScatterChart,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'

import { Icon } from '#/components/icons'
import { Button } from '#/components/v3/ui/button'
import { Input } from '#/components/v3/ui/input'
import { NativeSelect } from '#/components/v3/projects/select'
import {
  CARTESIAN_CHART_TYPES,
  CHART_TYPES,
  CHART_TYPE_LABELS,
  HEATMAP_AGGREGATES,
  MAX_ANNOTATIONS,
} from '#/lib/chart-spec'
import type { ChartAnnotation, ChartSpec, FieldBinding } from '#/lib/chart-spec'
import type { CanonicalDatasetSource } from '#/lib/chart-data'
import { proposeChartSpec } from '#/lib/assist-drafts'
import type { AssistChartProposal } from '#/lib/assist-drafts'
import { DraftProposalPanel } from '#/components/assist/draft-proposal-panel'

export interface ChartConfiguratorProps {
  source: CanonicalDatasetSource
  spec: ChartSpec
  onSpecChange: (spec: ChartSpec) => void
  idPrefix?: string
  /** `rail` is a narrow stacked encoding column; `wrap` is the horizontal toolbar. */
  layout?: 'wrap' | 'rail'
}

/** Controlled chart authoring controls shared by every full-size chart surface. */
export function ChartConfigurator({
  source,
  spec,
  onSpecChange,
  idPrefix = 'chart',
  layout = 'wrap',
}: ChartConfiguratorProps) {
  const columns = source.columns
  const numericColumns = columns.filter(
    (column) =>
      column.logicalType === 'decimal' || column.logicalType === 'integer',
  )
  const categoryColumns = columns.filter((column) =>
    ['category', 'text', 'boolean'].includes(column.logicalType),
  )
  const errorColumns = numericColumns.filter(
    (column) =>
      column.id !== spec.fields.x?.fieldId &&
      column.id !== spec.fields.y.fieldId &&
      /\b(sd|se|sem|error|ci|confidence|deviation)\b/i.test(column.label),
  )
  const aggregateTransform = spec.transformations.find(
    (transformation) => transformation.kind === 'aggregate',
  )
  const normaliseTransform = spec.transformations.find(
    (transformation) => transformation.kind === 'normalise',
  )
  // ASSIST-02: deterministic chart-config proposal from the current
  // dataset/fields. Previewed in DraftProposalPanel; Accept loads the spec
  // through the ordinary onSpecChange; Discard leaves zero state.
  const [chartProposal, setChartProposal] =
    useState<AssistChartProposal | null>(null)
  const [proposalStatus, setProposalStatus] = useState('')

  function proposeFromDataset() {
    const proposal = proposeChartSpec({
      datasetId: source.datasetId,
      fields: source.columns.map((column) => ({
        fieldId: column.id,
        label: column.label,
        logicalType: column.logicalType,
      })),
    })
    setChartProposal(proposal)
    setProposalStatus(
      proposal
        ? ''
        : 'No suggestion available for these fields — configure the chart by hand.',
    )
  }

  function update(patch: Partial<ChartSpec>) {
    onSpecChange({ ...spec, ...patch })
  }

  const TYPE_ICONS: Record<ChartSpec['type'], ReactNode> = {
    line: <LineChartIcon className="size-3.5" aria-hidden />,
    scatter: <ScatterChart className="size-3.5" aria-hidden />,
    scatter_line: <ScatterChart className="size-3.5" aria-hidden />,
    connected_scatter: <LineChartIcon className="size-3.5" aria-hidden />,
    bar: <BarChart3 className="size-3.5" aria-hidden />,
    grouped_bar: <BarChart3 className="size-3.5" aria-hidden />,
    stacked_bar: <BarChart3 className="size-3.5" aria-hidden />,
    histogram: <BarChart3 className="size-3.5 rotate-90" aria-hidden />,
    box: <Icon name="box" className="size-3.5" aria-hidden />,
    violin: <Icon name="box" className="size-3.5" aria-hidden />,
    strip: <ScatterChart className="size-3.5" aria-hidden />,
    summary: <BarChart3 className="size-3.5" aria-hidden />,
    heatmap: <Grid3x3 className="size-3.5" aria-hidden />,
  }

  /** Switching types keeps the spec coherent: fields that carry no meaning
   * for the new type are cleared and stale type-specific params dropped. */
  function setType(next: ChartSpec['type']) {
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
    fieldId: string,
  ) {
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
      (spec.overlays.errorBars.fieldId === fields.x?.fieldId ||
        spec.overlays.errorBars.fieldId === fields.y.fieldId)
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
                xField: spec.fields.x?.fieldId ?? null,
                yField: spec.fields.y.fieldId,
                seriesField: spec.fields.series?.fieldId ?? null,
              },
            }
          : {
              kind,
              params: {
                method: value,
                yField: spec.fields.y.fieldId,
                seriesField: spec.fields.series?.fieldId ?? null,
              },
            },
      ],
    })
  }

  function setErrorBarColumn(fieldId: string) {
    if (!fieldId) {
      return update({ overlays: { ...spec.overlays, errorBars: null } })
    }
    const column = errorColumns.find((candidate) => candidate.id === fieldId)
    if (!column) return
    update({
      overlays: {
        ...spec.overlays,
        errorBars: {
          fieldId: column.id,
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
            value: spec.fields.x?.fieldId ?? '',
          },
        ]
      : []),
    {
      key: 'y' as const,
      label: yLabel,
      ariaLabel: 'Y axis field',
      columns: numericColumns,
      value: spec.fields.y.fieldId,
    },
    ...(showSeriesField
      ? [
          {
            key: 'series' as const,
            label: 'Series',
            ariaLabel: 'Group by series',
            columns: categoryColumns,
            empty: 'No split',
            value: spec.fields.series?.fieldId ?? '',
          },
        ]
      : []),
  ]

  const typeButtons = CHART_TYPES.map((type) => (
    <Button
      key={type}
      type="button"
      variant={spec.type === type ? 'primary' : 'secondary'}
      size={layout === 'rail' ? 'icon' : 'sm'}
      role="radio"
      aria-checked={spec.type === type}
      aria-label={CHART_TYPE_LABELS[type]}
      title={CHART_TYPE_LABELS[type]}
      onClick={() => setType(type)}
      className={layout === 'rail' ? undefined : 'gap-1.5'}
    >
      {TYPE_ICONS[type]}
      {layout === 'rail' ? null : CHART_TYPE_LABELS[type]}
    </Button>
  ))

  return (
    <div
      className={
        layout === 'rail'
          ? 'space-y-2.5 p-2'
          : 'shrink-0 space-y-2.5 border-b pb-3'
      }
      aria-labelledby={`${idPrefix}-controls-title`}
    >
      <h2 id={`${idPrefix}-controls-title`} className="sr-only">
        Chart configuration
      </h2>
      <div className="flex flex-wrap items-center gap-2" data-print-hide>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={proposeFromDataset}
        >
          Propose chart
        </Button>
        {proposalStatus ? (
          <p className="text-xs text-fg-muted">{proposalStatus}</p>
        ) : null}
      </div>
      {chartProposal ? (
        <DraftProposalPanel
          proposal={chartProposal}
          onAccept={() => {
            onSpecChange(chartProposal.spec)
            setChartProposal(null)
          }}
          onDiscard={() => setChartProposal(null)}
        />
      ) : null}
      <div
        className={
          layout === 'rail'
            ? 'flex flex-col gap-3'
            : 'flex flex-wrap items-end gap-3'
        }
      >
        <div className={layout === 'rail' ? 'w-full' : 'min-w-fit shrink-0'}>
          <label className="text-label text-fg-muted">Chart type</label>
          {layout === 'rail' ? (
            <div
              role="radiogroup"
              aria-label="Chart type"
              className="grid grid-cols-4 gap-1"
            >
              {typeButtons}
            </div>
          ) : (
            <div
              role="radiogroup"
              aria-label="Chart type"
              className="flex items-center gap-1"
            >
              {typeButtons}
            </div>
          )}
        </div>
        {fields.map((field) => (
          <div
            key={field.key}
            className={layout === 'rail' ? 'w-full' : 'min-w-36 flex-1'}
          >
            <label
              className="text-label text-fg-muted"
              htmlFor={`${idPrefix}-${field.key}`}
            >
              {field.label}
            </label>
            <NativeSelect
              id={`${idPrefix}-${field.key}`}
              aria-label={field.ariaLabel}
              value={field.value}
              onChange={(event) => setField(field.key, event.target.value)}
              className="h-8 bg-surface"
            >
              {field.empty ? <option value="">{field.empty}</option> : null}
              {field.columns.map((column) => (
                <option key={column.id} value={column.id}>
                  {column.label}
                </option>
              ))}
            </NativeSelect>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3 pt-2.5">
        <div className="min-w-36 flex-1">
          <label
            className="text-label text-fg-muted"
            htmlFor={`${idPrefix}-aggregation`}
          >
            Aggregation
          </label>
          <NativeSelect
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
            className="h-8 bg-surface"
          >
            <option value="">None (raw rows)</option>
            <option value="mean">Mean (by x)</option>
            <option value="sum">Sum (by x)</option>
            <option value="min">Minimum (by x)</option>
            <option value="max">Maximum (by x)</option>
            <option value="count">Count (by x)</option>
          </NativeSelect>
        </div>
        <div className="min-w-36 flex-1">
          <label
            className="text-label text-fg-muted"
            htmlFor={`${idPrefix}-normalisation`}
          >
            Normalisation
          </label>
          <NativeSelect
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
            className="h-8 bg-surface"
          >
            <option value="">None</option>
            <option value="percent_of_max">Percent of maximum</option>
            <option value="z_score">Z-score</option>
          </NativeSelect>
        </div>
        {errorColumns.length ? (
          <div className="min-w-40 flex-1">
            <label
              className="text-label text-fg-muted"
              htmlFor={`${idPrefix}-error-column`}
            >
              Error bars
            </label>
            <NativeSelect
              id={`${idPrefix}-error-column`}
              aria-label="Error bar column"
              value={spec.overlays.errorBars?.fieldId ?? ''}
              onChange={(event) => setErrorBarColumn(event.target.value)}
              className="h-8 bg-surface"
            >
              <option value="">None</option>
              {errorColumns.map((column) => (
                <option key={column.id} value={column.id}>
                  {column.label}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-end gap-3 pt-2.5">
        <div className="min-w-36 flex-1">
          <label
            className="text-label text-fg-muted"
            htmlFor={`${idPrefix}-fit`}
          >
            Linear fit
          </label>
          <NativeSelect
            id={`${idPrefix}-fit`}
            aria-label="Linear fit"
            value={spec.overlays.fit?.method === 'ols' ? 'ols' : ''}
            onChange={(event) =>
              update({
                overlays: {
                  ...spec.overlays,
                  fit:
                    event.target.value === 'ols'
                      ? {
                          method: 'ols',
                          degree: 1,
                          showBand: true,
                          showEquation: true,
                        }
                      : null,
                },
              })
            }
            className="h-8 bg-surface"
          >
            <option value="">None</option>
            <option value="ols">OLS linear</option>
          </NativeSelect>
        </div>
        <div className="min-w-36 flex-1">
          <label
            className="text-label text-fg-muted"
            htmlFor={`${idPrefix}-error-source`}
          >
            Interval
          </label>
          <NativeSelect
            id={`${idPrefix}-error-source`}
            aria-label="Error bar interval"
            value={
              spec.overlays.errorBars?.source === 'computed'
                ? spec.overlays.errorBars.basis
                : spec.overlays.errorBars?.fieldId
                  ? 'field'
                  : ''
            }
            onChange={(event) => {
              const value = event.target.value
              if (!value)
                return update({
                  overlays: { ...spec.overlays, errorBars: null },
                })
              if (value === 'field') return
              update({
                overlays: {
                  ...spec.overlays,
                  errorBars: {
                    source: 'computed',
                    basis: value as 'sd' | 'sem' | 'ci',
                    multiplier: 1,
                    statistic: 'mean',
                  },
                },
              })
            }}
            className="h-8 bg-surface"
          >
            <option value="">None</option>
            <option value="sd">Grouped SD</option>
            <option value="sem">Grouped SEM</option>
            <option value="ci">Grouped 95% CI</option>
            <option value="field">Explicit field</option>
          </NativeSelect>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3 pt-2.5">
        <div className="min-w-36 flex-1">
          <label
            className="text-label text-fg-muted"
            htmlFor={`${idPrefix}-ref-hline`}
          >
            Horizontal reference
          </label>
          <Input
            id={`${idPrefix}-ref-hline`}
            aria-label="Horizontal reference"
            type="number"
            step="any"
            value={
              spec.overlays.references?.find((item) => item.kind === 'hline')
                ?.value ?? ''
            }
            onChange={(event) => {
              const existing = (spec.overlays.references ?? []).filter(
                (item) => item.kind !== 'hline',
              )
              if (event.target.value === '') {
                update({
                  overlays: { ...spec.overlays, references: existing },
                })
                return
              }
              update({
                overlays: {
                  ...spec.overlays,
                  references: [
                    ...existing,
                    {
                      kind: 'hline',
                      value: Number(event.target.value),
                      label: 'reference',
                    },
                  ],
                },
              })
            }}
            className="h-8 bg-surface"
            placeholder="None"
          />
        </div>
      </div>
      {spec.type === 'histogram' ? (
        <div className="flex flex-wrap items-end gap-3 pt-2.5">
          <div className="min-w-32 flex-1">
            <label
              className="text-label text-fg-muted"
              htmlFor={`${idPrefix}-histogram-bins`}
            >
              Bins
            </label>
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
              className="h-8 bg-surface"
            />
          </div>
          <div className="min-w-32 flex-1">
            <label
              className="text-label text-fg-muted"
              htmlFor={`${idPrefix}-histogram-bin-width`}
            >
              Bin width (overrides bins)
            </label>
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
              className="h-8 bg-surface"
            />
          </div>
        </div>
      ) : null}
      {spec.type === 'heatmap' ? (
        <div className="flex flex-wrap items-end gap-3 pt-2.5">
          <div className="min-w-36 flex-1">
            <label
              className="text-label text-fg-muted"
              htmlFor={`${idPrefix}-heatmap-aggregate`}
            >
              Cell value
            </label>
            <NativeSelect
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
              className="h-8 bg-surface"
            >
              {HEATMAP_AGGREGATES.map((a) => (
                <option key={a} value={a}>
                  {a === 'count' ? 'Row count' : `${a} of value field`}
                </option>
              ))}
            </NativeSelect>
          </div>
          {(spec.typeParams.heatmap?.aggregate ?? 'count') !== 'count' ? (
            <div className="min-w-36 flex-1">
              <label
                className="text-label text-fg-muted"
                htmlFor={`${idPrefix}-heatmap-value-field`}
              >
                Value field
              </label>
              <NativeSelect
                id={`${idPrefix}-heatmap-value-field`}
                aria-label="Heatmap value field"
                value={spec.typeParams.heatmap?.valueField?.fieldId ?? ''}
                onChange={(event) => {
                  const column = source.columns.find(
                    (candidate) => candidate.id === event.target.value,
                  )
                  updateHeatmapParams({
                    valueField: column ? { fieldId: column.id } : null,
                  })
                }}
                className="h-8 bg-surface"
              >
                <option value="">Select a numeric column</option>
                {numericColumns.map((column) => (
                  <option key={column.id} value={column.id}>
                    {column.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null}
          <div className="min-w-24">
            <label
              className="text-label text-fg-muted"
              htmlFor={`${idPrefix}-heatmap-xbins`}
            >
              X bins
            </label>
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
              className="h-8 bg-surface"
            />
          </div>
          <div className="min-w-24">
            <label
              className="text-label text-fg-muted"
              htmlFor={`${idPrefix}-heatmap-ybins`}
            >
              Y bins
            </label>
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
              className="h-8 bg-surface"
            />
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-end gap-3 pt-2.5">
        <div className="min-w-40 flex-1">
          <label
            className="text-label text-fg-muted"
            htmlFor={`${idPrefix}-facet`}
          >
            Facet by (optional)
          </label>
          <NativeSelect
            id={`${idPrefix}-facet`}
            aria-label="Facet column"
            value={spec.fields.facet?.fieldId ?? ''}
            onChange={(event) => setField('facet', event.target.value)}
            className="h-8 bg-surface"
          >
            <option value="">No facets</option>
            {categoryColumns.map((column) => (
              <option key={column.id} value={column.id}>
                {column.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      {CARTESIAN_CHART_TYPES.includes(spec.type) ? (
        <div className="space-y-2 pt-2.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-fg-muted">
              Annotations ({(spec.display.annotations ?? []).length}/
              {MAX_ANNOTATIONS})
            </p>
            <Button
              type="button"
              variant="secondary"
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
              <Icon name="plus" /> Add annotation
            </Button>
          </div>
          {(spec.display.annotations ?? []).map((annotation, i) => (
            <div key={i} className="flex items-end gap-2">
              <div className="w-20">
                <label
                  className="text-label text-fg-muted"
                  htmlFor={`${idPrefix}-ann-${i}-x`}
                >
                  X
                </label>
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
                  className="h-8 bg-surface"
                />
              </div>
              <div className="w-20">
                <label
                  className="text-label text-fg-muted"
                  htmlFor={`${idPrefix}-ann-${i}-y`}
                >
                  Y
                </label>
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
                  className="h-8 bg-surface"
                />
              </div>
              <div className="flex-1">
                <label
                  className="text-label text-fg-muted"
                  htmlFor={`${idPrefix}-ann-${i}-label`}
                >
                  Label
                </label>
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
                  className="h-8 bg-surface"
                />
              </div>
              <Button
                type="button"
                variant="quiet"
                size="icon"
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
