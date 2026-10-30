import { useCallback, useMemo, useState } from 'react'
import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'

import { Skeleton } from '#/components/v3/ui/skeleton'
import { Button } from '#/components/v3/ui/button'
import {
  openBesideOnAlt,
  useWorkspaceNavigation,
} from '#/components/workspace/workspace-navigation'
import {
  NO_PROJECT_ACCESS_BODY,
  noProjectAccessTitle,
  useHasProjectAccess,
} from '#/components/v3/projects/project-access'
import { Status } from '#/components/v3/ui/status'
import { Input } from '#/components/v3/ui/input'
import { Icon } from '#/components/v3/icons'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/v3/ui/dropdown-menu'
import { RegistryGrid, bandRow } from '#/components/v3/inventory/registry-grid'
import type {
  RegistryColumn,
  RegistryRow,
} from '#/components/v3/inventory/registry-grid'
import { FilterMenu } from '#/components/v3/ui/filter-menu'
import { Tabs } from '#/components/v3/ui/tabs'
import { ListHeader, ReadOnlyNote } from '#/components/v3/inventory/list'
import { Chip } from '#/components/v3/ui/chip'
import { MobileList, stickyCol } from '#/components/v3/projects/mobile-list'
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
} from '#/components/v3/experiments/experiments-data'
import type {
  ExperimentListRow,
  ExperimentListScope,
  ExperimentTabKey,
} from '#/components/v3/experiments/experiments-data'
import { now } from '#/lib/clock'
import { formatListDate } from '#/lib/list-date'
import { useUserNames } from '#/lib/user-names'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { t } from '#/copy'
import { hasCapability } from '#/lib/capability'
import {
  useAddedFieldListColumns,
  withAddedColumns,
} from '#/components/v3/models/added-fields'

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
    search: Record<string, unknown>,
  ): {
    tab?: Tab
    q?: string
    project?: string
    older?: boolean
    group?: 'project' | 'owner'
  } => ({
    tab: tabs.includes(search.tab as Tab) ? (search.tab as Tab) : undefined,
    q: typeof search.q === 'string' ? search.q : undefined,
    project:
      typeof search.project === 'string' && search.project
        ? search.project
        : undefined,
    older: search.older === true || search.older === 'true' || undefined,
    group:
      search.group === 'project' || search.group === 'owner'
        ? search.group
        : undefined,
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

function Experiments() {
  const { context } = Route.useRouteContext()
  const canWrite = hasCapability(context.workspace?.role, 'record.create')
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
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
        ? [...(projects.data ?? new Map<string, string>()).entries()]
            .filter(([, title]) =>
              title.toLowerCase().includes(q.toLowerCase()),
            )
            .map(([id]) => id)
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
  const issueCount = (recordId: string) => openIssues.data?.get(recordId) ?? 0
  const experimentIds = useMemo(
    () => (records.data ?? []).map((r) => r.id),
    [records.data],
  )
  const protocols = useExperimentProtocols(experimentIds)

  const ownerIds = useMemo(
    () => (records.data ?? []).map((r) => r.created_by_user_id),
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
  const groups: [string | null, ExperimentListRow[]][] = search.group
    ? [
        ...new Set(
          visible.map((r) =>
            search.group === 'project' ? r.project : r.owner,
          ),
        ),
      ].map((g) => [
        g,
        visible.filter((r) =>
          search.group === 'project' ? r.project === g : r.owner === g,
        ),
      ])
    : [[null, visible]]

  const setSearch = (patch: Partial<typeof search>) =>
    void navigate({ search: (s) => ({ ...s, ...patch }) })

  const addedColumns = useAddedFieldListColumns<ExperimentListRow>(
    'experiment',
    'uuid',
  )
  const baseColumns = useMemo<RegistryColumn<ExperimentListRow>[]>(
    () => [
      {
        id: 'identifier',
        header: t('projects.experimentsList.columns.id'),
        meta: {
          headerClassName: 'max-xl:hidden',
          cellClassName: 'mono max-xl:hidden',
        },
        cell: ({ row }) => <span className="mono">{row.original.id}</span>,
      },
      {
        id: 'title',
        header: t('projects.experimentsList.columns.experiment'),
        meta: {
          headerClassName: stickyCol,
          cellClassName: `${stickyCol} max-xl:h-auto max-xl:py-1`,
        },
        cell: ({ row }) => (
          <>
            <Link
              to="/experiments/$expId"
              params={{ expId: row.original.uuid }}
              className="text-fg hover:text-link"
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
        cell: ({ row }) =>
          row.original.projectId ? (
            <Link
              to="/projects/$projectId"
              params={{ projectId: row.original.projectId }}
              className="text-fg hover:text-link"
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
        id: 'protocol',
        header: t('projects.experimentsList.columns.protocol'),
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
          ) : protocols.isPending ? (
            <Skeleton className="h-3 w-16" />
          ) : (
            row.original.protocol
          ),
      },
      {
        id: 'status',
        header: t('projects.experimentsList.columns.status'),
        cell: ({ row }) => (
          <Status tone={row.original.status.tone}>
            {row.original.status.label}
          </Status>
        ),
      },
      {
        id: 'issues',
        header: t('projects.experimentsList.columns.issues'),
        cell: ({ row }) =>
          openIssues.isPending ? (
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
    ],
    [issueCount, openExperiment, protocols.isPending, openIssues.isPending],
  )
  const columns = useMemo(
    () => withAddedColumns(baseColumns, addedColumns),
    [baseColumns, addedColumns],
  )

  // A grouped list draws its groups as bands in the one table.
  const gridRows: RegistryRow<ExperimentListRow>[] = groups.flatMap(
    ([g, list]) => (g ? [bandRow(g, list.length), ...list] : list),
  )

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <ListHeader
        title={t('projects.experimentsList.title')}
        total={
          hasProjectAccess === false || records.isPending ? undefined : total
        }
        actions={
          canWrite ? (
            <Button
              variant="primary"
              icon="plus"
              nativeButton={false}
              render={<Link to="/experiments/new" />}
            >
              {t('projects.experimentsList.new')}
            </Button>
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

      <div className="flex flex-wrap items-center gap-1 border-b border-border-subtle px-4 py-2 md:px-6">
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
                onClick={() => setSort(k)}
              >
                {k === 'id'
                  ? t('projects.experimentsList.sortId')
                  : t('projects.experimentsList.sortUpdated')}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {search.project ? (
          <Button
            variant="quiet"
            icon="x"
            aria-label={t('projects.experimentsList.clearProject')}
            onClick={() => setSearch({ project: undefined })}
          >
            {t('projects.experimentsList.projectFilter', {
              name:
                rows.find((r) => r.projectId === search.project)?.project ??
                projects.data?.get(search.project) ??
                t('projects.experimentsList.selected'),
            })}
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
                    setSearch({ group: value === 'none' ? undefined : value })
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
          onChange={(v) => setSearch({ older: v === 'any' ? true : undefined })}
        />
        <form
          role="search"
          className="relative order-first min-w-0 flex-1 max-lg:basis-full lg:order-none lg:ml-3 lg:w-[280px] lg:flex-none"
          onSubmit={(e) => {
            e.preventDefault()
            setSearch({ q: draftQ.trim() || undefined })
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
            value={draftQ}
            className="h-7 pl-7 max-lg:h-9"
            onChange={(e) => {
              setDraftQ(e.target.value)
              if (!e.target.value) setSearch({ q: undefined })
            }}
          />
        </form>
      </div>

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

      <div className="min-h-0 flex-1 overflow-auto border-t border-border">
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
          rows={gridRows}
          columns={columns}
          getRowId={(e) => e.uuid}
          selectable={false}
          onRowClick={(e) => openExperiment(e)}
          isLoading={records.isPending}
        />
        {!records.isPending && !visible.length ? (
          <div
            role="status"
            className="flex flex-col items-center gap-2 px-4 py-12 text-center md:px-6"
          >
            <div className="text-prose font-semibold">
              {hasProjectAccess === false
                ? noProjectAccessTitle('experiments')
                : q
                  ? t('projects.experimentsList.noMatch', {
                      query: search.q ?? '',
                    })
                  : tabEmptyTitle[tab]}
            </div>
            <div className="max-w-[460px] leading-[19px] text-fg-muted">
              {hasProjectAccess === false
                ? NO_PROJECT_ACCESS_BODY
                : hiddenOld
                  ? t('projects.experimentsList.hiddenOld', {
                      count: hiddenOld,
                    })
                  : t('projects.experimentsList.searched')}
            </div>
            <div className="mt-2 flex gap-1.5">
              {hiddenOld ? (
                <Button onClick={() => setSearch({ older: true })}>
                  {t('projects.experimentsList.includeOlder', {
                    count: hiddenOld,
                  })}
                </Button>
              ) : null}
              {q ? (
                <Button onClick={() => setSearch({ q: undefined })}>
                  {t('projects.experimentsList.clearSearch')}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
      <div className="flex h-8 shrink-0 items-center gap-4 border-t border-border px-4 text-label text-fg-muted md:px-6">
        <span>
          {records.isPending ? (
            t('common.states.loading')
          ) : (
            <>
              {t('projects.experimentsList.shown', {
                shown: visible.length,
                total,
              })}
              {rows.length < total
                ? t('projects.experimentsList.loaded', { count: rows.length })
                : ''}
              {search.older ? '' : t('projects.experimentsList.filtered')}
            </>
          )}
        </span>
        {rows.length < total ? (
          <Button
            size="sm"
            variant="quiet"
            className="ml-auto"
            disabled={records.isFetching}
            onClick={() =>
              setLimit((current) => current + EXPERIMENT_LIST_PAGE_SIZE)
            }
          >
            {t('projects.experimentsList.loadMore')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
