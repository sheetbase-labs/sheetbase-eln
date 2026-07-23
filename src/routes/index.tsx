import { useQuery } from '@tanstack/react-query'
import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import {
  Activity as ActivityIcon,
  ArrowRight,
  ClipboardList,
  FlaskConical,
  Folder,
  Plus,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { AppShell } from '#/components/app-shell'
import {
  Button,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui'
import { StatusBadge } from '#/components/scientific'
import {
  notebookDataClient,
  notebookQueryKeys,
  toProject,
  toRecord,
} from '#/lib/notebook-data'
import type {
  NotebookRecord,
  Project,
  ProjectWire,
  RecordWire,
} from '#/lib/notebook-data'
import { cn } from '#/lib/utils'

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    const context = await getCurrentContextFn()
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    return { context }
  },
  component: Home,
})

const getCurrentContextFn = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { getRequestHeaders } = await import('@tanstack/react-start/server')
    const { getCurrentContext } = await import('#/lib/current-user')
    return getCurrentContext(getRequestHeaders())
  },
)

const retryBootstrapFn = createServerFn({ method: 'POST' }).handler(
  async () => {
    const { getRequestHeaders } = await import('@tanstack/react-start/server')
    const { auth } = await import('#/lib/auth')
    const { drizzle } = await import('drizzle-orm/node-postgres')
    const { env } = await import('#/env.server')
    const schema = await import('#/db/schema')
    const { bootstrapWorkspaceForUser } = await import('#/lib/bootstrap')

    const session = await auth.api.getSession({ headers: getRequestHeaders() })
    if (!session) {
      throw new Error('Not signed in')
    }
    const db = drizzle(env.DATABASE_URL, { schema })
    return bootstrapWorkspaceForUser(db, {
      id: session.user.id,
      name: session.user.name,
    })
  },
)

function Home() {
  const { context } = Route.useRouteContext()

  if (!context.workspace) {
    return (
      <AppShell
        context={{
          workspace: null,
          user: { name: context.user.name, email: context.user.email },
        }}
        breadcrumbs={[{ label: 'Home' }]}
      >
        <BootstrapRecovery userName={context.user.name} />
      </AppShell>
    )
  }

  return (
    <AppShell
      context={{
        workspace: { name: context.workspace.name },
        user: {
          name: context.user.name,
          email: context.user.email,
          role: context.workspace.role,
        },
      }}
      breadcrumbs={[{ label: 'Home' }]}
      primaryAction={
        <Button asChild size="sm">
          <Link to="/projects" className="no-underline">
            <Plus className="size-3.5" />
            New
          </Link>
        </Button>
      }
    >
      <MyWorkDashboard
        context={{
          user: { name: context.user.name, email: context.user.email },
          workspace: {
            name: context.workspace.name,
            slug: context.workspace.slug,
            role: context.workspace.role,
          },
        }}
      />
    </AppShell>
  )
}

// ---------------------------------------------------------------------------
// Dashboard query keys. Recent records are dashboard-scoped; the projects
// list reuses the shared `projectsList` key so it stays in sync with the
// projects route and the live-event coordinator.
// ---------------------------------------------------------------------------

const RECENT_RECORDS_KEY = ['dashboard', 'recent-records'] as const

function greetingFor(hour: number): string {
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const diff = Math.max(0, Date.now() - then)
  const minute = 60_000
  const hour = 3_600_000
  const day = 86_400_000
  if (diff < minute) return 'just now'
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`
  if (diff < day) return `${Math.floor(diff / hour)}h ago`
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`
  return new Date(iso).toLocaleDateString()
}

interface DashboardContext {
  user: { name: string; email: string }
  workspace: { name: string; slug: string; role: string }
}

/**
 * My Work dashboard — the signed-in landing surface. A dense, work-oriented
 * view of recent records, projects, assigned tasks and activity. Data comes
 * from the same-origin `/api/db` PostgREST boundary via TanStack Query so it
 * stays live with the rest of the app.
 *
 * Tasks and activity are stubbed with honest empty states for now: those
 * collections do not have backing endpoints yet, so the dashboard says so
 * rather than fabricating content.
 */
export function MyWorkDashboard({ context }: { context: DashboardContext }) {
  const now = new Date()
  const greeting = greetingFor(now.getHours())
  const todayLabel = now.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

  const recordsQuery = useQuery({
    queryKey: RECENT_RECORDS_KEY,
    queryFn: async () => {
      const rows = await notebookDataClient.list<RecordWire>(
        'records',
        '?order=updated_at.desc&limit=10',
      )
      return rows.map(toRecord)
    },
  })

  const projectsQuery = useQuery({
    queryKey: notebookQueryKeys.projectsList(),
    queryFn: async () => {
      const rows = await notebookDataClient.list<ProjectWire>(
        'projects',
        '?order=created_at.desc',
      )
      return rows.map(toProject)
    },
  })

  const records = recordsQuery.data ?? []
  const projects = projectsQuery.data ?? []
  const projectById = new Map(projects.map((p) => [p.id, p]))

  const inReviewCount = records.filter((r) => r.status === 'review').length
  const inProgressCount = records.filter(
    (r) => r.status === 'in-progress',
  ).length

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {todayLabel}
          </p>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            {greeting}, {context.user.name.split(/\s+/)[0]}
          </h1>
          <p className="text-sm text-muted-foreground">
            Here&apos;s what&apos;s on your plate today.
          </p>
        </div>
      </header>

      <section
        aria-label="Summary"
        className="grid grid-cols-2 gap-3 sm:grid-cols-4"
      >
        <MetricTile
          label="Projects"
          value={projects.length}
          loading={projectsQuery.isLoading}
        />
        <MetricTile
          label="Recent records"
          value={records.length}
          loading={recordsQuery.isLoading}
          hint={records.length >= 10 ? 'showing latest 10' : undefined}
        />
        <MetricTile
          label="In progress"
          value={inProgressCount}
          loading={recordsQuery.isLoading}
        />
        <MetricTile
          label="In review"
          value={inReviewCount}
          loading={recordsQuery.isLoading}
          hint={inReviewCount > 0 ? 'awaiting action' : undefined}
          hintTone="text-violet-600 dark:text-violet-400"
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <RecentWorkTable
            records={records}
            projectById={projectById}
            isLoading={recordsQuery.isLoading}
            error={recordsQuery.error}
            onRetry={() => recordsQuery.refetch()}
          />
        </div>

        <div className="space-y-6">
          <TasksPanel />
          <ActivityFeed />
        </div>
      </div>

      <ProjectQuickAccess
        projects={projects}
        isLoading={projectsQuery.isLoading}
        error={projectsQuery.error}
        onRetry={() => projectsQuery.refetch()}
      />
    </div>
  )
}

function MetricTile({
  label,
  value,
  hint,
  hintTone,
  loading,
}: {
  label: string
  value: number
  hint?: string
  hintTone?: string
  loading?: boolean
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-10" />
      ) : (
        <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-foreground">
          {value}
        </p>
      )}
      {hint ? (
        <p className={cn('mt-1 text-xs', hintTone ?? 'text-muted-foreground')}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Recent work table
// ---------------------------------------------------------------------------

export function RecentWorkTable({
  records,
  projectById,
  isLoading,
  error,
  onRetry,
}: {
  records: NotebookRecord[]
  projectById: Map<string, Project>
  isLoading: boolean
  error: unknown
  onRetry: () => void
}) {
  if (isLoading) {
    return (
      <section
        aria-label="Recent work"
        className="rounded-lg border border-border bg-card"
      >
        <SectionHeader title="Recent work" />
        <div className="space-y-2 p-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </section>
    )
  }

  if (error) {
    return (
      <section
        aria-label="Recent work"
        className="rounded-lg border border-border bg-card"
      >
        <SectionHeader title="Recent work" />
        <ErrorState message="Could not load recent work." onRetry={onRetry} />
      </section>
    )
  }

  if (records.length === 0) {
    return (
      <section
        aria-label="Recent work"
        className="rounded-lg border border-border bg-card"
      >
        <SectionHeader title="Recent work" />
        <EmptyState
          icon={FlaskConical}
          title="No recent work yet"
          body="Experiments, samples, protocols and reports you create will show up here. Start by opening a project."
          action={
            <Button asChild variant="outline" size="sm">
              <Link to="/projects" className="no-underline">
                Open projects
              </Link>
            </Button>
          }
        />
      </section>
    )
  }

  return (
    <section
      aria-label="Recent work"
      className="rounded-lg border border-border bg-card"
    >
      <SectionHeader title="Recent work" count={records.length} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead className="hidden sm:table-cell">Project</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden text-right sm:table-cell">
              Updated
            </TableHead>
            <TableHead className="hidden md:table-cell">Owner</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((record) => {
            const project = record.projectId
              ? projectById.get(record.projectId)
              : undefined
            return (
              <TableRow key={record.id}>
                <TableCell>
                  <Link
                    to={
                      record.projectId
                        ? '/projects/$projectId/experiments/$recordId'
                        : '/templates'
                    }
                    params={
                      record.projectId
                        ? {
                            projectId: record.projectId,
                            recordId: record.id,
                          }
                        : {}
                    }
                    className="flex items-center gap-3 no-underline"
                  >
                    <RecordKindIcon kind={record.kind} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {record.title}
                      </span>
                      <span className="block truncate font-mono text-[11px] tabular-nums text-muted-foreground">
                        {record.identifier}
                      </span>
                    </span>
                  </Link>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  {project ? (
                    <Link
                      to="/projects/$projectId"
                      params={{ projectId: project.id }}
                      className="truncate text-sm text-muted-foreground no-underline hover:text-foreground"
                    >
                      {project.title}
                    </Link>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <StatusBadge domain="experiment" status={record.status} />
                </TableCell>
                <TableCell className="hidden text-right text-xs tabular-nums text-muted-foreground sm:table-cell">
                  {formatRelativeTime(record.updatedAt)}
                </TableCell>
                <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                  {/* Owner resolution needs a user-directory endpoint that is
                      not yet available; show an honest placeholder. */}
                  <span aria-label="Owner not available">—</span>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </section>
  )
}

function RecordKindIcon({ kind }: { kind: string }) {
  const Icon: LucideIcon = kind === 'protocol_template' ? Folder : FlaskConical
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
      <Icon className="size-4" />
    </span>
  )
}

// ---------------------------------------------------------------------------
// Tasks & activity — honest empty states until backing endpoints exist.
// ---------------------------------------------------------------------------

export function TasksPanel() {
  return (
    <section
      aria-label="Active tasks"
      className="rounded-lg border border-border bg-card"
    >
      <SectionHeader title="Active tasks" />
      <EmptyState
        icon={ClipboardList}
        title="No tasks assigned"
        body="Tasks linked to experiments and reviews will appear here once task tracking is enabled."
      />
    </section>
  )
}

export function ActivityFeed() {
  return (
    <section
      aria-label="Recent activity"
      className="rounded-lg border border-border bg-card"
    >
      <SectionHeader title="Recent activity" />
      <EmptyState
        icon={ActivityIcon}
        title="No recent activity"
        body="Edits, comments, reviews and status changes from your workspace will show up here."
      />
    </section>
  )
}

// ---------------------------------------------------------------------------
// Project quick access
// ---------------------------------------------------------------------------

export function ProjectQuickAccess({
  projects,
  isLoading,
  error,
  onRetry,
}: {
  projects: Project[]
  isLoading: boolean
  error: unknown
  onRetry: () => void
}) {
  return (
    <section
      aria-label="Projects"
      className="rounded-lg border border-border bg-card"
    >
      <SectionHeader
        title="Projects"
        count={projects.length}
        action={
          <Button asChild variant="ghost" size="sm">
            <Link to="/projects" className="no-underline">
              View all
              <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        }
      />
      {isLoading ? (
        <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : error ? (
        <ErrorState message="Could not load projects." onRetry={onRetry} />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={Folder}
          title="No projects yet"
          body="Create your first project to start recording experiments, samples and protocols."
          action={
            <Button asChild variant="outline" size="sm">
              <Link to="/projects" className="no-underline">
                Create a project
              </Link>
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.slice(0, 6).map((project) => (
            <li key={project.id}>
              <Link
                to="/projects/$projectId"
                params={{ projectId: project.id }}
                className="flex h-full flex-col gap-2 rounded-md border border-border p-3 no-underline transition-colors hover:bg-muted/40"
              >
                <div className="flex items-center gap-2">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Folder className="size-3.5" />
                  </span>
                  <span className="truncate text-sm font-medium text-foreground">
                    {project.title}
                  </span>
                </div>
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  {project.key}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Shared section primitives
// ---------------------------------------------------------------------------

function SectionHeader({
  title,
  count,
  action,
}: {
  title: string
  count?: number
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {count !== undefined ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            {count}
          </span>
        ) : null}
      </div>
      {action}
    </div>
  )
}

function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon
  title: string
  body: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
      <span className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mx-auto max-w-xs text-xs leading-5 text-muted-foreground">
        {body}
      </p>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
      <p role="alert" className="text-sm text-destructive">
        {message}
      </p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Bootstrap recovery — shown only when a signed-in user has no workspace.
// ---------------------------------------------------------------------------

function BootstrapRecovery({ userName }: { userName: string }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold tracking-tight">
        Finish setting up, {userName}
      </h1>
      <p className="text-sm leading-6 text-muted-foreground">
        Your account exists but its workspace was not created. This is
        recoverable — creating it now picks up exactly where sign-up stopped.
      </p>
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-border bg-muted p-3 text-sm"
        >
          {error}
        </p>
      ) : null}
      <button
        type="button"
        disabled={pending}
        className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
        onClick={async () => {
          setPending(true)
          setError(null)
          try {
            await retryBootstrapFn()
            await router.invalidate()
          } catch {
            setError('Workspace creation failed. Try again.')
            setPending(false)
          }
        }}
      >
        {pending ? 'Creating workspace…' : 'Create my workspace'}
      </button>
    </div>
  )
}
