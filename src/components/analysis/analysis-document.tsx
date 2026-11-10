import { useMemo, useState } from 'react'
import { z } from 'zod'

import { t } from '#/copy'
import { Button } from '#/components/ui/button'
import { Field } from '#/components/ui/input'
import { InspectorSection, Muted } from '#/components/ui/layout'
import { Select } from '#/components/ui/select'
import { Status } from '#/components/ui/status'
import { Tabs } from '#/components/ui/tabs'
import { ChartRenderer } from '#/components/viz/chart-renderer'
import { ExplainThis } from '#/components/assist/explain-this'
import { chartFacts } from '#/lib/ai-explain-data'
import { axisTitle, chartTitle, numericColumns } from '#/lib/analysis-charts'
import { describeAnalysisChange } from '#/lib/analysis-versions'
import type { AnalysisVersionWire } from '#/lib/analysis-versions'
import { materialiseLiveChart, chartUsedFieldIds } from '#/lib/chart-data'
import type { ResolvedDataset } from '#/lib/chart-data'
import type { ChartColumn, ChartSpec } from '#/lib/chart-spec'
import { CHART_ROW_ID_KEY } from '#/lib/visualisation-pipeline'
import { cn } from '#/lib/utils'
import { formatDate } from '#/lib/format-date'

/** The fields a chart binds. */
function usedFieldIds(spec: ChartSpec): string[] {
  return chartUsedFieldIds(spec)
}

/** What a column does across the analysis's charts: "series", "x", "y1", "y2". */
function roles(columnId: string, charts: readonly ChartSpec[]): string[] {
  const found: string[] = []
  const first = charts.at(0)

  if (first?.fields.series?.fieldId === columnId) found.push('series')

  if (first?.fields.x?.fieldId === columnId) found.push('x')
  charts.forEach((chart, i) => {
    if (chart.fields.y.fieldId === columnId) found.push(`y${i + 1}`)
  })

  return found
}

function glyph(column: ChartColumn): string {
  return ['integer', 'decimal', 'quantity', 'number'].includes(
    column.logicalType,
  )
    ? '#'
    : 'Aa'
}

/** A dataset cell as text: a scalar reads as it is written, anything else as JSON. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- A dataset row's values are stored JSON of no shape this screen knows; each form it can take is read below.
function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = z.string().safeParse(value).data

  if (text !== undefined) return text
  const flag = z.boolean().safeParse(value).data

  if (flag !== undefined) return String(flag)
  const stored = z.number().safeParse(value).data

  if (stored !== undefined) return String(stored)

  return JSON.stringify(value)
}

/** The source's columns with the part each plays in the charts. */
export function FieldsPane({
  dataset,
  charts,
}: {
  dataset: ResolvedDataset | null
  charts: readonly ChartSpec[]
}) {
  const columns = dataset?.source.columns ?? []

  return (
    <aside
      aria-label={t('data.analysisDocument.ariaSourceFields')}
      className="flex w-[220px] shrink-0 flex-col gap-3 overflow-auto border-r border-border px-3 py-3 max-lg:hidden"
    >
      <section>
        <h2 className="mb-1 font-sans text-label font-semibold">
          {t('data.analysisDocument.source')}
        </h2>
        <p className="m-0 text-body">
          {dataset?.source.name ?? t('data.analysisDocument.noDataset')}
        </p>
        <Muted>
          {dataset
            ? t('data.analysisDocument.rowsSchemaV', {
                count: dataset.totalCount,
                version: dataset.source.schemaVersionNumber,
              })
            : t('data.analysisDocument.sourceDatasetAvailable')}
        </Muted>
      </section>
      <section>
        <h2 className="mb-1 font-sans text-label font-semibold">
          {t('data.analysisDocument.fields')}
        </h2>
        {columns.length === 0 ? (
          <Muted>{t('data.analysisDocument.noFields')}</Muted>
        ) : (
          <ul className="m-0 flex list-none flex-col p-0">
            {columns.map((column) => {
              const used = roles(column.id, charts)

              return (
                <li
                  key={column.id}
                  className={cn(
                    'flex items-center gap-2 rounded-sm px-1.5 py-1 text-label',
                    used.length > 0 && 'bg-accent-subtle',
                  )}
                >
                  <span className="w-4 text-fg-muted" aria-hidden>
                    {glyph(column)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {column.label}
                  </span>
                  <span className="shrink-0 text-fg-muted">
                    {used.length > 0
                      ? used.join(' · ')
                      : (axisTitle(column).match(/\((.*)\)$/)?.[1] ?? '')}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </aside>
  )
}

/** The charts of an analysis, one under another, numbered. */
export function ChartStack({
  charts,
  selected,
  onSelect,
  dataset,
  loading,
  title,
  onAdd,
}: {
  charts: readonly ChartSpec[]
  selected: number
  onSelect: (index: number) => void
  dataset: ResolvedDataset | null
  loading: boolean
  title: string
  /** Null when no further chart can be added. */
  onAdd: (() => void) | null
}) {
  // Charts are positional and carry no identity of their own, so the key says
  // where the chart sits and the map below never reads its own index.
  const entries = charts.map((spec, index) => ({
    spec,
    index,
    key: `${chartTitle(spec)}:${index}`,
  }))

  return (
    <div className="flex flex-col gap-3">
      {entries.map(({ spec, index: i, key }) => {
        const materialised = materialiseLiveChart(spec, dataset)
        const chartFactsText = chartFacts(chartTitle(spec), materialised)

        return (
          <div
            key={key}
            role="group"
            aria-label={t('data.analysisDocument.ariaChart', { value: i + 1 })}
            tabIndex={0}
            onClick={() => onSelect(i)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') onSelect(i)
            }}
            className={cn(
              'rounded-md border p-3',
              i === selected ? 'border-accent' : 'border-border',
            )}
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <h2 className="m-0 font-sans text-label font-semibold">
                {i + 1} · {chartTitle(spec)}
              </h2>
              {chartFactsText ? (
                <ExplainThis subject="chart" facts={chartFactsText} />
              ) : null}
            </div>
            <ChartRenderer
              title={title}
              hideTitle
              spec={spec}
              materialised={materialised}
              frozen={null}
              loading={loading}
              plotHeight={320}
              showTableAlternative={false}
            />
          </div>
        )
      })}
      {onAdd ? (
        <div>
          <Button onClick={onAdd}>{t('data.analysisDocument.addChart')}</Button>
        </div>
      ) : null}
    </div>
  )
}

/** The settings of the chart that is selected. */
export function ChartSettings({
  charts,
  selected,
  columns,
  editable,
  onYChange,
  onRemove,
}: {
  charts: readonly ChartSpec[]
  selected: number
  columns: readonly ChartColumn[]
  editable: boolean
  onYChange: (columnId: string) => void
  onRemove: (() => void) | null
}) {
  const spec = charts.at(selected)

  if (!spec) return null
  const x = columns.find((c) => c.id === spec.fields.x?.fieldId)
  const references = spec.overlays.references ?? []

  return (
    <InspectorSection
      title={t('data.analysisDocument.chart', {
        value: selected + 1,
        value2: chartTitle(spec),
      })}
    >
      <div className="flex flex-col gap-2">
        <Field
          label={t('data.analysisDocument.xAxis')}
          hint={t('data.analysisDocument.sharedEveryChart')}
        >
          <p className="m-0 text-body">
            {x
              ? axisTitle(x)
              : (spec.display.axes.x.label ?? t('common.states.none'))}
          </p>
        </Field>
        <Field label={t('data.analysisDocument.yAxis')}>
          <Select
            value={spec.fields.y.fieldId}
            disabled={!editable}
            onChange={(e) => onYChange(e.target.value)}
          >
            {numericColumns(columns).map((c) => (
              <option key={c.id} value={c.id}>
                {axisTitle(c)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('data.analysisDocument.referenceLine')}>
          {references.length === 0 ? (
            <Muted>{t('common.states.none')}</Muted>
          ) : (
            <ul className="m-0 list-none p-0 text-body">
              {references.map((r, i) => (
                <li key={i}>
                  {'label' in r && r.label
                    ? r.label
                    : `${r.kind}${'value' in r ? ` at ${r.value}` : ''}`}
                </li>
              ))}
            </ul>
          )}
        </Field>
        {onRemove && editable ? (
          <div>
            <Button onClick={onRemove}>
              {t('data.analysisDocument.removeChart')}
            </Button>
          </div>
        ) : null}
      </div>
    </InspectorSection>
  )
}

const ANALYSIS_TABS = ['data', 'diagnostics', 'versions'] as const

type Tab = (typeof ANALYSIS_TABS)[number]

/** Data, Diagnostics and Versions, under the charts. */
export function AnalysisTabs({
  charts,
  dataset,
  diagnostics,
  version,
  updatedAt,
  earlier = [],
  savedCharts = charts,
  onRestore,
}: {
  charts: readonly ChartSpec[]
  dataset: ResolvedDataset | null
  diagnostics: React.ReactNode
  version: number
  updatedAt: string
  /** Earlier saves, newest first. */
  earlier?: readonly AnalysisVersionWire[]
  /** The charts as last saved, which the current line compares with. */
  savedCharts?: readonly ChartSpec[]
  /** Load an earlier save's charts so the next save keeps them as the new version. */
  onRestore?: (charts: ChartSpec[]) => void
}) {
  const [tab, setTab] = useState<Tab>('data')

  const used = useMemo(
    () => new Set(charts.flatMap((c) => usedFieldIds(c))),
    [charts],
  )

  const columns = (dataset?.source.columns ?? []).filter((c) => used.has(c.id))

  const rows = dataset?.rows ?? []

  // A row is named by its id; a row without one keeps its place in the page.
  const rowEntries = rows.map((row, index) => ({
    row,
    key: z.string().safeParse(row[CHART_ROW_ID_KEY]).data ?? `row ${index}`,
  }))

  const flagFor = (row: ResolvedDataset['rows'][number]) => {
    const rowId = z.string().safeParse(row[CHART_ROW_ID_KEY]).data

    return rowId === undefined
      ? undefined
      : (dataset?.flags ?? []).find(
          (f) => f.rowId === rowId && used.has(f.fieldId),
        )
  }

  return (
    <div className="flex min-w-0 flex-col">
      <Tabs
        mode="state"
        label={t('data.analysisDocument.analysisDetail')}
        value={tab}
        onValueChange={(next) => {
          const chosen = z.enum(ANALYSIS_TABS).safeParse(next).data

          if (chosen) setTab(chosen)
        }}
        items={[
          {
            key: 'data',
            label: t('data.analysisDocument.data'),
            count: rows.length,
          },
          { key: 'diagnostics', label: t('data.analysisDocument.diagnostics') },
          {
            key: 'versions',
            label: t('data.analysisDocument.versions'),
            count: version,
          },
        ]}
      />
      <div className="py-2">
        {tab === 'data' ? (
          rows.length === 0 ? (
            <Muted>{t('data.analysisDocument.noRows')}</Muted>
          ) : (
            <div className="max-h-[260px] overflow-auto">
              <table className="w-full border-collapse text-label">
                <thead>
                  <tr className="text-left text-fg-muted">
                    {columns.map((c) => (
                      <th key={c.id} className="px-2 py-1 font-medium">
                        {axisTitle(c)}
                      </th>
                    ))}
                    <th className="px-2 py-1 font-medium">
                      {t('data.analysisDocument.inCriteria')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rowEntries.map(({ row, key }) => {
                    const flag = flagFor(row)

                    return (
                      <tr
                        key={key}
                        className={cn(
                          'border-t border-border',
                          flag && 'text-fg-muted',
                        )}
                      >
                        {columns.map((c) => (
                          <td key={c.id} className="px-2 py-1">
                            {cellText(row[c.id])}
                          </td>
                        ))}
                        <td className="px-2 py-1">
                          {flag
                            ? t('data.analysisDocument.excludedValueFlagged', {
                                reason: flag.reason,
                              })
                            : t('data.analysisDocument.included')}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : tab === 'diagnostics' ? (
          diagnostics
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-label">
            <li className="flex flex-wrap items-center gap-2">
              <Status tone="progress">
                {t('data.analysisDocument.current')}
              </Status>
              <span>
                {t('data.analysisDocument.versionSaved', {
                  version,
                  value: formatDate(updatedAt),
                })}
              </span>
              {earlier[0] ? (
                <span className="text-fg-muted">
                  {describeAnalysisChange(earlier[0].charts, savedCharts)}
                </span>
              ) : null}
            </li>
            {earlier.map((entry, index) => (
              <li
                key={entry.version}
                className="flex flex-wrap items-center gap-2 border-t border-border pt-1"
              >
                <span className="font-mono">
                  {t('data.analysisDocument.versionLabel', {
                    version: entry.version,
                  })}
                </span>
                <span>
                  {t('data.analysisDocument.savedOn', {
                    date: formatDate(entry.saved_at),
                  })}
                </span>
                <span className="text-fg-muted">
                  {describeAnalysisChange(
                    earlier[index + 1]?.charts ?? null,
                    entry.charts,
                  )}
                </span>
                {onRestore ? (
                  <button
                    type="button"
                    className="text-link underline"
                    onClick={() => onRestore(entry.charts)}
                  >
                    {t('data.analysisDocument.restoreNewVersion')}
                  </button>
                ) : null}
              </li>
            ))}
            {earlier.length === 0 ? (
              <li className="text-fg-muted">
                {t('data.analysisDocument.earlierSavesYetEach')}
              </li>
            ) : null}
          </ul>
        )}
      </div>
    </div>
  )
}
