import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import type { LinkProps } from '@tanstack/react-router'
import { Button } from '#/components/v3/ui/button'
import { Status } from '#/components/v3/ui/status'
import { Checkbox } from '#/components/v3/ui/checkbox'
import { Field, Input } from '#/components/v3/ui/input'
import {
  DescriptionList,
  Inspector,
  InspectorSection,
} from '#/components/v3/ui/layout'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { SearchTabs } from './search-tabs'
import { MobileList, stickyCol } from './mobile-list'
import { FilterChip } from './chip'
import { NativeSelect } from './select'
import { stages } from './options'
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

export interface ProjectsSearch {
  tab?: ProjectsTab
  q?: string
  archived?: boolean
  stage?: string
  sort?: ProjectsSort
  group?: 'none' | 'stage' | 'lead'
  new?: boolean
}

export interface NewProjectInput {
  title: string
  clientId?: string
  stage?: string
}

/**
 * UI port (branch roadmap-4/ui-app3): sheetbase-app-3's Projects screen, wired
 * to real data by the route. Layout and classes are app-3's; the data is
 * `project_list_summary`.
 */
export function ProjectsPage({
  projects,
  me,
  search,
  setSearch,
  onCreate,
  creating = false,
  createError = null,
  clientOptions = [],
}: {
  projects: ProjectRow[]
  me: string
  search: ProjectsSearch
  setSearch: (patch: Partial<ProjectsSearch>) => void
  onCreate: (input: NewProjectInput) => void
  creating?: boolean
  createError?: string | null
  clientOptions?: { id: string; label: string }[]
}) {
  const tab: ProjectsTab = search.tab ?? 'all'
  const includeArchived = !!search.archived
  const sort: ProjectsSort = search.sort ?? 'updated'
  const group = search.group ?? 'none'
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [active, setActive] = useState<string | null>(null)
  const [draftQ, setDraftQ] = useState(search.q ?? '')

  const inTab = (p: ProjectRow, t: ProjectsTab) =>
    t === 'all'
      ? true
      : t === 'mine'
        ? p.lead === me
        : t === 'inprogress'
          ? p.status.tone === 'progress'
          : t === 'inreview'
            ? p.status.tone === 'review'
            : !!p.archived
  const counts = Object.fromEntries(
    tabs.map((t) => [t, projects.filter((p) => inTab(p, t)).length]),
  ) as Record<ProjectsTab, number>
  const q = (search.q ?? '').trim().toLowerCase()
  const matchesQ = (p: ProjectRow) =>
    !q || [p.name, p.id, p.client].some((s) => s.toLowerCase().includes(q))
  const base = projects.filter(
    (p) =>
      inTab(p, tab) &&
      matchesQ(p) &&
      (!search.stage || p.stage === search.stage),
  )
  const rows = base
    .filter((p) => includeArchived || !p.archived)
    .sort((a, b) =>
      sort === 'updated'
        ? b.updated - a.updated
        : sort === 'id'
          ? b.id.localeCompare(a.id)
          : a.name.localeCompare(b.name),
    )
  const archivedHidden = includeArchived
    ? 0
    : base.filter((p) => p.archived).length
  const activeRow = projects.find((p) => p.id === active) ?? null
  const filterCount = (includeArchived ? 0 : 1) + (search.stage ? 1 : 0)
  const cols = [
    { key: 'client' as const, label: 'Client' },
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
  const colSpan = 5 + cols.length

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className={cn(
            'flex flex-col gap-1 border-b border-border bg-surface px-4 pt-4 md:px-6',
            !projects.length && 'pb-3',
          )}
        >
          <div className="flex items-center gap-2">
            <h1 className="text-title">Projects</h1>
            <span className="num text-body text-fg-muted">
              {projects.length}
            </span>
            <span className="flex-1" />
            <Button variant="primary" onClick={() => setSearch({ new: true })}>
              New project
            </Button>
          </div>
          {projects.length ? (
            <SearchTabs
              className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0"
              label="Project views"
              tabs={tabs.map((t) => ({
                key: t,
                label: tabLabel[t],
                count: counts[t],
                active: t === tab,
                link: {
                  to: '/projects',
                  search: {
                    ...search,
                    tab: t === 'all' ? undefined : t,
                  },
                } as LinkProps,
              }))}
            />
          ) : null}
        </header>

        {projects.length ? (
          <>
            <div className="flex items-center gap-1 border-b border-border-subtle px-4 py-2 md:px-6">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="quiet" className="max-lg:hidden" />}
                >
                  Sort: {sorts[sort]}
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
                    icon={includeArchived ? undefined : 'check'}
                    className={includeArchived ? 'pl-[30px]' : ''}
                    onClick={() =>
                      setSearch({
                        archived: includeArchived ? undefined : true,
                      })
                    }
                  >
                    Status is not Archived
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Stage is</DropdownMenuLabel>
                  {stages.map((s) => (
                    <DropdownMenuItem
                      key={s}
                      icon={search.stage === s ? 'check' : undefined}
                      className={search.stage === s ? '' : 'pl-[30px]'}
                      onClick={() =>
                        setSearch({ stage: search.stage === s ? undefined : s })
                      }
                    >
                      {s}
                    </DropdownMenuItem>
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
                  <DropdownMenuLabel>Show columns</DropdownMenuLabel>
                  {(['client', 'stage', 'lead', 'experiments'] as const).map(
                    (k) => (
                      <DropdownMenuItem
                        key={k}
                        closeOnClick={false}
                        icon={hidden.has(k) ? undefined : 'check'}
                        className={hidden.has(k) ? 'pl-[30px]' : ''}
                        onClick={() =>
                          setHidden((h) => {
                            const n = new Set(h)
                            if (n.has(k)) n.delete(k)
                            else n.add(k)
                            return n
                          })
                        }
                      >
                        {k[0].toUpperCase() + k.slice(1)}
                      </DropdownMenuItem>
                    ),
                  )}
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
                    onClick={() => {
                      void navigator.clipboard.writeText(window.location.href)
                      toast('Link to this view copied')
                    }}
                  >
                    Copy link to this view
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {filterCount ? (
              <div className="flex flex-wrap items-center gap-2 px-4 py-2 md:px-6">
                {!includeArchived ? (
                  <FilterChip
                    removeLabel="Remove filter: status is not Archived"
                    onRemove={() => setSearch({ archived: true })}
                  >
                    Status is not <b className="font-medium">Archived</b>
                  </FilterChip>
                ) : null}
                {search.stage ? (
                  <FilterChip
                    removeLabel={`Remove filter: stage is ${search.stage}`}
                    onRemove={() => setSearch({ stage: undefined })}
                  >
                    Stage is <b className="font-medium">{search.stage}</b>
                  </FilterChip>
                ) : null}
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
                    params: { projectId: p.id },
                  },
                }))}
              />
              <Table aria-label="Projects" className="max-md:hidden">
                <TableHeader>
                  <TableRow>
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
                    <TableHead className="max-xl:hidden">ID</TableHead>
                    <TableHead className={stickyCol}>Project</TableHead>
                    {cols.map((c) => (
                      <TableHead
                        key={c.key}
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
                            selected={active === p.id}
                            className="cursor-pointer"
                            onClick={() => setActive(p.id)}
                          >
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
                            <TableCell className="mono text-fg-muted max-xl:hidden">
                              {p.id}
                            </TableCell>
                            <TableCell
                              className={cn(
                                stickyCol,
                                'max-xl:h-auto max-xl:py-1',
                                active === p.id && 'font-medium',
                              )}
                            >
                              <button
                                type="button"
                                className="cursor-pointer border-0 bg-transparent p-0 text-left text-inherit font-[inherit]"
                                aria-label={`Show details for ${p.name}`}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setActive(p.id)
                                }}
                              >
                                {p.name}
                              </button>
                              <span className="mono block text-[11px] text-fg-muted xl:hidden">
                                {p.id}
                              </span>
                            </TableCell>
                            {cols.map((c) => (
                              <TableCell
                                key={c.key}
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
                              <Status tone={p.status.tone}>
                                {p.status.label}
                              </Status>
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
                  includeArchived={includeArchived}
                  archivedMatches={archivedHidden}
                  onIncludeArchived={() => setSearch({ archived: true })}
                  onClear={() => setSearch({ q: undefined, stage: undefined })}
                />
              ) : null}
            </div>
            <div className="flex h-8 shrink-0 items-center gap-4 border-t border-border px-4 text-label text-fg-muted md:px-6">
              <span>
                {rows.length} {rows.length === 1 ? 'project' : 'projects'}
              </span>
              {archivedHidden ? (
                <span className="max-md:hidden">
                  {archivedHidden} archived hidden by filter
                </span>
              ) : null}
              {checked.size ? (
                <span className="ml-auto text-fg max-xl:hidden">
                  {checked.size} selected
                </span>
              ) : null}
            </div>
          </>
        ) : (
          <EmptyProjects onNew={() => setSearch({ new: true })} />
        )}
      </div>

      {activeRow ? (
        <ProjectPeek p={activeRow} onClose={() => setActive(null)} />
      ) : null}

      <NewProjectDialog
        open={!!search.new}
        onOpenChange={(o) => setSearch({ new: o ? true : undefined })}
        onCreate={onCreate}
        creating={creating}
        error={createError}
        clientOptions={clientOptions}
      />
    </div>
  )
}

function NoResults({
  q,
  tab,
  includeArchived,
  archivedMatches,
  onIncludeArchived,
  onClear,
}: {
  q?: string
  tab: ProjectsTab
  includeArchived: boolean
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
            {includeArchived ? '' : 'non-archived '}projects.
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

function EmptyProjects({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-14 text-center md:px-6">
      <h2 className="text-doc">No projects yet</h2>
      <p className="m-0 max-w-[460px] leading-[19px] text-fg-muted">
        A project groups the experiments, samples and datasets for one programme
        or client. Members and permissions are set per project.
      </p>
      <div className="mt-2 flex gap-1.5">
        <Button variant="primary" onClick={onNew}>
          New project
        </Button>
      </div>
    </div>
  )
}

function ProjectPeek({ p, onClose }: { p: ProjectRow; onClose: () => void }) {
  const details: [string, React.ReactNode][] = [
    ['ID', <span className="mono">{p.id}</span>],
    ['Client', p.client],
    ['Modality', p.modality],
    ['Stage', p.stage],
    ['Lead', p.lead],
    ['Experiments', String(p.experiments)],
    ...(p.milestone
      ? [['Milestone', p.milestone] as [string, React.ReactNode]]
      : []),
  ]
  return (
    <Inspector aria-label="Project details" className="w-[320px] gap-0 p-0">
      <div className="flex flex-col gap-1 border-b border-border px-4 pb-3 pt-3.5">
        <div className="flex items-center gap-1.5">
          <span className="mono text-fg-muted">{p.id}</span>
          <span className="flex-1" />
          <Button
            size="icon"
            variant="quiet"
            className="size-6"
            aria-label="Close details"
            onClick={onClose}
          >
            <Icon name="x" size={12} />
          </Button>
        </div>
        <div className="font-heading text-doc font-semibold">{p.name}</div>
        <div className="flex items-center gap-2.5 text-label">
          <Status tone={p.status.tone}>{p.status.label}</Status>
          <Link
            to="/projects/$projectId"
            params={{ projectId: p.id }}
            className="ml-auto"
          >
            Open project
          </Link>
        </div>
      </div>
      <InspectorSection title="Details">
        <DescriptionList labelWidth={112} items={details} />
      </InspectorSection>
    </Inspector>
  )
}

function NewProjectDialog({
  open,
  onOpenChange,
  onCreate,
  creating,
  error,
  clientOptions,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (input: NewProjectInput) => void
  creating: boolean
  error: string | null
  clientOptions: { id: string; label: string }[]
}) {
  const [title, setTitle] = useState('')
  const [clientId, setClientId] = useState('')
  const [stage, setStage] = useState('')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader title="New project" />
        <DialogBody>
          <form
            id="new-project-form"
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (!title.trim()) return
              onCreate({
                title: title.trim(),
                clientId: clientId || undefined,
                stage: stage || undefined,
              })
            }}
          >
            <Field label="Title">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
                required
                placeholder="e.g. Lentivector stability study"
              />
            </Field>
            <Field label="Client">
              <NativeSelect
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              >
                <option value="">Internal</option>
                {clientOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Stage">
              <NativeSelect
                value={stage}
                onChange={(e) => setStage(e.target.value)}
              >
                <option value="">—</option>
                {stages.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </NativeSelect>
            </Field>
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
            disabled={creating || !title.trim()}
          >
            {creating ? 'Creating…' : 'Create project'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
