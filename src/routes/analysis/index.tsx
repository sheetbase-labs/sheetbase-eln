import { t } from '#/copy'
import { specSourceDatasetId } from '#/lib/analysis-spec-source'
import { useMemo, useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useOpenRow } from '#/components/workspace/workspace-navigation'

import { Muted, PageHeader } from '#/components/v3/ui/layout'
import {
  ListFooter,
  ListHeader,
  ListToolbar,
  MobileList,
  footerCount,
} from '#/components/v3/inventory/list'
import { Button } from '#/components/v3/ui/button'
import { Status } from '#/components/v3/ui/status'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Tabs } from '#/components/v3/ui/tabs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/v3/ui/dropdown-menu'
import {
  RegistryGrid,
  useRowFocus,
} from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import { useUserNames } from '#/lib/user-names'
import { formatDate } from '#/lib/format-date'
import { createDataClient } from '#/lib/data-client'
import {
  analysisStudioQueryKeys,
  fetchAnalysisViews,
} from '#/lib/analysis-studio-data'
import type { AnalysisViewWire } from '#/lib/analysis-studio-data'
import type { AnalysisDefinitionWire } from '#/lib/analysis-definitions-data'
import {
  analysisDefinitionQueryKeys,
  fetchAnalysisDefinitions,
} from '#/lib/analysis-definitions-data'
import { fetchDatasetSummaries } from '#/lib/dataset-explorer-data'
import { notebookDataClient } from '#/lib/notebook-data'

/**
 * UI port (roadmap-4/ui-app3): the Analysis Studio home. Lists the workspace's
 * saved analyses (the real analysis_views) with the datasets you can start
 * from; the builder is at /analysis/new and a saved view opens at
 * /analysis/$analysisId. `?state=denied` drives the acceptance suite.
 */
export const Route = createFileRoute('/analysis/')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { tab?: 'mine' | 'cited' | 'drafts'; q?: string; state?: 'denied' } => ({
    tab:
      search.tab === 'mine' || search.tab === 'cited' || search.tab === 'drafts'
        ? search.tab
        : undefined,
    q: typeof search.q === 'string' ? search.q : undefined,
    state: search.state === 'denied' ? 'denied' : undefined,
  }),
  component: AnalysisHome,
})

const client = createDataClient()

const analysisSorts = ['Updated', 'Name', 'ID'] as const
type AnalysisSort = (typeof analysisSorts)[number]

const MODES = [
  {
    mode: 'chart',
    label: t('data.analysisList.chart'),
    body: t('data.analysisList.figureFromDatasetSnapshot'),
  },
  {
    mode: 'analyse',
    label: t('data.analysisList.analyse'),
    body: t('data.analysisList.statisticsAssumptionChecks'),
  },
  {
    mode: 'compare',
    label: t('data.analysisList.compare'),
    body: t('data.analysisList.twoSnapshotsSideSide'),
  },
] as const

/**
 * One saved analysis as the list shows it. Chart views (`analysis_views`) and
 * statistics (`analysis_definitions`) are two stores but one kind of thing to
 * the person looking for their work, so the list merges them and the Kind
 * column says which each is.
 */
interface AnalysisRow {
  id: string
  kind: 'chart' | 'statistics'
  /** The display id when the row has one, else the start of its id. */
  identifier: string
  /** What a citation of this row names, for the Cited tab. */
  citeKey: string
  name: string
  /** The chart type or statistic, e.g. `line` or `descriptive`. */
  detail: string
  ownerId: string
  version: number
  updatedAt: string
  datasetId: string | undefined
}

function viewRow(view: AnalysisViewWire): AnalysisRow {
  return {
    id: view.id,
    kind: 'chart',
    identifier: view.display_id ?? view.id.slice(0, 8),
    citeKey: view.display_id ?? '',
    name: view.name,
    detail: view.charts[0].type,
    ownerId: view.owner_user_id,
    version: view.version,
    updatedAt: view.updated_at,
    datasetId: specSourceDatasetId(view.charts[0]),
  }
}

function definitionRow(saved: AnalysisDefinitionWire): AnalysisRow {
  const definition = saved.definition as {
    kind?: string
    datasets?: { datasetId?: string }[]
  }
  return {
    id: saved.id,
    kind: 'statistics',
    identifier: saved.id.slice(0, 8),
    citeKey: saved.id,
    name: saved.name,
    detail:
      definition.kind === 'curve'
        ? t('data.analysisList.doseResponseCurve')
        : (definition.kind ?? 'analysis'),
    ownerId: saved.owner_user_id,
    version: saved.version,
    updatedAt: saved.updated_at,
    datasetId: definition.datasets?.at(0)?.datasetId,
  }
}

const KIND_LABEL: Record<AnalysisRow['kind'], string> = {
  chart: t('data.analysisList.chart'),
  statistics: t('data.analysisList.statistics'),
}

function tabLabelFor(tab: 'mine' | 'cited' | 'drafts'): string {
  return tab === 'cited'
    ? t('data.analysisList.citedRecords')
    : tab === 'mine'
      ? t('data.analysisList.mine')
      : t('data.analysisList.drafts')
}

function kindLabel(row: AnalysisRow): string {
  return `${KIND_LABEL[row.kind]} · ${row.detail}`
}

/** Where a row opens: a chart view has its own page, statistics open in the studio. */
/** A chart opens as its saved page; an analysis opens in the studio. */
function analysisHref(row: AnalysisRow) {
  return row.kind === 'chart'
    ? `/analysis/${encodeURIComponent(row.id)}`
    : `/analysis/new?mode=analyse&definition=${encodeURIComponent(row.id)}`
}

function RowLink({
  row,
  className,
  children,
  onOpen,
}: {
  row: AnalysisRow
  className?: string
  children: React.ReactNode
  onOpen: (row: AnalysisRow, event: React.MouseEvent) => void
}) {
  return row.kind === 'chart' ? (
    <Link
      to="/analysis/$analysisId"
      params={{ analysisId: row.id }}
      className={className}
      onClick={(event) => onOpen(row, event)}
    >
      {children}
    </Link>
  ) : (
    <Link
      to="/analysis/new"
      search={{ mode: 'analyse', definition: row.id }}
      className={className}
      onClick={(event) => onOpen(row, event)}
    >
      {children}
    </Link>
  )
}

function AnalysisHome() {
  const { tab, q, state } = Route.useSearch()
  const navigate = useNavigate()
  const openAnalysis = useOpenRow<AnalysisRow>(
    navigate,
    analysisHref,
    (row) => row.name,
  )
  const { context } = Route.useRouteContext()
  const userId = context.user.id
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sort, setSort] = useState<AnalysisSort>('Updated')

  const views = useQuery({
    queryKey: analysisStudioQueryKeys.views,
    queryFn: () => fetchAnalysisViews(client),
    staleTime: 10_000,
  })
  const definitions = useQuery({
    queryKey: analysisDefinitionQueryKeys.all,
    queryFn: () => fetchAnalysisDefinitions(),
    staleTime: 10_000,
  })
  const datasets = useQuery({
    queryKey: analysisStudioQueryKeys.datasets,
    queryFn: () => fetchDatasetSummaries(),
    staleTime: 30_000,
  })
  const citations = useQuery({
    queryKey: ['ui-port', 'analysis', 'cited'],
    queryFn: () =>
      notebookDataClient.list<{ target_identifier: string }>(
        'record_links',
        '?link_type=eq.analysis&select=target_identifier',
      ),
  })
  const citedIds = useMemo<Set<string>>(
    () =>
      new Set(
        (citations.data ?? []).map(
          (c: { target_identifier: string }) => c.target_identifier,
        ),
      ),
    [citations.data],
  )
  const rows = useMemo<AnalysisRow[]>(
    () =>
      [
        ...(views.data ?? []).map(viewRow),
        ...(definitions.data ?? []).map(definitionRow),
      ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [views.data, definitions.data],
  )
  const names = useUserNames(rows.map((r) => r.ownerId).filter(Boolean))
  const columns = useMemo<RegistryColumn<AnalysisRow>[]>(
    () => [
      {
        id: 'identifier',
        header: 'ID',
        cell: ({ row }) => (
          <RowLink row={row.original} className="mono" onOpen={openAnalysis}>
            {row.original.identifier}
          </RowLink>
        ),
      },
      {
        id: 'name',
        header: t('data.analysisList.name'),
        meta: { cellClassName: 'font-medium' },
        cell: ({ row }) => (
          <RowLink row={row.original} onOpen={openAnalysis}>
            {row.original.name}
          </RowLink>
        ),
      },
      {
        id: 'kind',
        header: t('data.analysisList.kind'),
        cell: ({ row }) => (
          <Status tone="analysis">{kindLabel(row.original)}</Status>
        ),
      },
      {
        id: 'source',
        header: t('data.analysisList.source'),
        meta: { cellClassName: 'text-fg-muted' },
        cell: ({ row }) =>
          (datasets.data ?? []).find(
            (dataset) => dataset.id === row.original.datasetId,
          )?.name ?? '—',
      },
      {
        id: 'owner',
        header: t('data.analysisList.owner'),
        meta: { cellClassName: 'text-fg-muted' },
        cell: ({ row }) => names.userLabel(row.original.ownerId),
      },
      {
        id: 'updated',
        header: t('data.analysisList.updated'),
        meta: { cellClassName: 'text-fg-muted' },
        cell: ({ row }) => formatDate(row.original.updatedAt),
      },
    ],
    [datasets.data, names, openAnalysis],
  )
  const { rowSelection, onRowSelectionChange } = useRowFocus(
    selectedId,
    setSelectedId,
  )
  const datasetName = (id: string | undefined) =>
    (datasets.data ?? []).find((d) => d.id === id)?.name ?? '—'

  const needle = (q ?? '').trim().toLowerCase()
  const visible = useMemo(
    () =>
      [...rows]
        .sort((a, b) =>
          sort === 'Name'
            ? a.name.localeCompare(b.name)
            : sort === 'ID'
              ? a.identifier.localeCompare(b.identifier, 'en-GB', {
                  numeric: true,
                })
              : b.updatedAt.localeCompare(a.updatedAt),
        )
        .filter((v) => {
          if (tab === 'mine' && v.ownerId !== userId) return false
          if (tab === 'cited' && !citedIds.has(v.citeKey)) return false
          if (tab === 'drafts' && v.version > 1) return false
          if (
            needle &&
            !`${v.identifier} ${v.name} ${kindLabel(v)} ${v.datasetId ?? ''}`
              .toLowerCase()
              .includes(needle)
          )
            return false
          return true
        }),
    // `citedIds` resolves from its own query after the first render, so it has
    // to be a dependency: without it a direct load of ?tab=cited filters against
    // the empty set and never recomputes when the citations land.
    [rows, sort, tab, needle, userId, citedIds],
  )

  const recent = (datasets.data ?? []).slice(0, 3)
  const selected = visible.find((v) => v.id === selectedId) ?? null

  // The empty state says why the list is empty, so a tab filter that matches
  // nothing does not read as a workspace with no analyses: the header above
  // reports "N saved analyses" from the unfiltered rows.
  const emptyCopy = (() => {
    if (needle)
      return {
        title: t('data.analysisList.analysesMatch'),
        body: t('data.analysisList.analysisIdNameKind'),
      }
    if (rows.length > 0 && tab === 'cited')
      return {
        title: t('data.analysisList.analysesCitedRecords'),
        body: t('data.analysisList.analysisAppearsHereOnce'),
      }
    if (rows.length > 0 && tab === 'mine')
      return {
        title: t('data.analysisList.analysesOwn'),
        body: t('data.analysisList.haveSavedAnalysisWorkspace'),
      }
    if (rows.length > 0 && tab === 'drafts')
      return {
        title: t('data.analysisList.draftAnalyses'),
        body: t('data.analysisList.everyAnalysisWorkspaceHas'),
      }
    return {
      title: t('data.analysisList.analysesYet'),
      body: t('data.analysisList.analysisReadsPinnedDataset'),
    }
  })()

  if (state === 'denied') {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader title={t('data.analysisList.analysis')} />
        <div className="px-4 py-5 md:px-6">
          <EmptyState
            icon="lock"
            title={t('data.analysisList.donTHaveAccess')}
            description={t('data.analysisList.workspaceRoleDoesnT')}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <ListHeader
          title={t('data.analysisList.analysis')}
          total={rows.length}
          actions={
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="primary" icon="plus" />}
              >
                {t('data.analysisList.newAnalysis')}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                {MODES.map((m) => (
                  <DropdownMenuItem
                    key={m.mode}
                    hint={m.label}
                    onClick={() =>
                      void navigate({
                        to: '/analysis/new',
                        search: { mode: m.mode },
                      })
                    }
                  >
                    {m.body}
                  </DropdownMenuItem>
                ))}
                {recent.length ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>
                        {t('data.analysisList.startFromRecentDataset')}
                      </DropdownMenuLabel>
                      {recent.map((d) => (
                        <DropdownMenuItem
                          key={d.id}
                          onClick={() =>
                            void navigate({
                              to: '/analysis/new',
                              search: { mode: 'chart', dataset: d.id },
                            })
                          }
                        >
                          {d.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuGroup>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          }
          tabs={
            <Tabs
              mode="url"
              label={t('data.analysisList.analysisLists')}
              value={tab ?? 'all'}
              items={[
                {
                  key: 'all',
                  label: t('data.analysisList.all'),
                  count: rows.length,
                  link: { to: '/analysis', search: { q } },
                },
                {
                  key: 'mine',
                  label: t('data.analysisList.mine'),
                  count: rows.filter((v) => v.ownerId === userId).length,
                  link: { to: '/analysis', search: { tab: 'mine', q } },
                },
                {
                  key: 'cited',
                  label: t('data.analysisList.citedRecords'),
                  count: rows.filter((v) => citedIds.has(v.citeKey)).length,
                  link: { to: '/analysis', search: { tab: 'cited', q } },
                },
                {
                  key: 'drafts',
                  label: t('data.analysisList.drafts'),
                  count: rows.filter((v) => v.version <= 1).length,
                  link: { to: '/analysis', search: { tab: 'drafts', q } },
                },
              ]}
            />
          }
        />
        <ListToolbar
          q={q}
          label={t('data.analysisList.searchAnalyses')}
          placeholder={t('data.analysisList.placeholderSearchAnalysesIdName')}
          views={{
            sorts: [...analysisSorts],
            sort,
            onSort: (next) => setSort(next as AnalysisSort),
          }}
          onSearch={(next) =>
            void navigate({
              to: '/analysis',
              search: { tab, q: next || undefined },
              replace: true,
            })
          }
        />

        <div className="min-h-0 flex-1 overflow-auto">
          {views.isPending ||
          definitions.isPending ||
          (tab === 'cited' && citations.isPending) ? (
            <div className="px-4 py-5 md:px-6">
              <Muted>{t('data.analysisList.loadingAnalyses')}</Muted>
            </div>
          ) : visible.length === 0 ? (
            <div
              role="status"
              className="flex justify-center px-4 py-5 md:px-6"
            >
              <EmptyState
                icon="chart"
                className="items-center text-center"
                title={emptyCopy.title}
                description={emptyCopy.body}
                action={
                  needle ? (
                    <Button
                      onClick={() =>
                        void navigate({
                          to: '/analysis',
                          search: { tab },
                          replace: true,
                        })
                      }
                    >
                      {t('data.analysisList.clearSearch')}
                    </Button>
                  ) : (
                    <div className="flex flex-wrap justify-center gap-2">
                      {MODES.map((m) => (
                        <Button
                          key={m.mode}
                          nativeButton={false}
                          render={
                            <Link
                              to="/analysis/new"
                              search={{ mode: m.mode }}
                            />
                          }
                        >
                          {t('data.analysisList.startA', {
                            mode: m.label.toLowerCase(),
                          })}
                        </Button>
                      ))}
                    </div>
                  )
                }
              />
            </div>
          ) : (
            <>
              <RegistryGrid
                className="max-md:hidden"
                label={t('data.analysisList.savedAnalyses')}
                rows={visible}
                columns={columns}
                getRowId={(view) => view.id}
                rowSelection={rowSelection}
                onRowSelectionChange={onRowSelectionChange}
                onRowClick={openAnalysis}
                selectable={false}
              />
              <MobileList
                label={t('data.analysisList.savedAnalyses')}
                items={visible.map((view) => ({
                  key: view.id,
                  id: view.identifier,
                  title: view.name,
                  sub: `${kindLabel(view)} · ${datasetName(view.datasetId)}`,
                  link:
                    view.kind === 'chart'
                      ? {
                          to: '/analysis/$analysisId',
                          params: { analysisId: view.id },
                          onClick: (event: React.MouseEvent) =>
                            openAnalysis(view, event),
                        }
                      : {
                          to: '/analysis/new',
                          search: { mode: 'analyse', definition: view.id },
                          onClick: (event: React.MouseEvent) =>
                            openAnalysis(view, event),
                        },
                }))}
              />
            </>
          )}
        </div>
        <ListFooter right={selected ? '1 selected' : undefined}>
          {footerCount({
            shown: visible.length,
            total: rows.length,
            one: 'analysis',
            many: 'analyses',
            tab: tab ? tabLabelFor(tab) : undefined,
            query: needle ? q : undefined,
          })}
        </ListFooter>
      </div>
      {selected ? (
        <aside
          aria-label={`${selected.name} details`}
          className="hidden w-[320px] shrink-0 flex-col gap-4 overflow-auto border-l border-border bg-surface p-4 xl:flex"
        >
          <div className="flex flex-col gap-1">
            <span className="mono text-label text-fg-muted">
              {selected.identifier}
            </span>
            <div className="font-heading text-doc font-semibold">
              {selected.name}
            </div>
            <Status tone="analysis">{kindLabel(selected)}</Status>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="primary"
              nativeButton={false}
              render={
                selected.kind === 'chart' ? (
                  <Link
                    to="/analysis/$analysisId"
                    params={{ analysisId: selected.id }}
                  />
                ) : (
                  <Link
                    to="/analysis/new"
                    search={{ mode: 'analyse', definition: selected.id }}
                  />
                )
              }
            >
              {t('common.actions.open')}
            </Button>
            <Button
              size="sm"
              nativeButton={false}
              render={
                <Link
                  to="/analysis/new"
                  search={{
                    mode: 'chart',
                    dataset: selected.datasetId,
                  }}
                />
              }
            >
              {t('data.analysisList.newFromData')}
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="text-label font-medium text-fg-muted">
              {t('data.analysisList.source')}
            </h3>
            <span className="text-body">{datasetName(selected.datasetId)}</span>
          </div>
          <Muted>{t('data.analysisList.eachSaveAddsVersion')}</Muted>
        </aside>
      ) : null}
    </div>
  )
}
