import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useWorkspaceNavigation } from '#/components/workspace/workspace-navigation'
import { projectPath } from '#/lib/navigation'
import type { LinkProps } from '@tanstack/react-router'
import { Button } from '#/components/v3/ui/button'
import { copyText } from '#/components/v3/ui/copy-button'
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from '#/components/v3/ui/collapsible'
import {
  NO_PROJECT_ACCESS_BODY,
  noProjectAccessTitle,
  useHasProjectAccess,
} from './project-access'
import { Status } from '#/components/v3/ui/status'
import { Checkbox } from '#/components/v3/ui/checkbox'
import { Field, Input } from '#/components/v3/ui/input'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from '#/components/v3/ui/confirm-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/v3/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { Icon } from '#/components/v3/icons'
import { toast } from '#/components/v3/ui/sonner'
import { Tabs } from '#/components/v3/ui/tabs'
import { MobileList, stickyCol } from './mobile-list'
import { Select } from '#/components/v3/ui/select'
import { Chip } from '#/components/v3/ui/chip'
import { modalities, stages } from './options'
import type { ProjectDetailsInput } from './project-data'
import { projectDataClient, PROJECTS_KEY } from './project-data'
import type { ProjectRow } from './types'
import { cn } from '#/lib/utils'

export type { ProjectRow } from './types'

const tabs = ['all', 'mine', 'inprogress', 'inreview', 'archived'] as const
export type ProjectsTab = (typeof tabs)[number]
const tabLabel: Record<ProjectsTab, string> = {
  all: 'All',
  mine: 'Mine',
  inprogress: 'In progress',
  inreview: 'In review',
  archived: 'Archived',
}
const sorts = { updated: 'Updated', id: 'ID', name: 'Name' } as const
export type ProjectsSort = keyof typeof sorts

/** How a tab treats archived projects. `all` means all, and `archived` means
 * the archived ones; the status tabs list current work, so they hide them until
 * the person lifts the "Status is not Archived" filter — which is stated as a
 * chip whenever it hides anything. */
export type ArchivedMode = 'include' | 'exclude'

export function archivedModeFor(tab: ProjectsTab): ArchivedMode {
  return tab === 'all' || tab === 'archived' ? 'include' : 'exclude'
}

/** Why a create action cannot run, in one voice wherever it is stated. */
const CREATE_DISABLED_REASON = 'Your workspace role cannot create projects.'
const CREATE_DISABLED_BODY =
  'Your role cannot create projects. Ask a workspace owner or admin to create one, or to give you permission to create them.'

export interface ProjectsSearch {
  tab?: ProjectsTab
  q?: string
  /** The person's own archived choice, overriding the tab's default. */
  archived?: ArchivedMode
  stage?: string
  client?: string
  modality?: string
  fields?: string
  sort?: ProjectsSort
  group?: 'none' | 'stage' | 'lead'
  new?: boolean
}

export type NewProjectInput = ProjectDetailsInput & {
  /** A client that does not exist yet: the route creates it, then the project. */
  newClientName?: string | null
}

/**
 * UI port (branch roadmap-4/ui-app3): sheetbase-app-3's Projects screen, wired
 * to real data by the route. Layout and classes are app-3's; the data is
 * `project_list_summary`.
 */
export function ProjectsPage({
  projects,
  me,
  meId,
  canCreate = true,
  loading = false,
  error = null,
  onRetry,
  onOpenProject,
  search,
  setSearch,
  onCreate,
  creating = false,
  createError = null,
  createdProjectId = null,
  clientOptions = [],
  memberOptions = [],
  canCreateClient = false,
}: {
  projects: ProjectRow[]
  me: string
  meId?: string
  canCreate?: boolean
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  /** Opening a project is the route's job: it owns navigation. */
  onOpenProject?: (p: ProjectRow) => void
  search: ProjectsSearch
  setSearch: (patch: Partial<ProjectsSearch>) => void
  onCreate: (input: NewProjectInput) => void
  creating?: boolean
  createError?: string | null
  /** The project the last create produced, from the route's mutation. A create
   * that lands ends the dialog: the route drops `?new=true`, and this closes
   * the dialog the click opened, exactly as the design's `onCreated` closes
   * its URL-gated dialog. */
  createdProjectId?: string | null
  clientOptions?: { id: string; label: string }[]
  memberOptions?: { id: string; label: string }[]
  /** Workspace admins can add the client a project is for as they create it. */
  canCreateClient?: boolean
}) {
  const workspace = useWorkspaceNavigation()
  const navigate = useNavigate()
  const openProject = (project: ProjectRow, event?: React.MouseEvent) => {
    event?.stopPropagation()
    if (
      event &&
      (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0)
    )
      return
    const href = projectPath(project.uuid)
    if (workspace) {
      event?.preventDefault()
      workspace.open(href, { beside: true, title: project.name })
    } else if (!event) {
      if (onOpenProject) onOpenProject(project)
      else void navigate({ href })
    }
  }
  const hasProjectAccess = useHasProjectAccess()
  const tab: ProjectsTab = search.tab ?? 'all'
  const archived: ArchivedMode = search.archived ?? archivedModeFor(tab)
  const sort: ProjectsSort = search.sort ?? 'updated'
  const group = search.group ?? 'none'
  const hidden = new Set(search.fields?.split(',').filter(Boolean) ?? [])
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [draftQ, setDraftQ] = useState(search.q ?? '')
  const [confirmArchive, setConfirmArchive] = useState(false)
  // A create intent arrives from the URL (`?new=true`: the shell's New →
  // Project link, a refresh, a bookmark) or from this page's own button. Once
  // one has arrived the dialog's open state is local: a click's client
  // navigation can be superseded while the page is still loading — the URL
  // commits ?new=true and the page's search never carries it, leaving the
  // button apparently dead — and a close must close whatever the URL holds.
  const [newProjectOpen, setNewProjectOpen] = useState(
    canCreate && !!search.new,
  )
  // Whether a refused intent has already been answered: the param can outlive
  // the navigation that set it, and the person hears the reason once.
  const refusedNewProject = useRef(false)
  const [bulkError, setBulkError] = useState<string | null>(null)
  const queryClient = useQueryClient()
  useEffect(() => setDraftQ(search.q ?? ''), [search.q])

  const requestedNewProject = canCreate && !!search.new
  const lastRequestedNewProject = useRef(requestedNewProject)
  useEffect(() => {
    if (requestedNewProject && !lastRequestedNewProject.current) {
      setNewProjectOpen(true)
    }
    lastRequestedNewProject.current = requestedNewProject
  }, [requestedNewProject])

  // A create that lands ends the intent. The route clears `?new=true` and
  // invalidates the list, but that navigation cannot close a dialog whose open
  // state is local, so the created project itself is the signal: without this
  // the dialog stays up over the list after the write is already done.
  useEffect(() => {
    if (createdProjectId) setNewProjectOpen(false)
  }, [createdProjectId])

  const requestNewProject = () => {
    setNewProjectOpen(true)
    setSearch({ new: true })
  }

  // A create intent the role cannot honour says so, rather than leaving the
  // link or bookmark that carried it apparently dead. The guard resets once the
  // intent is gone, so a later link is answered too — and a param that outlives
  // its navigation is answered once, not on every render.
  useEffect(() => {
    if (!search.new) {
      refusedNewProject.current = false
      return
    }
    if (canCreate || refusedNewProject.current) return
    refusedNewProject.current = true
    toast.error(CREATE_DISABLED_REASON, { description: CREATE_DISABLED_BODY })
    setSearch({ new: undefined })
  }, [search.new, canCreate, setSearch])

  const inTab = (p: ProjectRow, t: ProjectsTab) =>
    t === 'all'
      ? true
      : t === 'mine'
        ? meId
          ? p.leadUserId === meId
          : p.lead === me
        : t === 'inprogress'
          ? p.status.tone === 'progress'
          : t === 'inreview'
            ? p.status.tone === 'review'
            : !!p.archived
  // A tab's count is the number of rows it lists, so the strip and the table
  // agree: every tab's rows pass through the same `inTab` and archived test.
  const counts = Object.fromEntries(
    tabs.map((t) => [
      t,
      projects.filter(
        (p) =>
          inTab(p, t) &&
          ((search.archived ?? archivedModeFor(t)) === 'include' ||
            !p.archived),
      ).length,
    ]),
  ) as Record<ProjectsTab, number>
  const q = (search.q ?? '').trim().toLowerCase()
  const matchesQ = (p: ProjectRow) =>
    !q || [p.name, p.id, p.client].some((s) => s.toLowerCase().includes(q))
  const base = projects.filter(
    (p) =>
      inTab(p, tab) &&
      matchesQ(p) &&
      (!search.stage || p.stage === search.stage) &&
      (!search.client || p.client === search.client) &&
      (!search.modality || p.modality === search.modality),
  )
  const rows = base
    .filter((p) => archived === 'include' || !p.archived)
    .sort((a, b) =>
      sort === 'updated'
        ? b.updated - a.updated || b.id.localeCompare(a.id)
        : sort === 'id'
          ? a.id.localeCompare(b.id)
          : a.name.localeCompare(b.name),
    )
  const archivedHidden =
    archived === 'exclude' ? base.filter((p) => p.archived).length : 0
  const filterCount =
    (archived === 'exclude' ? 1 : 0) +
    (search.stage ? 1 : 0) +
    (search.client ? 1 : 0) +
    (search.modality ? 1 : 0)
  const cols = [
    { key: 'client' as const, label: 'Client' },
    { key: 'modality' as const, label: 'Modality' },
    { key: 'stage' as const, label: 'Stage' },
    { key: 'lead' as const, label: 'Lead' },
    { key: 'experiments' as const, label: 'Experiments' },
  ].filter((c) => !hidden.has(c.key))
  const grouped: [string | null, ProjectRow[]][] =
    group === 'none'
      ? [[null, rows]]
      : [...new Set(rows.map((r) => r[group]))].map((g) => [
          g,
          rows.filter((r) => r[group] === g),
        ])
  // `archive_project`/`unarchive_project` admit a workspace owner or admin
  // only, so the selection exists only for a caller the server will accept.
  const role = useQuery({
    queryKey: ['workspace', 'my-role', meId ?? ''],
    enabled: Boolean(meId),
    queryFn: () =>
      projectDataClient
        .list<{ role: string }>(
          'workspace_memberships',
          `?user_id=eq.${encodeURIComponent(meId ?? '')}&select=role&limit=1`,
        )
        .then((memberships) => memberships[0]?.role ?? null),
    staleTime: 60_000,
  })
  const canBulkArchive = role.data === 'owner' || role.data === 'admin'
  const selected = rows.filter((p) => checked.has(p.id))
  const archivable = selected.filter((p) => !p.archived)
  const restorable = selected.filter((p) => p.archived)

  const bulk = useMutation({
    mutationFn: async (operation: 'archive' | 'restore') => {
      const targets = operation === 'archive' ? archivable : restorable
      const settled = await Promise.allSettled(
        targets.map((p) =>
          projectDataClient.rpc(
            operation === 'archive' ? 'archive_project' : 'unarchive_project',
            { p_project_id: p.uuid },
          ),
        ),
      )
      return {
        operation,
        count: targets.length,
        refused: settled.filter((result) => result.status === 'rejected')
          .length,
      }
    },
    onMutate: () => setBulkError(null),
    onSuccess: ({ operation, count, refused }) => {
      void queryClient.invalidateQueries({ queryKey: PROJECTS_KEY })
      setConfirmArchive(false)
      const done = count - refused
      if (refused) {
        setBulkError(
          `${done} of ${count} ${count === 1 ? 'project was' : 'projects were'} ${operation === 'archive' ? 'archived' : 'restored'}; the server refused the rest.`,
        )
        return
      }
      setChecked(new Set())
      toast(
        `${count} ${count === 1 ? 'project' : 'projects'} ${operation === 'archive' ? 'archived' : 'restored'}`,
      )
    },
    onError: (error: unknown) => {
      setConfirmArchive(false)
      setBulkError(
        error instanceof Error
          ? error.message
          : 'The database refused the change.',
      )
    },
  })
  const colSpan = (canBulkArchive ? 4 : 3) + cols.length
  // A disabled control has to say why (QA2-projects-1): the header button was
  // disabled with no stated reason.
  const createDisabledReason = !canCreate
    ? CREATE_DISABLED_REASON
    : loading
      ? 'Waiting for the project list to load.'
      : null

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className={cn(
            'flex flex-col gap-1 border-b border-border bg-surface px-4 pt-4 md:px-6',
            !projects.length && 'pb-3',
          )}
        >
          <div className="flex max-md:flex-wrap items-center gap-2">
            <h1 className="text-title">Projects</h1>
            {/* A number here would be asserted as fact. While the read is
                unresolved — stalled or failed — the page does not know it. */}
            {loading || error ? null : (
              <span className="num text-body text-fg-muted">
                {projects.length}
              </span>
            )}
            <span className="flex-1" />
            <Button
              variant="primary"
              disabled={!canCreate || loading}
              title={createDisabledReason ?? undefined}
              onClick={requestNewProject}
            >
              New project
            </Button>
          </div>
          {projects.length ? (
            <>
              <Tabs
                mode="url"
                value={tab}
                className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0 max-lg:hidden"
                label="Project views"
                items={tabs.map((t) => ({
                  key: t,
                  label: tabLabel[t],
                  count: counts[t],
                  link: {
                    to: '/projects',
                    search: {
                      ...search,
                      tab: t === 'all' ? undefined : t,
                    },
                  } as LinkProps,
                }))}
              />
              {/* Three tabs plus the "More" menu are wider than the column at
                  400 % zoom, and the row had no way to scroll, so "More" sat
                  past the viewport (QA4-zoom-projects). */}
              <div className="flex flex-wrap items-center gap-5 lg:hidden">
                <Tabs
                  mode="url"
                  value={tab}
                  label="Project views"
                  items={tabs.slice(0, 3).map((t) => ({
                    key: t,
                    label: tabLabel[t],
                    count: counts[t],
                    link: {
                      to: '/projects',
                      search: { ...search, tab: t === 'all' ? undefined : t },
                    } as LinkProps,
                  }))}
                />
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="quiet" />}>
                    More <Icon name="chevronDown" size={12} />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {tabs.slice(3).map((t) => (
                      <DropdownMenuItem
                        key={t}
                        onClick={() => setSearch({ tab: t })}
                      >
                        {tabLabel[t]} {counts[t]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </>
          ) : null}
        </header>

        {error ? (
          <div
            role="alert"
            className="flex flex-col items-center gap-3 px-4 py-14 text-center"
          >
            <h2 className="text-doc">Projects could not be loaded</h2>
            <p className="m-0 text-fg-muted">{error}</p>
            <Button onClick={onRetry}>Try again</Button>
          </div>
        ) : loading ? (
          <p role="status" className="px-6 py-10 text-fg-muted">
            Loading projects…
          </p>
        ) : projects.length ? (
          <>
            <div className="flex items-center gap-1 border-b border-border-subtle px-4 py-2 md:px-6">
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="quiet" />}>
                  <span className="max-lg:hidden">Sort: {sorts[sort]}</span>
                  <span className="lg:hidden">Sort</span>
                  <Icon name="chevronDown" size={12} />
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-[180px]">
                  {(Object.keys(sorts) as ProjectsSort[]).map((k) => (
                    <DropdownMenuItem
                      key={k}
                      icon={sort === k ? 'check' : undefined}
                      className={sort === k ? '' : 'pl-[30px]'}
                      onClick={() => setSearch({ sort: k })}
                    >
                      {sorts[k]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="quiet"
                      className={filterCount ? 'text-link hover:text-link' : ''}
                    />
                  }
                >
                  Filter{filterCount ? ` · ${filterCount}` : ''}
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-[260px]">
                  <DropdownMenuItem
                    icon={archived === 'exclude' ? 'check' : undefined}
                    className={archived === 'exclude' ? '' : 'pl-[30px]'}
                    onClick={() =>
                      setSearch({
                        archived:
                          archived === 'exclude' ? 'include' : 'exclude',
                      })
                    }
                  >
                    Status is not Archived
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Stage is</DropdownMenuLabel>
                    {stages.map((s) => (
                      <DropdownMenuItem
                        key={s}
                        icon={search.stage === s ? 'check' : undefined}
                        className={search.stage === s ? '' : 'pl-[30px]'}
                        onClick={() =>
                          setSearch({
                            stage: search.stage === s ? undefined : s,
                          })
                        }
                      >
                        {s}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                  {(['client', 'modality'] as const).map((field) => (
                    <DropdownMenuGroup key={field}>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel>
                        {field === 'client' ? 'Client is' : 'Modality is'}
                      </DropdownMenuLabel>
                      {[...new Set(projects.map((project) => project[field]))]
                        .sort()
                        .map((value) => (
                          <DropdownMenuItem
                            key={value}
                            icon={search[field] === value ? 'check' : undefined}
                            onClick={() =>
                              setSearch({
                                [field]:
                                  search[field] === value ? undefined : value,
                              })
                            }
                          >
                            {value}
                          </DropdownMenuItem>
                        ))}
                    </DropdownMenuGroup>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="quiet" className="max-lg:hidden" />}
                >
                  {group === 'none'
                    ? 'Group'
                    : `Group: ${group === 'stage' ? 'Stage' : 'Lead'}`}
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-[180px]">
                  {(['none', 'stage', 'lead'] as const).map((g) => (
                    <DropdownMenuItem
                      key={g}
                      icon={group === g ? 'check' : undefined}
                      className={group === g ? '' : 'pl-[30px]'}
                      onClick={() => setSearch({ group: g })}
                    >
                      {g === 'none'
                        ? 'No grouping'
                        : g === 'stage'
                          ? 'Stage'
                          : 'Lead'}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <form
                role="search"
                className="relative order-first min-w-0 flex-1 lg:order-none lg:ml-3 lg:w-[280px] lg:flex-none"
                onSubmit={(e) => {
                  e.preventDefault()
                  setSearch({ q: draftQ.trim() || undefined })
                }}
              >
                <label htmlFor="project-search" className="sr-only">
                  Search projects
                </label>
                <Icon
                  name="search"
                  size={14}
                  className="pointer-events-none absolute left-[9px] top-[8px] text-fg-muted"
                />
                <Input
                  id="project-search"
                  type="search"
                  placeholder="Search projects"
                  value={draftQ}
                  className="h-7 pl-7 max-lg:h-9"
                  onChange={(e) => {
                    setDraftQ(e.target.value)
                    if (!e.target.value) setSearch({ q: undefined })
                  }}
                />
              </form>
              <span className="flex-1 max-lg:hidden" />
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="quiet" className="max-lg:hidden" />}
                >
                  Fields
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[200px]">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Show columns</DropdownMenuLabel>
                    {(
                      [
                        'client',
                        'modality',
                        'stage',
                        'lead',
                        'experiments',
                      ] as const
                    ).map((k) => (
                      <DropdownMenuItem
                        key={k}
                        closeOnClick={false}
                        icon={hidden.has(k) ? undefined : 'check'}
                        className={hidden.has(k) ? 'pl-[30px]' : ''}
                        onClick={() => {
                          const next = new Set(hidden)
                          if (next.has(k)) next.delete(k)
                          else next.add(k)
                          setSearch({
                            fields: [...next].sort().join(',') || undefined,
                          })
                        }}
                      >
                        {k[0].toUpperCase() + k.slice(1)}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      size="icon"
                      className="max-md:hidden"
                      aria-label="More options"
                    />
                  }
                >
                  <Icon name="more" size={14} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[220px]">
                  <DropdownMenuItem
                    icon="copy"
                    onClick={() =>
                      void copyText(window.location.href, {
                        copiedMessage: 'Link to this view copied',
                        failedMessage:
                          'Could not copy the link. Copy it from the address bar.',
                      })
                    }
                  >
                    Copy link to this view
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {filterCount ? (
              <div className="flex flex-wrap items-center gap-2 px-4 py-2 md:px-6">
                {archived === 'exclude' ? (
                  <Chip
                    variant="remove"
                    removeLabel="Remove filter: status is not Archived"
                    onRemove={() => setSearch({ archived: 'include' })}
                  >
                    Status is not <b className="font-medium">Archived</b>
                  </Chip>
                ) : null}
                {search.stage ? (
                  <Chip
                    variant="remove"
                    removeLabel={`Remove filter: stage is ${search.stage}`}
                    onRemove={() => setSearch({ stage: undefined })}
                  >
                    Stage is <b className="font-medium">{search.stage}</b>
                  </Chip>
                ) : null}
                {(['client', 'modality'] as const).map((field) =>
                  search[field] ? (
                    <Chip
                      variant="remove"
                      key={field}
                      removeLabel={`Remove filter: ${field} is ${search[field]}`}
                      onRemove={() => setSearch({ [field]: undefined })}
                    >
                      {field === 'client' ? 'Client' : 'Modality'} is{' '}
                      <b className="font-medium">{search[field]}</b>
                    </Chip>
                  ) : null,
                )}
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-auto border-t border-border">
              <MobileList
                className="md:hidden"
                label="Projects"
                rows={rows.map((p) => ({
                  key: p.id,
                  title: p.name,
                  meta: (
                    <>
                      <span className="mono">{p.id}</span> · {p.client} ·{' '}
                      {p.lead}
                    </>
                  ),
                  status: p.status,
                  link: {
                    to: '/projects/$projectId',
                    params: { projectId: p.uuid },
                    onClick: (event: React.MouseEvent) => openProject(p, event),
                  },
                }))}
              />
              <Table aria-label="Projects" className="max-md:hidden">
                <TableHeader>
                  <TableRow>
                    {canBulkArchive ? (
                      <TableHead className="w-9 max-xl:hidden">
                        <Checkbox
                          aria-label="Select all projects"
                          checked={
                            rows.length > 0 &&
                            rows.every((r) => checked.has(r.id))
                          }
                          onCheckedChange={(on) =>
                            setChecked(
                              on ? new Set(rows.map((r) => r.id)) : new Set(),
                            )
                          }
                        />
                      </TableHead>
                    ) : null}
                    <TableHead className="max-xl:hidden">ID</TableHead>
                    <TableHead className={stickyCol}>Project</TableHead>
                    {cols.map((c) => (
                      <TableHead
                        key={c.key}
                        className={
                          c.key === 'modality' ? 'lg:hidden' : undefined
                        }
                        align={c.key === 'experiments' ? 'right' : undefined}
                      >
                        {c.label}
                      </TableHead>
                    ))}
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length
                    ? grouped.map(([g, list]) => [
                        g ? (
                          <TableRow key={`g-${g}`}>
                            <TableCell
                              colSpan={colSpan}
                              className="bg-surface-muted text-label font-medium text-fg-muted"
                            >
                              {g}{' '}
                              <span className="font-normal">{list.length}</span>
                            </TableCell>
                          </TableRow>
                        ) : null,
                        ...list.map((p) => (
                          <TableRow
                            key={p.id}
                            selected={checked.has(p.id)}
                            className="cursor-pointer"
                            onClick={() => openProject(p)}
                          >
                            {canBulkArchive ? (
                              <TableCell
                                className="max-xl:hidden"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Checkbox
                                  aria-label={`Select ${p.id}`}
                                  checked={checked.has(p.id)}
                                  onCheckedChange={(on) =>
                                    setChecked((s) => {
                                      const n = new Set(s)
                                      if (on) n.add(p.id)
                                      else n.delete(p.id)
                                      return n
                                    })
                                  }
                                />
                              </TableCell>
                            ) : null}
                            <TableCell className="mono text-fg-muted max-xl:hidden">
                              {p.id}
                            </TableCell>
                            <TableCell
                              className={cn(
                                stickyCol,
                                'max-xl:h-auto max-xl:py-1',
                                checked.has(p.id) && 'font-medium',
                              )}
                            >
                              <Link
                                to="/projects/$projectId"
                                params={{ projectId: p.uuid }}
                                onClick={(event) => openProject(p, event)}
                                className="cursor-pointer text-inherit underline-offset-2 hover:underline"
                              >
                                {p.name}
                              </Link>
                              <span className="mono block text-[11px] text-fg-muted xl:hidden">
                                {p.id}
                              </span>
                            </TableCell>
                            {cols.map((c) => (
                              <TableCell
                                key={c.key}
                                className={
                                  c.key === 'modality' ? 'lg:hidden' : undefined
                                }
                                align={
                                  c.key === 'experiments' ? 'right' : undefined
                                }
                              >
                                {c.key === 'experiments'
                                  ? p.experiments
                                  : String(p[c.key])}
                              </TableCell>
                            ))}
                            <TableCell>
                              <span className="flex items-center justify-end gap-2">
                                <Status tone={p.status.tone}>
                                  {p.status.label}
                                </Status>
                                <Button
                                  variant="quiet"
                                  icon="chevronRight"
                                  aria-label={`Open ${p.name}`}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    openProject(p)
                                  }}
                                />
                              </span>
                            </TableCell>
                          </TableRow>
                        )),
                      ])
                    : null}
                </TableBody>
              </Table>
              {!rows.length ? (
                <NoResults
                  q={search.q}
                  tab={tab}
                  archived={archived}
                  archivedMatches={archivedHidden}
                  onIncludeArchived={() => setSearch({ archived: 'include' })}
                  onClear={() =>
                    setSearch({
                      q: undefined,
                      stage: undefined,
                      client: undefined,
                      modality: undefined,
                    })
                  }
                />
              ) : null}
            </div>
            <div className="flex h-8 shrink-0 items-center gap-4 border-t border-border px-4 text-label text-fg-muted md:px-6">
              <span>
                {rows.length} {rows.length === 1 ? 'project' : 'projects'}
              </span>
              {archivedHidden ? (
                <span className="max-lg:hidden">
                  {archivedHidden} archived hidden by filter
                </span>
              ) : null}
              {bulkError ? (
                <span role="alert" className="text-danger-text">
                  {bulkError}
                </span>
              ) : null}
              {checked.size ? (
                <span className="ml-auto flex items-center gap-2 text-fg">
                  <span className="max-xl:hidden">{checked.size} selected</span>
                  {archivable.length ? (
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={bulk.isPending}
                      onClick={() => setConfirmArchive(true)}
                    >
                      Archive {archivable.length}
                    </Button>
                  ) : null}
                  {restorable.length ? (
                    <Button
                      size="sm"
                      disabled={bulk.isPending}
                      onClick={() => bulk.mutate('restore')}
                    >
                      Restore {restorable.length}
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => setChecked(new Set())}
                  >
                    Clear
                  </Button>
                </span>
              ) : null}
            </div>
          </>
        ) : (
          <EmptyProjects
            noAccess={hasProjectAccess === false}
            canCreate={canCreate}
            onNew={requestNewProject}
          />
        )}
      </div>

      <ConfirmDialog open={confirmArchive} onOpenChange={setConfirmArchive}>
        <ConfirmDialogContent className="w-[min(480px,calc(100vw-32px))]">
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              Archive {archivable.length}{' '}
              {archivable.length === 1 ? 'project' : 'projects'}?
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {archivable.map((p) => p.id).join(', ')} · every record becomes
              read-only
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <DialogBody>
            <p className="m-0 text-body leading-5">
              The projects leave the Projects list and the navigation. Signed
              records, datasets and audit trails stay available, and an archived
              project can be restored from the Archived tab.
            </p>
          </DialogBody>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel disabled={bulk.isPending} />
            <ConfirmDialogAction
              variant="danger-fill"
              disabled={bulk.isPending}
              onClick={() => bulk.mutate('archive')}
            >
              Archive{' '}
              {archivable.length === 1 ? 'this project' : 'these projects'}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>

      <NewProjectDialog
        open={newProjectOpen}
        onOpenChange={(open) => {
          if (open) return
          setNewProjectOpen(false)
          if (search.new) setSearch({ new: undefined })
        }}
        onCreate={onCreate}
        creating={creating}
        error={createError}
        clientOptions={clientOptions}
        memberOptions={memberOptions}
        meId={meId}
        canCreateClient={canCreateClient}
      />
    </div>
  )
}

function NoResults({
  q,
  tab,
  archived,
  archivedMatches,
  onIncludeArchived,
  onClear,
}: {
  q?: string
  tab: ProjectsTab
  archived: ArchivedMode
  archivedMatches: number
  onIncludeArchived: () => void
  onClear: () => void
}) {
  return (
    <div
      role="status"
      className="flex flex-col items-center gap-2 px-4 py-12 text-center md:px-6"
    >
      <div className="text-prose font-semibold">
        {q
          ? `No projects match “${q}”`
          : `No ${tabLabel[tab].toLowerCase()} projects`}
      </div>
      <div className="max-w-[460px] leading-[19px] text-fg-muted">
        {q ? (
          <>
            Searched names, IDs and clients in{' '}
            {archived === 'exclude' ? 'non-archived ' : ''}projects.
            {archivedMatches
              ? ` ${archivedMatches} archived ${archivedMatches === 1 ? 'project matches' : 'projects match'}.`
              : ''}
          </>
        ) : archivedMatches ? (
          `Archived projects are read-only. ${archivedMatches} archived ${archivedMatches === 1 ? 'project is' : 'projects are'} hidden by the “Status is not Archived” filter.`
        ) : (
          'Nothing here with the current filters.'
        )}
      </div>
      <div className="mt-2 flex gap-1.5">
        {archivedMatches ? (
          <Button onClick={onIncludeArchived}>
            Include archived ({archivedMatches})
          </Button>
        ) : null}
        {q ? <Button onClick={onClear}>Clear search</Button> : null}
      </div>
    </div>
  )
}

function EmptyProjects({
  onNew,
  noAccess,
  canCreate,
}: {
  onNew: () => void
  noAccess: boolean
  canCreate: boolean
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-14 text-center md:px-6">
      <h2 className="text-doc">
        {noAccess ? noProjectAccessTitle('projects') : 'No projects yet'}
      </h2>
      <p className="m-0 max-w-[460px] leading-[19px] text-fg-muted">
        {noAccess
          ? NO_PROJECT_ACCESS_BODY
          : 'A project groups the experiments, samples and datasets for one programme or client. Members and permissions are set per project.'}
      </p>
      {!noAccess && !canCreate ? (
        <p className="m-0 max-w-[460px] leading-[19px] text-fg-muted">
          {CREATE_DISABLED_BODY}
        </p>
      ) : null}
      <div className="mt-2 flex gap-1.5">
        <Button variant="primary" disabled={!canCreate} onClick={onNew}>
          New project
        </Button>
      </div>
    </div>
  )
}

/** The Client select's value for "create the client as the project is made". */
const NEW_CLIENT = '__new_client__'

function NewProjectDialog({
  open,
  onOpenChange,
  onCreate,
  creating,
  error,
  clientOptions,
  memberOptions,
  meId,
  canCreateClient,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (input: NewProjectInput) => void
  creating: boolean
  error: string | null
  clientOptions: { id: string; label: string }[]
  memberOptions: { id: string; label: string }[]
  meId?: string
  canCreateClient: boolean
}) {
  const [title, setTitle] = useState('')
  const [clientId, setClientId] = useState('')
  const [newClientName, setNewClientName] = useState('')
  const addingClient = clientId === NEW_CLIENT
  const [stage, setStage] = useState('')
  const [modality, setModality] = useState('')
  // The person creating a project leads it unless they pick someone else.
  const [leadChoice, setLeadChoice] = useState<string | null>(null)
  const leadDefault =
    meId && memberOptions.some((member) => member.id === meId) ? meId : ''
  const lead = leadChoice ?? leadDefault
  const setLead = setLeadChoice
  const [reviewer, setReviewer] = useState('')
  const [agreement, setAgreement] = useState('')
  const [startedOn, setStartedOn] = useState('')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(460px,calc(100vw-32px))]">
        <DialogHeader title="New project" />
        <DialogBody>
          <form
            id="new-project-form"
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (!title.trim()) return
              if (addingClient && !newClientName.trim()) return
              onCreate({
                title: title.trim(),
                clientId: addingClient ? null : clientId || null,
                newClientName: addingClient ? newClientName.trim() : null,
                stage: stage || null,
                modality: modality || null,
                leadUserId: lead || null,
                defaultReviewerUserId: reviewer || null,
                agreementReference: agreement || null,
                startedOn: startedOn || null,
              })
            }}
          >
            <Field label="Name">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
                required
                placeholder="e.g. Lentivector stability study"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Client">
                <Select
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                >
                  <option value="">Internal</option>
                  {clientOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                  {canCreateClient ? (
                    <option value={NEW_CLIENT}>New client…</option>
                  ) : null}
                </Select>
              </Field>
              {addingClient ? (
                <Field label="New client name" className="col-span-2">
                  <Input
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                    required
                    placeholder="e.g. AAV Vector Partners"
                  />
                </Field>
              ) : null}
              <Field label="Modality">
                <Select
                  value={modality}
                  onChange={(e) => setModality(e.target.value)}
                >
                  <option value="">—</option>
                  {modalities.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Stage">
                <Select
                  value={stage}
                  onChange={(e) => setStage(e.target.value)}
                >
                  <option value="">—</option>
                  {stages.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Lead">
                <Select value={lead} onChange={(e) => setLead(e.target.value)}>
                  <option value="">Not assigned</option>
                  {memberOptions.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field
              label="Default reviewer"
              hint="Reviews and signatures go to this person unless an experiment names another."
            >
              <Select
                value={reviewer}
                onChange={(e) => setReviewer(e.target.value)}
              >
                <option value="">Not assigned</option>
                {memberOptions.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Collapsible>
              <CollapsibleTrigger>Agreement and start date</CollapsibleTrigger>
              <CollapsiblePanel className="mt-3 grid grid-cols-2 gap-3">
                <Field label="Agreement reference">
                  <Input
                    value={agreement}
                    onChange={(e) => setAgreement(e.target.value)}
                  />
                </Field>
                <Field label="Start date">
                  <Input
                    type="date"
                    value={startedOn}
                    onChange={(e) => setStartedOn(e.target.value)}
                  />
                </Field>
              </CollapsiblePanel>
            </Collapsible>
            {error ? (
              <p role="alert" className="m-0 text-label text-danger-text">
                {error}
              </p>
            ) : null}
          </form>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <Button
            variant="primary"
            type="submit"
            form="new-project-form"
            disabled={
              creating ||
              !title.trim() ||
              (addingClient && !newClientName.trim())
            }
          >
            {creating ? 'Creating…' : 'Create project'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
