import { useCallback, useMemo, useState } from 'react'
import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { SortingState } from '@tanstack/react-table'

import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Status } from '#/components/v3/ui/status'
import {
  DescriptionList,
  Inspector,
  InspectorSection,
} from '#/components/v3/ui/layout'
import {
  ListFooter,
  ListHeader,
  ListToolbar,
  MobileList,
  footerCount,
} from '#/components/v3/inventory/list'
import { useRowFocus } from '#/components/v3/inventory/registry-grid'
import { Tabs } from '#/components/v3/ui/tabs'
import { NewReportDialog } from '#/components/v3/reports/new-report-dialog'
import { ReportsRegistryGrid } from '#/components/v3/reports/reports-registry-grid'
import { notebookDataClient } from '#/lib/notebook-data'
import { fetchReports, reportKeys, reportStatus } from '#/lib/reports'
import type { ReportListRow } from '#/lib/reports'
import { useOpenRow } from '#/components/workspace/workspace-navigation'
import { useUserNames } from '#/lib/user-names'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { formatDate } from '#/lib/format-date'
import { t } from '#/copy'

const tabs = ['all', 'mine', 'draft', 'review', 'approved', 'archived'] as const
type ReportTab = (typeof tabs)[number]

const tabLabel: Record<ReportTab, string> = {
  all: t('projects.reports.tabs.all'),
  mine: t('projects.reports.tabs.mine'),
  draft: t('projects.reports.tabs.draft'),
  review: t('projects.reports.tabs.review'),
  approved: t('projects.reports.tabs.approved'),
  archived: t('projects.reports.tabs.archived'),
}

const SORTS: Record<string, SortingState> = {
  [t('library.protocols.list.updated')]: [{ id: 'updatedAt', desc: true }],
  ID: [{ id: 'identifier', desc: false }],
  [t('projects.reports.grid.report')]: [{ id: 'title', desc: false }],
}
const sorts = Object.keys(SORTS)

function sortKeyOf(sorting: SortingState): string | undefined {
  const first = sorting.at(0)
  if (!first) return undefined
  return sorts.find((key) => {
    const entry = SORTS[key].at(0)
    return entry?.id === first.id && entry.desc === first.desc
  })
}

export const Route = createFileRoute('/reports')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { q?: string; tab?: ReportTab; selected?: string; new?: true } => ({
    new: search.new === true || search.new === 'true' ? true : undefined,
    q: typeof search.q === 'string' ? search.q : undefined,
    selected: typeof search.selected === 'string' ? search.selected : undefined,
    tab: (tabs as readonly string[]).includes(search.tab as string)
      ? (search.tab as ReportTab)
      : undefined,
  }),
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect(signInRedirect(location))
    }
    return { context }
  },
  component: ReportsRoute,
})

function ReportsRoute() {
  const isIndex = useRouterState({
    select: (state) => state.location.pathname === '/reports',
  })
  return isIndex ? <ReportsList /> : <Outlet />
}

function inTab(r: ReportListRow, tab: ReportTab, userId: string): boolean {
  switch (tab) {
    case 'all':
      return r.status !== 'archived'
    case 'mine':
      return r.createdByUserId === userId && r.status !== 'archived'
    case 'draft':
      return r.status === 'draft'
    case 'review':
      return r.status === 'in_review'
    case 'approved':
      return r.status === 'approved' || r.status === 'published'
    case 'archived':
      return r.status === 'archived'
  }
}

function ReportsList() {
  const { context } = Route.useRouteContext()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const dropNewFlag = useCallback(() => {
    void navigate({
      search: (current) => ({ ...current, new: undefined }),
      replace: true,
    })
  }, [navigate])
  const [sorting, setSorting] = useState<SortingState>(
    SORTS[t('library.protocols.list.updated')],
  )
  const [selectedId, setSelectedId] = useState<string | null>(
    search.selected ?? null,
  )
  const { rowSelection, onRowSelectionChange } = useRowFocus(
    selectedId,
    setSelectedId,
  )
  const openReport = useOpenRow<ReportListRow>(
    navigate,
    (row) => `/reports/${encodeURIComponent(row.recordId)}`,
    (row) => row.title,
  )
  const query = useQuery({
    queryKey: reportKeys.list,
    queryFn: () => fetchReports(notebookDataClient),
    staleTime: 15_000,
  })
  const rows = query.data ?? []
  const names = useUserNames(rows.map((r) => r.createdByUserId))
  const userId = context.user.id
  const tab: ReportTab = search.tab ?? 'all'
  const counts = useMemo(
    () =>
      Object.fromEntries(
        tabs.map((item) => [
          item,
          rows.filter((r) => inTab(r, item, userId)).length,
        ]),
      ) as Record<ReportTab, number>,
    [rows, userId],
  )
  const q = (search.q ?? '').trim().toLowerCase()
  const visible = rows
    .filter((r) => inTab(r, tab, userId))
    .filter((r) => !q || `${r.identifier} ${r.title}`.toLowerCase().includes(q))
  const sel =
    visible.find((r) => r.recordId === selectedId) ??
    visible.find((r) => r.recordId === search.selected) ??
    visible.at(0)
  const workspaceId = context.workspace?.id ?? ''

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <ListHeader
          title={t('projects.reports.page.title')}
          total={query.isPending ? undefined : rows.length}
          actions={
            <NewReportDialog
              workspaceId={workspaceId}
              autoOpen={search.new === true}
              onAutoOpened={dropNewFlag}
            />
          }
          tabs={
            <Tabs
              mode="url"
              label={t('projects.reports.page.lists')}
              value={tab}
              items={tabs.map((item) => ({
                key: item,
                label: tabLabel[item],
                count: query.isPending ? undefined : counts[item],
                link: {
                  to: '/reports',
                  search: {
                    tab: item === 'all' ? undefined : item,
                    q: search.q ?? '',
                  },
                },
              }))}
            />
          }
        />
        <ListToolbar
          q={search.q}
          label={t('projects.reports.page.search')}
          placeholder={t('projects.reports.page.search')}
          views={{
            sorts,
            sort: sortKeyOf(sorting),
            onSort: (s) => setSorting(SORTS[s] ?? []),
            showSortValue: false,
            groupLabel: '',
          }}
          onSearch={(next) =>
            void navigate({
              to: '/reports',
              search: (s) => ({ ...s, q: next || undefined }),
              replace: true,
            })
          }
        />
        <div className="min-h-0 flex-1 overflow-auto">
          {query.isPending || visible.length > 0 ? (
            <ReportsRegistryGrid
              rows={visible}
              ownerLabel={names.userLabel}
              isLoading={query.isPending}
              sorting={sorting}
              onSortingChange={setSorting}
              rowSelection={rowSelection}
              onRowSelectionChange={onRowSelectionChange}
              onOpen={openReport}
            />
          ) : null}
          <MobileList
            label={t('projects.reports.page.title')}
            items={visible.map((r) => {
              const status = reportStatus(r.status)
              return {
                key: r.recordId,
                id: r.identifier,
                title: r.title,
                sub: r.projectTitle ?? names.userLabel(r.createdByUserId),
                status: <Status tone={status.tone}>{status.label}</Status>,
                link: {
                  to: '/reports/$reportId',
                  params: { reportId: r.recordId },
                },
              }
            })}
          />
          {!query.isPending && visible.length === 0 ? (
            <div role="status" className="flex justify-center px-6">
              <EmptyState
                icon={q ? 'search' : 'report'}
                className="items-center py-14 text-center"
                title={
                  q
                    ? t('projects.reports.page.noneMatch', {
                        q: search.q ?? '',
                      })
                    : t('projects.reports.page.noneIn', {
                        tab: tabLabel[tab].toLowerCase(),
                      })
                }
                description={t('projects.reports.page.searchHint')}
                action={
                  q ? (
                    <Button
                      nativeButton={false}
                      render={
                        <Link to="/reports" search={{ tab: search.tab }} />
                      }
                    >
                      {t('projects.reports.page.clearSearch')}
                    </Button>
                  ) : (
                    <NewReportDialog workspaceId={workspaceId} />
                  )
                }
              />
            </div>
          ) : null}
        </div>
        <ListFooter
          loading={query.isPending}
          right={selectedId ? '1 selected' : undefined}
        >
          {footerCount({
            shown: visible.length,
            total: counts[tab],
            one: 'report',
            tab: tabLabel[tab],
          })}
        </ListFooter>
      </div>

      {sel ? (
        <Inspector
          aria-label={t('projects.reports.page.summary')}
          className="w-[320px] gap-0 p-0"
        >
          <div className="flex flex-col gap-1 border-b border-border px-4 pb-3 pt-3.5">
            <span className="mono text-fg-muted">{sel.identifier}</span>
            <div className="font-heading text-doc font-semibold">
              {sel.title}
            </div>
            {sel.subtitle ? (
              <div className="text-label text-fg-muted">{sel.subtitle}</div>
            ) : null}
            <div className="text-label">
              <Status tone={reportStatus(sel.status).tone}>
                {reportStatus(sel.status).label}
              </Status>
            </div>
          </div>
          <div className="flex flex-col gap-4 px-4 py-3.5">
            <InspectorSection title={t('projects.reports.page.details')}>
              <DescriptionList
                labelWidth={100}
                items={[
                  [
                    t('projects.reports.page.project'),
                    sel.projectTitle ?? t('projects.reports.page.noProject'),
                  ],
                  [
                    t('projects.reports.page.owner'),
                    names.userLabel(sel.createdByUserId),
                  ],
                  [t('projects.reports.page.sections'), sel.sectionCount],
                  [
                    t('projects.reports.page.generated'),
                    sel.lastGeneratedAt
                      ? formatDate(sel.lastGeneratedAt)
                      : t('projects.reports.grid.never'),
                  ],
                  [
                    t('projects.reports.page.updated'),
                    formatDate(sel.updatedAt),
                  ],
                ]}
              />
            </InspectorSection>
          </div>
        </Inspector>
      ) : null}
    </div>
  )
}
