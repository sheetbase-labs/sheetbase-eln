import { specSourceDatasetId } from '#/lib/analysis-spec-source'
import { useMemo, useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { PageHeader, Muted } from '#/components/v3/ui/layout'
import { Button } from '#/components/v3/ui/button'
import { Status } from '#/components/v3/ui/status'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Tabs } from '#/components/v3/ui/tabs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/v3/ui/dropdown-menu'
import {
  RegistryGrid,
  useRowFocus,
} from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import { useUserNames } from '#/lib/user-names'
import { createDataClient } from '#/lib/data-client'
import {
  analysisStudioQueryKeys,
  fetchAnalysisViews,
} from '#/lib/analysis-studio-data'
import type { AnalysisViewWire } from '#/lib/analysis-studio-data'
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

const MODES = [
  { mode: 'chart', label: 'Chart', body: 'A figure from a dataset snapshot.' },
  {
    mode: 'analyse',
    label: 'Analyse',
    body: 'Statistics with assumption checks.',
  },
  { mode: 'compare', label: 'Compare', body: 'Two snapshots side by side.' },
] as const

function kindLabel(view: AnalysisViewWire): string {
  return view.spec.type
}

function AnalysisHome() {
  const { tab, q, state } = Route.useSearch()
  const navigate = useNavigate()
  const { context } = Route.useRouteContext()
  const userId = context.user.id
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const views = useQuery({
    queryKey: analysisStudioQueryKeys.views,
    queryFn: () => fetchAnalysisViews(client),
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
  const rows = views.data ?? []
  const names = useUserNames(rows.map((r) => r.owner_user_id).filter(Boolean))
  const columns = useMemo<RegistryColumn<AnalysisViewWire>[]>(
    () => [
      {
        id: 'identifier',
        header: 'ID',
        meta: {
          headerClassName: 'pl-4!',
          cellClassName: 'pl-4!',
        },
        cell: ({ row }) => (
          <Link
            to="/analysis/$analysisId"
            params={{ analysisId: row.original.id }}
            className="mono"
          >
            {row.original.display_id ?? row.original.id.slice(0, 8)}
          </Link>
        ),
      },
      {
        id: 'name',
        header: 'Name',
        meta: { cellClassName: 'font-medium' },
        cell: ({ row }) => row.original.name,
      },
      {
        id: 'kind',
        header: 'Kind',
        cell: ({ row }) => (
          <Status tone="analysis">{kindLabel(row.original)}</Status>
        ),
      },
      {
        id: 'source',
        header: 'Source',
        meta: { cellClassName: 'text-fg-muted' },
        cell: ({ row }) =>
          (datasets.data ?? []).find(
            (dataset) => dataset.id === specSourceDatasetId(row.original.spec),
          )?.name ?? '—',
      },
      {
        id: 'owner',
        header: 'Owner',
        meta: { cellClassName: 'text-fg-muted' },
        cell: ({ row }) => names.userLabel(row.original.owner_user_id),
      },
      {
        id: 'updated',
        header: 'Updated',
        meta: {
          headerClassName: 'pr-4!',
          cellClassName: 'pr-4! text-fg-muted',
        },
        cell: ({ row }) => row.original.updated_at.slice(0, 10),
      },
    ],
    [datasets.data, names],
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
      rows.filter((v) => {
        if (tab === 'mine' && v.owner_user_id !== userId) return false
        if (tab === 'cited' && !citedIds.has(v.display_id ?? '')) return false
        if (tab === 'drafts' && v.version > 1) return false
        if (
          needle &&
          !`${v.display_id ?? ''} ${v.name} ${v.spec.type} ${specSourceDatasetId(v.spec) ?? ''}`
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

  const recent = (datasets.data ?? []).slice(0, 3)
  const selected = visible.find((v) => v.id === selectedId) ?? null

  // The empty state says why the list is empty, so a tab filter that matches
  // nothing does not read as a workspace with no analyses: the header above
  // reports "N saved analyses" from the unfiltered rows.
  const emptyCopy = (() => {
    if (needle)
      return {
        title: 'No analyses match',
        body: 'No analysis ID, name, kind or dataset matches that search. Clear it to see every saved analysis.',
      }
    if (rows.length > 0 && tab === 'cited')
      return {
        title: 'No analyses are cited in records',
        body: 'An analysis appears here once a notebook or record cites it. Open an analysis to cite it, or start a new one.',
      }
    if (rows.length > 0 && tab === 'mine')
      return {
        title: 'No analyses of your own',
        body: 'You have not saved an analysis in this workspace yet. Start one, or open All to see analyses other people saved.',
      }
    if (rows.length > 0 && tab === 'drafts')
      return {
        title: 'No draft analyses',
        body: 'Every analysis in this workspace has been edited past its first version, so none is still a draft.',
      }
    return {
      title: 'No analyses yet',
      body: 'An analysis reads a pinned dataset snapshot and makes a figure or table you can cite in a notebook. Pick how you want to start.',
    }
  })()

  if (state === 'denied') {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader trail={[{ label: 'Home' }]} title="Analysis" />
        <div className="px-4 py-5 md:px-6">
          <EmptyState
            icon="lock"
            title="You don’t have access to analyses"
            description="Your workspace role doesn’t include Analysis. You can still see figures that records cite. A workspace admin can change your role in Settings › Members."
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          trail={[{ label: 'Home' }]}
          title="Analysis"
          meta={<span>{rows.length} saved analyses</span>}
          actions={
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="primary" icon="plus" />}
              >
                New analysis
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
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />

        {recent.length ? (
          <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5 md:px-6">
            <span className="text-label text-fg-muted">
              Start from a recent dataset
            </span>
            {recent.map((d) => (
              <Link
                key={d.id}
                to="/analysis/new"
                search={{ mode: 'chart', dataset: d.id }}
                className="text-label"
              >
                {d.name}
              </Link>
            ))}
          </div>
        ) : null}

        <div className="border-b border-border px-4 md:px-6">
          {/* The strip scrolls instead of pushing the page sideways: "Cited in
              records" + "Drafts" are wider than the column at 400 % zoom, and
              the row had no scroll of its own, so it overflowed the document
              (QA4-zoom-analysis). */}
          <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0">
            <Tabs
              mode="url"
              label="Analysis lists"
              value={tab ?? 'all'}
              items={[
                {
                  key: 'all',
                  label: 'All',
                  count: rows.length,
                  link: { to: '/analysis', search: {} },
                },
                {
                  key: 'mine',
                  label: 'Mine',
                  count: rows.filter((v) => v.owner_user_id === userId).length,
                  link: { to: '/analysis', search: { tab: 'mine' } },
                },
                {
                  key: 'cited',
                  label: 'Cited in records',
                  count: rows.filter((v) => citedIds.has(v.display_id ?? ''))
                    .length,
                  link: { to: '/analysis', search: { tab: 'cited' } },
                },
                {
                  key: 'drafts',
                  label: 'Drafts',
                  count: rows.filter((v) => v.version <= 1).length,
                  link: { to: '/analysis', search: { tab: 'drafts' } },
                },
              ]}
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {views.isLoading || (tab === 'cited' && citations.isLoading) ? (
            <div className="px-4 py-5 md:px-6">
              <Muted>Loading analyses…</Muted>
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
                      Clear search
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
                          Start a {m.label.toLowerCase()}
                        </Button>
                      ))}
                    </div>
                  )
                }
              />
            </div>
          ) : (
            <RegistryGrid
              label="Saved analyses"
              rows={visible}
              columns={columns}
              getRowId={(view) => view.id}
              rowSelection={rowSelection}
              onRowSelectionChange={onRowSelectionChange}
              onRowClick={(view) => setSelectedId(view.id)}
              selectable={false}
            />
          )}
        </div>
      </div>
      {selected ? (
        <aside
          aria-label={`${selected.name} details`}
          className="hidden w-[320px] shrink-0 flex-col gap-4 overflow-auto border-l border-border bg-surface p-4 xl:flex"
        >
          <div className="flex flex-col gap-1">
            <span className="mono text-label text-fg-muted">
              {selected.display_id ?? selected.id.slice(0, 8)}
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
                <Link
                  to="/analysis/$analysisId"
                  params={{ analysisId: selected.id }}
                />
              }
            >
              Open
            </Button>
            <Button
              size="sm"
              nativeButton={false}
              render={
                <Link
                  to="/analysis/new"
                  search={{
                    mode: 'chart',
                    dataset: specSourceDatasetId(selected.spec),
                  }}
                />
              }
            >
              New from its data
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="text-label font-medium text-fg-muted">Source</h3>
            <span className="text-body">
              {datasetName(specSourceDatasetId(selected.spec))}
            </span>
          </div>
          <Muted>
            Editing an analysis updates it in place and bumps its version, so a
            citation always points at the latest version.
          </Muted>
        </aside>
      ) : null}
    </div>
  )
}
