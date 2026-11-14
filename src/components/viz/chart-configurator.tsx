import { SearchableSelect } from '#/components/record-picker/searchable-select'
import type { ReactNode } from 'react'

import { t } from '#/copy'
import { Icon } from '#/components/icons'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import {
  CARTESIAN_CHART_TYPES,
  CHART_TYPES,
  CHART_TYPE_LABELS,
  HEATMAP_AGGREGATES,
  MAX_ANNOTATIONS,
  chartStringParameter,
} from '#/lib/chart-spec'
import {
  ROLE_SPEC_KEY,
  columnsForRole,
  isCategoryColumn,
  isMeasuredColumn,
} from '#/lib/chart-encodings'
import type { ChartRole } from '#/lib/chart-encodings'
import { ChartEncodingEditor } from '#/components/viz/chart-encodings'
import type { ChartAnnotation, ChartSpec } from '#/lib/chart-spec'
import type { CanonicalDatasetSource } from '#/lib/chart-data'
import { AuthoringProposal } from './authoring-proposal'
import { changeAuthoringField, changeAuthoringType } from './authoring-spec'

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
  function assignRole(role: ChartRole, fieldId: string | null) {
    onSpecChange(
      changeAuthoringField(
        spec,
        source.columns,
        ROLE_SPEC_KEY[role],
        fieldId ?? '',
      ),
    )
  }

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
        {t('data.chartConfigurator.chartConfiguration')}
      </h2>
      <AuthoringProposal source={source} onSpecChange={onSpecChange} />
      <AuthoringBindings
        source={source}
        spec={spec}
        onSpecChange={onSpecChange}
        idPrefix={idPrefix}
        layout={layout}
      />
      <AuthoringStatistics
        source={source}
        spec={spec}
        onSpecChange={onSpecChange}
        idPrefix={idPrefix}
      />
      <AuthoringOverlays
        source={source}
        spec={spec}
        onSpecChange={onSpecChange}
        idPrefix={idPrefix}
      />
      <AuthoringTypeParams
        source={source}
        spec={spec}
        onSpecChange={onSpecChange}
        idPrefix={idPrefix}
      />
      <div className="flex flex-wrap items-end gap-3 pt-2.5">
        <div className="min-w-40 flex-1">
          <label
            className="text-label text-fg-muted"
            htmlFor={`${idPrefix}-facet`}
          >
            {t('data.chartConfigurator.facetOptional')}
          </label>
          <SearchableSelect
            noun="column"
            id={`${idPrefix}-facet`}
            aria-label={t('data.chartConfigurator.ariaFacetColumn')}
            value={spec.fields.facet?.fieldId ?? ''}
            onValueChange={(value) =>
              onSpecChange(
                changeAuthoringField(spec, source.columns, 'facet', value),
              )
            }
            className="h-8 bg-surface"
          >
            <option value="">{t('data.chartConfigurator.noFacets')}</option>
            {columnsForRole('facet', source.columns, spec.type).map(
              (column) => (
                <option key={column.id} value={column.id}>
                  {column.label}
                </option>
              ),
            )}
          </SearchableSelect>
        </div>
      </div>
      <div className="pt-2.5">
        <ChartEncodingEditor
          idPrefix={`${idPrefix}-enc`}
          columns={source.columns}
          spec={spec}
          onAssign={assignRole}
        />
      </div>
      <AuthoringAnnotations
        spec={spec}
        onSpecChange={onSpecChange}
        idPrefix={idPrefix}
      />
    </div>
  )
}

function AuthoringBindings({
  source,
  spec,
  onSpecChange,
  idPrefix = 'chart',
  layout = 'wrap',
}: ChartConfiguratorProps) {
  const columns = source.columns
  const numericColumns = columns.filter(isMeasuredColumn)
  const categoryColumns = columns.filter(isCategoryColumn)

  const TYPE_ICONS: Record<ChartSpec['type'], ReactNode> = {
    line: <Icon name="lineChart" className="size-3.5" aria-hidden />,
    scatter: <Icon name="scatter" className="size-3.5" aria-hidden />,
    scatter_line: <Icon name="scatter" className="size-3.5" aria-hidden />,
    connected_scatter: (
      <Icon name="lineChart" className="size-3.5" aria-hidden />
    ),
    bar: <Icon name="barChart" className="size-3.5" aria-hidden />,
    grouped_bar: <Icon name="barChart" className="size-3.5" aria-hidden />,
    stacked_bar: <Icon name="barChart" className="size-3.5" aria-hidden />,
    histogram: (
      <Icon name="barChart" className="size-3.5 rotate-90" aria-hidden />
    ),
    box: <Icon name="box" className="size-3.5" aria-hidden />,
    violin: <Icon name="box" className="size-3.5" aria-hidden />,
    strip: <Icon name="scatter" className="size-3.5" aria-hidden />,
    summary: <Icon name="barChart" className="size-3.5" aria-hidden />,
    heatmap: <Icon name="grid" className="size-3.5" aria-hidden />,
  }

  /** Switching types keeps the spec coherent: fields that carry no meaning
   * for the new type are cleared and stale type-specific params dropped. */
  function setType(next: ChartSpec['type']) {
    onSpecChange(changeAuthoringType(spec, numericColumns, next))
  }

  function setField(
    key: 'x' | 'y' | 'series' | 'color' | 'size' | 'facet',
    fieldId: string,
  ) {
    onSpecChange(changeAuthoringField(spec, columns, key, fieldId))
  }

  // Histograms and box plots measure fields.y directly (no x mapping);
  // heatmaps use x/y as grid dimensions and never group by series.
  const showXField = spec.type !== 'histogram' && spec.type !== 'box'
  const showSeriesField = spec.type !== 'heatmap'

  const yLabel =
    spec.type === 'heatmap'
      ? t('data.chartConfigurator.yDimension')
      : spec.type === 'histogram' || spec.type === 'box'
        ? t('data.chartConfigurator.measuredValue')
        : 'Y-axis'

  const fields = [
    ...(showXField
      ? [
          {
            key: 'x' as const,
            label: t('data.chartConfigurator.xAxis'),
            ariaLabel: t('data.chartConfigurator.xAxisField'),
            columns: columnsForRole('x', columns, spec.type),
            empty: t('data.chartConfigurator.noneRowIndex'),
            value: spec.fields.x?.fieldId ?? '',
          },
        ]
      : []),
    {
      key: 'y' as const,
      label: yLabel,
      ariaLabel: t('data.chartConfigurator.yAxisField'),
      columns: columnsForRole('y', columns, spec.type),
      value: spec.fields.y.fieldId,
    },
    ...(showSeriesField
      ? [
          {
            key: 'series' as const,
            label: t('data.chartConfigurator.series'),
            ariaLabel: t('data.chartConfigurator.groupSeries'),
            columns: categoryColumns,
            empty: t('data.chartConfigurator.noSplit'),
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
      data-chart-encoding-fields
      className={
        layout === 'rail'
          ? 'flex flex-col gap-3'
          : 'flex flex-wrap items-end gap-3'
      }
    >
      <div className={layout === 'rail' ? 'w-full' : 'min-w-fit shrink-0'}>
        <span
          id={`${idPrefix}-type-label`}
          className="text-label text-fg-muted"
        >
          {t('data.chartConfigurator.chartType')}
        </span>
        {layout === 'rail' ? (
          <div
            role="radiogroup"
            aria-labelledby={`${idPrefix}-type-label`}
            className="grid grid-cols-4 gap-1"
          >
            {typeButtons}
          </div>
        ) : (
          <div
            role="radiogroup"
            aria-labelledby={`${idPrefix}-type-label`}
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
          <SearchableSelect
            noun="column"
            id={`${idPrefix}-${field.key}`}
            aria-label={field.ariaLabel}
            value={field.value}
            onValueChange={(value) => setField(field.key, value)}
            className="h-8 bg-surface"
          >
            {field.empty ? <option value="">{field.empty}</option> : null}
            {field.columns.map((column) => (
              <option key={column.id} value={column.id}>
                {column.label}
              </option>
            ))}
          </SearchableSelect>
        </div>
      ))}
    </div>
  )
}

/** Error columns are shared by the explicit interval and statistics controls. */
function authoringErrorColumns(
  source: CanonicalDatasetSource,
  spec: ChartSpec,
) {
  return source.columns.filter(
    (column) =>
      isMeasuredColumn(column) &&
      column.id !== spec.fields.x?.fieldId &&
      column.id !== spec.fields.y.fieldId &&
      /\b(sd|se|sem|error|ci|confidence|deviation)\b/i.test(column.label),
  )
}

function AuthoringStatistics({
  source,
  spec,
  onSpecChange,
  idPrefix,
}: ChartConfiguratorProps) {
  const errorColumns = authoringErrorColumns(source, spec)

  const aggregateTransform = spec.transformations.find(
    (transformation) => transformation.kind === 'aggregate',
  )

  const normaliseTransform = spec.transformations.find(
    (transformation) => transformation.kind === 'normalise',
  )

  function setTransformation(kind: 'aggregate' | 'normalise', value: string) {
    const others = spec.transformations.filter(
      (transformation) => transformation.kind !== kind,
    )

    if (!value) return onSpecChange({ ...spec, transformations: others })
    onSpecChange({
      ...spec,
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
    const next = changeAuthoringErrorColumn(spec, errorColumns, fieldId)

    if (next !== spec) onSpecChange(next)
  }

  return (
    <div className="flex flex-wrap items-end gap-3 pt-2.5">
      <div className="min-w-36 flex-1">
        <label
          className="text-label text-fg-muted"
          htmlFor={`${idPrefix}-aggregation`}
        >
          {t('data.chartConfigurator.aggregation')}
        </label>
        <Select
          id={`${idPrefix}-aggregation`}
          aria-label={t('data.chartConfigurator.ariaAggregationFunction')}
          value={chartStringParameter(aggregateTransform?.params.function)}
          onChange={(event) =>
            setTransformation('aggregate', event.target.value)
          }
          className="h-8 bg-surface"
        >
          <option value="">{t('data.chartConfigurator.noneRawRows')}</option>
          <option value="mean">{t('data.chartConfigurator.meanX')}</option>
          <option value="sum">{t('data.chartConfigurator.sumX')}</option>
          <option value="min">{t('data.chartConfigurator.minimumX')}</option>
          <option value="max">{t('data.chartConfigurator.maximumX')}</option>
          <option value="count">{t('data.chartConfigurator.countX')}</option>
        </Select>
      </div>
      <div className="min-w-36 flex-1">
        <label
          className="text-label text-fg-muted"
          htmlFor={`${idPrefix}-normalisation`}
        >
          {t('data.chartConfigurator.normalisation')}
        </label>
        <Select
          id={`${idPrefix}-normalisation`}
          aria-label={t('data.chartConfigurator.ariaNormalisationMethod')}
          value={chartStringParameter(normaliseTransform?.params.method)}
          onChange={(event) =>
            setTransformation('normalise', event.target.value)
          }
          className="h-8 bg-surface"
        >
          <option value="">{t('common.states.none')}</option>
          <option value="percent_of_max">
            {t('data.chartConfigurator.percentMaximum')}
          </option>
          <option value="z_score">{t('data.chartConfigurator.zScore')}</option>
        </Select>
      </div>
      {errorColumns.length ? (
        <div className="min-w-40 flex-1">
          <label
            className="text-label text-fg-muted"
            htmlFor={`${idPrefix}-error-column`}
          >
            {t('data.chartConfigurator.errorBars')}
          </label>
          <SearchableSelect
            noun="column"
            id={`${idPrefix}-error-column`}
            aria-label={t('data.chartConfigurator.ariaErrorBarColumn')}
            value={spec.overlays.errorBars?.fieldId ?? ''}
            onValueChange={(value) => setErrorBarColumn(value)}
            className="h-8 bg-surface"
          >
            <option value="">{t('common.states.none')}</option>
            {errorColumns.map((column) => (
              <option key={column.id} value={column.id}>
                {column.label}
              </option>
            ))}
          </SearchableSelect>
        </div>
      ) : null}
    </div>
  )
}

function changeAuthoringErrorColumn(
  spec: ChartSpec,
  columns: CanonicalDatasetSource['columns'],
  fieldId: string,
): ChartSpec {
  if (!fieldId)
    return { ...spec, overlays: { ...spec.overlays, errorBars: null } }

  const column = columns.find((candidate) => candidate.id === fieldId)

  if (!column) return spec

  return {
    ...spec,
    overlays: {
      ...spec.overlays,
      errorBars: { fieldId: column.id, basis: 'custom', multiplier: 1 },
    },
  }
}

function AuthoringOverlays({
  source,
  spec,
  onSpecChange,
  idPrefix,
}: ChartConfiguratorProps) {
  const errorColumns = authoringErrorColumns(source, spec)

  function update(patch: Partial<ChartSpec>) {
    onSpecChange({ ...spec, ...patch })
  }

  function setErrorBarColumn(fieldId: string) {
    const next = changeAuthoringErrorColumn(spec, errorColumns, fieldId)

    if (next !== spec) onSpecChange(next)
  }

  return (
    <>
      <div className="flex flex-wrap items-end gap-3 pt-2.5">
        <div className="min-w-36 flex-1">
          <label
            className="text-label text-fg-muted"
            htmlFor={`${idPrefix}-fit`}
          >
            {t('data.chartConfigurator.linearFit')}
          </label>
          <Select
            id={`${idPrefix}-fit`}
            aria-label={t('data.chartConfigurator.linearFit')}
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
            <option value="">{t('common.states.none')}</option>
            <option value="ols">{t('data.chartConfigurator.olsLinear')}</option>
          </Select>
        </div>
        <div className="min-w-36 flex-1">
          <label
            className="text-label text-fg-muted"
            htmlFor={`${idPrefix}-error-source`}
          >
            {t('data.chartConfigurator.interval')}
          </label>
          <Select
            id={`${idPrefix}-error-source`}
            aria-label={t('data.chartConfigurator.ariaErrorBarInterval')}
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

              if (value === 'field') {
                // Explicit field: keep the column already named, otherwise
                // take the first column that reads as an error interval, so
                // choosing the option lands on a real column instead of
                // snapping back to the previous choice.
                const fieldId =
                  spec.overlays.errorBars?.fieldId ?? errorColumns[0]?.id

                if (fieldId) setErrorBarColumn(fieldId)

                return
              }

              if (value !== 'sd' && value !== 'sem' && value !== 'ci') return

              update({
                overlays: {
                  ...spec.overlays,
                  errorBars: {
                    source: 'computed',
                    basis: value,
                    multiplier: 1,
                    statistic: 'mean',
                  },
                },
              })
            }}
            className="h-8 bg-surface"
          >
            <option value="">{t('common.states.none')}</option>
            <option value="sd">{t('data.chartConfigurator.groupedSd')}</option>
            <option value="sem">
              {t('data.chartConfigurator.groupedSem')}
            </option>
            <option value="ci">
              {t('data.chartConfigurator.grouped95Ci')}
            </option>
            {errorColumns.length ? (
              <option value="field">
                {t('data.chartConfigurator.explicitField')}
              </option>
            ) : null}
          </Select>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3 pt-2.5">
        <div className="min-w-36 flex-1">
          <label
            className="text-label text-fg-muted"
            htmlFor={`${idPrefix}-ref-hline`}
          >
            {t('data.chartConfigurator.horizontalReference')}
          </label>
          <Input
            id={`${idPrefix}-ref-hline`}
            aria-label={t('data.chartConfigurator.horizontalReference')}
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
            placeholder={t('common.states.none')}
          />
        </div>
      </div>
    </>
  )
}

function AuthoringTypeParams({
  source,
  spec,
  onSpecChange,
  idPrefix,
}: ChartConfiguratorProps) {
  const numericColumns = source.columns.filter(isMeasuredColumn)

  function updateHistogramParams(
    patch: Partial<NonNullable<ChartSpec['typeParams']['histogram']>>,
  ) {
    onSpecChange({
      ...spec,
      typeParams: {
        ...spec.typeParams,
        histogram: { ...spec.typeParams.histogram, ...patch },
      },
    })
  }

  function updateHeatmapParams(
    patch: Partial<NonNullable<ChartSpec['typeParams']['heatmap']>>,
  ) {
    onSpecChange({
      ...spec,
      typeParams: {
        ...spec.typeParams,
        heatmap: {
          aggregate: 'count',
          valueField: null,
          ...spec.typeParams.heatmap,
          ...patch,
        },
      },
    })
  }

  return (
    <>
      {spec.type === 'histogram' ? (
        <div className="flex flex-wrap items-end gap-3 pt-2.5">
          <div className="min-w-32 flex-1">
            <label
              className="text-label text-fg-muted"
              htmlFor={`${idPrefix}-histogram-bins`}
            >
              {t('data.chartConfigurator.bins')}
            </label>
            <Input
              id={`${idPrefix}-histogram-bins`}
              aria-label={t('data.chartConfigurator.ariaHistogramBinCount')}
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
              {t('data.chartConfigurator.binWidthOverridesBins')}
            </label>
            <Input
              id={`${idPrefix}-histogram-bin-width`}
              aria-label={t('data.chartConfigurator.ariaHistogramBinWidth')}
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
              {t('data.chartConfigurator.cellValue')}
            </label>
            <Select
              id={`${idPrefix}-heatmap-aggregate`}
              aria-label={t(
                'data.chartConfigurator.ariaHeatmapCellAggregation',
              )}
              value={spec.typeParams.heatmap?.aggregate ?? 'count'}
              onChange={(event) => {
                const aggregate = HEATMAP_AGGREGATES.find(
                  (candidate) => candidate === event.target.value,
                )

                if (!aggregate) return

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
                  {a === 'count'
                    ? t('data.chartConfigurator.rowCount')
                    : t('data.chartConfigurator.valueField', { a })}
                </option>
              ))}
            </Select>
          </div>
          {(spec.typeParams.heatmap?.aggregate ?? 'count') !== 'count' ? (
            <div className="min-w-36 flex-1">
              <label
                className="text-label text-fg-muted"
                htmlFor={`${idPrefix}-heatmap-value-field`}
              >
                {t('data.chartConfigurator.valueField2')}
              </label>
              <SearchableSelect
                noun="column"
                id={`${idPrefix}-heatmap-value-field`}
                aria-label={t('data.chartConfigurator.ariaHeatmapValueField')}
                value={spec.typeParams.heatmap?.valueField?.fieldId ?? ''}
                onValueChange={(value) => {
                  const column = source.columns.find(
                    (candidate) => candidate.id === value,
                  )

                  updateHeatmapParams({
                    valueField: column ? { fieldId: column.id } : null,
                  })
                }}
                className="h-8 bg-surface"
              >
                <option value="">
                  {t('data.chartConfigurator.selectNumericColumn')}
                </option>
                {numericColumns.map((column) => (
                  <option key={column.id} value={column.id}>
                    {column.label}
                  </option>
                ))}
              </SearchableSelect>
            </div>
          ) : null}
          <div className="min-w-24">
            <label
              className="text-label text-fg-muted"
              htmlFor={`${idPrefix}-heatmap-xbins`}
            >
              {t('data.chartConfigurator.xBins')}
            </label>
            <Input
              id={`${idPrefix}-heatmap-xbins`}
              aria-label={t('data.chartConfigurator.ariaHeatmapXBinCount')}
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
              {t('data.chartConfigurator.yBins')}
            </label>
            <Input
              id={`${idPrefix}-heatmap-ybins`}
              aria-label={t('data.chartConfigurator.ariaHeatmapYBinCount')}
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
    </>
  )
}

function AuthoringAnnotations({
  spec,
  onSpecChange,
  idPrefix,
}: Pick<ChartConfiguratorProps, 'spec' | 'onSpecChange' | 'idPrefix'>) {
  function setAnnotations(annotations: ChartAnnotation[]) {
    onSpecChange({ ...spec, display: { ...spec.display, annotations } })
  }

  return CARTESIAN_CHART_TYPES.includes(spec.type) ? (
    <div className="space-y-2 pt-2.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-fg-muted">
          {t('data.chartConfigurator.annotations', {
            length: (spec.display.annotations ?? []).length,
            MAX_ANNOTATIONS,
          })}
        </p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={(spec.display.annotations ?? []).length >= MAX_ANNOTATIONS}
          onClick={() =>
            setAnnotations([
              ...(spec.display.annotations ?? []),
              {
                x: 0,
                y: 0,
                label: t('data.chartConfigurator.newAnnotation'),
              },
            ])
          }
        >
          <Icon name="plus" /> {t('data.chartConfigurator.addAnnotation')}
        </Button>
      </div>
      {(spec.display.annotations ?? []).map((annotation, i) => (
        // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- Approved positional ChartAnnotation contract: duplicate values are valid and controlled callers can replace the whole array. DOM tests cover editing, removal and caller replacement; persistent row IDs require an owner contract change.
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
              aria-label={t('data.chartConfigurator.ariaAnnotationX', {
                value: i + 1,
              })}
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
              aria-label={t('data.chartConfigurator.ariaAnnotationY', {
                value: i + 1,
              })}
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
              {t('data.chartConfigurator.label')}
            </label>
            <Input
              id={`${idPrefix}-ann-${i}-label`}
              aria-label={t('data.chartConfigurator.ariaAnnotationLabel', {
                value: i + 1,
              })}
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
            aria-label={t('data.chartConfigurator.ariaRemoveAnnotation', {
              value: i + 1,
            })}
            onClick={() =>
              setAnnotations(
                (spec.display.annotations ?? []).filter((_, j) => j !== i),
              )
            }
          >
            <Icon name="trash" />
          </Button>
        </div>
      ))}
    </div>
  ) : null
}
