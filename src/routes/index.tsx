import { MetricSummary } from '#/components/scientific/metric-summary'
import { useQuery } from '@tanstack/react-query'
import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Activity as ActivityIcon,
  ArrowRight,
  AtSign,
  ClipboardList,
  Database,
  FlaskConical,
  Folder,
  GanttChart,
  Inbox,
  Layers,
  LayoutTemplate,
  Pin,
  Plus,
  Search,
  Star,
  TestTube,
  Upload,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { CreateBlankExperimentDialog } from '#/components/notebook/create-blank-experiment-dialog'
import { useShell } from '#/components/shell'
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
  fetchFavouriteItems,
  favouritesQueryKeys,
  FAVOURITES_LIMIT,
  useSetFavourite,
} from '#/lib/favourites'
import type { FavouriteItem } from '#/lib/favourites'
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
import {
  fetchRecentItems,
  recentsQueryKeys,
  RECENTS_LIMIT,
} from '#/lib/recents'
import type { RecentItem } from '#/lib/recents'
import { projectPath, recordDestination, recordPath } from '#/lib/navigation'
import { cn } from '#/lib/utils'
import { requestShortcutsDialog } from '#/lib/shortcuts-dialog'
import { useUserNames } from '#/lib/user-names'
import { fetchCalendarBookings, formatTimeInZone } from '#/lib/calendar'
import { fetchWorkspaceMembers } from '#/lib/workspace-admin'
import { useWorkItems } from '#/lib/work-items/data'

function RouteShell({
  children,
  ...configuration
}: Parameters<typeof useShell>[0] & { children: ReactNode }) {
  useShell(configuration)
  return <>{children}</>
}

export const Route = createFileRoute('/')({
  beforeLoad: async ({ context }) => {
    // Auth context is fetched once at the root route — read it from there
    // instead of making a separate server round-trip.
    const contextValue = context.auth
    if (!contextValue) {
      throw redirect({ to: '/sign-in' })
    }
    return { context: contextValue }
  },
  component: Home,
})

const retryBootstrapFn = createServerFn({ method: 'POST' }).handler(
  async () => {
    const { getRequestHeaders } = await import('@tanstack/react-start/server')
    const { getAppSession } = await import('#/lib/auth')
    const { drizzle } = await import('drizzle-orm/node-postgres')
    const { env } = await import('#/env.server')
    const schema = await import('#/db/schema')
    const { bootstrapWorkspaceForUser } = await import('#/lib/bootstrap')

    const session = await getAppSession(getRequestHeaders())
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
      fullBleed
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
            id: context.workspace.id,
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

interface DashboardContext {
  userId: string
  user: { name: string; email: string }
  workspace: { id: string; name: string; slug: string; role: string }
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
  const todayLabel = now.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
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

  // FIND-01 — cross-object recents for work resumption: per-user views plus
  // the canonical edit/review audit trail, merged deterministically and
  // resolved to canonical labels/destinations.
  const recentsQuery = useQuery({
    queryKey: recentsQueryKeys.recents(userId, RECENTS_LIMIT),
    queryFn: () => fetchRecentItems(notebookDataClient, userId, RECENTS_LIMIT),
  })

  // FIND-02 — deliberate per-user favourites for fast return. Server-persisted
  // per user; archived/deleted/retired objects are dropped at read time, and
  // unfavouriting (the star on an object page or here) is the only removal.
  const favouritesQuery = useQuery({
    queryKey: favouritesQueryKeys.items(),
    queryFn: () => fetchFavouriteItems(notebookDataClient, FAVOURITES_LIMIT),
  })
  const favouriteMutation = useSetFavourite()

  // WORK-01 — the caller's open work items, for the inbox count.
  const workItemsQuery = useWorkItems()

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

  // WORK-02.2 — first-run state: nothing viewed, edited or awaiting review.
  const isFirstRun =
    !recentsQuery.isLoading &&
    (recentsQuery.data ?? []).length === 0 &&
    !myRecordsQuery.isLoading &&
    myRecords.length === 0
  const pinnedRecords = pinnedQuery.data ?? []
  const projectById = new Map(projects.map((p) => [p.id, p]))

  // Resolve user IDs → names for mentions and activity feed
  const allUserIds = useMemo(() => {
    const ids = new Set<string>()
    for (const m of myMentions) if (m.authorUserId) ids.add(m.authorUserId)
    for (const a of recentActivity) if (a.actorUserId) ids.add(a.actorUserId)
    return Array.from(ids)
  }, [myMentions, recentActivity])
  const { userLabel } = useUserNames(allUserIds, {
    id: userId,
    name: context.user.name,
  })

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
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-0.5">
          <h1 className="text-page-title text-foreground">Home</h1>
          <p className="text-caption text-muted-foreground">
            {todayLabel} · {context.workspace.name}
          </p>
        </div>
        <Button asChild variant="secondary" size="md">
          <Link to="/inbox" className="no-underline">
            Open inbox
          </Link>
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-caption text-muted-foreground">
        <span>{(myReviewsQuery.data ?? []).length} to review</span>
        <span>
          {myRecords.filter((record) => record.status === 'in_progress').length}{' '}
          experiments in progress
        </span>
        <Link to="/inbox" className="text-primary no-underline hover:underline">
          Open inbox · {(workItemsQuery.data ?? []).length} items
        </Link>
      </div>

      {isFirstRun ? (
        <FirstRunSection
          projects={projects}
          workspaceId={context.workspace.id}
        />
      ) : null}

      <QuickActionsGrid />

      <section
        aria-label="Summary"
        className="grid grid-cols-1 gap-x-5 gap-y-3 border-y border-border py-3 sm:grid-cols-2 xl:grid-cols-5"
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
          return (
            <MetricCard
              key={metric.label}
              metric={metric}
              loading={isLoading}
              deadlineHint={i === 1 ? deadlineHint : undefined}
            />
          )
        })}
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <RecentSection
          items={recentsQuery.data ?? []}
          isLoading={recentsQuery.isLoading}
          error={recentsQuery.error}
          onRetry={() => recentsQuery.refetch()}
        />

        <MyPrioritiesPanel
          priorities={myPriorities}
          isLoading={myReviewsQuery.isLoading}
        />
      </div>

      <TodayScheduleSection workspaceId={context.workspace.id} />

      <NeedsAttentionSection />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
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
            userLabel={userLabel}
          />
          <ProjectQuickAccess
            projects={projects}
            isLoading={projectsQuery.isLoading}
            error={projectsQuery.error}
            onRetry={() => projectsQuery.refetch()}
          />
        </div>

        <div className="space-y-6">
          <FavouritesSection
            items={favouritesQuery.data ?? []}
            isLoading={favouritesQuery.isLoading}
            error={favouritesQuery.error}
            onRetry={() => favouritesQuery.refetch()}
            onRemove={(item) =>
              favouriteMutation.mutate({
                kind: item.kind,
                objectId: item.id,
                favourite: false,
              })
            }
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
          <ActivityFeed
            items={recentActivity}
            isLoading={activityQuery.isLoading}
            error={activityQuery.error}
            onRetry={() => activityQuery.refetch()}
            currentUserId={userId}
            userLabel={userLabel}
          />
        </div>
      </div>
    </div>
  )
}

const hintToneClasses: Record<
  NonNullable<DashboardMetric['hintTone']>,
  string
> = {
  default: 'text-muted-foreground',
  urgent: 'text-danger-text',
  warning: 'text-warning-text',
  info: 'text-info',
  success: 'text-success-text',
  violet: 'text-review',
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
  deadlineHint,
}: {
  metric: DashboardMetric
  loading?: boolean
  deadlineHint?: string
}) {
  const card = (
    <MetricSummary
      label={metric.label}
      value={loading ? <Skeleton className="h-6 w-6" /> : metric.value}
      valueDescription={metric.timeBoundary}
      hint={metric.hint}
      hintClassName={
        metric.hintTone ? hintToneClasses[metric.hintTone] : undefined
      }
      detail={deadlineHint}
    />
  )

  if (metric.linkTo && !loading) {
    return (
      <Link
        to={metric.linkTo}
        params={metric.linkParams}
        className="block min-w-0 rounded-md no-underline hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
  to?: string
  action?: 'create-experiment'
  icon: LucideIcon
  hint: string
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    label: 'Create experiment',
    action: 'create-experiment',
    icon: FlaskConical,
    hint: 'Start a blank Notebook',
  },
  {
    label: 'Add sample',
    to: '/samples',
    icon: TestTube,
    hint: 'Register a new sample',
  },
  {
    label: 'Upload file',
    to: '/projects',
    icon: Upload,
    hint: 'Open a project, then attach files in a Notebook',
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
    to: '/inbox',
    icon: Inbox,
    hint: 'Open the review and approvals queue',
  },
  {
    label: 'Configure',
    to: '/configure',
    icon: Layers,
    hint: 'Govern Models and Dataset Schema versions',
  },
  {
    label: 'Datasets',
    to: '/datasets',
    icon: Database,
    hint: 'Browse datasets, schemas and lineage',
  },
]

function QuickActionsGrid() {
  const [createOpen, setCreateOpen] = useState(false)
  return (
    <section aria-label="Quick actions">
      <h2 className="sr-only">Quick actions</h2>
      <ul className="flex flex-wrap items-center gap-2">
        {QUICK_ACTIONS.map((action) => {
          const Icon = action.icon
          return (
            <li key={action.label}>
              {action.action === 'create-experiment' ? (
                <Button
                  type="button"
                  size="sm"
                  title={action.hint}
                  onClick={() => setCreateOpen(true)}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {action.label}
                </Button>
              ) : (
                <Button asChild variant="ghost" size="sm">
                  <Link
                    to={action.to}
                    title={action.hint}
                    className="no-underline"
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    {action.label}
                  </Link>
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      <CreateBlankExperimentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </section>
  )
}

// ---------------------------------------------------------------------------
// Favourites (FIND-02) — deliberate per-user pins across canonical objects.
// Persistent across sessions; ordering is created_at desc (most recently
// favourited first) with a kind-then-id tiebreak, resolved to canonical
// labels/destinations by the data layer. Favourites of archived, deleted or
// retired objects never render here — they are hidden at read time, NOT
// deleted; unfavouriting (star or the remove control here) is the only way a
// favourite disappears.
// ---------------------------------------------------------------------------

export function FavouritesSection({
  items,
  isLoading,
  error,
  onRetry,
  onRemove,
}: {
  items: FavouriteItem[]
  isLoading: boolean
  error: unknown
  onRetry: () => void
  onRemove: (item: FavouriteItem) => void
}) {
  return (
    <section aria-label="Favourites" className="min-w-0 border-t border-border">
      <SectionHeader
        title="Favourites"
        count={isLoading ? undefined : items.length}
      />
      {isLoading ? (
        <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-1">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : error ? (
        <ErrorState message="Could not load favourites." onRetry={onRetry} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Star}
          title="No favourites yet"
          body="Use the star on any Notebook, Sheet, Dataset, project or template to pin the work you return to most."
        />
      ) : (
        <ul className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-1">
          {items.map((item) => {
            const Icon = RECENT_KIND_ICONS[item.kind]
            return (
              <li
                key={`${item.kind}:${item.id}`}
                className="flex items-center bg-card"
              >
                <Link
                  to={item.destination}
                  className="flex h-full min-w-0 flex-1 items-center gap-3 px-4 py-3 no-underline transition-colors hover:bg-muted/40"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {item.label}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {RECENT_KIND_LABELS[item.kind]}
                      {item.identifier ? ` · ${item.identifier}` : ''} ·{' '}
                      {formatRelativeTime(item.createdAt)}
                    </span>
                  </span>
                </Link>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="mr-2 shrink-0"
                  aria-label={`Remove ${item.label} from favourites`}
                  onClick={() => onRemove(item)}
                >
                  <Star
                    className="size-3.5 fill-warning text-warning-text"
                    aria-hidden="true"
                  />
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Recent (FIND-01) — compact cross-object resumption surface. Notebooks,
// Sheets, Datasets, Records and projects the user recently viewed, edited or
// had reviewed, ordered by last activity. Items already resolve to canonical
// labels and destinations in the data layer.
// ---------------------------------------------------------------------------

const RECENT_KIND_ICONS: Record<RecentItem['kind'], LucideIcon> = {
  record: FlaskConical,
  dataset: Database,
  sheet: GanttChart,
  project: Folder,
  notebook_template: LayoutTemplate,
}

const RECENT_KIND_LABELS: Record<RecentItem['kind'], string> = {
  record: 'Record',
  dataset: 'Dataset',
  sheet: 'Sheet',
  project: 'Project',
  notebook_template: 'Template',
}

const RECENT_SIGNAL_LABELS: Record<RecentItem['signal'], string> = {
  edited: 'Edited',
  reviewed: 'In review',
  viewed: 'Viewed',
}

const RECENT_SIGNAL_CLASSES: Record<RecentItem['signal'], string> = {
  edited: 'bg-success-wash text-success-text',
  reviewed: 'bg-review-wash text-review',
  viewed: 'bg-muted text-muted-foreground',
}

export function RecentSection({
  items,
  isLoading,
  error,
  onRetry,
}: {
  items: RecentItem[]
  isLoading: boolean
  error: unknown
  onRetry: () => void
}) {
  return (
    <section aria-label="Recent" className="min-w-0 border-t border-border">
      <SectionHeader
        title="Continue working"
        count={isLoading ? undefined : items.length}
      />
      {isLoading ? (
        <div className="grid gap-3 p-3 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : error ? (
        <ErrorState message="Could not load recent items." onRetry={onRetry} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={ActivityIcon}
          title="Nothing recent yet"
          body="Notebooks, Sheets, Datasets, Records and projects you open or edit will appear here so you can pick up where you left off."
          action={
            <Button asChild variant="outline" size="sm">
              <Link to="/projects" className="no-underline">
                Open projects
              </Link>
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-px bg-border sm:grid-cols-2">
          {items.map((item) => {
            const Icon = RECENT_KIND_ICONS[item.kind]
            return (
              <li key={`${item.kind}:${item.id}`} className="bg-background">
                <Link
                  to={item.destination}
                  className="flex h-full items-center gap-3 px-4 py-3 no-underline transition-colors hover:bg-muted/40"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {item.label}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {RECENT_KIND_LABELS[item.kind]}
                      {item.identifier ? ` · ${item.identifier}` : ''} ·{' '}
                      {formatRelativeTime(item.lastActivityAt)}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                      RECENT_SIGNAL_CLASSES[item.signal],
                    )}
                  >
                    {RECENT_SIGNAL_LABELS[item.signal]}
                  </span>
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
      <section aria-label={title} className="min-w-0 border-t border-border">
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
      <section aria-label={title} className="min-w-0 border-t border-border">
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
      <section aria-label={title} className="min-w-0 border-t border-border">
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
    <section aria-label={title} className="min-w-0 border-t border-border">
      <SectionHeader title={title} count={records.length} />
      <Table variant="quiet" className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-1/2">Title</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden text-right sm:table-cell">
              Updated
            </TableHead>
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
                    to={recordDestination(record.kind, record.id)}
                    className="flex items-center gap-3 no-underline"
                  >
                    <RecordKindIcon kind={record.kind} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {record.title}
                      </span>
                      <span className="block truncate font-mono text-xs tabular-nums text-muted-foreground">
                        {record.identifier}
                      </span>
                    </span>
                  </Link>
                  {project ? (
                    <Link
                      to="/projects/$projectId"
                      params={{ projectId: project.id }}
                      className="mt-1 block truncate text-xs text-muted-foreground no-underline hover:text-foreground"
                    >
                      {project.title}
                    </Link>
                  ) : null}
                </TableCell>
                <TableCell>
                  <StatusBadge domain="experiment" status={record.status} />
                </TableCell>
                <TableCell className="hidden text-right text-xs tabular-nums text-muted-foreground sm:table-cell">
                  {formatRelativeTime(record.updatedAt)}
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
  userLabel,
}: {
  mentions: DashboardMentionItem[]
  isLoading: boolean
  error: unknown
  onRetry: () => void
  currentUserId: string
  userLabel: (userId: string) => string
}) {
  if (isLoading) {
    return (
      <section
        aria-label="Mentions and comments"
        className="min-w-0 border-t border-border"
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
        className="min-w-0 border-t border-border"
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
        className="min-w-0 border-t border-border"
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
      className="min-w-0 border-t border-border"
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
              to={recordPath(mention.recordId)}
              className="block no-underline"
            >
              <p className="line-clamp-2 text-sm text-foreground">
                {mention.body}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {mention.authorUserId === currentUserId
                  ? 'You'
                  : mention.authorUserId
                    ? userLabel(mention.authorUserId)
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
  userLabel,
}: {
  items: DashboardActivityItem[]
  isLoading: boolean
  error: unknown
  onRetry: () => void
  currentUserId: string
  userLabel: (userId: string) => string
}) {
  if (isLoading) {
    return (
      <section
        aria-label="Recent activity"
        className="min-w-0 border-t border-border"
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
        className="min-w-0 border-t border-border"
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
        className="min-w-0 border-t border-border"
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
      className="min-w-0 border-t border-border"
    >
      <SectionHeader
        title="Recent activity"
        action={
          <span className="text-xs text-muted-foreground">
            Latest {Math.min(items.length, 5)}
          </span>
        }
      />
      <ul className="divide-y divide-border">
        {items.slice(0, 5).map((item) => {
          const isMe = item.actorUserId === currentUserId
          const actor = isMe
            ? 'You'
            : item.actorUserId
              ? userLabel(item.actorUserId)
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

/**
 * WORK-02.1 — "Needs attention": the caller's open work items (assigned
 * reviews, failed runs and followed records), from api.my_work_items.
 */

/**
 * WORK-02.1 — "Today": the workspace's bookings for the current day.
 */

/**
 * WORK-02.2 — the first-run guidance: a short setup checklist, shown when the
 * user has nothing recently viewed, edited or awaiting their review.
 */
function FirstRunSection({
  projects,
  workspaceId,
}: {
  projects: Array<{ id: string; title: string }>
  workspaceId: string
}) {
  const firstProject: { id: string; title: string } | null =
    projects.length > 0 ? projects[0] : null
  const membersQuery = useQuery({
    queryKey: ['workspace-members', workspaceId],
    queryFn: () => fetchWorkspaceMembers(notebookDataClient, workspaceId),
    staleTime: 60_000,
  })
  const members = (membersQuery.data ?? []).slice(0, 5)
  const { userLabel } = useUserNames(members.map((member) => member.userId))
  const steps = [
    {
      title: 'Account created',
      detail: 'You are signed in and ready.',
      done: true,
    },
    {
      title: 'Set up your electronic signature',
      detail:
        'Required before you can author, review or approve records. Takes about 2 minutes.',
      action: { label: 'Set up signature', to: '/settings' },
      done: false,
    },
    {
      title: 'Open your first project',
      detail: firstProject
        ? `${firstProject.title} is ready when you are.`
        : 'Projects you can access appear here.',
      action: {
        label: 'Open project',
        to: firstProject ? projectPath(firstProject.id) : '/projects',
      },
      done: false,
    },
    {
      title: 'Create an experiment from a protocol',
      detail: 'Templates set up sections, sheets and required fields for you.',
      action: { label: 'Browse templates', to: '/templates' },
      done: false,
    },
  ]
  const done = steps.filter((step) => step.done).length
  return (
    <section
      aria-label="Get set up"
      className="min-w-0 rounded-lg border border-border"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="text-section text-foreground">Get set up</h2>
        <span className="text-caption text-muted-foreground">
          {done} of {steps.length} done
        </span>
      </div>
      <ol className="divide-y divide-border">
        {steps.map((step) => (
          <li key={step.title} className="flex items-start gap-3 px-4 py-3">
            <span
              aria-hidden="true"
              className={cn(
                'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full text-[10px]',
                step.done
                  ? 'bg-success-wash text-success-text'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              {step.done ? '✓' : ''}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">
                {step.title}
              </p>
              <p className="text-caption text-muted-foreground">
                {step.detail}
              </p>
            </div>
            {step.action ? (
              <Button asChild variant="secondary" size="sm">
                <Link to={step.action.to} className="no-underline">
                  {step.action.label}
                </Link>
              </Button>
            ) : null}
          </li>
        ))}
      </ol>
      <div className="grid gap-4 border-t border-border p-4 md:grid-cols-2">
        <div className="min-w-0">
          <h3 className="mb-2 text-label text-muted-foreground">
            Your projects
          </h3>
          {projects.length === 0 ? (
            <p className="text-caption text-muted-foreground">
              Other projects in this workspace are visible once someone adds
              you.
            </p>
          ) : (
            <ul className="space-y-1">
              {projects.slice(0, 5).map((project) => (
                <li key={project.id}>
                  <Link
                    to={projectPath(project.id)}
                    className="text-sm text-foreground no-underline hover:underline"
                  >
                    {project.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="min-w-0">
          <h3 className="mb-2 text-label text-muted-foreground">
            People to know
          </h3>
          {members.length === 0 ? (
            <p className="text-caption text-muted-foreground">
              Workspace members appear here.
            </p>
          ) : (
            <ul className="space-y-1">
              {members.map((member) => (
                <li
                  key={member.id}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span className="truncate text-foreground">
                    {userLabel(member.userId)}
                  </span>
                  <span className="shrink-0 text-caption text-muted-foreground">
                    {member.role}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-2 text-caption">
        <span className="text-muted-foreground">Help</span>
        <Link to="/help" className="text-primary no-underline hover:underline">
          How records, reviews and signatures work
        </Link>
        <button
          type="button"
          onClick={requestShortcutsDialog}
          className="text-primary hover:underline"
        >
          Keyboard shortcuts
        </button>
      </div>
    </section>
  )
}

function TodayScheduleSection({ workspaceId }: { workspaceId: string }) {
  const now = new Date()
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  const query = useQuery({
    queryKey: [
      'calendar',
      'today-bookings',
      workspaceId,
      start.toISOString(),
      end.toISOString(),
    ],
    queryFn: () =>
      fetchCalendarBookings(
        notebookDataClient,
        workspaceId,
        start.toISOString(),
        end.toISOString(),
      ),
  })
  const bookings = query.data ?? []
  return (
    <section aria-label="Today" className="min-w-0 border-t border-border">
      <SectionHeader title="Today" />
      {query.isLoading ? (
        <div className="space-y-2 p-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : bookings.length === 0 ? (
        <EmptyState
          icon={GanttChart}
          title="Nothing booked today"
          body="Today's instrument and meeting bookings show here."
        />
      ) : (
        <ul className="divide-y divide-border">
          {bookings.map((booking) => (
            <li key={booking.id} className="flex items-center gap-3 px-4 py-3">
              <span className="w-12 shrink-0 text-caption text-muted-foreground">
                {formatTimeInZone(
                  new Date(booking.starts_at),
                  booking.timezone,
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {booking.title}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {booking.status}
                  {booking.location ? ` · ${booking.location}` : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function NeedsAttentionSection() {
  const query = useWorkItems()
  const items = (query.data ?? []).filter(
    (item) => item.state !== 'following' && item.kind !== 'following',
  )
  return (
    <section
      aria-label="Needs attention"
      className="min-w-0 border-t border-border"
    >
      <SectionHeader title="Needs attention" />
      {query.isLoading ? (
        <div className="space-y-2 p-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Nothing needs attention"
          body="Reviews, failed pipeline runs and followed records will appear here."
        />
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li key={`${item.kind}:${item.recordId ?? item.identifier}`}>
              {item.recordId ? (
                <Link
                  to={recordPath(item.recordId)}
                  className="flex items-center gap-3 px-4 py-3 no-underline"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {item.title}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {item.reason}
                    </p>
                  </div>
                </Link>
              ) : (
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {item.title}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {item.reason}
                    </p>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function MyPrioritiesPanel({
  priorities,
  isLoading,
}: {
  priorities: ReviewItem[]
  isLoading: boolean
}) {
  const { userLabel } = useUserNames(
    priorities.map((review) => review.submittedByUserId),
  )
  return (
    <section
      aria-label="Awaiting your review"
      className="min-w-0 border-t border-border"
    >
      <SectionHeader title="Awaiting your review" />
      {isLoading ? (
        <div className="space-y-2 p-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : priorities.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Nothing awaiting your review"
          body="Pending reviews assigned to you will appear here."
        />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Record</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Submitted by</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {priorities.map((review) => {
                const overdue = isReviewOverdue(
                  review.state,
                  review.submittedAt,
                  OVERDUE_DAYS,
                )
                return (
                  <TableRow key={review.id}>
                    <TableCell>
                      <Link to="/inbox" className="no-underline">
                        <span className="block text-sm font-medium text-foreground">
                          {review.recordTitle}
                        </span>
                        <span className="block text-id text-muted-foreground">
                          {review.recordIdentifier}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {review.projectTitle ?? '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {userLabel(review.submittedByUserId)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-muted-foreground',
                        overdue && 'text-danger-text',
                      )}
                    >
                      {review.dueAt
                        ? new Date(review.dueAt).toLocaleDateString('en-GB', {
                            day: 'numeric',
                            month: 'short',
                          })
                        : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="secondary">
                        <Link to="/inbox" className="no-underline">
                          Review
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
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
      className="min-w-0 border-t border-border"
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
                to={recordDestination(record.kind, record.id)}
                className="min-w-0 flex-1 no-underline"
              >
                <p className="truncate text-sm font-medium text-foreground">
                  {record.title}
                </p>
                <p className="truncate font-mono text-xs tabular-nums text-muted-foreground">
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
      className="min-w-0 border-t border-border"
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
                <Link to="/inbox" className="block no-underline">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {review.recordIdentifier}
                    </span>
                    <span
                      className={cn(
                        'text-xs font-medium',
                        overdue ? 'text-danger-text' : 'text-muted-foreground',
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
    <section aria-label="Projects" className="min-w-0 border-t border-border">
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
        <div className="grid gap-2 p-3">
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
        <ul className="grid gap-2 p-3">
          {projects.slice(0, 6).map((project) => (
            <li key={project.id}>
              <Link
                to="/projects/$projectId"
                params={{ projectId: project.id }}
                className="flex h-full flex-col gap-1 rounded-md p-2 no-underline transition-colors hover:bg-muted/40"
              >
                <div className="flex items-center gap-2">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Folder className="size-3.5" />
                  </span>
                  <span className="truncate text-sm font-medium text-foreground">
                    {project.title}
                  </span>
                </div>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
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
    <div className="flex min-h-9 items-center justify-between gap-2 border-b border-border px-4 py-1">
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
    <div className="flex items-start gap-3 px-4 py-3">
      <Icon
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="max-w-prose text-xs leading-5 text-muted-foreground">
          {body}
        </p>
        {action ? <div className="pt-1">{action}</div> : null}
      </div>
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
      <Button
        type="button"
        disabled={pending}
        className="px-4"
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
      </Button>
    </div>
  )
}
