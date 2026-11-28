import { filterParamSchema } from '#/lib/list-filter'
import type { FilterParam } from '#/lib/search-filter'
import { useRowFilter } from '#/components/inventory/row-filter'
import { t } from '#/copy'
import {
  emptyCopyFor,
  kindLabel,
  statisticSummary,
  tabLabelFor,
} from '../-analysis-list-model'
import type { AnalysisRow } from '../-analysis-list-model'
import { useListArrange } from '#/components/inventory/list-arrange'
import { ownerColumn, updatedColumn } from '#/components/inventory/list-columns'
import {
  AnalysisInspector,
  AnalysisListBody,
  AnalysisNewMenu,
} from '../-analysis-list-parts'
import { hasCapability } from '#/lib/capability'
import { specSourceDatasetId } from '#/lib/analysis-spec-source'
import { useMemo, useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { useOpenRow } from '#/components/workspace/workspace-navigation'

import { PageHeader } from '#/components/ui/layout'
import {
  ListFooter,
  ListHeader,
  ListToolbar,
  footerCount,
} from '#/components/inventory/list'
import { Status } from '#/components/ui/status'
import { EmptyState } from '#/components/ui/empty-state'
import { Tabs } from '#/components/ui/tabs'
import { useRowFocus } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { useUserNames } from '#/lib/user-names'
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
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- TanStack Router hands validateSearch the raw URL values as Record<string, unknown>; analysisSearchSchema decodes every key this route reads.
    search: Record<string, unknown>,
  ): AnalysisSearch => analysisSearchSchema.parse(search),
  component: AnalysisHome,
})

const client = createDataClient()

/** The list's filters, as the URL carries them. */
interface AnalysisSearch {
  tab?: 'mine' | 'cited' | 'drafts'
  q?: string
  state?: 'denied'
  filter?: FilterParam
}

/** A URL that names none of them usable reads as an unfiltered list. */
const analysisSearchSchema = z.object({
  tab: z.enum(['mine', 'cited', 'drafts']).optional().catch(undefined),
  q: z.string().optional().catch(undefined),
  state: z.literal('denied').optional().catch(undefined),
  filter: filterParamSchema,
})

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
  const summary = statisticSummary(saved)

  return {
    id: saved.id,
    kind: 'statistics',
    identifier: saved.display_id ?? saved.id.slice(0, 8),
    citeKey: saved.id,
    name: saved.name,
    detail: summary.kindLabel,
    ownerId: saved.owner_user_id,
    version: saved.version,
    updatedAt: saved.updated_at,
    datasetId: summary.datasetId,
  }
}

/** Every saved analysis, chart or statistic, opens at its own address. */
function analysisHref(row: AnalysisRow) {
  return `/analysis/${encodeURIComponent(row.id)}`
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
  return (
    <Link
      to="/analysis/$analysisId"
      params={{ analysisId: row.id }}
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
  const canWrite = hasCapability(context.workspace?.role, 'record.create')
  const userId = context.user.id
  const [selectedId, setSelectedId] = useState<string | null>(null)

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
        accessorFn: (a) => a.identifier,
        cell: ({ row }) => (
          <RowLink row={row.original} className="mono" onOpen={openAnalysis}>
            {row.original.identifier}
          </RowLink>
        ),
      },
      {
        id: 'name',
        header: t('data.analysisList.name'),
        size: 240,
        accessorFn: (a) => a.name,
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
        size: 200,
        accessorFn: kindLabel,
        cell: ({ row }) => (
          <Status tone="analysis">{kindLabel(row.original)}</Status>
        ),
      },
      {
        id: 'source',
        header: t('data.analysisList.source'),
        size: 220,
        accessorFn: (a) =>
          (datasets.data ?? []).find((dataset) => dataset.id === a.datasetId)
            ?.name ?? '',
        meta: { cellClassName: 'text-fg-muted' },
        cell: ({ row }) =>
          (datasets.data ?? []).find(
            (dataset) => dataset.id === row.original.datasetId,
          )?.name ?? '—',
      },
      ownerColumn((a) => a.ownerId, names.userLabel),
      updatedColumn((a) => a.updatedAt),
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

  const inTabRows = useMemo(
    () =>
      rows.filter((v) => {
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
    [rows, tab, needle, userId, citedIds],
  )

  const { filter, rows: visible } = useRowFilter(inTabRows, rows)
  const arrange = useListArrange({ rows: visible, columns })

  const recent = (datasets.data ?? []).slice(0, 3)
  const selected = visible.find((v) => v.id === selectedId) ?? null

  const emptyCopy = emptyCopyFor(needle, rows.length, tab)

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
          countNoun={t('data.analysisList.countNoun', { count: rows.length })}
          actions={<AnalysisNewMenu canWrite={canWrite} recent={recent} />}
          tabs={
            <Tabs
              mode="url"
              label={t('data.analysisList.analysisLists')}
              keepFilter
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
          filter={filter}
          placeholder={t('data.analysisList.placeholderSearchAnalysesIdName')}
          arrange={arrange}
          onSearch={(next) =>
            void navigate({
              to: '/analysis',
              search: { tab, q: next || undefined },
              replace: true,
            })
          }
        />

        <AnalysisListBody
          isPending={
            views.isPending ||
            definitions.isPending ||
            (tab === 'cited' && citations.isPending)
          }
          visible={visible}
          grid={arrange.grid}
          columns={columns}
          rowSelection={rowSelection}
          onRowSelectionChange={onRowSelectionChange}
          openAnalysis={openAnalysis}
          datasetName={datasetName}
          emptyCopy={emptyCopy}
          needle={needle}
          tab={tab}
        />
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
      <AnalysisInspector selected={selected} datasetName={datasetName} />
    </div>
  )
}
