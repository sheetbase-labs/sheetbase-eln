import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useRouterState,
} from '@tanstack/react-router'
import { FolderPlus, Search, SlidersHorizontal } from 'lucide-react'
import { useMemo, useState } from 'react'

import { useShell } from '#/components/app-shell'
import { StatusBadge } from '#/components/scientific'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui'
import { createDataClient, DataClientError } from '#/lib/data-client'
import { formatDate, formatRelativeTime } from '#/lib/notebook-data'

// Column width/alignment hints consumed by the TableHead/TableCell renderers
// so the dense grid stays aligned without per-cell className repetition.
declare module '@tanstack/react-table' {
  interface ColumnMeta<TData, TValue> {
    className?: string
  }
}

/**
 * Projects dashboard. The workspace's projects rendered as a dense, full-width
 * data grid (TanStack Table) with key, status, live record counts and last
 * activity — replacing the original sparse `<ul>`. Project creation is a
 * proper dialog form rather than a bare text input.
 *
 * Reads through the same-origin /api/db boundary; creates through the
 * create_project RPC (server-side key generation). Loading, empty, error,
 * validation and permission states are all handled.
 */

// Wire shape from PostgREST (snake_case). Mapped at the call site.
interface ProjectWire {
  id: string
  workspace_id: string
  key: string
  title: string
  status: string
  created_at: string
  updated_at: string
  archived_at: string | null
}

interface Project {
  id: string
  key: string
  title: string
  status: string
  createdAt: string
  updatedAt: string | null
}

function toProject(row: ProjectWire): Project {
  return {
    id: row.id,
    key: row.key,
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export const Route = createFileRoute('/projects')({
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    return { context }
  },
  component: ProjectsRoute,
})

const dataClient = createDataClient()

const PROJECTS_KEY = ['projects'] as const

function ProjectsRoute() {
  const { context } = Route.useRouteContext()
  const queryClient = useQueryClient()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const isProjectsIndex = pathname === '/projects'

  const query = useQuery({
    queryKey: PROJECTS_KEY,
    queryFn: async () => {
      const rows = await dataClient.list<ProjectWire>(
        'projects',
        '?order=created_at.desc',
      )
      return rows.map(toProject)
    },
    enabled: isProjectsIndex,
  })

  // Live record counts per project. Fetched only after the projects list
  // resolves, in parallel, using PostgREST's cheap count header so at most
  // one row is transferred per project. Counts are best-effort: a failed
  // count resolves to `undefined` and the cell renders an em dash.
  const countsQuery = useQuery({
    queryKey: [...PROJECTS_KEY, 'record-counts'],
    queryFn: async () => {
      const projects = query.data ?? []
      if (projects.length === 0) return {}
      const entries = await Promise.all(
        projects.map(async (p) => {
          try {
            const total = await dataClient.count(
              'records',
              `?project_id=eq.${p.id}&archived_at=is.null`,
            )
            return [p.id, total] as const
          } catch {
            return [p.id, undefined] as const
          }
        }),
      )
      const counts: Record<string, number> = {}
      for (const [id, total] of entries) {
        if (typeof total === 'number') counts[id] = total
      }
      return counts
    },
    enabled: isProjectsIndex && !!query.data && query.data.length > 0,
  })

  const [title, setTitle] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const createMutation = useMutation({
    mutationFn: async (newTitle: string) => {
      // Server-side key generation; the RPC returns the created row.
      const row = await dataClient.rpc<ProjectWire>('create_project', {
        p_title: newTitle,
      })
      return toProject(row)
    },
    onMutate: async (newTitle) => {
      // No optimistic add: the server assigns the key, so we cannot
      // fabricate a correct local row. Rollback on error is trivial (no
      // change was made), and the canonical row arrives on success.
      void newTitle
      await queryClient.cancelQueries({ queryKey: PROJECTS_KEY })
    },
    onSuccess: (created) => {
      queryClient.setQueryData<Project[]>(PROJECTS_KEY, (prev) =>
        prev ? [created, ...prev] : [created],
      )
      // Invalidate counts so the new project's zero count resolves rather
      // than staying blank until the next refetch.
      void queryClient.invalidateQueries({
        queryKey: [...PROJECTS_KEY, 'record-counts'],
      })
      setTitle('')
      setValidationError(null)
      setCreateOpen(false)
    },
    onError: (error) => {
      if (error instanceof DataClientError) {
        if (error.code === 'unauthenticated') {
          setValidationError('Your session expired. Sign in again.')
        } else if (error.code === 'no_workspace') {
          setValidationError('Your workspace is not set up yet.')
        } else if (error.code === 'workspace_mismatch') {
          setValidationError('The request targeted the wrong workspace.')
        } else if (error.status >= 500) {
          setValidationError(
            'The data service is unavailable. Try again shortly.',
          )
        } else {
          setValidationError(error.message)
        }
      } else {
        setValidationError('Could not create the project. Try again.')
      }
    },
  })

  const projects = query.data ?? []
  const isLoading = query.isLoading
  const isPendingCreate = createMutation.isPending

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) {
      setValidationError('Give the project a title first.')
      return
    }
    createMutation.mutate(trimmed)
  }

  useShell({
    fullBleed: true,
    context: {
      workspace: context.workspace ? { name: context.workspace.name } : null,
      user: { name: context.user.name, email: context.user.email },
    },
    breadcrumbs: [{ label: 'Home', to: '/' }, { label: 'Projects' }],
    primaryAction: (
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogTrigger asChild>
          <Button size="sm">
            <FolderPlus className="size-4" />
            New project
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>
              Give the project a clear title. Sheetbase generates the project
              key and workspace binding on the server.
            </DialogDescription>
          </DialogHeader>
          <CreateProjectForm
            title={title}
            onTitleChange={setTitle}
            onSubmit={handleSubmit}
            isPending={isPendingCreate}
            validationError={validationError}
          />
        </DialogContent>
      </Dialog>
    ),
  })

  if (!isProjectsIndex) return <Outlet />

  return (
    <>
      <div className="flex flex-col gap-4 p-4 md:p-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {context.workspace?.name ?? 'Sheetbase'}
            </p>
            <h1 className="font-display text-2xl font-semibold tracking-tight">
              Projects
            </h1>
            <p className="text-sm text-muted-foreground">
              {isLoading
                ? 'Loading workspace projects…'
                : `${projects.length} project${projects.length === 1 ? '' : 's'}`}
            </p>
          </div>
        </header>

        <ProjectList
          projects={projects}
          isLoading={isLoading}
          error={query.error}
          onRetry={() => query.refetch()}
          recordCounts={countsQuery.data}
          countsLoading={
            countsQuery.isLoading && countsQuery.fetchStatus !== 'idle'
          }
        />
      </div>
    </>
  )
}

export function CreateProjectForm({
  title,
  onTitleChange,
  onSubmit,
  isPending,
  validationError,
}: {
  title: string
  onTitleChange: (value: string) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  isPending: boolean
  validationError: string | null
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate>
      <label htmlFor="project-title" className="sr-only">
        Project title
      </label>
      <Input
        id="project-title"
        type="text"
        value={title}
        onChange={(event) => onTitleChange(event.target.value)}
        placeholder="New project title"
        autoFocus
        aria-invalid={validationError ? true : undefined}
        aria-describedby={validationError ? 'project-title-error' : undefined}
        disabled={isPending}
      />
      {validationError ? (
        <p
          id="project-title-error"
          role="alert"
          className="text-sm text-destructive"
        >
          {validationError}
        </p>
      ) : null}
      <DialogFooter>
        <Button
          type="submit"
          disabled={isPending || title.trim() === ''}
          className="w-full sm:w-auto"
        >
          {isPending ? 'Creating…' : 'Create project'}
        </Button>
      </DialogFooter>
    </form>
  )
}

interface ProjectListProject {
  id: string
  key: string
  title: string
  status: string
  createdAt: string
  updatedAt?: string | null
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

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return projects
    return projects.filter(
      (p) =>
        p.title.toLowerCase().includes(q) || p.key.toLowerCase().includes(q),
    )
  }, [projects, filter])

  const columns = useMemo(() => {
    return [
      columnHelper.display({
        id: 'title',
        header: 'Project',
        cell: ({ row }) => {
          const p = row.original
          return (
            <Link
              to="/projects/$projectId"
              params={{ projectId: p.id }}
              className="flex min-w-0 flex-col gap-0.5 no-underline"
            >
              <span className="truncate text-sm font-medium text-foreground group-hover:text-primary">
                {p.title}
              </span>
              <span className="truncate font-mono text-xs tabular-nums text-muted-foreground">
                {p.key}
              </span>
            </Link>
          )
        },
        meta: { className: 'min-w-[16rem]' },
      }),
      columnHelper.accessor('status', {
        header: 'Status',
        cell: ({ getValue }) => (
          <StatusBadge domain="project" status={getValue()} />
        ),
        meta: { className: 'w-[8rem]' },
      }),
      columnHelper.display({
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
      columnHelper.display({
        id: 'activity',
        header: 'Last activity',
        cell: ({ row }) => (
          <time
            dateTime={row.original.updatedAt ?? row.original.createdAt}
            title={row.original.updatedAt ?? row.original.createdAt}
            className="whitespace-nowrap text-sm tabular-nums text-muted-foreground"
          >
            {formatRelativeTime(
              row.original.updatedAt ?? row.original.createdAt,
            )}
          </time>
        ),
        meta: { className: 'w-[8rem]' },
      }),
    ]
  }, [recordCounts, countsLoading])

  const table = useReactTable({
    data: filtered,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  if (isLoading) {
    return (
      <div className="space-y-3">
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
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter projects by title or key"
            aria-label="Filter projects"
            className="h-8 pl-8 text-sm"
          />
        </div>
        <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex">
          <SlidersHorizontal className="size-3.5" />
          {filtered.length} shown
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
          No projects match “{filter}”.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {table.getHeaderGroups().map((headerGroup) =>
                  headerGroup.headers.map((header) => (
                    <TableHead
                      key={header.id}
                      className={header.column.columnDef.meta?.className}
                    >
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                    </TableHead>
                  )),
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="group cursor-pointer transition-colors hover:bg-muted/40"
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cell.column.columnDef.meta?.className}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

/** Loading skeleton shaped like the projects table so the layout is stable. */
function ProjectsTableShell() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="min-w-[16rem]">Project</TableHead>
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
