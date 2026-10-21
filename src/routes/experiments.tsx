import { useMemo, useState } from 'react'
import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'

import { Button } from '#/components/v3/ui/button'
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
import { ListHeader } from '#/components/v3/inventory/list'
import { Chip } from '#/components/v3/ui/chip'
import { MobileList, stickyCol } from '#/components/v3/projects/mobile-list'
import {
  EXPERIMENT_LIST_PAGE_SIZE,
  toExperimentListRow,
  useExperimentOpenIssues,
  useExperimentProtocols,
  useExperimentRecords,
  useExperimentTabCounts,
  useProjectNameMap,
} from '#/components/v3/experiments/experiments-data'
import type {
  ExperimentListRow,
  ExperimentTabKey,
} from '#/components/v3/experiments/experiments-data'
import { useUserNames } from '#/lib/user-names'
import { signInRedirect } from '#/lib/sign-in-redirect'

const tabs = [
  'all',
  'mine',
  'inprogress',
  'onhold',
  'inreview',
  'approved',
  'drafts',
  'archived',
] as const satisfies readonly ExperimentTabKey[]
type Tab = (typeof tabs)[number]
const tabLabel: Record<Tab, string> = {
  all: 'All',
  mine: 'Mine',
  inprogress: 'In progress',
  onhold: 'On hold',
  inreview: 'In review',
  approved: 'Approved',
  drafts: 'Drafts',
  archived: 'Archived',
}
/** Empty-state titles. Interpolating the tab label read "No all experiments". */
const tabEmptyTitle: Record<Tab, string> = {
  all: 'No experiments',
  mine: 'No experiments you own',
  inprogress: 'No experiments in progress',
  onhold: 'No experiments on hold',
  inreview: 'No experiments in review',
  approved: 'No approved experiments',
  drafts: 'No draft experiments',
  archived: 'No archived experiments',
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
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const tab: Tab = search.tab ?? 'all'
  const [limit, setLimit] = useState(EXPERIMENT_LIST_PAGE_SIZE)
  const records = useExperimentRecords(context.workspace?.id, limit)
  const tabCounts = useExperimentTabCounts(context.user.id)
  const openIssues = useExperimentOpenIssues(context.workspace?.id)
  const issueCount = (recordId: string) => openIssues.data?.get(recordId) ?? 0
  const projects = useProjectNameMap()
  const experimentIds = useMemo(
    () => (records.data ?? []).map((r) => r.id),
    [records.data],
  )
  const protocols = useExperimentProtocols(experimentIds)
  const [sort, setSort] = useState<'updated' | 'id'>('updated')
  const [draftQ, setDraftQ] = useState(search.q ?? '')

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
            }
          : row
      }),
    [records.data, projects.data, ownerNames, protocols.data],
  )

  // A record's status tab comes from the same table the tab counts are built
  // from, so a tab filters exactly the rows it counts — and no experiment
  // status falls outside every tab.
  const inTab = (row: ExperimentListRow, t: Tab): boolean =>
    t === 'all'
      ? row.statusTab !== 'archived'
      : t === 'mine'
        ? row.ownerId === context.user.id && row.statusTab !== 'archived'
        : row.statusTab === t
  const loadedCounts = Object.fromEntries(
    tabs.map((t) => [t, rows.filter((r) => inTab(r, t)).length]),
  ) as Record<Tab, number>
  // Exact totals once they arrive; the loaded rows stand in while they load so
  // the tabs never flash zeros.
  const counts = search.project
    ? loadedCounts
    : (tabCounts.data ?? loadedCounts)
  const total = counts.all
  const q = (search.q ?? '').trim().toLowerCase()
  const base = rows.filter(
    (r) =>
      inTab(r, tab) &&
      (!search.project || r.projectId === search.project) &&
      (!q ||
        [r.id, r.title, r.project, r.owner].some((v) =>
          v.toLowerCase().includes(q),
        )),
  )
  const hasProjectAccess = useHasProjectAccess()
  const visible = base
    .filter((r) => search.older || r.recent)
    .sort((a, b) =>
      sort === 'id'
        ? b.id.localeCompare(a.id)
        : b.updated.localeCompare(a.updated),
    )
  const hiddenOld = search.older ? 0 : base.length - visible.length
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

  const columns = useMemo<RegistryColumn<ExperimentListRow>[]>(
    () => [
      {
        id: 'identifier',
        header: 'ID',
        meta: {
          headerClassName: 'max-xl:hidden',
          cellClassName: 'mono max-xl:hidden',
        },
        cell: ({ row }) => <span className="mono">{row.original.id}</span>,
      },
      {
        id: 'title',
        header: 'Experiment',
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
        header: 'Project',
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
        header: 'Owner',
        accessorFn: (e) => e.owner,
      },
      {
        id: 'protocol',
        header: 'Protocol',
        cell: ({ row }) =>
          row.original.protocolRecordId ? (
            <Link
              to="/protocols/$protocolId"
              params={{ protocolId: row.original.protocolRecordId }}
              className="text-fg hover:text-link"
              onClick={(event) => event.stopPropagation()}
            >
              {row.original.protocol}
            </Link>
          ) : (
            row.original.protocol
          ),
      },
      {
        id: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <Status tone={row.original.status.tone}>
            {row.original.status.label}
          </Status>
        ),
      },
      {
        id: 'issues',
        header: 'Open issues',
        cell: ({ row }) => (
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
        header: 'Created',
        accessorFn: (e) => e.created,
        meta: { headerClassName: 'text-right', cellClassName: 'text-right' },
        cell: ({ row }) => (
          <span className="text-fg-muted">{row.original.created}</span>
        ),
      },
      {
        id: 'updated',
        header: 'Updated',
        accessorFn: (e) => e.updated,
        meta: { headerClassName: 'text-right', cellClassName: 'text-right' },
        cell: ({ row }) => (
          <span className="text-fg-muted">{row.original.updated}</span>
        ),
      },
    ],
    [issueCount],
  )

  // A grouped list draws its groups as bands in the one table.
  const gridRows: RegistryRow<ExperimentListRow>[] = groups.flatMap(
    ([g, list]) => (g ? [bandRow(g, list.length), ...list] : list),
  )

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <ListHeader
        title="Experiments"
        total={hasProjectAccess === false ? undefined : total}
        actions={
          <Button
            variant="primary"
            icon="plus"
            nativeButton={false}
            render={<Link to="/experiments/new" />}
          >
            New experiment
          </Button>
        }
        tabs={
          <Tabs
            mode="url"
            value={tab}
            className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0"
            label="Experiment views"
            items={tabs.map((t) => ({
              key: t,
              label: tabLabel[t],
              count: counts[t],
              link: {
                to: '/experiments',
                search: { ...search, tab: t === 'all' ? undefined : t },
              },
            }))}
          />
        }
      />

      <div className="flex flex-wrap items-center gap-1 border-b border-border-subtle px-4 py-2 md:px-6">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="quiet" />}>
            Sort: {sort === 'id' ? 'ID' : 'Updated'}
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-[180px]">
            {(['updated', 'id'] as const).map((k) => (
              <DropdownMenuItem
                key={k}
                icon={sort === k ? 'check' : undefined}
                className={sort === k ? '' : 'pl-[30px]'}
                onClick={() => setSort(k)}
              >
                {k === 'id' ? 'ID' : 'Updated'}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {search.project ? (
          <Button
            variant="quiet"
            icon="x"
            aria-label="Clear the project filter"
            onClick={() => setSearch({ project: undefined })}
          >
            Project:{' '}
            {rows.find((r) => r.projectId === search.project)?.project ??
              projects.data?.get(search.project) ??
              'selected'}
          </Button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="quiet" />}>
            Group:{' '}
            {search.group === 'project'
              ? 'Project'
              : search.group === 'owner'
                ? 'Owner'
                : 'None'}
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-[180px]">
            {(
              [
                ['none', 'None'],
                ['project', 'Project'],
                ['owner', 'Owner'],
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
          label="Updated"
          value={search.older ? 'any' : '30d'}
          options={[
            { value: '30d', label: 'Last 30 days' },
            { value: 'any', label: 'Any time' },
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
            Search experiments
          </label>
          <Icon
            name="search"
            size={14}
            className="pointer-events-none absolute left-[9px] top-[8px] text-fg-muted"
          />
          <Input
            id="exp-search"
            type="search"
            placeholder="Search experiments"
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
            removeLabel="Remove filter: updated in last 30 days"
            onRemove={() => setSearch({ older: true })}
          >
            Updated in last 30 days
          </Chip>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto border-t border-border">
        <MobileList
          className="md:hidden"
          label="Experiments"
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
          label="Experiments"
          rows={gridRows}
          columns={columns}
          getRowId={(e) => e.uuid}
          selectable={false}
          onRowClick={(e) =>
            void navigate({
              to: '/experiments/$expId',
              params: { expId: e.uuid },
            })
          }
        />
        {!visible.length ? (
          <div
            role="status"
            className="flex flex-col items-center gap-2 px-4 py-12 text-center md:px-6"
          >
            <div className="text-prose font-semibold">
              {hasProjectAccess === false
                ? noProjectAccessTitle('experiments')
                : q
                  ? `No experiments match “${search.q}”`
                  : tabEmptyTitle[tab]}
            </div>
            <div className="max-w-[460px] leading-[19px] text-fg-muted">
              {hasProjectAccess === false
                ? NO_PROJECT_ACCESS_BODY
                : hiddenOld
                  ? `${hiddenOld} older ${hiddenOld === 1 ? 'experiment matches' : 'experiments match'} outside the last 30 days.`
                  : 'Searched IDs, titles, projects and owners.'}
            </div>
            <div className="mt-2 flex gap-1.5">
              {hiddenOld ? (
                <Button onClick={() => setSearch({ older: true })}>
                  Include older ({hiddenOld})
                </Button>
              ) : null}
              {q ? (
                <Button onClick={() => setSearch({ q: undefined })}>
                  Clear search
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
      <div className="flex h-8 shrink-0 items-center gap-4 border-t border-border px-4 text-label text-fg-muted md:px-6">
        <span>
          {visible.length} of {total}
          {rows.length < total ? ` · ${rows.length} loaded` : ''}
          {search.older ? '' : ' · filtered to last 30 days'}
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
            Load more
          </Button>
        ) : null}
      </div>
    </div>
  )
}
