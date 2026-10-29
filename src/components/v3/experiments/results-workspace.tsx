import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'

import { ChartRenderer } from '#/components/viz/chart-renderer'
import { Icon } from '#/components/v3/icons'
import { Notice } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import { Checkbox } from '#/components/v3/ui/checkbox'
import {
  DescriptionList,
  Inspector,
  InspectorSection,
  Muted,
} from '#/components/v3/ui/layout'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { formatDate } from '#/lib/notebook-data'
import { formatInstant } from '#/lib/display-time-zone'
import { filterRowsByFlags } from '#/lib/dataset-flags'
import { materialiseLiveChart, resolveChartDataset } from '#/lib/chart-data'
import type { ResolvedDataset } from '#/lib/chart-data'
import {
  analysisStudioDataClient,
  analysisStudioQueryKeys,
  fetchAnalysisViewSourceStatus,
} from '#/lib/analysis-studio-data'
import type { AnalysisViewWire } from '#/lib/analysis-studio-data'
import { useUserNames } from '#/lib/user-names'
import { cn } from '#/lib/utils'
import { t } from '#/copy'

/** One row of a summary table: a series and what its values did. */
export interface SeriesSummaryRow {
  series: string
  rows: number
  /** Per numeric column, "min–max". */
  ranges: Record<string, string>
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function trim(n: number): string {
  return Number(n.toFixed(2)).toString()
}

/** "Summary by train": per series, the row count and each numeric column's
 * min–max, over the rows the figure plots. */
export function summariseBySeries(
  rows: readonly Record<string, unknown>[],
  seriesFieldId: string,
  columnIds: readonly string[],
): SeriesSummaryRow[] {
  const groups = new Map<string, Record<string, unknown>[]>()
  for (const row of rows) {
    const key = String(row[seriesFieldId] ?? '—')
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([series, members]) => ({
      series,
      rows: members.length,
      ranges: Object.fromEntries(
        columnIds.map((id) => {
          const values = members
            .map((m) => numeric(m[id]))
            .filter((v): v is number => v !== null)
          if (!values.length) return [id, '—']
          const lo = Math.min(...values)
          const hi = Math.max(...values)
          return [id, lo === hi ? trim(lo) : `${trim(lo)}–${trim(hi)}`]
        }),
      ),
    }))
}

type OutputKey = string

interface Output {
  key: OutputKey
  kind: 'figure' | 'table' | 'decision'
  title: string
  sub: string
  view?: AnalysisViewWire
}

/**
 * The ExpResults board: the experiment's outputs down the left (figures and
 * tables from the analyses it cites, then the decision), the selected output
 * in the middle, and its data, rules and provenance on the right. A figure is
 * the cited analysis rendered live from its source dataset; the table
 * summarises the same rows by series. Flagged values stay out of both unless
 * the rule is switched off.
 */
export function ResultsWorkspace({
  expId,
  views,
  decision,
}: {
  expId: string
  views: AnalysisViewWire[]
  decision: {
    label: string
    notes: string | null
    action: React.ReactNode
  }
}) {
  const queryClient = useQueryClient()
  const sources = useQueries({
    queries: views.map((view) => ({
      queryKey: ['ui-port', 'results', 'dataset', view.id, view.version],
      queryFn: () =>
        resolveChartDataset(analysisStudioDataClient, view.charts[0]),
      staleTime: 15_000,
    })),
  })
  const owners = useUserNames(views.map((v) => v.owner_user_id))

  const outputs = useMemo<Output[]>(() => {
    const list: Output[] = []
    let figure = 0
    let table = 0
    for (const view of views) {
      figure += 1
      list.push({
        key: `figure:${view.id}`,
        kind: 'figure',
        title: t('projects.resultsWorkspace.figure', {
          number: figure,
          name: view.name,
        }),
        sub: t('projects.resultsWorkspace.draftSub', {
          id: view.display_id ?? t('projects.resultsWorkspace.analysis'),
        }),
        view,
      })
    }
    for (const view of views) {
      table += 1
      list.push({
        key: `table:${view.id}`,
        kind: 'table',
        title: t('projects.resultsWorkspace.table', { number: table }),
        sub: t('projects.resultsWorkspace.draftSub', {
          id: view.display_id ?? t('projects.resultsWorkspace.analysis'),
        }),
        view,
      })
    }
    list.push({
      key: 'decision',
      kind: 'decision',
      title: t('projects.resultsWorkspace.decision'),
      sub: decision.label,
    })
    return list
  }, [views, decision.label])

  const [picked, setPicked] = useState<OutputKey | null>(null)
  const selected = outputs.find((o) => o.key === picked) ?? outputs.at(0)
  const selectedView = selected?.view
  const selectedIndex = selectedView
    ? views.findIndex((v) => v.id === selectedView.id)
    : -1
  const dataset: ResolvedDataset | null =
    selectedIndex >= 0 ? (sources[selectedIndex]?.data ?? null) : null
  const [excludeFlagged, setExcludeFlagged] = useState(true)

  const flagged = dataset?.flags?.length ?? 0
  const effective = useMemo<ResolvedDataset | null>(
    () =>
      dataset ? (excludeFlagged ? dataset : { ...dataset, flags: [] }) : null,
    [dataset, excludeFlagged],
  )
  const materialised = useMemo(
    () =>
      selectedView && effective
        ? materialiseLiveChart(selectedView.charts[0], effective)
        : null,
    [selectedView, effective],
  )

  const status = useQuery({
    queryKey: analysisStudioQueryKeys.sourceStatus(selectedView?.id ?? ''),
    queryFn: () =>
      fetchAnalysisViewSourceStatus(analysisStudioDataClient, selectedView!.id),
    enabled: Boolean(selectedView),
    staleTime: 5_000,
  })

  const columnLabel = (id: string | undefined) =>
    dataset?.source.columns.find((c) => c.id === id)?.label ?? '—'
  const spec = selectedView?.charts[0]
  const specFields = (spec?.fields ?? {}) as Record<
    string,
    { fieldId?: string } | null | undefined
  >
  const xId = specFields.x?.fieldId
  const yId = specFields.y?.fieldId
  const seriesId = specFields.series?.fieldId

  const summary = useMemo(() => {
    if (!effective || !seriesId) return null
    const columns = effective.source.columns.filter(
      (c) =>
        c.id !== xId &&
        (c.logicalType === 'decimal' || c.logicalType === 'integer'),
    )
    const rows = excludeFlagged
      ? filterRowsByFlags(
          effective.rows,
          effective.flags ?? [],
          columns.map((c) => c.id),
        )
      : effective.rows
    return {
      columns,
      rows: summariseBySeries(
        rows,
        seriesId,
        columns.map((c) => c.id),
      ),
      excluded: effective.rows.length - rows.length,
    }
  }, [effective, seriesId, xId, excludeFlagged])

  const unit = (id: string) => {
    const column = dataset?.source.columns.find((c) => c.id === id)
    const value = column?.unit
    return typeof value === 'string' && value ? ` (${value})` : ''
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <nav
        aria-label={t('projects.resultsWorkspace.outputs')}
        className="w-[196px] shrink-0 overflow-auto border-r border-border px-3 py-4"
      >
        <div className="mb-2 px-2 text-label text-fg-muted">
          {t('projects.resultsWorkspace.outputs')}
        </div>
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {outputs.map((output) => {
            const active = output.key === selected?.key
            return (
              <li key={output.key}>
                <button
                  type="button"
                  aria-current={active ? 'true' : undefined}
                  onClick={() => setPicked(output.key)}
                  className={cn(
                    'flex w-full cursor-pointer flex-col rounded-md border-0 bg-transparent px-2 py-1.5 text-left',
                    active ? 'bg-selected' : 'hover:bg-hover',
                  )}
                >
                  <span className="text-body">{output.title}</span>
                  <span className="text-label text-fg-muted">{output.sub}</span>
                </button>
              </li>
            )
          })}
        </ul>
        <Button
          size="sm"
          className="mt-3"
          icon="plus"
          nativeButton={false}
          render={
            <Link
              to="/analysis/new"
              search={{
                mode: 'chart',
                experiment: expId,
                returnTo: `/experiments/${expId}/results`,
              }}
            />
          }
        >
          {t('projects.resultsWorkspace.add')}
        </Button>
      </nav>

      <div className="min-w-0 flex-1 overflow-auto px-6 py-5">
        {selected?.kind === 'decision' ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="m-0 font-heading text-doc font-semibold">
                {t('projects.resultsWorkspace.decision')}
              </h2>
              {decision.action}
            </div>
            <p className="m-0 text-body">
              <span className="font-medium">{decision.label}</span>
              {decision.notes ? (
                <span className="text-fg-muted"> · {decision.notes}</span>
              ) : null}
            </p>
          </div>
        ) : selected?.kind === 'table' ? (
          <div className="flex flex-col gap-3">
            <h2 className="m-0 font-heading text-doc font-semibold">
              {selected.title}
            </h2>
            {summary ? (
              <>
                <Table aria-label={t('projects.resultsWorkspace.summary')}>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{columnLabel(seriesId)}</TableHead>
                      <TableHead>
                        {t('projects.resultsWorkspace.rows')}
                      </TableHead>
                      {summary.columns.map((c) => (
                        <TableHead key={c.id}>
                          {t('projects.resultsWorkspace.minMax', {
                            column: `${c.label}${unit(c.id)}`,
                          })}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.rows.map((row) => (
                      <TableRow key={row.series}>
                        <TableCell className="font-medium">
                          {row.series}
                        </TableCell>
                        <TableCell className="num">{row.rows}</TableCell>
                        {summary.columns.map((c) => (
                          <TableCell key={c.id} className="num">
                            {row.ranges[c.id]}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {summary.excluded > 0 ? (
                  <Muted>
                    {t('projects.resultsWorkspace.rowsLeftOut', {
                      count: summary.excluded,
                    })}
                  </Muted>
                ) : null}
              </>
            ) : (
              <Muted>{t('projects.resultsWorkspace.noSource')}</Muted>
            )}
          </div>
        ) : selectedView ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline gap-2">
              <h2 className="m-0 font-heading text-doc font-semibold">
                {selected.title}
              </h2>
              <span className="text-label text-fg-muted">
                {t('projects.resultsWorkspace.draft')}
              </span>
            </div>
            {materialised ? (
              <ChartRenderer
                title={selectedView.name}
                spec={selectedView.charts[0]}
                materialised={materialised}
                frozen={null}
                loading={sources[selectedIndex]?.isLoading}
              />
            ) : (
              <Muted>{t('projects.resultsWorkspace.loading')}</Muted>
            )}
            {flagged > 0 && excludeFlagged ? (
              <Muted>
                {t('projects.resultsWorkspace.valuesLeftOut', {
                  count: flagged,
                  name: dataset?.source.name ?? '',
                })}
              </Muted>
            ) : null}
          </div>
        ) : (
          <Muted>{t('projects.resultsWorkspace.nothing')}</Muted>
        )}
      </div>

      {selectedView ? (
        <Inspector label={t('projects.resultsWorkspace.details')} width={290}>
          <InspectorSection title={t('projects.resultsWorkspace.data')}>
            <DescriptionList
              labelWidth={64}
              items={[
                [
                  t('projects.resultsWorkspace.source'),
                  dataset?.source.name ?? '…',
                ],
                [t('projects.resultsWorkspace.xAxis'), columnLabel(xId)],
                [t('projects.resultsWorkspace.yAxis'), columnLabel(yId)],
                [t('projects.resultsWorkspace.series'), columnLabel(seriesId)],
              ]}
            />
          </InspectorSection>
          <InspectorSection title={t('projects.resultsWorkspace.rules')}>
            <label className="flex cursor-pointer items-start gap-2 text-label">
              <Checkbox
                checked={excludeFlagged}
                onCheckedChange={(checked) => setExcludeFlagged(checked)}
              />
              <span>
                {t('projects.resultsWorkspace.exclude')}{' '}
                <span className="text-fg-muted">({flagged})</span>
              </span>
            </label>
          </InspectorSection>
          <InspectorSection title={t('projects.resultsWorkspace.provenance')}>
            <Muted>
              {t('projects.resultsWorkspace.lastRun', {
                id:
                  selectedView.display_id ??
                  t('projects.resultsWorkspace.thisAnalysis'),
                date: formatDate(selectedView.updated_at),
                time: formatInstant(selectedView.updated_at, {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false,
                }),
                name: owners.userLabel(selectedView.owner_user_id),
              })}
            </Muted>
            {status.data?.state === 'stale' ? (
              <Notice tone="warn" icon="warn" className="mt-2">
                {t('projects.resultsWorkspace.stale')}
              </Notice>
            ) : null}
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                onClick={() =>
                  void queryClient.invalidateQueries({
                    queryKey: ['ui-port', 'results'],
                  })
                }
              >
                {t('projects.resultsWorkspace.rerun')}
              </Button>
              <Button
                size="sm"
                variant="quiet"
                nativeButton={false}
                render={
                  <Link
                    to="/analysis/$analysisId"
                    params={{ analysisId: selectedView.id }}
                  />
                }
              >
                <Icon name="chart" size={14} />{' '}
                {t('projects.resultsWorkspace.open')}
              </Button>
            </div>
          </InspectorSection>
        </Inspector>
      ) : null}
    </div>
  )
}
