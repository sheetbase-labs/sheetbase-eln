import { useMemo, useState } from 'react'

import { Button } from '#/components/v3/ui/button'
import { Field } from '#/components/v3/ui/input'
import { InspectorSection, Muted } from '#/components/v3/ui/layout'
import { Select } from '#/components/v3/ui/select'
import { Status } from '#/components/v3/ui/status'
import { Tabs } from '#/components/v3/ui/tabs'
import { ChartRenderer } from '#/components/viz/chart-renderer'
import { axisTitle, chartTitle, numericColumns } from '#/lib/analysis-charts'
import { describeAnalysisChange } from '#/lib/analysis-versions'
import type { AnalysisVersionWire } from '#/lib/analysis-versions'
import { materialiseLiveChart, chartUsedFieldIds } from '#/lib/chart-data'
import type { ResolvedDataset } from '#/lib/chart-data'
import type { ChartColumn, ChartSpec } from '#/lib/chart-spec'
import { CHART_ROW_ID_KEY } from '#/lib/visualisation-pipeline'
import { cn } from '#/lib/utils'

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
      aria-label="Source and fields"
      className="flex w-[220px] shrink-0 flex-col gap-3 overflow-auto border-r border-border px-3 py-3 max-lg:hidden"
    >
      <section>
        <h2 className="mb-1 font-sans text-label font-semibold">Source</h2>
        <p className="m-0 text-body">{dataset?.source.name ?? 'No dataset'}</p>
        <Muted>
          {dataset
            ? `${dataset.totalCount} rows · schema v${dataset.source.schemaVersionNumber}`
            : 'The source dataset is not available.'}
        </Muted>
      </section>
      <section>
        <h2 className="mb-1 font-sans text-label font-semibold">Fields</h2>
        {columns.length === 0 ? (
          <Muted>No fields.</Muted>
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
  return (
    <div className="flex flex-col gap-3">
      {charts.map((spec, i) => (
        <div
          key={i}
          role="group"
          aria-label={`Chart ${i + 1}`}
          onClick={() => onSelect(i)}
          className={cn(
            'rounded-md border p-3',
            i === selected ? 'border-accent' : 'border-border',
          )}
        >
          <h2 className="mb-1 font-sans text-label font-semibold">
            {i + 1} · {chartTitle(spec)}
          </h2>
          <ChartRenderer
            title={title}
            hideTitle
            spec={spec}
            materialised={materialiseLiveChart(spec, dataset)}
            frozen={null}
            loading={loading}
            plotHeight={320}
            showTableAlternative={false}
          />
        </div>
      ))}
      {onAdd ? (
        <div>
          <Button onClick={onAdd}>Add chart</Button>
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
    <InspectorSection title={`Chart ${selected + 1} · ${chartTitle(spec)}`}>
      <div className="flex flex-col gap-2">
        <Field label="X axis" hint="Shared by every chart">
          <p className="m-0 text-body">
            {x ? axisTitle(x) : (spec.display.axes.x.label ?? 'None')}
          </p>
        </Field>
        <Field label="Y axis">
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
        <Field label="Reference line">
          {references.length === 0 ? (
            <Muted>None.</Muted>
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
            <Button onClick={onRemove}>Remove this chart</Button>
          </div>
        ) : null}
      </div>
    </InspectorSection>
  )
}

export interface ExclusionCounts {
  values: number
  rows: number
}

/** Flagged values across every field the charts use. */
export function exclusionCounts(
  dataset: ResolvedDataset | null,
  charts: readonly ChartSpec[],
): ExclusionCounts {
  if (!dataset?.flags?.length) return { values: 0, rows: 0 }
  const used = new Set(charts.flatMap((c) => usedFieldIds(c)))
  const hit = dataset.flags.filter((f) => used.has(f.fieldId))
  return {
    values: new Set(hit.map((f) => `${f.rowId}:${f.fieldId}`)).size,
    rows: new Set(hit.map((f) => f.rowId)).size,
  }
}

type Tab = 'data' | 'diagnostics' | 'versions'

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
    () => [...new Set(charts.flatMap((c) => usedFieldIds(c)))],
    [charts],
  )
  const columns = (dataset?.source.columns ?? []).filter((c) =>
    used.includes(c.id),
  )
  const rows = dataset?.rows ?? []
  const flagFor = (row: Record<string, unknown>) => {
    const rowId = row[CHART_ROW_ID_KEY]
    return typeof rowId === 'string'
      ? (dataset?.flags ?? []).find(
          (f) => f.rowId === rowId && used.includes(f.fieldId),
        )
      : undefined
  }
  return (
    <div className="flex min-w-0 flex-col">
      <Tabs
        mode="state"
        label="Analysis detail"
        value={tab}
        onValueChange={(v) => setTab(v as Tab)}
        items={[
          { key: 'data', label: 'Data', count: rows.length },
          { key: 'diagnostics', label: 'Diagnostics' },
          { key: 'versions', label: 'Versions', count: version },
        ]}
      />
      <div className="py-2">
        {tab === 'data' ? (
          rows.length === 0 ? (
            <Muted>No rows.</Muted>
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
                    <th className="px-2 py-1 font-medium">In criteria</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => {
                    const flag = flagFor(row)
                    return (
                      <tr
                        key={i}
                        className={cn(
                          'border-t border-border',
                          flag && 'text-fg-muted',
                        )}
                      >
                        {columns.map((c) => (
                          <td key={c.id} className="px-2 py-1">
                            {String(row[c.id] ?? '')}
                          </td>
                        ))}
                        <td className="px-2 py-1">
                          {flag
                            ? `Excluded · value flagged (${flag.reason})`
                            : 'Included'}
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
              <Status tone="progress">Current</Status>
              <span>
                Version {version}, saved {updatedAt.slice(0, 10)}
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
                <span className="font-mono">v{entry.version}</span>
                <span>saved {entry.saved_at.slice(0, 10)}</span>
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
                    Restore as new version
                  </button>
                ) : null}
              </li>
            ))}
            {earlier.length === 0 ? (
              <li className="text-fg-muted">
                No earlier saves yet. Each save from now on is kept here. A
                record that cites this analysis keeps the version it cited.
              </li>
            ) : null}
          </ul>
        )}
      </div>
    </div>
  )
}
