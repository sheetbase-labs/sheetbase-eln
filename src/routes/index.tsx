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
  AlertTriangle,
  ArrowRight,
  AtSign,
  CalendarDays,
  ChevronRight,
  CircleCheck,
  ClipboardList,
  Database,
  Eye,
  FlaskConical,
  Folder,
  GanttChart,
  Inbox,
  LayoutTemplate,
  Pin,
  Plus,
  Star,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { useShell } from '#/components/app-shell'
import {
  Button,
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
  dashboardQueryKeys,
  fetchMyMentions,
  fetchMyPendingReviews,
  fetchMyRecords,
  fetchPinnedRecords,
  fetchRecentActivity,
  isReviewOverdue,
  OVERDUE_DAYS,
} from '#/lib/dashboard-data'
import type {
  DashboardActivityItem,
  DashboardMentionItem,
  DashboardPinnedItem,
} from '#/lib/dashboard-data'
import { createDataClient } from '#/lib/data-client'
import { fetchCalendarBookings, toCalendarBooking } from '#/lib/calendar'
import type { CalendarBooking } from '#/lib/calendar'
import { fetchInstrumentRuns, fetchInstruments } from '#/lib/instrument-monitor'
import type { ReviewItem } from '#/lib/reviews'
import {
  fetchRecentItems,
  recentsQueryKeys,
  RECENTS_LIMIT,
} from '#/lib/recents'
import type { RecentItem } from '#/lib/recents'
import { recordDestination, recordPath } from '#/lib/navigation'
import { cn } from '#/lib/utils'
import { useUserNames } from '#/lib/user-names'

const dataClient = createDataClient()

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

function greetingFor(hour: number): string {
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

interface DashboardContext {
  userId: string
  user: { name: string; email: string }
  workspace: { id?: string; name: string; slug: string; role: string }
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

  const workspaceId = context.workspace.id ?? ''

  // Today's calendar bookings — drives the "Today" schedule rail.
  const todayStart = useMemo(() => {
    const day = new Date()
    day.setHours(0, 0, 0, 0)
    return day
  }, [])
  const todayBookingsQuery = useQuery({
    queryKey: ['home', 'today-bookings', workspaceId, todayStart.getTime()],
    queryFn: () =>
      fetchCalendarBookings(
        dataClient,
        workspaceId,
        todayStart.toISOString(),
        new Date(todayStart.getTime() + 86_400_000).toISOString(),
      ),
    enabled: Boolean(workspaceId),
  })

  // Instrument + run queries — failed runs feed the attention queue.
  const instrumentsQuery = useQuery({
    queryKey: ['home', 'instruments', workspaceId],
    queryFn: () => fetchInstruments(dataClient, workspaceId),
    enabled: Boolean(workspaceId),
  })
  const instrumentRunsQuery = useQuery({
    queryKey: ['home', 'instrument-runs', workspaceId],
    queryFn: () => fetchInstrumentRuns(dataClient, workspaceId),
    enabled: Boolean(workspaceId),
  })

  // --- Derived data ------------------------------------------------------

  const myRecords = myRecordsQuery.data ?? []
  const pendingReviews = myReviewsQuery.data ?? []
  const myMentions = myMentionsQuery.data ?? []
  const recentActivity = activityQuery.data ?? []
  const projects = projectsQuery.data ?? []
  const pinnedRecords = pinnedQuery.data ?? []
  const favourites = favouritesQuery.data ?? []
  const recents = recentsQuery.data ?? []
  const projectById = new Map(projects.map((p) => [p.id, p]))

  // Resolve user IDs → names for mentions, reviews and the activity feed.
  const allUserIds = useMemo(() => {
    const ids = new Set<string>()
    for (const m of myMentions) if (m.authorUserId) ids.add(m.authorUserId)
    for (const a of recentActivity) if (a.actorUserId) ids.add(a.actorUserId)
    for (const r of pendingReviews)
      if (r.submittedByUserId) ids.add(r.submittedByUserId)
    return Array.from(ids)
  }, [myMentions, recentActivity, pendingReviews])
  const { userLabel } = useUserNames(allUserIds, {
    id: userId,
    name: context.user.name,
  })

  // My priorities — top 3 pending reviews sorted by age (oldest first).
  const myPriorities = [...pendingReviews]
    .sort((a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt))
    .slice(0, 3)

  const failedRuns = useMemo(
    () =>
      (instrumentRunsQuery.data ?? [])
        .filter((run) => run.status === 'failed')
        .slice(0, 3),
    [instrumentRunsQuery.data],
  )
  const instrumentNameById = useMemo(
    () => new Map((instrumentsQuery.data ?? []).map((i) => [i.id, i.name])),
    [instrumentsQuery.data],
  )
  const todayBookings = useMemo<CalendarBooking[]>(
    () =>
      (todayBookingsQuery.data ?? []).map((b) => toCalendarBooking(b, [], [])),
    [todayBookingsQuery.data],
  )

  const recordTitleById = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of myRecords) map.set(r.id, r.title)
    for (const p of pinnedRecords) map.set(p.record.id, p.record.title)
    return map
  }, [myRecords, pinnedRecords])

  const attentionItems = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = []
    for (const run of failedRuns) {
      items.push({
        id: `run:${run.id}`,
        tone: 'danger',
        icon: AlertTriangle,
        title: `${instrumentNameById.get(run.instrumentId) ?? 'Instrument'} run failed`,
        meta:
          [run.runIdentifier, run.errorMessage].filter(Boolean).join(' · ') ||
          'Queued run reported a failure',
        actionLabel: 'Retry queue',
        to: '/instrument-monitor',
      })
    }
    for (const review of pendingReviews.slice(0, 3)) {
      items.push({
        id: `review:${review.id}`,
        tone: 'violet',
        icon: Eye,
        title: `Review requested: ${review.recordTitle}`,
        meta: `${userLabel(review.submittedByUserId)} submitted for your sign-off · ${
          review.isOverdue
            ? 'overdue'
            : `submitted ${formatRelativeTime(review.submittedAt)}`
        }`,
        actionLabel: 'Open review',
        to: '/reviews',
        primaryAction: true,
      })
    }
    for (const mention of myMentions.slice(0, 2)) {
      items.push({
        id: `mention:${mention.id}`,
        tone: 'info',
        icon: AtSign,
        title: `Mentioned in ${recordTitleById.get(mention.recordId) ?? 'a record'}`,
        meta: `${mention.authorUserId === userId ? 'You' : mention.authorUserId ? userLabel(mention.authorUserId) : 'Someone'} · ${formatRelativeTime(mention.createdAt)}`,
        actionLabel: 'Reply',
        to: recordPath(mention.recordId),
      })
    }
    return items.slice(0, 6)
  }, [
    failedRuns,
    instrumentNameById,
    pendingReviews,
    myMentions,
    recordTitleById,
    userLabel,
    userId,
  ])

  const attentionLoading =
    myReviewsQuery.isLoading ||
    myMentionsQuery.isLoading ||
    (Boolean(workspaceId) && instrumentRunsQuery.isLoading)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div>
          <p className="text-sm text-muted-foreground">{todayLabel}</p>
          <h1 className="mt-0.5 font-display text-headline font-heading tracking-tight text-foreground">
            {greeting}, {context.user.name.split(/\s+/)[0]}
          </h1>
        </div>
        <div className="flex items-center gap-4 pb-0.5 text-sm text-muted-foreground">
          {pendingReviews.length > 0 ? (
            <span className="flex items-center gap-1.5">
              <span
                className="size-2 rounded-full bg-violet"
                aria-hidden="true"
              />
              {pendingReviews.length}{' '}
              {pendingReviews.length === 1 ? 'review due' : 'reviews due'}
            </span>
          ) : null}
          {failedRuns.length > 0 ? (
            <span className="flex items-center gap-1.5">
              <span
                className="size-2 rounded-full bg-destructive"
                aria-hidden="true"
              />
              {failedRuns.length}{' '}
              {failedRuns.length === 1 ? 'run failed' : 'runs failed'}
            </span>
          ) : null}
          {myMentions.length > 0 ? (
            <span className="flex items-center gap-1.5">
              <span
                className="size-2 rounded-full bg-info"
                aria-hidden="true"
              />
              {myMentions.length}{' '}
              {myMentions.length === 1 ? 'mention' : 'mentions'}
            </span>
          ) : null}
        </div>
      </header>

      <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <NeedsAttention items={attentionItems} isLoading={attentionLoading} />
          <ContinueWorking
            recents={recents}
            pinnedRecords={pinnedRecords}
            favourites={favourites}
            projectById={projectById}
            isLoading={recentsQuery.isLoading || myRecordsQuery.isLoading}
            error={recentsQuery.error ?? myRecordsQuery.error}
            onRetry={() => {
              recentsQuery.refetch()
              myRecordsQuery.refetch()
            }}
            pinnedIds={pinnedIds}
            onTogglePin={togglePin}
            onUnfavourite={(item) =>
              favouriteMutation.mutate({
                kind: item.kind,
                objectId: item.id,
                favourite: false,
              })
            }
            pinnedLoading={pinnedQuery.isLoading || favouritesQuery.isLoading}
          />
        </div>

        <div className="min-w-0 space-y-6">
          <TodayPanel
            bookings={todayBookings}
            isLoading={todayBookingsQuery.isLoading}
            error={todayBookingsQuery.error}
            onRetry={() => todayBookingsQuery.refetch()}
          />
          <MyPrioritiesPanel
            priorities={myPriorities}
            isLoading={myReviewsQuery.isLoading}
          />
          <ActivityFeed
            items={recentActivity}
            isLoading={activityQuery.isLoading}
            error={activityQuery.error}
            onRetry={() => activityQuery.refetch()}
            currentUserId={userId}
            userLabel={userLabel}
            currentUserName={context.user.name}
          />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Needs attention — failed runs, pending reviews and mentions, each with an
// inline action. Accent bar + tonal icon mark severity without colour alone.
// ---------------------------------------------------------------------------

interface AttentionItem {
  id: string
  tone: 'danger' | 'violet' | 'info'
  icon: LucideIcon
  title: string
  meta: string
  actionLabel: string
  to: string
  primaryAction?: boolean
}

const ATTENTION_TONES: Record<
  AttentionItem['tone'],
  { bar: string; chip: string }
> = {
  danger: {
    bar: 'bg-destructive',
    chip: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  },
  violet: {
    bar: 'bg-violet',
    chip: 'bg-violet/10 text-violet',
  },
  info: {
    bar: 'bg-info',
    chip: 'bg-info/10 text-info',
  },
}

export function NeedsAttention({
  items,
  isLoading,
}: {
  items: AttentionItem[]
  isLoading: boolean
}) {
  return (
    <section aria-label="Needs attention" className="min-w-0">
      <SectionHeader
        title="Needs attention"
        action={
          <Link
            to="/reviews"
            className="text-xs font-medium text-primary no-underline hover:underline"
          >
            View all
          </Link>
        }
      />
      <div className="rounded-md border border-border bg-surface">
        {isLoading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={CircleCheck}
            title="All clear"
            body="Failed runs, review requests and mentions that need you will land here."
          />
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item) => {
              const Icon = item.icon
              const tone = ATTENTION_TONES[item.tone]
              return (
                <li
                  key={item.id}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <span
                    className={cn('w-1 self-stretch rounded-full', tone.bar)}
                    aria-hidden="true"
                  />
                  <span
                    className={cn(
                      'flex size-7 shrink-0 items-center justify-center rounded-md',
                      tone.chip,
                    )}
                  >
                    <Icon className="size-3.5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {item.title}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {item.meta}
                    </p>
                  </div>
                  <Button
                    asChild
                    variant={item.primaryAction ? 'default' : 'outline'}
                    size="sm"
                    className="shrink-0"
                  >
                    <Link to={item.to} className="no-underline">
                      {item.actionLabel}
                    </Link>
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Continue working — Recent | Pinned segmented switch over a dense work table.
// ---------------------------------------------------------------------------

interface WorkRow {
  key: string
  to: string
  icon: LucideIcon
  title: string
  identifier: string | null
  projectTitle: string | null
  status: ReactNode
  editedAt: string
  pin?: { recordId: string; pinned: boolean }
  favourite?: FavouriteItem
}

function SignalPill({ signal }: { signal: RecentItem['signal'] }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        RECENT_SIGNAL_CLASSES[signal],
      )}
    >
      {RECENT_SIGNAL_LABELS[signal]}
    </span>
  )
}

export function ContinueWorking({
  recents,
  pinnedRecords,
  favourites,
  projectById,
  isLoading,
  error,
  onRetry,
  pinnedIds,
  onTogglePin,
  onUnfavourite,
  pinnedLoading,
}: {
  recents: RecentItem[]
  pinnedRecords: DashboardPinnedItem[]
  favourites: FavouriteItem[]
  projectById: Map<string, Project>
  isLoading: boolean
  error: unknown
  onRetry: () => void
  pinnedIds: string[]
  onTogglePin: (recordId: string) => void
  onUnfavourite: (item: FavouriteItem) => void
  pinnedLoading: boolean
}) {
  const recentRows: WorkRow[] = recents.slice(0, 8).map((item) => ({
    key: `recent:${item.kind}:${item.id}`,
    to: item.destination,
    icon: RECENT_KIND_ICONS[item.kind],
    title: item.label,
    identifier: item.identifier,
    projectTitle: null,
    status: <SignalPill signal={item.signal} />,
    editedAt: item.lastActivityAt,
    pin:
      item.kind === 'record'
        ? { recordId: item.id, pinned: pinnedIds.includes(item.id) }
        : undefined,
  }))

  const pinnedRows: WorkRow[] = [
    ...pinnedRecords.map(({ record, project }) => ({
      key: `pin:${record.id}`,
      to: recordDestination(record.kind, record.id),
      icon: record.kind === 'protocol_template' ? Folder : FlaskConical,
      title: record.title,
      identifier: record.identifier,
      projectTitle:
        project?.title ??
        (record.projectId
          ? (projectById.get(record.projectId)?.title ?? null)
          : null),
      status: <StatusBadge domain="experiment" status={record.status} />,
      editedAt: record.updatedAt,
      pin: { recordId: record.id, pinned: true },
    })),
    ...favourites.map((item) => ({
      key: `fav:${item.kind}:${item.id}`,
      to: item.destination,
      icon: RECENT_KIND_ICONS[item.kind],
      title: item.label,
      identifier: item.identifier,
      projectTitle: null,
      status: null,
      editedAt: item.createdAt,
      favourite: item,
    })),
  ]

  return (
    <section aria-label="Continue working" className="min-w-0">
      <Tabs defaultValue="recent">
        <div className="flex items-center justify-between gap-2 pb-2">
          <h2 className="text-sm font-heading font-semibold text-foreground">
            Continue working
          </h2>
          <TabsList variant="boxed" className="h-7">
            <TabsTrigger value="recent" className="px-2.5 text-xs">
              Recent
            </TabsTrigger>
            <TabsTrigger value="pinned" className="px-2.5 text-xs">
              Pinned
            </TabsTrigger>
          </TabsList>
        </div>
        <div className="rounded-md border border-border bg-surface">
          <TabsContent value="recent" className="mt-0">
            {isLoading ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : error ? (
              <ErrorState
                message="Could not load recent work."
                onRetry={onRetry}
              />
            ) : recentRows.length === 0 ? (
              <EmptyState
                icon={FlaskConical}
                title="No recent work yet"
                body="Notebooks, datasets, samples and projects you open will appear here so you can pick up where you left off."
                action={
                  <Button asChild variant="outline" size="sm">
                    <Link to="/projects" className="no-underline">
                      Open projects
                    </Link>
                  </Button>
                }
              />
            ) : (
              <WorkTable
                rows={recentRows}
                onTogglePin={onTogglePin}
                onUnfavourite={onUnfavourite}
              />
            )}
          </TabsContent>
          <TabsContent value="pinned" className="mt-0">
            {pinnedLoading ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : pinnedRows.length === 0 ? (
              <EmptyState
                icon={Pin}
                title="No pinned items"
                body="Pin records from the Recent tab, or star a favourite on any object page, to keep work here."
              />
            ) : (
              <WorkTable
                rows={pinnedRows}
                onTogglePin={onTogglePin}
                onUnfavourite={onUnfavourite}
              />
            )}
          </TabsContent>
        </div>
      </Tabs>
    </section>
  )
}

function WorkTable({
  rows,
  onTogglePin,
  onUnfavourite,
}: {
  rows: WorkRow[]
  onTogglePin: (recordId: string) => void
  onUnfavourite: (item: FavouriteItem) => void
}) {
  return (
    <Table variant="quiet" className="table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className="w-[42%]">Record</TableHead>
          <TableHead className="hidden md:table-cell">Project</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="hidden text-right sm:table-cell">
            Edited
          </TableHead>
          <TableHead className="w-14" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const Icon = row.icon
          return (
            <TableRow key={row.key} className="group">
              <TableCell>
                <Link
                  to={row.to}
                  className="flex items-center gap-3 no-underline"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {row.title}
                    </span>
                    <span className="block truncate font-mono text-xs tabular-nums text-muted-foreground">
                      {row.identifier ?? '—'}
                    </span>
                  </span>
                </Link>
              </TableCell>
              <TableCell className="hidden truncate text-sm text-muted-foreground md:table-cell">
                {row.projectTitle ?? '—'}
              </TableCell>
              <TableCell>{row.status ?? '—'}</TableCell>
              <TableCell className="hidden text-right text-xs tabular-nums text-muted-foreground sm:table-cell">
                {formatRelativeTime(row.editedAt)}
              </TableCell>
              <TableCell className="w-14">
                <div className="flex items-center justify-end gap-0.5">
                  {row.pin ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={
                        row.pin.pinned ? 'Unpin record' : 'Pin record'
                      }
                      className={cn(
                        !row.pin.pinned &&
                          'opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100',
                      )}
                      onClick={() => onTogglePin(row.pin!.recordId)}
                    >
                      <Pin
                        className={cn(
                          'size-3.5',
                          row.pin.pinned
                            ? 'fill-foreground text-foreground'
                            : 'text-muted-foreground',
                        )}
                        aria-hidden="true"
                      />
                    </Button>
                  ) : null}
                  {row.favourite ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${row.title} from favourites`}
                      onClick={() => onUnfavourite(row.favourite!)}
                    >
                      <Star
                        className="size-3.5 fill-amber-400 text-amber-500"
                        aria-hidden="true"
                      />
                    </Button>
                  ) : null}
                  <ChevronRight
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                </div>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

// ---------------------------------------------------------------------------
// Today — the day's calendar bookings in the right rail.
// ---------------------------------------------------------------------------

function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function TodayPanel({
  bookings,
  isLoading,
  error,
  onRetry,
}: {
  bookings: CalendarBooking[]
  isLoading: boolean
  error: unknown
  onRetry: () => void
}) {
  return (
    <section aria-label="Today" className="min-w-0">
      <SectionHeader
        title="Today"
        action={
          <Link
            to="/calendar"
            className="text-xs font-medium text-primary no-underline hover:underline"
          >
            Calendar
          </Link>
        }
      />
      <div className="rounded-md border border-border bg-surface">
        {isLoading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : error ? (
          <ErrorState
            message="Could not load today's schedule."
            onRetry={onRetry}
          />
        ) : bookings.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title="Nothing scheduled today"
            body="Instrument bookings and bay reservations will show up here."
          />
        ) : (
          <ul className="divide-y divide-border">
            {bookings.map((booking) => (
              <li
                key={booking.id}
                className="flex items-center gap-3 px-3 py-2.5"
              >
                <span
                  className="w-1 self-stretch rounded-full bg-primary"
                  style={
                    booking.color
                      ? { backgroundColor: booking.color }
                      : undefined
                  }
                  aria-hidden="true"
                />
                <div className="w-12 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                  <span className="block">
                    {booking.allDay ? 'All' : formatClock(booking.startsAt)}
                  </span>
                  <span className="block">
                    {booking.allDay ? 'day' : formatClock(booking.endsAt)}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {booking.title}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[booking.location, booking.status]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
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
                    className="size-3.5 fill-amber-400 text-amber-500"
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
  edited:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  reviewed:
    'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
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
        title="Recent"
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

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function ActivityFeed({
  items,
  isLoading,
  error,
  onRetry,
  currentUserId,
  userLabel,
  currentUserName,
}: {
  items: DashboardActivityItem[]
  isLoading: boolean
  error: unknown
  onRetry: () => void
  currentUserId: string
  userLabel: (userId: string) => string
  currentUserName?: string
}) {
  if (isLoading) {
    return (
      <section aria-label="Recent activity" className="min-w-0">
        <SectionHeader title="Workspace activity" />
        <div className="space-y-2 rounded-md border border-border bg-surface p-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </section>
    )
  }

  if (error) {
    return (
      <section aria-label="Recent activity" className="min-w-0">
        <SectionHeader title="Workspace activity" />
        <div className="rounded-md border border-border bg-surface">
          <ErrorState message="Could not load activity." onRetry={onRetry} />
        </div>
      </section>
    )
  }

  if (items.length === 0) {
    return (
      <section aria-label="Recent activity" className="min-w-0">
        <SectionHeader title="Workspace activity" />
        <div className="rounded-md border border-border bg-surface">
          <EmptyState
            icon={ActivityIcon}
            title="No recent activity"
            body="Edits, comments, reviews and status changes from your workspace will show up here once you start creating records."
          />
        </div>
      </section>
    )
  }

  return (
    <section aria-label="Recent activity" className="min-w-0">
      <SectionHeader
        title="Workspace activity"
        action={
          <span className="text-xs text-muted-foreground">
            Latest {Math.min(items.length, 5)}
          </span>
        }
      />
      <div className="rounded-md border border-border bg-surface">
        <ul className="divide-y divide-border">
          {items.slice(0, 5).map((item) => {
            const isMe = item.actorUserId === currentUserId
            const actor = isMe
              ? 'You'
              : item.actorUserId
                ? userLabel(item.actorUserId)
                : 'System'
            const initials = initialsFor(
              isMe && currentUserName ? currentUserName : actor,
            )
            return (
              <li
                key={item.id}
                className="flex items-center gap-2.5 px-3 py-2.5"
              >
                <span
                  className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground"
                  aria-hidden="true"
                >
                  {initials}
                </span>
                <p className="min-w-0 flex-1 truncate text-sm text-foreground">
                  <span className="font-medium">{actor}</span>{' '}
                  {activitySentence(item)}
                </p>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatRelativeTime(item.createdAt)}
                </span>
              </li>
            )
          })}
        </ul>
      </div>
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
    <section aria-label="My priorities" className="min-w-0">
      <SectionHeader
        title="My priorities"
        action={
          <Link
            to="/reviews"
            className="text-xs font-medium text-primary no-underline hover:underline"
          >
            Edit
          </Link>
        }
      />
      <div className="rounded-md border border-border bg-surface">
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
            {priorities.map((review) => {
              const overdue = isReviewOverdue(
                review.state,
                review.submittedAt,
                OVERDUE_DAYS,
              )
              return (
                <li
                  key={review.id}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <span
                    className="size-4 shrink-0 rounded-xs border-[1.5px] border-muted-foreground/40"
                    aria-hidden="true"
                  />
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
                      'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
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
      </div>
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
                <Link to="/reviews" className="block no-underline">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {review.recordIdentifier}
                    </span>
                    <span
                      className={cn(
                        'text-xs font-medium',
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
    <div className="flex items-center justify-between gap-2 pb-2">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-heading font-semibold text-foreground">
          {title}
        </h2>
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
