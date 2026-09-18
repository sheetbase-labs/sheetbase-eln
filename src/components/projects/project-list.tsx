import { useMemo, useRef, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { createColumnHelper } from '@tanstack/react-table'
import { Link } from '@tanstack/react-router'
import { ChevronRight, Search, X } from 'lucide-react'
import { DataTable } from '#/components/scientific/data-table'
import { StatusBadge } from '#/components/scientific'
import {
  Button,
  Input,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '#/components/ui'
import { formatDate, formatRelativeTime } from '#/lib/notebook-data'

interface ProjectListProject {
  id: string
  key: string
  title: string
  status: string
  createdAt: string
  updatedAt?: string | null
  lastActivityAt?: string | null
  experimentCount?: number
}

const columnHelper = createColumnHelper<ProjectListProject>()

export function ProjectList({
  projects,
  isLoading,
  error,
  onRetry,
  recordCounts,
  countsLoading = false,
  reviewsByProject,
}: {
  projects: ProjectListProject[]
  isLoading: boolean
  error: unknown
  onRetry: () => void
  /** Map of project id → record count, from the best-effort counts query. */
  recordCounts?: Record<string, number>
  /** Whether counts are still loading for the currently rendered rows. */
  countsLoading?: boolean
  /** Map of project id → pending review count awaiting the current user. */
  reviewsByProject?: Map<string, number>
}) {
  const [filter, setFilter] = useState('')
  const [status, setStatus] = useState('all')
  const filterRef = useRef<HTMLInputElement>(null)
  function clearFilter() {
    setFilter('')
    setStatus('all')
    filterRef.current?.focus()
  }

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return projects
      .filter(
        (p) =>
          (status === 'all' || p.status === status) &&
          (p.title.toLowerCase().includes(q) ||
            p.key.toLowerCase().includes(q)),
      )
      .sort(
        (a, b) =>
          Date.parse(b.lastActivityAt ?? b.updatedAt ?? b.createdAt) -
          Date.parse(a.lastActivityAt ?? a.updatedAt ?? a.createdAt),
      )
  }, [projects, filter, status])

  const statusCounts = useMemo(() => {
    return {
      all: projects.length,
      active: projects.filter((p) => p.status === 'active').length,
      archived: projects.filter((p) => p.status === 'archived').length,
    }
  }, [projects])

  const columns = useMemo(() => {
    return [
      columnHelper.accessor('title', {
        enableHiding: false,
        header: 'Project',
        cell: ({ row }) => {
          const p = row.original
          return (
            <Link
              to="/projects/$projectId"
              params={{ projectId: p.id }}
              className="flex min-w-0 flex-col gap-0.5 rounded-sm no-underline hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title={p.title}
            >
              <span className="truncate text-sm font-medium text-foreground">
                {p.title}
              </span>
              <span className="truncate font-mono text-xs tabular-nums text-muted-foreground">
                {p.key}
              </span>
            </Link>
          )
        },
        meta: { className: 'w-auto' },
      }),
      columnHelper.accessor((p) => recordCounts?.[p.id], {
        id: 'records',
        header: 'Records',
        cell: ({ row }) => {
          const total = recordCounts?.[row.original.id]
          const experiments = row.original.experimentCount
          if (total === undefined && experiments === undefined) {
            return countsLoading ? (
              <Skeleton className="h-4 w-8" />
            ) : (
              <span className="text-sm tabular-nums text-muted-foreground">
                —
              </span>
            )
          }
          const parts = [
            experiments !== undefined ? `${experiments} exp` : null,
            total !== undefined ? `${total} records` : null,
          ].filter(Boolean)
          return (
            <span className="text-sm tabular-nums text-foreground">
              {parts.join(' · ')}
            </span>
          )
        },
        meta: { className: 'w-[10rem]' },
      }),
      columnHelper.accessor((p) => reviewsByProject?.get(p.id) ?? 0, {
        id: 'reviews',
        header: 'Reviews',
        cell: ({ row }) => {
          const awaiting = reviewsByProject?.get(row.original.id) ?? 0
          if (awaiting === 0) {
            return (
              <span className="text-sm tabular-nums text-muted-foreground">
                —
              </span>
            )
          }
          return (
            <span className="text-sm font-medium tabular-nums text-violet">
              {awaiting} awaiting you
            </span>
          )
        },
        meta: { className: 'w-[8.5rem]' },
      }),
      columnHelper.accessor('status', {
        header: 'Status',
        cell: ({ getValue }) => (
          <StatusBadge domain="project" status={getValue()} />
        ),
        meta: { className: 'w-[8rem]' },
      }),
      columnHelper.accessor('lastActivityAt', {
        header: 'Last activity',
        cell: ({ getValue }) => {
          const value = getValue()
          return value ? (
            <time dateTime={value} title={value}>
              {formatRelativeTime(value)}
            </time>
          ) : (
            <span className="text-muted-foreground">—</span>
          )
        },
        meta: { className: 'w-[9rem] text-right' },
      }),
      columnHelper.display({
        id: 'open',
        enableHiding: false,
        enableSorting: false,
        cell: () => (
          <ChevronRight
            className="ml-auto size-4 text-muted-foreground"
            aria-hidden="true"
          />
        ),
        meta: { className: 'w-8' },
      }),
    ] as ColumnDef<ProjectListProject, unknown>[]
  }, [recordCounts, countsLoading, reviewsByProject])

  if (isLoading) {
    return (
      <div className="min-w-0 space-y-3">
        <p className="sr-only" aria-busy="true">
          Loading projects…
        </p>
        <ProjectsTableShell />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-2 rounded-lg border border-border bg-surface p-4">
        <p role="alert" className="text-sm text-destructive">
          Could not load projects.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    )
  }

  if (projects.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/20 p-10 text-center">
        <p className="text-sm font-medium text-foreground">
          No projects yet. Create your first one above.
        </p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          Projects group experiments, samples, reagents and protocols into one
          addressable workspace.
        </p>
      </div>
    )
  }

  return (
    <div className="min-w-0 space-y-3">
      <Tabs defaultValue="list">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="relative w-56">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={filterRef}
              type="search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter projects…"
              aria-label="Filter projects"
              className="h-8 pl-8 text-sm"
            />
          </div>
          <TabsList variant="boxed" className="h-8">
            <TabsTrigger value="list" className="px-2.5 text-xs">
              List
            </TabsTrigger>
            <TabsTrigger value="timeline" className="px-2.5 text-xs">
              Timeline
            </TabsTrigger>
          </TabsList>
        </div>
        <div className="flex items-end justify-between gap-x-3 border-b border-border">
          <Tabs value={status} onValueChange={(value) => setStatus(value)}>
            <TabsList className="w-auto border-b-0">
              <TabsTrigger value="all">
                All
                <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                  {statusCounts.all}
                </span>
              </TabsTrigger>
              <TabsTrigger value="active">Active</TabsTrigger>
              <TabsTrigger value="archived">Archived</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="mb-1.5 flex items-center gap-2">
            {filter ? (
              <button
                type="button"
                onClick={clearFilter}
                aria-label="Clear filter"
                className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 text-xs font-medium text-foreground hover:bg-control"
              >
                Filter: “{filter}”
                <X className="size-3.5 text-muted-foreground" aria-hidden />
              </button>
            ) : null}
            {status !== 'all' ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearFilter}
              >
                Clear filter
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => filterRef.current?.focus()}
            >
              + Filter
            </Button>
          </div>
        </div>
        <TabsContent value="list" className="mt-0">
          <DataTable
            data={filtered}
            columns={columns}
            label="Projects"
            tableClassName="min-w-[54rem] table-fixed"
            getRowId={(project) => project.id}
            enablePagination
            emptyMessage={
              filter
                ? `No projects match “${filter}”.`
                : 'No projects with this status.'
            }
            footer={(table) => {
              const sorting = table.getState().sorting.at(0)
              const sortLabel = sorting
                ? {
                    title: 'project',
                    records: 'records',
                    reviews: 'reviews',
                    status: 'status',
                    lastActivityAt: 'last activity',
                  }[sorting.id]
                : 'last activity'
              return (
                <>
                  <span>
                    {filtered.length} project
                    {filtered.length === 1 ? '' : 's'}
                  </span>
                  <div className="flex items-center gap-2">
                    {sortLabel ? (
                      <span className="text-muted-foreground">
                        Sorted by {sortLabel}
                        {sorting?.desc ? ' (desc)' : ''}
                      </span>
                    ) : null}
                    {table.getPageCount() > 1 && (
                      <>
                        <span role="status">
                          Page {table.getState().pagination.pageIndex + 1} of{' '}
                          {table.getPageCount()}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7"
                          onClick={() => table.previousPage()}
                          disabled={!table.getCanPreviousPage()}
                        >
                          Previous
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7"
                          onClick={() => table.nextPage()}
                          disabled={!table.getCanNextPage()}
                        >
                          Next
                        </Button>
                      </>
                    )}
                  </div>
                </>
              )
            }}
          />
        </TabsContent>
        <TabsContent value="timeline" className="mt-0">
          <ProjectsTimeline projects={filtered} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

/** Minimal project timeline — one bar per project from creation to last
 * activity, on a shared scale. */
function ProjectsTimeline({ projects }: { projects: ProjectListProject[] }) {
  const now = Date.now()
  const bounds = useMemo(() => {
    const starts = projects.map((p) => Date.parse(p.createdAt))
    const ends = projects.map((p) =>
      p.lastActivityAt ? Date.parse(p.lastActivityAt) : now,
    )
    const min = starts.length ? Math.min(...starts) : now - 86_400_000
    const max = Math.max(...ends, now)
    return { min, max: Math.max(max, min + 86_400_000) }
  }, [projects, now])

  if (projects.length === 0) {
    return (
      <div className="rounded-md border border-border bg-surface p-8 text-center text-sm text-muted-foreground">
        No projects to show on the timeline.
      </div>
    )
  }

  const span = bounds.max - bounds.min

  return (
    <div className="rounded-md border border-border bg-surface">
      <div className="flex justify-between border-b border-border px-4 py-2 font-mono text-xs tabular-nums text-muted-foreground">
        <span>{formatDate(new Date(bounds.min).toISOString())}</span>
        <span>{formatDate(new Date(bounds.max).toISOString())}</span>
      </div>
      <ul className="divide-y divide-border">
        {projects.map((project) => {
          const start = Date.parse(project.createdAt)
          const end = project.lastActivityAt
            ? Date.parse(project.lastActivityAt)
            : now
          const left = Math.max(
            0,
            Math.min(100, ((start - bounds.min) / span) * 100),
          )
          const width = Math.max(
            1.5,
            Math.min(100 - left, ((end - start) / span) * 100),
          )
          return (
            <li
              key={project.id}
              className="grid grid-cols-[minmax(0,14rem)_1fr] items-center gap-3 px-4 py-2"
            >
              <Link
                to="/projects/$projectId"
                params={{ projectId: project.id }}
                className="truncate text-sm font-medium text-foreground no-underline hover:text-primary"
              >
                {project.title}
              </Link>
              <div className="relative h-5 rounded-xs bg-muted/60">
                <span
                  className="absolute inset-y-1 rounded-xs bg-primary/70"
                  style={{ left: `${left}%`, width: `${width}%` }}
                  title={`${formatDate(project.createdAt)} — ${
                    project.lastActivityAt
                      ? formatRelativeTime(project.lastActivityAt)
                      : 'no activity'
                  }`}
                />
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Loading skeleton shaped like the projects table so the layout is stable. */
function ProjectsTableShell() {
  return (
    <div className="min-w-0 border-y border-border">
      <Table
        variant="quiet"
        className="min-w-[54rem] table-fixed"
        aria-label="Projects"
      >
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-auto">Project</TableHead>
            <TableHead className="w-[8rem]">Status</TableHead>
            <TableHead className="w-[5.5rem] text-right">Records</TableHead>
            <TableHead className="w-[8rem]">Created</TableHead>
            <TableHead className="w-[8rem]">Last activity</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 6 }).map((_, i) => (
            <TableRow key={i} className="hover:bg-transparent">
              <TableCell>
                <Skeleton className="h-4 w-40" />
                <Skeleton className="mt-1 h-3 w-24" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-5 w-16 rounded-full" />
              </TableCell>
              <TableCell>
                <Skeleton className="ml-auto h-4 w-8" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-20" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-20" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
