import { useCallback, useMemo, useState } from 'react'
import { z } from 'zod'
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
import { useListView } from '#/lib/list-views'

import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { ObjectLink } from '#/components/ui/object-link'
import { Status } from '#/components/ui/status'
import {
  DescriptionList,
  Inspector,
  InspectorSection,
} from '#/components/ui/layout'
import {
  ListFooter,
  ListHeader,
  ReadOnlyNote,
  ListToolbar,
  MobileList,
  footerCount,
} from '#/components/inventory/list'
import { useRowFocus } from '#/components/inventory/registry-grid'
import { Tabs } from '#/components/ui/tabs'
import { NewReportDialog } from '#/components/reports/new-report-dialog'
import { ReportsRegistryGrid } from '#/components/reports/reports-registry-grid'
import { notebookDataClient } from '#/lib/notebook-data'
import { fetchReports, reportKeys, reportStatus } from '#/lib/reports'
import type { ReportListRow } from '#/lib/reports'
import { useOpenRow } from '#/components/workspace/workspace-navigation'
import { useUserNames } from '#/lib/user-names'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { formatDate } from '#/lib/format-date'
import { t } from '#/copy'
import { hasCapability } from '#/lib/capability'

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

const SORTS = {
  [t('library.protocols.list.updated')]: [{ id: 'updatedAt', desc: true }],
  ID: [{ id: 'identifier', desc: false }],
  [t('projects.reports.grid.report')]: [{ id: 'title', desc: false }],
} satisfies Record<string, SortingState>

const sorts = Object.keys(SORTS)

function sortKeyOf(sorting: SortingState): string | undefined {
  const first = sorting.at(0)

  if (!first) return undefined

  return sorts.find((key) => {
    const entry = SORTS[key].at(0)

    return entry?.id === first.id && entry.desc === first.desc
  })
}

/** The address bar's filters, decoded once; anything unreadable is dropped. */
const reportsSearchSchema = z.object({
  q: z.string().optional().catch(undefined),
  selected: z.string().optional().catch(undefined),
  new: z
    .union([z.literal('true'), z.literal(true)])
    .optional()
    .catch(undefined),
  tab: z.enum(tabs).optional().catch(undefined),
})

/** The report list's readable search state. */
interface ReportsSearch {
  q?: string
  tab?: ReportTab
  selected?: string
  new?: true
}

export const Route = createFileRoute('/reports')({
  validateSearch: (search): ReportsSearch => {
    const parsed = reportsSearchSchema.safeParse(search)

    if (!parsed.success) return {}

    return {
      new: parsed.data.new === undefined ? undefined : true,
      q: parsed.data.q,
      selected: parsed.data.selected,
      tab: parsed.data.tab,
    }
  },
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

/** Rows while the list is still loading; one array so `useMemo` keeps its value. */
const NO_REPORTS: ReportListRow[] = []

/** How many reports each tab holds for this person. */
function tabCounts(
  rows: ReportListRow[],
  userId: string,
): Record<ReportTab, number> {
  const out: Record<ReportTab, number> = {
    all: 0,
    mine: 0,
    draft: 0,
    review: 0,
    approved: 0,
    archived: 0,
  }

  for (const item of tabs)
    out[item] = rows.filter((r) => inTab(r, item, userId)).length

  return out
}

/** The reports the chosen tab and the typed words show. */
function visibleReports(
  rows: ReportListRow[],
  tab: ReportTab,
  userId: string,
  typed: string,
): ReportListRow[] {
  const q = typed.trim().toLowerCase()

  return rows
    .filter((r) => inTab(r, tab, userId))
    .filter((r) => !q || `${r.identifier} ${r.title}`.toLowerCase().includes(q))
}

/** The report the details pane shows: the chosen row, the address bar's, or the first. */
function selectedReport(
  visible: ReportListRow[],
  selectedId: string | null,
  searchSelected: string | undefined,
): ReportListRow | undefined {
  return (
    visible.find((r) => r.recordId === selectedId) ??
    visible.find((r) => r.recordId === searchSelected) ??
    visible.at(0)
  )
}

/** The sort to apply: the person's own, else the newest-updated reports first. */
function sortStateOf(sorting: SortingState): SortingState {
  return sorting.length ? sorting : SORTS[t('library.protocols.list.updated')]
}

/** What a person reads about the selected report, beside the list. */
function ReportDetails({
  report,
  userLabel,
}: {
  report: ReportListRow
  userLabel: (userId: string) => string
}) {
  return (
    <Inspector
      aria-label={t('projects.reports.page.summary')}
      className="w-[320px] gap-0 p-0"
    >
      <div className="flex flex-col gap-1 border-b border-border px-4 pb-3 pt-3.5">
        <ObjectLink
          kind="report"
          id={report.recordId}
          identifier={report.identifier}
          className="text-fg-muted"
        />
        <div className="font-heading text-doc font-semibold">
          {report.title}
        </div>
        {report.subtitle ? (
          <div className="text-label text-fg-muted">{report.subtitle}</div>
        ) : null}
        <div className="text-label">
          <Status tone={reportStatus(report.status).tone}>
            {reportStatus(report.status).label}
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
                report.projectTitle ?? t('projects.reports.page.noProject'),
              ],
              [
                t('projects.reports.page.owner'),
                userLabel(report.createdByUserId),
              ],
              [t('projects.reports.page.sections'), report.sectionCount],
              [
                t('projects.reports.page.generated'),
                report.lastGeneratedAt
                  ? formatDate(report.lastGeneratedAt)
                  : t('projects.reports.grid.never'),
              ],
              [
                t('projects.reports.page.updated'),
                formatDate(report.updatedAt),
              ],
            ]}
          />
        </InspectorSection>
      </div>
    </Inspector>
  )
}

/** What the list says when the current tab and search turn up nothing. */
function ReportsEmpty({
  q,
  tab,
  searchQ,
  workspaceId,
}: {
  q: string
  tab: ReportTab
  searchQ: string | undefined
  workspaceId: string
}) {
  return (
    <div role="status" className="flex justify-center px-6">
      <EmptyState
        icon={q ? 'search' : 'report'}
        className="items-center py-14 text-center"
        title={
          q
            ? t('projects.reports.page.noneMatch', { q: searchQ ?? '' })
            : tab === 'all'
              ? t('projects.reports.page.noneYet')
              : t('projects.reports.page.noneIn', { tab: tabLabel[tab] })
        }
        description={t('projects.reports.page.searchHint')}
        action={
          q ? (
            <Button
              nativeButton={false}
              render={<Link to="/reports" search={{ tab }} />}
            >
              {t('projects.reports.page.clearSearch')}
            </Button>
          ) : (
            <NewReportDialog workspaceId={workspaceId} />
          )
        }
      />
    </div>
  )
}

/** The list's tab strip: one tab per report state, carrying its count. */
function ReportTabs({
  tab,
  counts,
  pending,
  q,
}: {
  tab: ReportTab
  counts: Record<ReportTab, number>
  pending: boolean
  q: string
}) {
  return (
    <Tabs
      mode="url"
      label={t('projects.reports.page.lists')}
      value={tab}
      items={tabs.map((item) => ({
        key: item,
        label: tabLabel[item],
        count: pending ? undefined : counts[item],
        link: {
          to: '/reports',
          search: { tab: item === 'all' ? undefined : item, q },
        },
      }))}
    />
  )
}

/** The narrow-screen list of the same reports. */
function ReportMobileList({
  rows,
  userLabel,
}: {
  rows: ReportListRow[]
  userLabel: (userId: string) => string
}) {
  return (
    <MobileList
      label={t('projects.reports.page.title')}
      items={rows.map((row) => {
        const status = reportStatus(row.status)

        return {
          key: row.recordId,
          id: row.identifier,
          title: row.title,
          sub: row.projectTitle ?? userLabel(row.createdByUserId),
          status: <Status tone={status.tone}>{status.label}</Status>,
          link: {
            to: '/reports/$reportId',
            params: { reportId: row.recordId },
          },
        }
      })}
    />
  )
}

/** The list's title row: the count, the new-report action and the tabs. */
function ReportHeader({
  canWrite,
  pending,
  total,
  workspaceId,
  autoOpen,
  onAutoOpened,
  tab,
  counts,
  q,
}: {
  canWrite: boolean
  pending: boolean
  total: number
  workspaceId: string
  autoOpen: boolean
  onAutoOpened: () => void
  tab: ReportTab
  counts: Record<ReportTab, number>
  q: string
}) {
  return (
    <ListHeader
      title={t('projects.reports.page.title')}
      total={pending ? undefined : total}
      actions={
        canWrite ? (
          <NewReportDialog
            workspaceId={workspaceId}
            autoOpen={autoOpen}
            onAutoOpened={onAutoOpened}
          />
        ) : (
          <ReadOnlyNote>
            {t('common.readOnly.cannotAdd', {
              things: t('common.readOnly.things.reports'),
            })}
          </ReadOnlyNote>
        )
      }
      tabs={<ReportTabs tab={tab} counts={counts} pending={pending} q={q} />}
    />
  )
}

function ReportsList() {
  const { context } = Route.useRouteContext()
  const canWrite = hasCapability(context.workspace?.role, 'record.create')
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })

  const dropNewFlag = useCallback(() => {
    void navigate({
      search: (current) => ({ ...current, new: undefined }),
      replace: true,
    })
  }, [navigate])

  // The person's own sorting (a header click, or the Sort menu) is remembered;
  // with none, the newest-updated reports lead.
  const view = useListView('reports')

  const sorting = sortStateOf(view.sorting)
  const setSorting = view.setSorting

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

  const rows = query.data ?? NO_REPORTS
  const names = useUserNames(rows.map((r) => r.createdByUserId))
  const userId = context.user.id
  const tab: ReportTab = search.tab ?? 'all'

  const counts = useMemo(() => tabCounts(rows, userId), [rows, userId])

  const visible = visibleReports(rows, tab, userId, search.q ?? '')
  const sel = selectedReport(visible, selectedId, search.selected)

  const workspaceId = context.workspace?.id ?? ''

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <ReportHeader
          canWrite={canWrite}
          pending={query.isPending}
          total={rows.length}
          workspaceId={workspaceId}
          autoOpen={search.new === true}
          onAutoOpened={dropNewFlag}
          tab={tab}
          counts={counts}
          q={search.q ?? ''}
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
        <div className="min-h-0 flex-1 overflow-auto max-md:pb-20">
          {query.isPending || visible.length > 0 ? (
            <ReportsRegistryGrid
              rows={visible}
              ownerLabel={names.userLabel}
              isLoading={query.isPending}
              view={view}
              sorting={sorting}
              onSortingChange={setSorting}
              rowSelection={rowSelection}
              onRowSelectionChange={onRowSelectionChange}
              onOpen={openReport}
            />
          ) : null}
          <ReportMobileList rows={visible} userLabel={names.userLabel} />
          {!query.isPending && visible.length === 0 ? (
            <ReportsEmpty
              q={search.q ?? ''}
              tab={tab}
              searchQ={search.tab}
              workspaceId={workspaceId}
            />
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

      {sel ? <ReportDetails report={sel} userLabel={names.userLabel} /> : null}
    </div>
  )
}
