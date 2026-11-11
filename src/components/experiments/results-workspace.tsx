import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import { ChartRenderer } from '#/components/viz/chart-renderer'
import { Icon } from '#/components/icons'
import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import {
  DescriptionList,
  Inspector,
  InspectorSection,
  Muted,
} from '#/components/ui/layout'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
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
import { summariseBySeries } from './results-summary'
import type { SeriesSummaryRow } from './results-summary'
import { useUserNames } from '#/lib/user-names'
import { cn } from '#/lib/utils'
import { t } from '#/copy'

type OutputKey = string

interface Output {
  key: OutputKey
  kind: 'figure' | 'table' | 'decision'
  title: string
  sub: string
  view?: AnalysisViewWire
}

interface Decision {
  label: string
  notes: string | null
  action: React.ReactNode
}

/** The experiment's outputs, as the board lists them down the left. */
function OutputList({
  outputs,
  selectedKey,
  expId,
  onPick,
}: {
  outputs: Output[]
  selectedKey: OutputKey | undefined
  expId: string
  onPick: (key: OutputKey) => void
}) {
  return (
    <nav
      aria-label={t('projects.resultsWorkspace.outputs')}
      className="w-[196px] shrink-0 overflow-auto border-r border-border px-3 py-4"
    >
      <div className="mb-2 px-2 text-label text-fg-muted">
        {t('projects.resultsWorkspace.outputs')}
      </div>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {outputs.map((output) => {
          const active = output.key === selectedKey

          return (
            <li key={output.key}>
              <button
                type="button"
                aria-current={active ? 'true' : undefined}
                onClick={() => onPick(output.key)}
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
              returnTo: `/experiments/${expId}/data/results`,
            }}
          />
        }
      >
        {t('projects.resultsWorkspace.add')}
      </Button>
    </nav>
  )
}

/** The decision the experiment reached, with the action that records it. */
function DecisionPane({ decision }: { decision: Decision }) {
  return (
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
  )
}

/** The table output: one row per series, one column per numeric field. */
function SummaryPane({
  title,
  summary,
  seriesId,
  columnLabel,
  unit,
}: {
  title: string
  summary: {
    columns: ResolvedDataset['source']['columns']
    rows: SeriesSummaryRow[]
    excluded: number
  } | null
  seriesId: string | undefined
  columnLabel: (id: string | undefined) => string
  unit: (id: string) => string
}) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="m-0 font-heading text-doc font-semibold">{title}</h2>
      {summary ? (
        <>
          <Table aria-label={t('projects.resultsWorkspace.summary')}>
            <TableHeader>
              <TableRow>
                <TableHead>{columnLabel(seriesId)}</TableHead>
                <TableHead>{t('projects.resultsWorkspace.rows')}</TableHead>
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
                  <TableCell className="font-medium">{row.series}</TableCell>
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
  )
}

/** A figure output: the cited analysis, drawn from its source dataset. */
function FigurePane({
  title,
  view,
  effective,
  loading,
  flagged,
  excludeFlagged,
  datasetName,
}: {
  title: string
  view: AnalysisViewWire
  effective: ResolvedDataset | null
  loading: boolean | undefined
  flagged: number
  excludeFlagged: boolean
  datasetName: string
}) {
  const materialised = useMemo(
    () => (effective ? materialiseLiveChart(view.charts[0], effective) : null),
    [view, effective],
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <h2 className="m-0 font-heading text-doc font-semibold">{title}</h2>
        <span className="text-label text-fg-muted">
          {t('projects.resultsWorkspace.draft')}
        </span>
      </div>
      {materialised ? (
        <ChartRenderer
          title={view.name}
          spec={view.charts[0]}
          materialised={materialised}
          frozen={null}
          loading={loading}
        />
      ) : (
        <Muted>{t('projects.resultsWorkspace.loading')}</Muted>
      )}
      {flagged > 0 && excludeFlagged ? (
        <Muted>
          {t('projects.resultsWorkspace.valuesLeftOut', {
            count: flagged,
            name: datasetName,
          })}
        </Muted>
      ) : null}
    </div>
  )
}

/** The middle of the board: whichever output is selected. */
function ResultsBody({
  selected,
  decision,
  view,
  summary,
  effective,
  loading,
  flagged,
  excludeFlagged,
  datasetName,
  seriesId,
  columnLabel,
  unit,
}: {
  selected: Output | undefined
  decision: Decision
  view: AnalysisViewWire | undefined
  summary: {
    columns: ResolvedDataset['source']['columns']
    rows: SeriesSummaryRow[]
    excluded: number
  } | null
  effective: ResolvedDataset | null
  loading: boolean | undefined
  flagged: number
  excludeFlagged: boolean
  datasetName: string
  seriesId: string | undefined
  columnLabel: (id: string | undefined) => string
  unit: (id: string) => string
}) {
  if (selected?.kind === 'decision') return <DecisionPane decision={decision} />

  if (selected?.kind === 'table')
    return (
      <SummaryPane
        title={selected.title}
        summary={summary}
        seriesId={seriesId}
        columnLabel={columnLabel}
        unit={unit}
      />
    )

  if (view)
    return (
      <FigurePane
        title={selected?.title ?? ''}
        view={view}
        effective={effective}
        loading={loading}
        flagged={flagged}
        excludeFlagged={excludeFlagged}
        datasetName={datasetName}
      />
    )

  return <Muted>{t('projects.resultsWorkspace.nothing')}</Muted>
}

/** What the selected output read, its rules, and where it came from. */
function ResultDetails({
  view,
  datasetName,
  xId,
  yId,
  seriesId,
  columnLabel,
  flagged,
  excludeFlagged,
  onExcludeFlaggedChange,
}: {
  view: AnalysisViewWire
  datasetName: string
  xId: string | undefined
  yId: string | undefined
  seriesId: string | undefined
  columnLabel: (id: string | undefined) => string
  flagged: number
  excludeFlagged: boolean
  onExcludeFlaggedChange: (exclude: boolean) => void
}) {
  const queryClient = useQueryClient()
  const owners = useUserNames([view.owner_user_id])

  const status = useQuery({
    queryKey: analysisStudioQueryKeys.sourceStatus(view.id),
    queryFn: () =>
      fetchAnalysisViewSourceStatus(analysisStudioDataClient, view.id),
    staleTime: 5_000,
  })

  return (
    <Inspector label={t('projects.resultsWorkspace.details')} width={290}>
      <InspectorSection title={t('projects.resultsWorkspace.data')}>
        <DescriptionList
          labelWidth={64}
          items={[
            [t('projects.resultsWorkspace.source'), datasetName || '…'],
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
            onCheckedChange={(checked) => onExcludeFlaggedChange(checked)}
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
            id: view.display_id ?? t('projects.resultsWorkspace.thisAnalysis'),
            date: formatDate(view.updated_at),
            time: formatInstant(view.updated_at, {
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            }),
            name: owners.userLabel(view.owner_user_id),
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
                params={{ analysisId: view.id }}
              />
            }
          >
            <Icon name="chart" size={14} />{' '}
            {t('projects.resultsWorkspace.open')}
          </Button>
        </div>
      </InspectorSection>
    </Inspector>
  )
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
  decision: Decision
}) {
  const sources = useQueries({
    queries: views.map((view) => ({
      queryKey: ['ui-port', 'results', 'dataset', view.id, view.version],
      queryFn: () =>
        resolveChartDataset(analysisStudioDataClient, view.charts[0]),
      staleTime: 15_000,
    })),
  })

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

  const columnLabel = (id: string | undefined) =>
    dataset?.source.columns.find((c) => c.id === id)?.label ?? '—'

  const unit = (id: string) => {
    const column = dataset?.source.columns.find((c) => c.id === id)
    const value = z.string().safeParse(column?.unit).data

    return value ? ` (${value})` : ''
  }

  const fields = selectedView?.charts[0]?.fields
  const xId = fields?.x?.fieldId
  const yId = fields?.y.fieldId
  const seriesId = fields?.series?.fieldId

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

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <OutputList
        outputs={outputs}
        selectedKey={selected?.key}
        expId={expId}
        onPick={setPicked}
      />

      <div className="min-w-0 flex-1 overflow-auto px-6 py-5">
        <ResultsBody
          selected={selected}
          decision={decision}
          view={selectedView}
          summary={summary}
          effective={effective}
          loading={
            selectedIndex >= 0 ? sources[selectedIndex]?.isLoading : undefined
          }
          flagged={flagged}
          excludeFlagged={excludeFlagged}
          datasetName={dataset?.source.name ?? ''}
          seriesId={seriesId}
          columnLabel={columnLabel}
          unit={unit}
        />
      </div>

      {selectedView ? (
        <ResultDetails
          view={selectedView}
          datasetName={dataset?.source.name ?? ''}
          xId={xId}
          yId={yId}
          seriesId={seriesId}
          columnLabel={columnLabel}
          flagged={flagged}
          excludeFlagged={excludeFlagged}
          onExcludeFlaggedChange={setExcludeFlagged}
        />
      ) : null}
    </div>
  )
}
