import { t } from '#/copy'
import {
  analysisSorts,
  emptyCopyFor,
  kindLabel,
  tabLabelFor,
} from '../-analysis-list-model'
import type { AnalysisRow, AnalysisSort } from '../-analysis-list-model'
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
}

/** A URL that names none of them usable reads as an unfiltered list. */
const analysisSearchSchema = z.object({
  tab: z.enum(['mine', 'cited', 'drafts']).optional().catch(undefined),
  q: z.string().optional().catch(undefined),
  state: z.literal('denied').optional().catch(undefined),
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

/** The part of a saved statistics definition the list names. */
const definitionSummarySchema = z.object({
  kind: z.string().optional(),
  datasets: z.array(z.object({ datasetId: z.string().optional() })).optional(),
})

function definitionRow(saved: AnalysisDefinitionWire): AnalysisRow {
  const parsed = definitionSummarySchema.safeParse(saved.definition)
  const definition = parsed.success ? parsed.data : {}

  return {
    id: saved.id,
    kind: 'statistics',
    identifier: saved.display_id ?? saved.id.slice(0, 8),
    citeKey: saved.id,
    name: saved.name,
    detail:
      definition.kind === 'curve'
        ? t('data.analysisList.doseResponseCurve')
        : definition.kind === 'comparison'
          ? t('data.analysisList.groupComparison')
          : definition.kind === 'survival'
            ? t('data.analysisList.survivalCurve')
            : (definition.kind ?? 'analysis'),
    ownerId: saved.owner_user_id,
    version: saved.version,
    updatedAt: saved.updated_at,
    datasetId: definition.datasets?.at(0)?.datasetId,
  }
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
  const canWrite = hasCapability(context.workspace?.role, 'record.create')
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
          actions={<AnalysisNewMenu canWrite={canWrite} recent={recent} />}
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
            onSort: (next) => {
              const chosen = analysisSorts.find((option) => option === next)

              if (chosen) setSort(chosen)
            },
          }}
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
