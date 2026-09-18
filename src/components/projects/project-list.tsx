import { useMemo, useRef, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { createColumnHelper } from '@tanstack/react-table'
import { Link } from '@tanstack/react-router'
import { Search } from 'lucide-react'
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
}: {
  projects: ProjectListProject[]
  isLoading: boolean
  error: unknown
  onRetry: () => void
  /** Map of project id → record count, from the best-effort counts query. */
  recordCounts?: Record<string, number>
  /** Whether counts are still loading for the currently rendered rows. */
  countsLoading?: boolean
}) {
  const [filter, setFilter] = useState('')
  const [status, setStatus] = useState('active')
  const filterRef = useRef<HTMLInputElement>(null)
  function clearFilter() {
    setFilter('')
    setStatus('active')
    filterRef.current?.focus()
  }

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return projects.filter(
      (p) =>
        (status === 'all' || p.status === status) &&
        (p.title.toLowerCase().includes(q) || p.key.toLowerCase().includes(q)),
    )
  }, [projects, filter, status])

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
      columnHelper.accessor('status', {
        header: 'Status',
        cell: ({ getValue }) => (
          <StatusBadge domain="project" status={getValue()} />
        ),
        meta: { className: 'w-[8rem]' },
      }),
      columnHelper.accessor((p) => recordCounts?.[p.id], {
        id: 'records',
        header: 'Records',
        cell: ({ row }) => {
          const total = recordCounts?.[row.original.id]
          if (total === undefined) {
            return countsLoading ? (
              <Skeleton className="h-4 w-8" />
            ) : (
              <span className="text-sm tabular-nums text-muted-foreground">
                —
              </span>
            )
          }
          return (
            <span className="text-sm tabular-nums text-foreground">
              {total}
            </span>
          )
        },
        meta: { className: 'w-[5.5rem] text-right' },
      }),
      columnHelper.accessor('createdAt', {
        header: 'Created',
        cell: ({ row }) => (
          <time
            dateTime={row.original.createdAt}
            title={row.original.createdAt}
            className="whitespace-nowrap text-sm tabular-nums text-muted-foreground"
          >
            {formatDate(row.original.createdAt)}
          </time>
        ),
        meta: { className: 'w-[8rem]' },
      }),
      columnHelper.accessor('experimentCount', {
        header: 'Experiments',
        cell: ({ getValue }) => getValue() ?? '—',
        meta: { className: 'w-[8rem] text-right' },
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
        meta: { className: 'w-[9rem]' },
      }),
    ] as ColumnDef<ProjectListProject, unknown>[]
  }, [recordCounts, countsLoading])

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
      <DataTable
        toolbar={
          <>
            <div className="relative min-w-0 basis-full sm:flex-1 sm:basis-auto sm:max-w-sm">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={filterRef}
                type="search"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter projects by title or key"
                aria-label="Filter projects"
                className="h-8 pl-8 text-sm"
              />
            </div>
            <label className="sr-only" htmlFor="project-status">
              Project status
            </label>
            <select
              id="project-status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="active">Active</option>
              <option value="archived">Archived</option>
              <option value="all">All projects</option>
            </select>
            <span
              role="status"
              className="shrink-0 text-xs tabular-nums text-muted-foreground"
            >
              {filtered.length} of {projects.length}
            </span>
            {filter || status !== 'active' ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearFilter}
              >
                Clear filter
              </Button>
            ) : null}
          </>
        }
        data={filtered}
        columns={columns}
        label="Projects"
        variant="quiet"
        tableClassName="min-w-[54rem] table-fixed"
        getRowId={(project) => project.id}
        enablePagination
        enableColumnVisibility
        initialColumnVisibility={{ createdAt: false }}
        emptyMessage={
          filter
            ? `No projects match “${filter}”.`
            : 'No projects with this status.'
        }
      />
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
