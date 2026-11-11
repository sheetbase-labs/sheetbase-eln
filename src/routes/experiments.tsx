import { useCallback, useMemo, useState } from 'react'
import { z } from 'zod'
import { ObjectLink } from '#/components/ui/object-link'
import { useQueryClient } from '@tanstack/react-query'
import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'

import { Skeleton } from '#/components/ui/skeleton'
import { Button } from '#/components/ui/button'
import {
  openBesideOnAlt,
  useWorkspaceNavigation,
} from '#/components/workspace/workspace-navigation'
import {
  NO_PROJECT_ACCESS_BODY,
  noProjectAccessTitle,
  useHasProjectAccess,
} from '#/components/projects/project-access'
import { Status } from '#/components/ui/status'
import { Input } from '#/components/ui/input'
import { Icon } from '#/components/icons'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { RegistryGrid, bandRow } from '#/components/inventory/registry-grid'
import { useBulkSelection } from '#/components/inventory/bulk-selection'
import { useListView } from '#/lib/list-views'
import { RecordBulkBar } from '#/components/inventory/record-bulk-bar'
import type {
  RegistryColumn,
  RegistryRow,
} from '#/components/inventory/registry-grid'
import { FilterMenu } from '#/components/ui/filter-menu'
import { Tabs } from '#/components/ui/tabs'
import {
  ListHeader,
  PHONE_SCROLL_ROW,
  ReadOnlyNote,
} from '#/components/inventory/list'
import { Chip } from '#/components/ui/chip'
import { PlanWithAi } from '#/components/planner/plan-with-ai'
import { MobileList, stickyCol } from '#/components/projects/mobile-list'
import {
  EXPERIMENT_LIST_PAGE_SIZE,
  toExperimentListRow,
  useExperimentOpenIssues,
  useExperimentProtocols,
  useExperimentRecords,
  recentSince,
  useExperimentTabCounts,
  useProjectNameMap,
  useWorkspaceMemberNames,
} from '#/components/experiments/experiments-data'
import type {
  ExperimentListRow,
  ExperimentListScope,
  ExperimentTabKey,
} from '#/components/experiments/experiments-data'
import { RepeatingDialog } from '#/components/recurring/repeating-dialog'
import { RepeatExperimentDialog } from '#/components/recurring/repeat-experiment-dialog'
import { now } from '#/lib/clock'
import { formatListDate } from '#/lib/list-date'
import { useUserNames } from '#/lib/user-names'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { t } from '#/copy'
import { hasCapability } from '#/lib/capability'
import { useAddedFieldListColumns } from '#/components/models/added-fields'
import { withAddedColumns } from '#/components/models/added-field-columns'

const tabs = [
  'all',
  'mine',
  'inprogress',
  'onhold',
  'inreview',
  'approved',
  'planned',
  'drafts',
  'archived',
] as const satisfies readonly ExperimentTabKey[]

type Tab = (typeof tabs)[number]

/** The experiments list's search, as the URL carries it. */
interface ExperimentsSearch {
  tab?: Tab
  q?: string
  project?: string
  older?: boolean
  group?: 'project' | 'owner'
}

/** A search value from the URL, present only when the URL carried text. */
const experimentsSearchText = z.string()

/** A project id from the URL; an empty project filter is no filter. */
const experimentsProjectParam = z.string().min(1)

/** A tab name from the URL, present only when the list offers that tab. */
const experimentsTabParam = z
  .string()
  .transform((value) => tabs.find((tab) => tab === value))

/** A grouping from the URL, present only when the list offers it. */
const experimentsGroupParam = z.enum(['project', 'owner'])

const tabLabel: Record<Tab, string> = {
  all: t('projects.experimentsList.tabs.all'),
  mine: t('projects.experimentsList.tabs.mine'),
  inprogress: t('projects.experimentsList.tabs.inprogress'),
  onhold: t('projects.experimentsList.tabs.onhold'),
  inreview: t('projects.experimentsList.tabs.inreview'),
  approved: t('projects.experimentsList.tabs.approved'),
  planned: t('projects.experimentsList.tabs.planned'),
  drafts: t('projects.experimentsList.tabs.drafts'),
  archived: t('projects.experimentsList.tabs.archived'),
}

/** Empty-state titles. Interpolating the tab label read "No all experiments". */
const tabEmptyTitle: Record<Tab, string> = {
  all: t('projects.experimentsList.empty.all'),
  mine: t('projects.experimentsList.empty.mine'),
  inprogress: t('projects.experimentsList.empty.inprogress'),
  onhold: t('projects.experimentsList.empty.onhold'),
  inreview: t('projects.experimentsList.empty.inreview'),
  approved: t('projects.experimentsList.empty.approved'),
  planned: t('projects.experimentsList.empty.planned'),
  drafts: t('projects.experimentsList.empty.drafts'),
  archived: t('projects.experimentsList.empty.archived'),
}

/** UI port (roadmap-4/ui-app3): the experiments list on real experiment
 * records. Protocol version and open issues are design fields the model lacks
 * and render as gaps, and the model carries no start date — the Created column
 * is the record's creation date. Rows open the record (the dedicated
 * /experiments/$expId frame follows). */
export const Route = createFileRoute('/experiments')({
  validateSearch: (
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- TanStack Router hands validateSearch the raw URL values as Record<string, unknown>; every value is decoded below before use.
    search: Record<string, unknown>,
  ): ExperimentsSearch => ({
    tab: experimentsTabParam.safeParse(search.tab).data,
    q: experimentsSearchText.safeParse(search.q).data,
    project: experimentsProjectParam.safeParse(search.project).data,
    older: search.older === true || search.older === 'true' || undefined,
    group: experimentsGroupParam.safeParse(search.group).data,
  }),
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth

    if (!context) {
      throw redirect(signInRedirect(location))
    }

    return { context }
  },
  component: ExperimentsRoute,
})

function ExperimentsRoute() {
  const isIndex = useRouterState({
    select: (state) => state.location.pathname === '/experiments',
  })

  return isIndex ? <Experiments /> : <Outlet />
}

/** Columns a new list starts without, so it fits beside the sidebar at
 * laptop width; the Columns menu brings them back. */
const EXPERIMENTS_HIDDEN_BY_DEFAULT = ['assignee']

function Experiments() {
  const { context } = Route.useRouteContext()
  const canWrite = hasCapability(context.workspace?.role, 'record.create')
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const queryClient = useQueryClient()
  const bulk = useBulkSelection()
  const workspace = useWorkspaceNavigation()

  // Like every other registry list: an experiment opens in this pane, and
  // Alt-click opens it beside.
  const openExperiment = useCallback(
    (row: ExperimentListRow, event?: React.MouseEvent) => {
      const href = `/experiments/${encodeURIComponent(row.uuid)}`

      if (openBesideOnAlt(workspace, href, event, row.title)) return

      if (!event)
        void navigate({
          to: '/experiments/$expId',
          params: { expId: row.uuid },
        })
    },
    [workspace, navigate],
  )

  const tab: Tab = search.tab ?? 'all'
  const [limit, setLimit] = useState(EXPERIMENT_LIST_PAGE_SIZE)
  const [sort, setSort] = useState<'updated' | 'id'>('updated')
  const [draftQ, setDraftQ] = useState(search.q ?? '')
  const projects = useProjectNameMap()
  const members = useWorkspaceMemberNames()
  const q = (search.q ?? '').trim()

  // The database cannot see project or person names, so the ones that match
  // the search text are named here and the read matches their IDs.
  const matchProjectIds = useMemo(
    () =>
      q
        ? [...(projects.data ?? new Map<string, string>()).entries()].flatMap(
            ([id, title]) =>
              title.toLowerCase().includes(q.toLowerCase()) ? [id] : [],
          )
        : [],
    [projects.data, q],
  )

  const matchOwnerIds = useMemo(
    () =>
      q
        ? (members.data ?? [])
            .filter((m) => m.name.toLowerCase().includes(q.toLowerCase()))
            .map((m) => m.userId)
        : [],
    [members.data, q],
  )

  const since = search.older ? undefined : recentSince()

  const scope: ExperimentListScope = {
    projectId: search.project,
    since,
    query: q || undefined,
    matchProjectIds,
    matchOwnerIds,
  }

  const records = useExperimentRecords(
    context.workspace?.id,
    { ...scope, tab, userId: context.user.id },
    sort,
    limit,
  )

  // Counted under the same filters as the list, so every tab's number is the
  // length of the list behind it.
  const tabCounts = useExperimentTabCounts(context.user.id, scope)

  // The same counts with the date window lifted say how many are older.
  const allTimeCounts = useExperimentTabCounts(
    context.user.id,
    { ...scope, since: undefined },
    !search.older,
  )

  const openIssues = useExperimentOpenIssues(context.workspace?.id)

  const issueCount = useCallback(
    (recordId: string) => openIssues.data?.get(recordId) ?? 0,
    [openIssues.data],
  )

  const experimentIds = useMemo(
    () => (records.data ?? []).map((r) => r.id),
    [records.data],
  )

  const protocols = useExperimentProtocols(experimentIds)

  // Owners and the people experiments are assigned to are named together.
  const ownerIds = useMemo(
    () =>
      (records.data ?? []).flatMap((r) =>
        r.assignee_user_id
          ? [r.created_by_user_id, r.assignee_user_id]
          : [r.created_by_user_id],
      ),
    [records.data],
  )

  const { userLabel } = useUserNames(ownerIds, {
    id: context.user.id,
    name: context.user.name,
  })

  const ownerNames = useMemo(() => {
    const map = new Map<string, string>()

    for (const id of ownerIds) map.set(id, userLabel(id))

    return map
  }, [ownerIds, userLabel])

  const rows: ExperimentListRow[] = useMemo(
    () =>
      (records.data ?? []).map((r) => {
        const row = toExperimentListRow(
          r,
          projects.data ?? new Map(),
          ownerNames,
        )

        const protocol = protocols.data?.get(r.id)

        return protocol
          ? {
              ...row,
              protocol: protocol.identifier,
              protocolRecordId: protocol.recordId,
              protocolVersion: protocol.version,
            }
          : row
      }),
    [records.data, projects.data, ownerNames, protocols.data],
  )

  const counts = tabCounts.data
  const total = counts?.[tab] ?? rows.length
  const hasProjectAccess = useHasProjectAccess()
  // The database already applied the tab, project, date window and search.
  const visible = rows

  const hiddenOld = search.older
    ? 0
    : Math.max(0, (allTimeCounts.data?.[tab] ?? 0) - total)

  const projectFilterName = projectFilterLabel(
    rows,
    projects.data,
    search.project,
  )

  const groups = groupedRows(visible, search.group)

  const setSearch = (patch: Partial<typeof search>) =>
    void navigate({ search: (s) => ({ ...s, ...patch }) })

  const addedColumns = useAddedFieldListColumns<ExperimentListRow>(
    'experiment',
    'uuid',
  )

  const baseColumns = useMemo<RegistryColumn<ExperimentListRow>[]>(
    () =>
      experimentColumns({
        issueCount,
        openExperiment,
        protocolsPending: protocols.isPending,
        issuesPending: openIssues.isPending,
      }),
    [issueCount, openExperiment, protocols.isPending, openIssues.isPending],
  )

  const columns = useMemo(
    () => withAddedColumns(baseColumns, addedColumns),
    [baseColumns, addedColumns],
  )

  const view = useListView(
    'experiments',
    undefined,
    EXPERIMENTS_HIDDEN_BY_DEFAULT,
  )

  // A grouped list draws its groups as bands in the one table.
  const gridRows: RegistryRow<ExperimentListRow>[] = groups.flatMap(
    ([g, list]) => (g ? [bandRow(g, list.length), ...list] : list),
  )

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <ExperimentsHeader
        canWrite={canWrite}
        workspaceId={context.workspace?.id}
        total={
          hasProjectAccess === false || records.isPending ? undefined : total
        }
        tab={tab}
        search={search}
        counts={counts}
      />

      <ExperimentsToolbar
        sort={sort}
        onSort={setSort}
        search={search}
        onSearch={setSearch}
        draftQuery={draftQ}
        onDraftQuery={setDraftQ}
        projectName={projectFilterName}
      />

      {!search.older ? (
        <div className="flex items-center gap-2 px-4 py-2 md:px-6">
          <Chip
            variant="remove"
            removeLabel={t('projects.experimentsList.removeRecent')}
            onRemove={() => setSearch({ older: true })}
          >
            {t('projects.experimentsList.recentChip')}
          </Chip>
        </div>
      ) : null}

      <RecordBulkBar
        selection={bulk}
        kind="experiment"
        move="project"
        restore={tab === 'archived'}
        canWrite={canWrite}
        onChanged={() =>
          void queryClient.invalidateQueries({
            queryKey: ['ui-port', 'experiments'],
          })
        }
      />
      <div className="min-h-0 flex-1 overflow-auto border-t border-border max-md:pb-20">
        <MobileList
          className="md:hidden"
          label={t('projects.experimentsList.title')}
          rows={visible.map((e) => ({
            key: e.uuid,
            title: e.title,
            meta: (
              <>
                <span className="mono">{e.id}</span> · {e.project}
                {e.protocolRecordId ? <> · {e.protocol}</> : null}
              </>
            ),
            status: e.status,
            link: { to: '/experiments/$expId', params: { expId: e.uuid } },
          }))}
        />
        <RegistryGrid
          className="max-md:hidden"
          label={t('projects.experimentsList.title')}
          view={view}
          // The Sort and Group menus above order this list.
          sortable={false}
          rows={gridRows}
          columns={columns}
          getRowId={(e) => e.uuid}
          bulk={bulk}
          rowLabel={(e) => e.id}
          selectable={false}
          onRowClick={(e) => openExperiment(e)}
          isLoading={records.isPending}
        />
        <ExperimentsEmpty
          isLoading={records.isPending}
          visibleCount={visible.length}
          hasProjectAccess={hasProjectAccess}
          query={q}
          searchQuery={search.q ?? ''}
          tab={tab}
          hiddenOld={hiddenOld}
          onIncludeOlder={() => setSearch({ older: true })}
          onClearSearch={() => setSearch({ q: undefined })}
        />
      </div>
      <ExperimentsFooter
        isLoading={records.isPending}
        shown={visible.length}
        total={total}
        loaded={rows.length}
        older={search.older === true}
        isFetching={records.isFetching}
        onLoadMore={() =>
          setLimit((current) => current + EXPERIMENT_LIST_PAGE_SIZE)
        }
      />
    </div>
  )
}

/** Everything the list's toolbar reads and writes: sort, filters and search. */
function ExperimentsToolbar({
  sort,
  onSort,
  search,
  onSearch,
  draftQuery,
  onDraftQuery,
  projectName,
}: {
  sort: 'updated' | 'id'
  onSort: (sort: 'updated' | 'id') => void
  search: ExperimentsSearch
  onSearch: (patch: Partial<ExperimentsSearch>) => void
  draftQuery: string
  onDraftQuery: (value: string) => void
  projectName: string | undefined
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border-subtle px-4 py-2 md:px-6">
      <div className={PHONE_SCROLL_ROW}>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="quiet" />}>
            {t('projects.experimentsList.sort', {
              by:
                sort === 'id'
                  ? t('projects.experimentsList.sortId')
                  : t('projects.experimentsList.sortUpdated'),
            })}
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-[180px]">
            {(['updated', 'id'] as const).map((k) => (
              <DropdownMenuItem
                key={k}
                icon={sort === k ? 'check' : undefined}
                className={sort === k ? '' : 'pl-[30px]'}
                onClick={() => onSort(k)}
              >
                {k === 'id'
                  ? t('projects.experimentsList.sortId')
                  : t('projects.experimentsList.sortUpdated')}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {projectName ? (
          <Button
            variant="quiet"
            icon="x"
            aria-label={t('projects.experimentsList.clearProject')}
            onClick={() => onSearch({ project: undefined })}
          >
            {t('projects.experimentsList.projectFilter', { name: projectName })}
          </Button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="quiet" />}>
            {t('projects.experimentsList.group', {
              by:
                search.group === 'project'
                  ? t('projects.experimentsList.columns.project')
                  : search.group === 'owner'
                    ? t('projects.experimentsList.columns.owner')
                    : t('projects.experimentsList.none'),
            })}
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-[180px]">
            {(
              [
                ['none', t('projects.experimentsList.none')],
                ['project', t('projects.experimentsList.columns.project')],
                ['owner', t('projects.experimentsList.columns.owner')],
              ] as const
            ).map(([value, label]) => {
              const active =
                value === 'none' ? !search.group : search.group === value

              return (
                <DropdownMenuItem
                  key={value}
                  icon={active ? 'check' : undefined}
                  className={active ? '' : 'pl-[30px]'}
                  onClick={() =>
                    onSearch({ group: value === 'none' ? undefined : value })
                  }
                >
                  {label}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        <FilterMenu
          label={t('projects.experimentsList.columns.updated')}
          value={search.older ? 'any' : '30d'}
          options={[
            { value: '30d', label: t('projects.experimentsList.last30') },
            { value: 'any', label: t('projects.experimentsList.anyTime') },
          ]}
          onChange={(v) => onSearch({ older: v === 'any' ? true : undefined })}
        />
      </div>
      <form
        role="search"
        className="relative order-first min-w-0 flex-1 max-lg:basis-full lg:order-none lg:ml-3 lg:w-[280px] lg:flex-none"
        onSubmit={(e) => {
          e.preventDefault()
          onSearch({ q: draftQuery.trim() || undefined })
        }}
      >
        <label htmlFor="exp-search" className="sr-only">
          {t('projects.experimentsList.search')}
        </label>
        <Icon
          name="search"
          size={14}
          className="pointer-events-none absolute left-[9px] top-[8px] text-fg-muted"
        />
        <Input
          id="exp-search"
          type="search"
          placeholder={t('projects.experimentsList.search')}
          value={draftQuery}
          className="h-7 pl-7 max-lg:h-9"
          onChange={(e) => {
            onDraftQuery(e.target.value)

            if (!e.target.value) onSearch({ q: undefined })
          }}
        />
      </form>
    </div>
  )
}

/** Why the list is empty, with the one action that widens it. */
function ExperimentsEmpty({
  isLoading,
  visibleCount,
  hasProjectAccess,
  query,
  searchQuery,
  tab,
  hiddenOld,
  onIncludeOlder,
  onClearSearch,
}: {
  isLoading: boolean
  visibleCount: number
  hasProjectAccess: boolean | undefined
  query: string
  searchQuery: string
  tab: Tab
  hiddenOld: number
  onIncludeOlder: () => void
  onClearSearch: () => void
}) {
  if (isLoading || visibleCount > 0) return null

  const noAccess = hasProjectAccess === false

  return (
    <div
      role="status"
      className="flex flex-col items-center gap-2 px-4 py-12 text-center md:px-6"
    >
      <div className="text-prose font-semibold">
        {noAccess
          ? noProjectAccessTitle('experiments')
          : query
            ? t('projects.experimentsList.noMatch', { query: searchQuery })
            : tabEmptyTitle[tab]}
      </div>
      <div className="max-w-[460px] leading-[19px] text-fg-muted">
        {noAccess
          ? NO_PROJECT_ACCESS_BODY
          : hiddenOld
            ? t('projects.experimentsList.hiddenOld', { count: hiddenOld })
            : t('projects.experimentsList.searched')}
      </div>
      <div className="mt-2 flex gap-1.5">
        {hiddenOld ? (
          <Button onClick={onIncludeOlder}>
            {t('projects.experimentsList.includeOlder', { count: hiddenOld })}
          </Button>
        ) : null}
        {query ? (
          <Button onClick={onClearSearch}>
            {t('projects.experimentsList.clearSearch')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/** How many of the list are shown, and the way to load the rest. */
function ExperimentsFooter({
  isLoading,
  shown,
  total,
  loaded,
  older,
  isFetching,
  onLoadMore,
}: {
  isLoading: boolean
  shown: number
  total: number
  loaded: number
  older: boolean
  isFetching: boolean
  onLoadMore: () => void
}) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-4 border-t border-border px-4 text-label text-fg-muted md:px-6">
      <span>
        {isLoading ? (
          t('common.states.loading')
        ) : (
          <>
            {t('projects.experimentsList.shown', { shown, total })}
            {loaded < total
              ? t('projects.experimentsList.loaded', { count: loaded })
              : ''}
            {older ? '' : t('projects.experimentsList.filtered')}
          </>
        )}
      </span>
      {loaded < total ? (
        <Button
          size="sm"
          variant="quiet"
          className="ml-auto"
          disabled={isFetching}
          onClick={onLoadMore}
        >
          {t('projects.experimentsList.loadMore')}
        </Button>
      ) : null}
    </div>
  )
}

/** The list's own columns, before any the workspace added to experiments. */
function experimentColumns({
  issueCount,
  openExperiment,
  protocolsPending,
  issuesPending,
}: {
  issueCount: (recordId: string) => number
  openExperiment: (row: ExperimentListRow, event?: React.MouseEvent) => void
  protocolsPending: boolean
  issuesPending: boolean
}): RegistryColumn<ExperimentListRow>[] {
  return [
    {
      id: 'identifier',
      header: t('projects.experimentsList.columns.id'),
      accessorFn: (e) => e.id,
      enableHiding: false,
      meta: {
        headerClassName: 'max-xl:hidden',
        cellClassName: 'mono max-xl:hidden',
      },
      cell: ({ row }) => (
        <ObjectLink kind="experiment" identifier={row.original.id} />
      ),
    },
    {
      id: 'title',
      header: t('projects.experimentsList.columns.experiment'),
      accessorFn: (e) => e.title,
      enableHiding: false,
      meta: {
        headerClassName: stickyCol,
        cellClassName: `${stickyCol} max-xl:h-auto max-xl:py-1`,
      },
      cell: ({ row }) => (
        <>
          <Link
            to="/experiments/$expId"
            params={{ expId: row.original.uuid }}
            title={row.original.title}
            className="block max-w-[13rem] truncate text-fg hover:text-link 2xl:max-w-[24rem]"
            onClick={(event) => {
              // The row's own click must not navigate a second time.
              event.stopPropagation()
              openExperiment(row.original, event)
            }}
          >
            {row.original.title}
          </Link>
          <span className="mono block text-[11px] text-fg-muted xl:hidden">
            {row.original.id}
          </span>
        </>
      ),
    },
    {
      id: 'project',
      header: t('projects.experimentsList.columns.project'),
      accessorFn: (e) => e.project,
      cell: ({ row }) =>
        row.original.projectId ? (
          <Link
            to="/projects/$projectId"
            params={{ projectId: row.original.projectId }}
            title={row.original.project}
            className="block max-w-[13rem] truncate text-fg hover:text-link 2xl:max-w-[24rem]"
            onClick={(event) => event.stopPropagation()}
          >
            {row.original.project}
          </Link>
        ) : (
          <span className="text-fg-muted">—</span>
        ),
    },
    {
      id: 'owner',
      header: t('projects.experimentsList.columns.owner'),
      accessorFn: (e) => e.owner,
    },
    {
      id: 'assignee',
      header: t('projects.experimentsList.columns.assignee'),
      accessorFn: (e) => e.assignee ?? undefined,
      cell: ({ row }) =>
        row.original.assignee ?? <span className="text-fg-muted">—</span>,
    },
    {
      id: 'protocol',
      header: t('projects.experimentsList.columns.protocol'),
      accessorFn: (e) =>
        e.protocolVersion ? `${e.protocol} v${e.protocolVersion}` : e.protocol,
      cell: ({ row }) =>
        row.original.protocolRecordId ? (
          <Link
            to="/protocols/$protocolId"
            params={{ protocolId: row.original.protocolRecordId }}
            className="text-fg hover:text-link"
            onClick={(event) => event.stopPropagation()}
          >
            {row.original.protocol}
            {row.original.protocolVersion
              ? ` v${row.original.protocolVersion}`
              : ''}
          </Link>
        ) : protocolsPending ? (
          <Skeleton className="h-3 w-16" />
        ) : (
          row.original.protocol
        ),
    },
    {
      id: 'status',
      header: t('projects.experimentsList.columns.status'),
      accessorFn: (e) => e.status.label,
      cell: ({ row }) => (
        <Status tone={row.original.status.tone}>
          {row.original.status.label}
        </Status>
      ),
    },
    {
      id: 'issues',
      header: t('projects.experimentsList.columns.issues'),
      accessorFn: (e) => issueCount(e.uuid),
      cell: ({ row }) =>
        issuesPending ? (
          <Skeleton className="h-3 w-6" />
        ) : (
          <span
            className={
              issueCount(row.original.uuid) > 0
                ? 'text-warning-text'
                : 'text-fg-muted'
            }
          >
            {issueCount(row.original.uuid) > 0
              ? issueCount(row.original.uuid)
              : '—'}
          </span>
        ),
    },
    {
      id: 'created',
      header: t('projects.experimentsList.columns.started'),
      accessorFn: (e) => e.createdAt,
      meta: { headerClassName: 'text-right', cellClassName: 'text-right' },
      // The model carries no start date, so a record that has not begun
      // (a draft, or one still being planned) shows none.
      cell: ({ row }) => (
        <span className="text-fg-muted">
          {row.original.status.label === 'Draft' ||
          row.original.status.label === 'Planned'
            ? '—'
            : formatListDate(row.original.createdAt, now())}
        </span>
      ),
    },
    {
      id: 'updated',
      header: t('projects.experimentsList.columns.updated'),
      accessorFn: (e) => e.updatedAt,
      meta: { headerClassName: 'text-right', cellClassName: 'text-right' },
      cell: ({ row }) => (
        <span className="text-fg-muted">
          {formatListDate(row.original.updatedAt, now())}
        </span>
      ),
    },
  ]
}

/** The list's title, its New actions and the tab strip. */
function ExperimentsHeader({
  canWrite,
  workspaceId,
  total,
  tab,
  search,
  counts,
}: {
  canWrite: boolean
  workspaceId: string | undefined
  total: number | undefined
  tab: Tab
  search: ExperimentsSearch
  counts: Record<Tab, number> | undefined
}) {
  return (
    <ListHeader
      title={t('projects.experimentsList.title')}
      total={total}
      actions={
        canWrite ? (
          <>
            <RepeatingDialog
              kind="experiment"
              workspaceId={workspaceId}
              actions={<RepeatExperimentDialog workspaceId={workspaceId} />}
            />
            <PlanWithAi />
            <Button
              variant="primary"
              icon="plus"
              nativeButton={false}
              render={<Link to="/experiments/new" />}
            >
              {t('projects.experimentsList.new')}
            </Button>
          </>
        ) : (
          <ReadOnlyNote>
            {t('common.readOnly.cannotAdd', {
              things: t('common.readOnly.things.experiments'),
            })}
          </ReadOnlyNote>
        )
      }
      tabs={
        <Tabs
          mode="url"
          value={tab}
          className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0"
          label={t('projects.experimentsList.views')}
          items={tabs.map((name) => ({
            key: name,
            label: tabLabel[name],
            count: !counts ? undefined : counts[name],
            link: {
              to: '/experiments',
              search: { ...search, tab: name === 'all' ? undefined : name },
            },
          }))}
        />
      }
    />
  )
}

/** The name the project filter's chip shows, or undefined when unfiltered. */
function projectFilterLabel(
  rows: readonly ExperimentListRow[],
  projects: ReadonlyMap<string, string> | undefined,
  projectId: string | undefined,
): string | undefined {
  if (!projectId) return undefined

  return (
    rows.find((r) => r.projectId === projectId)?.project ??
    projects?.get(projectId) ??
    t('projects.experimentsList.selected')
  )
}

/** The rows under their group band, or one ungrouped band. */
function groupedRows(
  visible: readonly ExperimentListRow[],
  group: ExperimentsSearch['group'],
): [string | null, ExperimentListRow[]][] {
  if (!group) return [[null, [...visible]]]

  const keys = new Set(
    visible.map((r) => (group === 'project' ? r.project : r.owner)),
  )

  return [...keys].map((key) => [
    key,
    visible.filter((r) =>
      group === 'project' ? r.project === key : r.owner === key,
    ),
  ])
}
