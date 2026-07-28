import { useQuery } from '@tanstack/react-query'
import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Activity as ActivityIcon,
  ArrowRight,
  AtSign,
  ClipboardList,
  Database,
  FlaskConical,
  Folder,
  Inbox,
  LayoutTemplate,
  Pin,
  Plus,
  Search,
  TestTube,
  Upload,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { useShell } from '#/components/app-shell'

function RouteShell({
  children,
  ...configuration
}: Parameters<typeof useShell>[0] & { children: ReactNode }) {
  useShell(configuration)
  return <>{children}</>
}
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
  formatRelativeTime,
} from '#/lib/notebook-data'
import type { NotebookRecord, Project, ProjectWire } from '#/lib/notebook-data'
import {
  activitySentence,
  computeMyWorkMetrics,
  dashboardQueryKeys,
  fetchMyMentions,
  fetchMyPendingReviews,
  fetchMyRecords,
  fetchPinnedRecords,
  fetchRecentActivity,
  isReviewOverdue,
  nextDeadlineHint,
  OVERDUE_DAYS,
  SOON_DAYS,
} from '#/lib/dashboard-data'
import type {
  DashboardActivityItem,
  DashboardMetric,
  DashboardMentionItem,
  DashboardPinnedItem,
} from '#/lib/dashboard-data'
import type { ReviewItem } from '#/lib/reviews'
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
      <RouteShell
        context={{
          workspace: null,
          user: { name: context.user.name, email: context.user.email },
        }}
        breadcrumbs={[{ label: 'Home' }]}
      >
        <BootstrapRecovery userName={context.user.name} />
      </RouteShell>
    )
  }

  return (
    <RouteShell
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
          userId: context.user.id,
          user: { name: context.user.name, email: context.user.email },
          workspace: {
            name: context.workspace.name,
            slug: context.workspace.slug,
            role: context.workspace.role,
          },
        }}
      />
    </RouteShell>
  )
}

// ---------------------------------------------------------------------------
// Dashboard query keys are now in src/lib/dashboard-data.ts (dashboardQueryKeys).
// ---------------------------------------------------------------------------

function greetingFor(hour: number): string {
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

interface DashboardContext {
  userId: string
  user: { name: string; email: string }
  workspace: { name: string; slug: string; role: string }
}

/**
 * My Work dashboard — the signed-in landing surface. A dense, work-oriented
 * view of real assignments, pending reviews, recent edits, mentions,
 * deadlines, pinned records and workspace activity. All data comes from the
 * same PostgREST resources the rest of the app uses (`records`,
 * `change_events`, `review_submissions`, `comments`) via TanStack Query — no
 * dashboard-only tables are created. Every metric links to the records that
 * produce it and declares its time boundary.
 *
 * Empty and single-user states remain useful: before collaboration expands,
 * the dashboard shows the user's own records and workspace activity with
 * honest "nothing yet" states rather than fabricated content.
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
  const userId = context.userId

  // --- Real data queries -------------------------------------------------

  // Records created or updated by the current user — "assigned to me".
  const myRecordsQuery = useQuery({
    queryKey: dashboardQueryKeys.myRecords(userId),
    queryFn: () => fetchMyRecords(notebookDataClient, userId),
  })

  // Pending review submissions assigned to the current user.
  const myReviewsQuery = useQuery({
    queryKey: dashboardQueryKeys.myReviews(userId),
    queryFn: () => fetchMyPendingReviews(notebookDataClient, userId),
  })

  // Open comments mentioning the current user.
  const myMentionsQuery = useQuery({
    queryKey: dashboardQueryKeys.myMentions(userId),
    queryFn: () => fetchMyMentions(notebookDataClient, userId),
  })

  // Workspace-wide recent activity feed.
  const activityQuery = useQuery({
    queryKey: dashboardQueryKeys.recentActivity(25),
    queryFn: () => fetchRecentActivity(notebookDataClient, 25),
  })

  // All projects for quick access.
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

  // Pinned records — IDs stored in localStorage, resolved to full records.
  // Initialize empty on the server; load from localStorage on mount.
  const [pinnedIds, setPinnedIds] = useState<string[]>([])
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PINNED_RECORDS_KEY)
      const ids = raw ? (JSON.parse(raw) as string[]) : []
      if (ids.length > 0) setPinnedIds(ids)
    } catch {
      /* ignore: private mode / disabled storage */
    }
  }, [])

  const pinnedQuery = useQuery({
    queryKey: dashboardQueryKeys.pinnedRecords(pinnedIds),
    queryFn: () => fetchPinnedRecords(notebookDataClient, pinnedIds),
    enabled: pinnedIds.length > 0,
  })

  const togglePin = (recordId: string) => {
    const next = pinnedIds.includes(recordId)
      ? pinnedIds.filter((id) => id !== recordId)
      : [...pinnedIds, recordId]
    setPinnedIds(next)
    try {
      localStorage.setItem(PINNED_RECORDS_KEY, JSON.stringify(next))
    } catch {
      /* ignore: private mode / disabled storage */
    }
  }

  // --- Derived data ------------------------------------------------------

  const myRecords = myRecordsQuery.data ?? []
  const pendingReviews = myReviewsQuery.data ?? []
  const myMentions = myMentionsQuery.data ?? []
  const recentActivity = activityQuery.data ?? []
  const projects = projectsQuery.data ?? []
  const pinnedRecords = pinnedQuery.data ?? []
  const projectById = new Map(projects.map((p) => [p.id, p]))

  const metrics = computeMyWorkMetrics({
    myRecords,
    pendingReviews,
    myMentions,
    recentActivity,
    overdueDays: OVERDUE_DAYS,
    soonDays: SOON_DAYS,
  })

  const deadlineHint = nextDeadlineHint(pendingReviews)

  // My priorities — top 3 pending reviews sorted by age (oldest first).
  const myPriorities = [...pendingReviews]
    .sort((a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt))
    .slice(0, 3)

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
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
      >
        {metrics.map((metric, i) => {
          const isLoading =
            i === 0
              ? myRecordsQuery.isLoading
              : i === 1
                ? myReviewsQuery.isLoading
                : i === 2
                  ? myRecordsQuery.isLoading
                  : i === 3
                    ? activityQuery.isLoading
                    : myMentionsQuery.isLoading
          const icon =
            i === 0
              ? FlaskConical
              : i === 1
                ? Inbox
                : i === 2
                  ? ClipboardList
                  : i === 3
                    ? ActivityIcon
                    : AtSign
          const tone: CardTone =
            i === 0
              ? 'info'
              : i === 1
                ? 'violet'
                : i === 2
                  ? 'warning'
                  : i === 3
                    ? 'neutral'
                    : 'info'
          return (
            <MetricCard
              key={metric.label}
              metric={metric}
              loading={isLoading}
              icon={icon}
              tone={tone}
              deadlineHint={i === 1 ? deadlineHint : undefined}
            />
          )
        })}
      </section>

      <QuickActionsGrid />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <RecentWorkTable
            records={myRecords.slice(0, 6)}
            projectById={projectById}
            isLoading={myRecordsQuery.isLoading}
            error={myRecordsQuery.error}
            onRetry={() => myRecordsQuery.refetch()}
            pinnedIds={pinnedIds}
            onTogglePin={togglePin}
            title="Recently edited"
            emptyTitle="No records yet"
            emptyBody="Experiments, samples, protocols and reports you create or edit will show up here. Start by opening a project."
          />
          <MentionsPanel
            mentions={myMentions}
            isLoading={myMentionsQuery.isLoading}
            error={myMentionsQuery.error}
            onRetry={() => myMentionsQuery.refetch()}
            currentUserId={userId}
          />
          <ActivityFeed
            items={recentActivity}
            isLoading={activityQuery.isLoading}
            error={activityQuery.error}
            onRetry={() => activityQuery.refetch()}
            currentUserId={userId}
          />
        </div>

        <div className="space-y-6">
          <MyPrioritiesPanel
            priorities={myPriorities}
            isLoading={myReviewsQuery.isLoading}
          />
          <PinnedRecordsPanel
            pinnedRecords={pinnedRecords}
            isLoading={pinnedQuery.isLoading}
            onUnpin={togglePin}
          />
          <UpcomingApprovalsPanel
            pendingReviews={pendingReviews}
            isLoading={myReviewsQuery.isLoading}
          />
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

type CardTone = 'info' | 'success' | 'warning' | 'violet' | 'neutral'

const summaryToneClasses: Record<CardTone, string> = {
  info: 'text-blue-600 dark:text-blue-400',
  success: 'text-emerald-600 dark:text-emerald-400',
  warning: 'text-amber-600 dark:text-amber-400',
  violet: 'text-violet-600 dark:text-violet-400',
  neutral: 'text-muted-foreground',
}

const hintToneClasses: Record<
  NonNullable<DashboardMetric['hintTone']>,
  string
> = {
  default: 'text-muted-foreground',
  urgent: 'text-red-600 dark:text-red-400',
  warning: 'text-amber-600 dark:text-amber-400',
  info: 'text-blue-600 dark:text-blue-400',
  success: 'text-emerald-600 dark:text-emerald-400',
  violet: 'text-violet-600 dark:text-violet-400',
}

/**
 * Metric card rendered from a DashboardMetric. When the metric has a
 * `linkTo`, the card is wrapped in a Link so the user can navigate to the
 * records that produce the count. The `timeBoundary` is shown as a tooltip
 * on the value so the user can verify the window.
 */
function MetricCard({
  metric,
  loading,
  icon: Icon,
  tone,
  deadlineHint,
}: {
  metric: DashboardMetric
  loading?: boolean
  icon: LucideIcon
  tone: CardTone
  deadlineHint?: string
}) {
  const card = (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {metric.label}
        </span>
        <Icon
          className={`size-4 ${summaryToneClasses[tone]}`}
          aria-hidden="true"
        />
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-10" />
      ) : (
        <p
          className="mt-1.5 font-display text-2xl font-semibold tabular-nums leading-none text-foreground"
          title={metric.timeBoundary}
        >
          {metric.value}
        </p>
      )}
      {metric.hint ? (
        <p
          className={cn(
            'mt-1 text-xs',
            metric.hintTone
              ? hintToneClasses[metric.hintTone]
              : 'text-muted-foreground',
          )}
        >
          {metric.hint}
        </p>
      ) : null}
      {deadlineHint ? (
        <p className="mt-0.5 text-xs text-blue-600 dark:text-blue-400">
          {deadlineHint}
        </p>
      ) : null}
    </div>
  )

  if (metric.linkTo && !loading) {
    return (
      <Link
        to={metric.linkTo}
        params={metric.linkParams}
        className="no-underline contents"
      >
        {card}
      </Link>
    )
  }
  return card
}

// ---------------------------------------------------------------------------
// Quick actions
// ---------------------------------------------------------------------------

interface QuickAction {
  label: string
  to: string
  icon: LucideIcon
  hint: string
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    label: 'Create experiment',
    to: '/templates',
    icon: FlaskConical,
    hint: 'Instantiate from a template',
  },
  {
    label: 'Add sample',
    to: '/templates',
    icon: TestTube,
    hint: 'Register a new sample',
  },
  {
    label: 'Upload file',
    to: '/templates',
    icon: Upload,
    hint: 'Attach a file to a record',
  },
  {
    label: 'Browse templates',
    to: '/templates',
    icon: LayoutTemplate,
    hint: 'Explore the template library',
  },
  {
    label: 'Search',
    to: '/search',
    icon: Search,
    hint: 'Find records across the workspace',
  },
  {
    label: 'Review inbox',
    to: '/reviews',
    icon: Inbox,
    hint: 'Open the review and approvals queue',
  },
  {
    label: 'Schemas',
    to: '/schemas',
    icon: Database,
    hint: 'Manage dataset schemas',
  },
  {
    label: 'Datasets',
    to: '/datasets',
    icon: Database,
    hint: 'Browse datasets, schemas and lineage',
  },
]

function QuickActionsGrid() {
  return (
    <section aria-label="Quick actions">
      <h2 className="mb-3 text-sm font-semibold text-foreground">
        Quick actions
      </h2>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {QUICK_ACTIONS.map((action) => {
          const Icon = action.icon
          return (
            <li key={action.label}>
              <Link
                to={action.to}
                className="flex h-full flex-col gap-2 rounded-lg border border-border bg-card p-3 no-underline transition-colors hover:bg-muted/40"
              >
                <span className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <span className="text-sm font-medium text-foreground">
                  {action.label}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {action.hint}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
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
  pinnedIds,
  onTogglePin,
  title = 'Recent work',
  emptyTitle = 'No recent work yet',
  emptyBody = 'Experiments, samples, protocols and reports you create will show up here. Start by opening a project.',
}: {
  records: NotebookRecord[]
  projectById: Map<string, Project>
  isLoading: boolean
  error: unknown
  onRetry: () => void
  pinnedIds?: string[]
  onTogglePin?: (recordId: string) => void
  title?: string
  emptyTitle?: string
  emptyBody?: string
}) {
  if (isLoading) {
    return (
      <section
        aria-label={title}
        className="rounded-lg border border-border bg-card"
      >
        <SectionHeader title={title} />
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
        aria-label={title}
        className="rounded-lg border border-border bg-card"
      >
        <SectionHeader title={title} />
        <ErrorState
          message={`Could not load ${title.toLowerCase()}.`}
          onRetry={onRetry}
        />
      </section>
    )
  }

  if (records.length === 0) {
    return (
      <section
        aria-label={title}
        className="rounded-lg border border-border bg-card"
      >
        <SectionHeader title={title} />
        <EmptyState
          icon={FlaskConical}
          title={emptyTitle}
          body={emptyBody}
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
      aria-label={title}
      className="rounded-lg border border-border bg-card"
    >
      <SectionHeader title={title} count={records.length} />
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
            {onTogglePin ? <TableHead className="w-8" /> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((record) => {
            const project = record.projectId
              ? projectById.get(record.projectId)
              : undefined
            const isPinned = pinnedIds?.includes(record.id) ?? false
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
                  <span aria-label="Owner not available">—</span>
                </TableCell>
                {onTogglePin ? (
                  <TableCell className="w-8">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={isPinned ? 'Unpin record' : 'Pin record'}
                      onClick={() => onTogglePin(record.id)}
                    >
                      <Pin
                        className={cn(
                          'size-3.5',
                          isPinned
                            ? 'fill-foreground text-foreground'
                            : 'text-muted-foreground',
                        )}
                        aria-hidden="true"
                      />
                    </Button>
                  </TableCell>
                ) : null}
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
// Pinned records — localStorage key and panel.
// ---------------------------------------------------------------------------

const PINNED_RECORDS_KEY = 'sheetbase-pinned-records'

// ---------------------------------------------------------------------------
// Mentions panel — open comments mentioning the current user.
// ---------------------------------------------------------------------------

export function MentionsPanel({
  mentions,
  isLoading,
  error,
  onRetry,
  currentUserId,
}: {
  mentions: DashboardMentionItem[]
  isLoading: boolean
  error: unknown
  onRetry: () => void
  currentUserId: string
}) {
  if (isLoading) {
    return (
      <section
        aria-label="Mentions and comments"
        className="rounded-lg border border-border bg-card"
      >
        <SectionHeader title="Mentions & comments" />
        <div className="space-y-2 p-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      </section>
    )
  }

  if (error) {
    return (
      <section
        aria-label="Mentions and comments"
        className="rounded-lg border border-border bg-card"
      >
        <SectionHeader title="Mentions & comments" />
        <ErrorState message="Could not load mentions." onRetry={onRetry} />
      </section>
    )
  }

  if (mentions.length === 0) {
    return (
      <section
        aria-label="Mentions and comments"
        className="rounded-lg border border-border bg-card"
      >
        <SectionHeader title="Mentions & comments" />
        <EmptyState
          icon={AtSign}
          title="No mentions yet"
          body="When collaborators mention you in a comment, it will appear here. Share a record to start a discussion."
        />
      </section>
    )
  }

  return (
    <section
      aria-label="Mentions and comments"
      className="rounded-lg border border-border bg-card"
    >
      <SectionHeader
        title="Mentions & comments"
        count={mentions.length}
        action={
          <span className="text-xs text-muted-foreground">
            {mentions.length} new
          </span>
        }
      />
      <ul className="divide-y divide-border">
        {mentions.map((mention) => (
          <li key={mention.id} className="px-4 py-3">
            <Link
              to="/projects/$projectId/experiments/$recordId"
              params={{
                projectId: 'unknown',
                recordId: mention.recordId,
              }}
              className="block no-underline"
            >
              <p className="line-clamp-2 text-sm text-foreground">
                {mention.body}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {mention.authorUserId === currentUserId
                  ? 'You'
                  : mention.authorUserId
                    ? mention.authorUserId.slice(0, 8)
                    : 'Deleted user'}
                {' · '}
                {formatRelativeTime(mention.createdAt)}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Activity feed — real change events from the workspace audit trail.
// ---------------------------------------------------------------------------

export function ActivityFeed({
  items,
  isLoading,
  error,
  onRetry,
  currentUserId,
}: {
  items: DashboardActivityItem[]
  isLoading: boolean
  error: unknown
  onRetry: () => void
  currentUserId: string
}) {
  if (isLoading) {
    return (
      <section
        aria-label="Recent activity"
        className="rounded-lg border border-border bg-card"
      >
        <SectionHeader title="Recent activity" />
        <div className="space-y-2 p-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </section>
    )
  }

  if (error) {
    return (
      <section
        aria-label="Recent activity"
        className="rounded-lg border border-border bg-card"
      >
        <SectionHeader title="Recent activity" />
        <ErrorState message="Could not load activity." onRetry={onRetry} />
      </section>
    )
  }

  if (items.length === 0) {
    return (
      <section
        aria-label="Recent activity"
        className="rounded-lg border border-border bg-card"
      >
        <SectionHeader title="Recent activity" />
        <EmptyState
          icon={ActivityIcon}
          title="No recent activity"
          body="Edits, comments, reviews and status changes from your workspace will show up here once you start creating records."
        />
      </section>
    )
  }

  return (
    <section
      aria-label="Recent activity"
      className="rounded-lg border border-border bg-card"
    >
      <SectionHeader title="Recent activity" count={items.length} />
      <ul className="divide-y divide-border">
        {items.slice(0, 15).map((item) => {
          const isMe = item.actorUserId === currentUserId
          const actor = isMe
            ? 'You'
            : item.actorUserId
              ? item.actorUserId.slice(0, 8)
              : 'System'
          return (
            <li key={item.id} className="flex items-start gap-3 px-4 py-2.5">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <ActivityIcon className="size-3" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground">
                  <span className="font-medium">{actor}</span>{' '}
                  {activitySentence(item)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatRelativeTime(item.createdAt)}
                </p>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ---------------------------------------------------------------------------
// My priorities — top pending reviews, shown in the right sidebar.
// ---------------------------------------------------------------------------

export function MyPrioritiesPanel({
  priorities,
  isLoading,
}: {
  priorities: ReviewItem[]
  isLoading: boolean
}) {
  return (
    <section
      aria-label="My priorities"
      className="rounded-lg border border-border bg-card"
    >
      <SectionHeader title="My priorities" />
      {isLoading ? (
        <div className="space-y-2 p-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : priorities.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No priorities"
          body="Pending reviews assigned to you will appear here as priorities."
        />
      ) : (
        <ol className="divide-y divide-border">
          {priorities.map((review, i) => {
            const overdue = isReviewOverdue(
              review.state,
              review.submittedAt,
              OVERDUE_DAYS,
            )
            return (
              <li key={review.id} className="flex items-center gap-3 px-4 py-3">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                  {i + 1}
                </span>
                <Link to="/reviews" className="min-w-0 flex-1 no-underline">
                  <p className="truncate text-sm font-medium text-foreground">
                    Review {review.recordIdentifier}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {review.recordTitle}
                  </p>
                </Link>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
                    overdue
                      ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                      : 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
                  )}
                >
                  {overdue ? 'Overdue' : 'Under review'}
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Pinned records panel — shortcuts to records the user pinned.
// ---------------------------------------------------------------------------

export function PinnedRecordsPanel({
  pinnedRecords,
  isLoading,
  onUnpin,
}: {
  pinnedRecords: DashboardPinnedItem[]
  isLoading: boolean
  onUnpin: (recordId: string) => void
}) {
  return (
    <section
      aria-label="Pinned items"
      className="rounded-lg border border-border bg-card"
    >
      <SectionHeader title="Pinned items" />
      {isLoading ? (
        <div className="space-y-2 p-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : pinnedRecords.length === 0 ? (
        <EmptyState
          icon={Pin}
          title="No pinned items"
          body="Pin records from the recently edited table to keep them handy here."
        />
      ) : (
        <ul className="divide-y divide-border">
          {pinnedRecords.map(({ record, project }) => (
            <li key={record.id} className="flex items-center gap-2 px-4 py-3">
              <Link
                to={
                  record.projectId
                    ? '/projects/$projectId/experiments/$recordId'
                    : '/templates'
                }
                params={
                  record.projectId
                    ? { projectId: record.projectId, recordId: record.id }
                    : {}
                }
                className="min-w-0 flex-1 no-underline"
              >
                <p className="truncate text-sm font-medium text-foreground">
                  {record.title}
                </p>
                <p className="truncate font-mono text-[11px] tabular-nums text-muted-foreground">
                  {record.identifier}
                  {project ? ` · ${project.title}` : ''}
                </p>
              </Link>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Unpin record"
                onClick={() => onUnpin(record.id)}
              >
                <Pin
                  className="size-3.5 fill-foreground text-foreground"
                  aria-hidden="true"
                />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Upcoming approvals — pending reviews with ageing info.
// ---------------------------------------------------------------------------

export function UpcomingApprovalsPanel({
  pendingReviews,
  isLoading,
}: {
  pendingReviews: ReviewItem[]
  isLoading: boolean
}) {
  const sorted = [...pendingReviews]
    .sort((a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt))
    .slice(0, 5)

  return (
    <section
      aria-label="Upcoming approvals"
      className="rounded-lg border border-border bg-card"
    >
      <SectionHeader title="Upcoming approvals" />
      {isLoading ? (
        <div className="space-y-2 p-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No upcoming approvals"
          body="Reviews assigned to you will appear here with their ageing status."
        />
      ) : (
        <ul className="divide-y divide-border">
          {sorted.map((review) => {
            const ageDays = Math.floor(
              (Date.now() - Date.parse(review.submittedAt)) / 86_400_000,
            )
            const overdue = ageDays > OVERDUE_DAYS
            return (
              <li key={review.id} className="px-4 py-3">
                <Link to="/reviews" className="block no-underline">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                      {review.recordIdentifier}
                    </span>
                    <span
                      className={cn(
                        'text-[10px] font-medium',
                        overdue
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-muted-foreground',
                      )}
                    >
                      {overdue
                        ? `Overdue (${ageDays}d)`
                        : ageDays === 0
                          ? 'Today'
                          : `${ageDays}d ago`}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-sm text-foreground">
                    {review.recordTitle}
                  </p>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
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
