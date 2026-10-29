import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { JoinedWelcome } from '#/components/v3/shell/joined-welcome'
import { LabSetupDialog } from '#/components/v3/setup/lab-setup-dialog'
import { rememberSetupSkipped, setupWasSkipped } from '#/lib/lab-setup'

import { rich, t } from '#/copy'
import { useDisplayTimeZone } from '#/lib/display-time-zone'
import { reagentPath } from '#/lib/navigation'
import { AskAiButton } from '#/components/assist/ask-ai-button'
import { Button } from '#/components/v3/ui/button'
import { Skeleton } from '#/components/v3/ui/skeleton'
import { Notice } from '#/components/v3/ui/alert'
import { Icon } from '#/components/v3/icons'
import {
  Inspector,
  InspectorSection,
  PageHeader,
  Section,
} from '#/components/v3/ui/layout'
import { Dot, Status } from '#/components/v3/ui/status'
import { TableBox } from '#/components/v3/ui/table'
import {
  RegistryGrid,
  rightAligned,
} from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { HomeQuiet, recentTone } from '#/components/v3/home/home-quiet'
import {
  fetchProjectSummaries,
  fetchWorkspaceMemberIdentities,
} from '#/components/v3/projects/project-data'
import {
  fetchCalendarBookings,
  fetchCalendarInstruments,
  fetchCalendarResources,
  isSameDayInZone,
  toCalendarBooking,
} from '#/lib/calendar'
import type { CalendarBookingWire } from '#/lib/calendar'
import { formatRelativeTime, notebookDataClient } from '#/lib/notebook-data'
import {
  describeRecentChange,
  fetchRecentItems,
  recentStatusLabel,
} from '#/lib/recents'
import type { RecentItem } from '#/lib/recents'
import {
  fetchWorkspaceCertifications,
  isCurrentStatement,
  signatureCertificationDataClient,
} from '#/lib/signature-certification'
import {
  auditLinkFor,
  BOOKKEEPING_ENTITIES,
  collapseActivity,
  describeAuditEvent,
  ENTITY_LABELS,
  fetchAuditEvents,
} from '#/lib/audit-history'
import type { DescribedAuditEvent } from '#/lib/audit-history'
import { ObjectHistoryDialog } from '#/components/audit/object-history-dialog'
import {
  buildComingUp,
  continueWorkingItems,
  fetchProjectApprovalProgress,
  fetchUpcomingMilestones,
  fetchUpcomingRecordEnds,
  freeInstruments,
  groupComingUp,
  homePace,
  homeUpcomingWindow,
  homeWaitingItem,
  pickUpItems,
} from '#/lib/home-quiet'
import {
  fetchHomeCounts,
  fetchHomeReviews,
  fetchHomeDatasetIssues,
  fetchHomeMaterials,
  fetchHomePeople,
  hasOpenedHomeProject,
  homeAssignedProjects,
  homeDayRange,
  homeDueLabel,
  homeMaterialExpiryLabel,
} from '#/lib/home-data'
import { fetchSeenItemKeys, workItemsQueryKeys } from '#/lib/work-items/data'
import { needsAction } from '#/lib/work-items/predicate'
import {
  fetchWorkspaceGeneral,
  workspaceGeneralQueryKey,
} from '#/lib/workspace-general'
import {
  fetchMyProjectAssignments,
  fetchMyOnboardingState,
  workspaceAccessKeys,
} from '#/lib/workspace-access'
import { cn } from '#/lib/utils'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { now as appNow } from '#/lib/clock'

/** UI port (roadmap-4/ui-app3): Home, matching the reference — a status chip
 * row, Awaiting your review, Continue working, and an inspector with Today,
 * Needs attention and Recent activity — all on real data. When the user has no
 * personal recents yet, Home shows the first-run setup state instead. */
export const Route = createFileRoute('/')({
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect(signInRedirect(location))
    }
    // A client viewer has no Home: the portal is their whole product, so they
    // land there instead of on a workspace page they cannot use.
    if (context.workspace?.role === 'client_viewer') {
      throw redirect({ to: '/client-portal' })
    }
    return { context }
  },
  validateSearch: (search: Record<string, unknown>): { setup?: true } => ({
    setup: search.setup === true || search.setup === '1' ? true : undefined,
  }),
  component: Home,
})

/** No seen keys until that read answers; an empty set marks nothing seen. */
const EMPTY_SEEN: ReadonlySet<string> = new Set()

interface FirstRunProject {
  id: string
  title: string
  accessLevel: string
}
export interface FirstRunInput {
  workspaceName: string
  accountHint?: string
  signatureCertified: boolean
  projects: FirstRunProject[]
  hasOpenedProject: boolean
  hasExperiment: boolean
  /** The person's workspace role. Unset reads as an author. */
  role?: string
  /** How many people are in the workspace; a founder starts alone. */
  memberCount?: number
  /** Whether the first admin finished the short setup; unset hides the step. */
  setupDone?: boolean
}

export interface FirstRunStep {
  label: string
  hint: string
  done: boolean
  actionLabel?: string
  actionTo?: string
}

/**
 * First-run checklist, matching HomeFirstRun: account created, signature,
 * first project and first experiment. Every item reads real state passed in by
 * the caller; nothing is persisted for the checklist itself.
 */
export function firstRunSteps(input: FirstRunInput): FirstRunStep[] {
  const project = input.projects.at(0)
  // An owner or administrator is the one who adds people and starts the first
  // project; nobody is going to add them, so their checklist says to do it.
  const administers = input.role === 'owner' || input.role === 'admin'
  const readOnly = input.role === 'viewer' || input.role === 'client_viewer'
  const reviewOnly = input.role === 'reviewer'
  const steps: FirstRunStep[] = [
    {
      label: t('projects.home.firstRun.accountCreated'),
      hint:
        input.accountHint ??
        t('projects.home.firstRun.joined', { workspace: input.workspaceName }),
      done: true,
    },
    ...(input.role === 'owner' && input.setupDone !== undefined
      ? [
          {
            label: t('projects.home.firstRun.setup'),
            hint: t('projects.home.firstRun.setupHint'),
            done: input.setupDone,
            actionLabel: t('projects.home.firstRun.setupAction'),
            actionTo: '/?setup=1',
          },
        ]
      : []),
    ...(administers
      ? [
          {
            label: t('projects.home.firstRun.invite'),
            hint: t('projects.home.firstRun.inviteHint'),
            done: (input.memberCount ?? 1) > 1,
            actionLabel: t('projects.home.firstRun.invite'),
            actionTo: '/settings/members?invite=admin',
          },
        ]
      : []),
    {
      label: t('projects.home.firstRun.signature'),
      hint: administers
        ? t('projects.home.firstRun.signatureHintAdmin')
        : t('projects.home.firstRun.signatureHintMember'),
      done: input.signatureCertified,
      actionLabel: 'Set up signature',
      actionTo: '/settings/my-signature',
    },
    {
      label:
        administers && !project
          ? t('projects.home.firstRun.createFirstProject')
          : t('projects.home.firstRun.openFirstProject'),
      hint: project
        ? t('projects.home.firstRun.addedTo', { title: project.title })
        : administers
          ? t('projects.home.firstRun.projectHintAdmin')
          : t('projects.home.firstRun.projectHintMember'),
      done: input.hasOpenedProject,
      actionLabel: project
        ? t('projects.home.firstRun.openProject')
        : administers
          ? t('projects.home.firstRun.createProject')
          : t('projects.home.firstRun.browseProjects'),
      actionTo: project
        ? `/projects/${project.id}`
        : administers
          ? '/projects?new=true'
          : '/projects',
    },
    {
      label: t('projects.home.firstRun.experiment'),
      hint: t('projects.home.firstRun.experimentHint'),
      done: input.hasExperiment,
      actionLabel: t('projects.home.firstRun.browseProtocols'),
      actionTo: '/protocols',
    },
  ]
  // The checklist asks each role only for what that role can do: a viewer
  // cannot sign or author, and a reviewer reviews what others submit rather
  // than creating experiments, so neither is given a step it cannot finish.
  if (readOnly) {
    return steps.filter(
      (step) =>
        step.actionTo !== '/settings/my-signature' &&
        step.actionTo !== '/protocols',
    )
  }
  if (reviewOnly) {
    return steps
      .filter((step) => step.actionTo !== '/protocols')
      .map((step) =>
        step.actionTo?.startsWith('/projects')
          ? {
              ...step,
              hint: `${step.hint} ${t('projects.home.firstRun.reviewsArrive')}`,
            }
          : step,
      )
  }
  return steps
}

export function firstRunProgress(steps: FirstRunStep[]): {
  done: number
  total: number
} {
  return { done: steps.filter((step) => step.done).length, total: steps.length }
}

/** A submission awaiting this reader's review, as `fetchHomeReviews` returns
 * it. */
interface HomeReviewRow {
  id: string
  revisionId: string
  identifier: string
  title: string
  projectTitle: string | null
  submittedByName: string | null
  dueAt: string | null
}

/**
 * A phone has room for the record and the way into it, not for every column:
 * the rest stay in the table from tablet width up.
 */
const PHONE_HIDDEN = {
  headerClassName: 'max-md:hidden',
  cellClassName: 'max-md:hidden',
}

/** Awaiting your review, which names the record, its project, who submitted it
 * and its due date, with the way into the review. */
function homeReviewColumns(timeZone: string): RegistryColumn<HomeReviewRow>[] {
  return [
    {
      id: 'record',
      header: t('projects.home.columns.record'),
      cell: ({ row }) => (
        <Link
          to="/review/$revisionId"
          params={{ revisionId: row.original.revisionId }}
          className="text-fg hover:text-link"
        >
          <span className="mono text-fg-muted">{row.original.identifier}</span>{' '}
          {row.original.title}
        </Link>
      ),
    },
    {
      id: 'project',
      header: t('projects.home.columns.project'),
      meta: PHONE_HIDDEN,
      cell: ({ row }) => row.original.projectTitle ?? '—',
    },
    {
      id: 'submittedBy',
      header: t('projects.home.columns.submittedBy'),
      meta: PHONE_HIDDEN,
      cell: ({ row }) => row.original.submittedByName ?? '—',
    },
    {
      id: 'due',
      header: t('projects.home.columns.due'),
      meta: { ...PHONE_HIDDEN, cellClassName: 'num max-md:hidden' },
      cell: ({ row }) => homeDueLabel(row.original.dueAt, appNow(), timeZone),
    },
    {
      id: 'action',
      header: () => (
        <span className="sr-only">{t('projects.home.columns.action')}</span>
      ),
      meta: rightAligned<HomeReviewRow>().meta,
      cell: ({ row }) => (
        <Button
          size="sm"
          nativeButton={false}
          render={
            <Link
              to="/review/$revisionId"
              params={{ revisionId: row.original.revisionId }}
            />
          }
        >
          {t('projects.home.columns.review')}
        </Button>
      ),
    },
  ]
}

const homeRecentColumns: RegistryColumn<RecentItem>[] = [
  {
    id: 'name',
    header: t('projects.home.columns.name'),
    cell: ({ row }) => (
      <>
        {row.original.identifier ? (
          <span className="mono text-fg-muted">{row.original.identifier}</span>
        ) : null}{' '}
        <Link to={row.original.destination} className="text-fg hover:text-link">
          {row.original.label}
        </Link>
      </>
    ),
  },
  {
    id: 'status',
    header: t('projects.home.columns.status'),
    meta: PHONE_HIDDEN,
    cell: ({ row }) => {
      const status = recentStatusLabel(row.original)
      return status ? (
        <Status tone={recentTone(row.original)}>{status}</Status>
      ) : (
        <span className="text-fg-muted">—</span>
      )
    },
  },
  {
    id: 'change',
    header: t('projects.home.columns.lastActivity'),
    meta: { ...PHONE_HIDDEN, cellClassName: 'text-fg-muted max-md:hidden' },
    cell: ({ row }) => describeRecentChange(row.original),
  },
  {
    id: 'updated',
    header: t('projects.home.columns.updated'),
    meta: {
      headerClassName: 'text-right max-md:hidden',
      cellClassName: 'num text-right text-fg-muted max-md:hidden',
    },
    cell: ({ row }) => formatRelativeTime(row.original.lastActivityAt),
  },
]

/** The part of a query result Home's degradation reads. */
interface HomeQueryState {
  isError: boolean
  refetch: () => unknown
}

/** The sections whose reads failed, each with the reads that back it. */
export function unavailableSections(
  sections: { label: string; queries: HomeQueryState[] }[],
): { label: string; queries: HomeQueryState[] }[] {
  return sections.filter((section) =>
    section.queries.some((query) => query.isError),
  )
}

/** A section that could not be read says so and offers the retry. */
function SectionUnavailable({
  what,
  onRetry,
}: {
  what: string
  onRetry: () => void
}) {
  return (
    <div className="flex items-center gap-2 text-label text-fg-muted">
      <span>{t('projects.home.unavailable.section', { what })}</span>
      <Button size="sm" variant="quiet" onClick={onRetry}>
        {t('common.actions.tryAgain')}
      </Button>
    </div>
  )
}

export function Home() {
  const { context, shellCounts } = Route.useRouteContext()
  const { setup: forceSetup } = Route.useSearch()
  const [setupClosed, setSetupClosed] = useState(false)
  const workspaceId = context.workspace?.id
  const userId = context.user.id
  const reviewsQuery = useQuery({
    queryKey: ['home-reviews', workspaceId, userId],
    queryFn: () => fetchHomeReviews(notebookDataClient, userId),
    enabled: Boolean(workspaceId),
  })
  const materialsQuery = useQuery({
    queryKey: ['home-materials', workspaceId, userId],
    queryFn: () => fetchHomeMaterials(notebookDataClient),
    enabled: Boolean(workspaceId),
  })

  const workspaceQuery = useQuery({
    queryKey: [...workspaceGeneralQueryKey, workspaceId, userId],
    queryFn: () => fetchWorkspaceGeneral(notebookDataClient),
    enabled: Boolean(workspaceId),
  })
  const timeZone = useDisplayTimeZone(workspaceQuery.data?.timezone)
  const now = appNow()
  const range = homeDayRange(now, timeZone)
  // R5-HOME-01: one booking read serves both the busy Home (today only) and
  // the quiet Home's "Coming up" list, so the calm state adds no second read.
  const upcomingWindow = homeUpcomingWindow(now, timeZone)
  const countsQuery = useQuery({
    queryKey: ['home-counts', workspaceId, userId, range.start, range.end],
    queryFn: () => fetchHomeCounts(notebookDataClient, workspaceId!, range),
    enabled: Boolean(workspaceId) && workspaceQuery.isSuccess,
  })
  const counts = countsQuery.data
  // The sidebar badge states the caller's inbox total and Home displays the
  // same number, so one screen cannot show two numbers for the same work: the
  // shell context wins when it carries one. It carries none for a zero inbox
  // and `null` for a count that could not be read, and in both cases Home falls
  // back to its own read rather than stating a number it cannot back.
  const shellInbox = 'inbox' in shellCounts ? shellCounts.inbox : undefined
  const inboxCount = shellInbox != null ? Number(shellInbox) : counts?.inbox
  // The pace is decided by this page's own reads — the reads that fill the
  // banner, Coming up and the review table — so whatever Home says is waiting
  // is something the page can name and open, not a badge snapshot it cannot
  // substantiate. Both reads state the one Inbox predicate.
  const waitingCounts = counts
    ? {
        inbox: counts.inbox,
        datasetsWithErrors: counts.datasetsWithErrors,
        unreadNotifications: counts.unreadNotifications,
      }
    : null
  const pace = waitingCounts ? homePace(waitingCounts) : 'busy'
  const bookingsQuery = useQuery({
    queryKey: ['home-bookings', workspaceId, userId, range.start],
    queryFn: () =>
      fetchCalendarBookings(
        notebookDataClient,
        workspaceId!,
        range.start,
        upcomingWindow.end,
      ),
    enabled: Boolean(workspaceId) && workspaceQuery.isSuccess,
  })

  const datasetIssuesQuery = useQuery({
    queryKey: ['home-dataset-issues', workspaceId, userId],
    queryFn: () => fetchHomeDatasetIssues(notebookDataClient),
    enabled: Boolean(workspaceId),
  })

  // GAP 1 — personal recents read model (views + owned change events), never
  // recent workspace experiments.
  const recentsQuery = useQuery({
    queryKey: ['home-recents', workspaceId, userId],
    queryFn: () => fetchRecentItems(notebookDataClient, userId, 6),
    enabled: Boolean(workspaceId),
  })
  const recents = recentsQuery.data ?? []
  const showFirstRun = recentsQuery.isSuccess && recents.length === 0
  // R5-HOME-01: the calm page shows the person's projects, so their project
  // summaries are shared with the first-run state rather than re-read.
  const calm = !showFirstRun && pace !== 'busy'
  const needsProjects = showFirstRun || calm

  const onboardingQuery = useQuery({
    queryKey: workspaceAccessKeys.onboarding(workspaceId ?? '', userId),
    queryFn: () => fetchMyOnboardingState(notebookDataClient),
    enabled: Boolean(workspaceId) && showFirstRun,
  })
  const onboarding = onboardingQuery.data

  // GAP 2 — first-run setup state. Only fetched when it will be shown.
  const certificationsQuery = useQuery({
    queryKey: ['home-first-run-certifications', workspaceId, userId],
    queryFn: () =>
      fetchWorkspaceCertifications(
        signatureCertificationDataClient,
        workspaceId!,
      ),
    enabled: Boolean(workspaceId) && showFirstRun,
  })
  const assignmentsQuery = useQuery({
    queryKey: workspaceAccessKeys.assignments(workspaceId ?? '', userId),
    queryFn: () => fetchMyProjectAssignments(notebookDataClient),
    enabled: Boolean(workspaceId) && needsProjects,
  })
  const projectsQuery = useQuery({
    queryKey: ['home-first-run-projects', workspaceId, userId],
    queryFn: () => fetchProjectSummaries(workspaceId),
    enabled:
      Boolean(workspaceId) && needsProjects && assignmentsQuery.isSuccess,
  })
  const projects = homeAssignedProjects(
    projectsQuery.data ?? [],
    assignmentsQuery.data ?? [],
  )
  const projectIds = projects.map((project) => project.id)
  const projectOpensQuery = useQuery({
    queryKey: ['home-first-run-project-opens', workspaceId, userId, projectIds],
    queryFn: () => hasOpenedHomeProject(notebookDataClient, userId, projectIds),
    enabled: showFirstRun && projectsQuery.isSuccess,
  })
  const peopleQuery = useQuery({
    queryKey: ['home-first-run-people', workspaceId, userId, projectIds],
    queryFn: () => fetchHomePeople(notebookDataClient, projectIds, userId),
    enabled: showFirstRun && projectsQuery.isSuccess,
  })
  const membersQuery = useQuery({
    queryKey: ['home-first-run-members', workspaceId, userId],
    queryFn: () => fetchWorkspaceMemberIdentities(),
    enabled:
      showFirstRun &&
      (onboarding?.workspace_role === 'owner' ||
        onboarding?.workspace_role === 'admin'),
  })
  const experimentsQuery = useQuery({
    queryKey: ['home-first-run-experiments', workspaceId, userId],
    queryFn: () =>
      notebookDataClient.list<{ id: string }>(
        'records',
        `?kind=eq.experiment&created_by_user_id=eq.${encodeURIComponent(userId)}&deleted_at=is.null&select=id&limit=1`,
      ),
    enabled: Boolean(workspaceId) && showFirstRun,
  })

  // R5-HOME-01 — the quiet Home's own reads, all enabled only in the calm
  // states: the workspace's instruments, the experiments with a planned end
  // inside the next two weeks, the person's project milestones due in the same
  // window, and each project's own approval counts.
  const resourcesQuery = useQuery({
    queryKey: ['home-resources', workspaceId],
    queryFn: () => fetchCalendarResources(notebookDataClient, workspaceId!),
    enabled: Boolean(workspaceId) && workspaceQuery.isSuccess && calm,
  })
  // ADR-0054 — the free-instrument list is the registry, not the mirror of it.
  const instrumentsQuery = useQuery({
    queryKey: ['home-instruments', workspaceId],
    queryFn: () => fetchCalendarInstruments(notebookDataClient, workspaceId!),
    enabled: Boolean(workspaceId) && workspaceQuery.isSuccess && calm,
  })
  const upcomingEndsQuery = useQuery({
    queryKey: ['home-upcoming', workspaceId, userId, range.start],
    queryFn: () =>
      fetchUpcomingRecordEnds(notebookDataClient, workspaceId!, upcomingWindow),
    enabled: Boolean(workspaceId) && workspaceQuery.isSuccess && calm,
  })
  const milestonesQuery = useQuery({
    queryKey: [
      'home-upcoming-milestones',
      workspaceId,
      userId,
      range.start,
      projectIds.join(','),
    ],
    queryFn: () =>
      fetchUpcomingMilestones(notebookDataClient, projectIds, upcomingWindow),
    enabled: calm && projectsQuery.isSuccess && projectIds.length > 0,
  })
  const approvalsQuery = useQuery({
    queryKey: [
      'home-project-approvals',
      workspaceId,
      userId,
      projectIds.join(','),
    ],
    queryFn: () => fetchProjectApprovalProgress(notebookDataClient, projects),
    enabled: calm && projectsQuery.isSuccess && projects.length > 0,
  })

  const activityQuery = useQuery({
    queryKey: ['home-activity', workspaceId, userId],
    queryFn: () => fetchAuditEvents(notebookDataClient, { limit: 6 }),
    enabled: Boolean(workspaceId),
  })

  // QA2-Inbox-1: the same seen state the Inbox list drops items by, so the
  // reviews and materials Home names cannot outlive what the Inbox lists.
  const seenQuery = useQuery({
    queryKey: workItemsQueryKeys.seen(),
    queryFn: () => fetchSeenItemKeys(),
    enabled: Boolean(workspaceId),
  })
  const seen = seenQuery.data ?? EMPTY_SEEN

  const reviews = (reviewsQuery.data ?? []).filter((review) =>
    needsAction(
      {
        kind: 'review_requested',
        state: 'needs_action',
        recordId: review.recordId,
        identifier: review.identifier,
        title: review.title,
      },
      seen,
    ),
  )
  const datasetIssues = datasetIssuesQuery.data ?? []
  const materials = (materialsQuery.data ?? []).filter((material) =>
    needsAction(material, seen),
  )
  const bookings = (bookingsQuery.data ?? []).filter(
    (b: CalendarBookingWire) => !b.cancelled_at,
  )
  // Access bookkeeping is not something anyone did to their work; it stays in
  // the audit log, not in Home's recent activity.
  const activity = (activityQuery.data?.events ?? [])
    .filter((event) => !BOOKKEEPING_ENTITIES.has(event.entityType))
    .map(describeAuditEvent)

  // The booking read now spans the "Coming up" window; the busy Home still
  // means today.
  const calendarBookings = bookings.map((booking) => toCalendarBooking(booking))
  const todayBookings = calendarBookings.filter((booking) =>
    isSameDayInZone(new Date(booking.startsAt), now, timeZone),
  )
  const waiting =
    pace === 'near-quiet' && waitingCounts
      ? homeWaitingItem({
          counts: waitingCounts,
          reviews: reviews.map((review) => ({
            revisionId: review.revisionId,
            identifier: review.identifier,
          })),
          materials: materials.map((material) => ({
            recordId: material.recordId,
            identifier: material.identifier,
            reason: homeMaterialExpiryLabel(material, now, timeZone),
          })),
          datasetIssues: datasetIssues.map((issue) => ({
            id: issue.id,
            identifier: issue.identifier,
            label: issue.label,
          })),
        })
      : null
  const pickUp = calm
    ? pickUpItems(recents, recentStatusLabel, describeRecentChange)
    : []
  const continueWorking = calm ? continueWorkingItems(recents, pickUp) : recents
  const comingUp = calm
    ? groupComingUp(
        buildComingUp({
          bookings: calendarBookings,
          // A booking names a resource id, which is the instrument id for an
          // instrument booking (its resource row mirrors the registry). Rooms
          // and other resources name themselves here.
          resourceNames: new Map(
            (resourcesQuery.data ?? []).map((resource) => [
              resource.id,
              resource.name,
            ]),
          ),
          reviews: reviews.flatMap((review) =>
            review.dueAt
              ? [
                  {
                    revisionId: review.revisionId,
                    identifier: review.identifier,
                    dueAt: review.dueAt,
                  },
                ]
              : [],
          ),
          materials: materials.map((material) => ({
            recordId: material.recordId,
            identifier: material.identifier,
            title: material.title,
            dueAt: material.dueAt,
            reason: homeMaterialExpiryLabel(material, now, timeZone),
          })),
          plannedEnds: upcomingEndsQuery.data ?? [],
          milestones: milestonesQuery.data ?? [],
          projectNames: new Map(
            projects.map((project) => [project.id, project.title]),
          ),
          now,
          timeZone,
        }),
        now,
        timeZone,
      )
    : []
  const instrumentsFree = calm
    ? freeInstruments(
        instrumentsQuery.data ?? [],
        calendarBookings,
        now,
        timeZone,
      )
    : []

  const mine = (certificationsQuery.data ?? []).find((c) => c.userId === userId)
  const setupSteps = firstRunSteps({
    workspaceName:
      context.workspace?.name ?? t('projects.home.firstRun.thisWorkspace'),
    accountHint: onboarding?.invitation_accepted_at
      ? t('projects.home.firstRun.acceptedOn', {
          date: homeDueLabel(
            onboarding.invitation_accepted_at,
            appNow(),
            timeZone,
          ),
        })
      : onboarding
        ? t('projects.home.firstRun.joined', {
            workspace:
              context.workspace?.name ??
              t('projects.home.firstRun.thisWorkspace'),
          })
        : t('projects.home.firstRun.accountReady'),
    signatureCertified: isCurrentStatement(mine),
    projects,
    hasOpenedProject: projectOpensQuery.data ?? false,
    hasExperiment: (experimentsQuery.data?.length ?? 0) > 0,
    role: onboarding?.workspace_role,
    memberCount: membersQuery.data?.length,
    setupDone: Boolean(workspaceQuery.data?.setupCompletedAt),
  })
  const progress = firstRunProgress(setupSteps)

  // QA2-Home-1: a chip leads to the set it counts, so the destination opens
  // filtered to that set instead of its unfiltered default.
  const chipClass =
    'inline-flex items-center gap-1.5 text-label text-fg-muted no-underline hover:text-fg hover:underline'

  const today = appNow().toLocaleDateString('en-GB', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
  const openNotebookId = recents.find((r) => r.kind === 'record')?.id

  const homeQueries = [
    workspaceQuery,
    countsQuery,
    bookingsQuery,
    datasetIssuesQuery,
    recentsQuery,
    reviewsQuery,
    materialsQuery,
    seenQuery,
    activityQuery,
    ...(showFirstRun
      ? [
          onboardingQuery,
          certificationsQuery,
          assignmentsQuery,
          projectsQuery,
          projectOpensQuery,
          peopleQuery,
          experimentsQuery,
        ]
      : []),
    ...(calm
      ? [
          resourcesQuery,
          upcomingEndsQuery,
          // The calm page owns the project cards, so it waits for them too.
          assignmentsQuery,
          projectsQuery,
          // These two stay disabled (and so must stay out of the gate) when the
          // person has no project of their own to report on.
          ...(projectsQuery.isSuccess && projectIds.length > 0
            ? [milestonesQuery, approvalsQuery]
            : []),
        ]
      : []),
  ]
  // Home degrades one section at a time. Only the two reads that decide which
  // Home to draw (the workspace's time zone and the person's recents) take the
  // whole page down with them; every other read that fails leaves its own
  // section saying so, with a way to retry, and the rest of Home stays usable.
  if ([workspaceQuery, recentsQuery].some((query) => query.isError)) {
    return (
      <div className="flex flex-1 flex-col gap-3 p-6" role="alert">
        <h1 className="text-section">
          {t('projects.home.unavailable.pageTitle')}
        </h1>
        <p>{t('projects.home.unavailable.pageBody')}</p>
        <Button
          onClick={() => {
            for (const query of homeQueries) void query.refetch()
          }}
        >
          {t('common.actions.tryAgain')}
        </Button>
      </div>
    )
  }
  if (homeQueries.some((query) => query.isPending)) {
    return (
      <div className="flex flex-col gap-4 p-6" role="status">
        <span className="sr-only">{t('projects.home.loading')}</span>
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-64" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
        <Skeleton className="h-56" />
      </div>
    )
  }

  const unavailable = unavailableSections([
    { label: t('projects.home.sections.counts'), queries: [countsQuery] },
    {
      label: t('projects.home.sections.yourBookings'),
      queries: [bookingsQuery],
    },
    {
      label: t('projects.home.sections.needsAttention'),
      queries: [datasetIssuesQuery, materialsQuery, seenQuery],
    },
    {
      label: t('projects.home.sections.awaitingReview'),
      queries: [reviewsQuery, seenQuery],
    },
    {
      label: t('projects.home.sections.recentActivity'),
      queries: [activityQuery],
    },
    ...(showFirstRun
      ? [
          {
            label: t('projects.home.sections.getSetUp'),
            queries: [
              onboardingQuery,
              certificationsQuery,
              assignmentsQuery,
              projectsQuery,
              projectOpensQuery,
              peopleQuery,
              experimentsQuery,
            ],
          },
        ]
      : []),
    ...(calm
      ? [
          {
            label: t('projects.home.sections.comingUp'),
            queries: [resourcesQuery, upcomingEndsQuery, milestonesQuery],
          },
          {
            label: t('projects.home.sections.yourProjects'),
            queries: [assignmentsQuery, projectsQuery, approvalsQuery],
          },
        ]
      : []),
  ])
  const retryUnavailable = () => {
    for (const section of unavailable)
      for (const query of section.queries)
        if (query.isError) void query.refetch()
  }
  const sectionFailed = (...queries: HomeQueryState[]) =>
    queries.some((query) => query.isError)
  const retrySection =
    (...queries: HomeQueryState[]) =>
    () => {
      for (const query of queries) if (query.isError) void query.refetch()
    }

  const pageHeader = (
    <PageHeader
      className="border-b-0 bg-transparent"
      title={t('projects.home.title')}
      meta={
        <span>
          {t('projects.home.meta', {
            today,
            workspace: context.workspace?.name ?? t('projects.home.workspace'),
          })}
          {showFirstRun &&
          onboarding &&
          isSameDayInZone(new Date(onboarding.joined_at), appNow(), timeZone)
            ? t('projects.home.joinedToday')
            : ''}
        </span>
      }
      actions={
        showFirstRun ? (
          <AskAiButton />
        ) : (
          <>
            {openNotebookId ? (
              <Button
                className="max-md:hidden"
                nativeButton={false}
                render={
                  <Link
                    to="/records/$recordId/notebook"
                    params={{ recordId: openNotebookId }}
                  />
                }
              >
                {t('projects.home.openNotebook')}
              </Button>
            ) : null}
            <Button
              variant="primary"
              className="max-md:hidden"
              nativeButton={false}
              render={<Link to="/experiments/new" />}
            >
              {t('projects.home.newExperiment')}
            </Button>
            <AskAiButton />
          </>
        )
      }
    />
  )
  const header = (
    <>
      {pageHeader}
      {unavailable.length ? (
        <div className="px-4 pb-2 md:px-6">
          <Notice
            tone="warn"
            title={t('projects.home.unavailable.partTitle')}
            action={
              <Button size="sm" onClick={retryUnavailable}>
                {t('common.actions.tryAgain')}
              </Button>
            }
          >
            {t('projects.home.unavailable.partBody', {
              sections: unavailable.map((section) => section.label).join(', '),
            })}
          </Notice>
        </div>
      ) : null}
    </>
  )

  if (calm) {
    return (
      <HomeQuiet
        header={header}
        pace={pace === 'quiet' ? 'quiet' : 'near-quiet'}
        waiting={waiting}
        comingUp={comingUp}
        pickUp={pickUp}
        continueWorking={continueWorking}
        projects={approvalsQuery.data ?? []}
        todayBookings={todayBookings}
        freeInstruments={instrumentsFree}
        activity={activity}
        userId={userId}
        timeZone={timeZone}
      />
    )
  }

  const setupDone = Boolean(workspaceQuery.data?.setupCompletedAt)
  const setupOpen =
    !setupClosed &&
    context.workspace?.role === 'owner' &&
    Boolean(workspaceId) &&
    !setupDone &&
    (forceSetup === true || !setupWasSkipped(workspaceId!))

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      {setupOpen ? (
        <LabSetupDialog
          workspaceId={workspaceId!}
          workspaceName={context.workspace?.name ?? ''}
          currentTimeZone={workspaceQuery.data?.timezone}
          ownEmail={context.user.email}
          onClose={() => {
            if (forceSetup !== true) rememberSetupSkipped(workspaceId!)
            setSetupClosed(true)
          }}
        />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">
        {header}
        {showFirstRun ? (
          <div className="flex flex-col gap-6 px-4 pb-8 pt-2 md:px-6">
            {workspaceId ? (
              <JoinedWelcome
                workspaceId={workspaceId}
                workspaceName={
                  context.workspace?.name ??
                  t('projects.home.firstRun.thisWorkspace')
                }
                userId={userId}
                email={context.user.email}
                role={onboarding?.workspace_role}
              />
            ) : null}
            <section className="flex flex-col gap-2">
              <div className="flex items-baseline gap-2">
                <h2 className="text-section">
                  {t('projects.home.firstRun.getSetUp')}
                </h2>
                <span className="num text-label text-fg-muted">
                  {t('projects.home.firstRun.progress', {
                    done: progress.done,
                    total: progress.total,
                  })}
                </span>
              </div>
              <ul className="m-0 flex list-none flex-col p-0">
                {setupSteps.map((step, index) => (
                  <li
                    key={step.label}
                    className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3 border-b border-border-subtle py-3 last:border-0"
                  >
                    <span
                      className={cn(
                        'flex size-[22px] items-center justify-center rounded-full border text-[11px] font-semibold',
                        step.done
                          ? 'border-success bg-success-wash text-success-text'
                          : 'border-border-strong text-fg-muted',
                      )}
                    >
                      {step.done ? '✓' : index + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="font-medium">{step.label}</div>
                      <div className="text-label text-fg-muted">
                        {step.hint}
                      </div>
                    </div>
                    {!step.done && step.actionTo ? (
                      <Button
                        size="sm"
                        variant={index === 1 ? 'primary' : undefined}
                        nativeButton={false}
                        render={<Link to={step.actionTo} />}
                      >
                        {step.actionLabel}
                      </Button>
                    ) : (
                      <span />
                    )}
                  </li>
                ))}
              </ul>
            </section>

            <Section title={t('projects.home.sections.continueWorking')}>
              <div className="rounded-md border border-dashed border-border-strong px-4 py-5 text-label text-fg-muted">
                {t('projects.home.firstRun.continueEmpty')}
              </div>
            </Section>
          </div>
        ) : (
          <div className="flex flex-col gap-7 px-4 pb-8 pt-2 md:px-6">
            {/* MOB-01.2: on a phone the inspector is a sheet behind a tap, so
                today's bookings are page content — the first thing a bench user
                needs is what they are doing next. */}
            <div className="md:hidden">
              <Section
                title={t('projects.home.sections.yourBookings')}
                action={
                  <Link to="/schedule" className="text-label">
                    {t('projects.home.fullSchedule')}
                  </Link>
                }
              >
                {sectionFailed(bookingsQuery) ? (
                  <SectionUnavailable
                    what={t('projects.home.sections.yourBookings')}
                    onRetry={retrySection(bookingsQuery)}
                  />
                ) : todayBookings.length ? (
                  <ul className="m-0 flex list-none flex-col p-0">
                    {todayBookings.map((b) => (
                      <li
                        key={b.id}
                        className="flex min-h-11 items-center gap-3 border-b border-border-subtle py-2 last:border-0"
                      >
                        <span className="num w-10 shrink-0 font-medium text-link">
                          {new Date(b.startsAt).toLocaleTimeString('en-GB', {
                            timeZone,
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        <div className="min-w-0">
                          <div className="font-medium">{b.title}</div>
                          {b.location ? (
                            <div className="text-label text-fg-muted">
                              {b.location}
                            </div>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="m-0 text-label text-fg-muted">
                    {t('projects.home.noBookings')}
                  </p>
                )}
              </Section>
            </div>
            <nav
              aria-label={t('projects.home.summary')}
              className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-label text-fg-muted"
            >
              <Link
                to="/inbox"
                search={{ type: 'reviews' }}
                className={chipClass}
              >
                <Dot tone="review" />
                <span>
                  <b className="num font-semibold">{counts?.reviews ?? '—'}</b>{' '}
                  {t('projects.home.toReview')}
                </span>
              </Link>
              <Link
                to="/datasets"
                search={{ tab: 'issues' }}
                className={chipClass}
              >
                <Dot tone="bad" />
                <span>
                  <b className="num font-semibold">
                    {counts?.datasetsWithErrors ?? '—'}
                  </b>{' '}
                  {counts?.datasetsWithErrors === 1
                    ? t('projects.home.datasetWithErrors')
                    : t('projects.home.datasetsWithErrors')}
                </span>
              </Link>
              <Link
                to="/experiments"
                search={{ tab: 'inprogress' }}
                className={chipClass}
              >
                <Dot tone="progress" />
                <span>
                  <b className="num font-semibold">
                    {counts?.experimentsInProgress ?? '—'}
                  </b>{' '}
                  {t('projects.home.experimentsInProgress')}
                </span>
              </Link>
              <Link to="/schedule" className={chipClass}>
                <Dot tone="analysis" />
                <span>
                  <b className="num font-semibold">
                    {counts?.instrumentRuns ?? '—'}
                  </b>{' '}
                  {counts?.instrumentRuns === 1
                    ? t('projects.home.instrumentBooking')
                    : t('projects.home.instrumentBookings')}
                </span>
              </Link>
              <span className="flex-1" />
              <Link to="/inbox" className="text-label">
                {t('projects.home.openInbox', { count: inboxCount ?? '—' })}
              </Link>
            </nav>

            <Section
              title={t('projects.home.sections.awaitingReview')}
              count={counts?.reviews}
              action={
                <Link to="/inbox" className="text-label">
                  {t('projects.home.allInInbox')}
                </Link>
              }
            >
              {sectionFailed(reviewsQuery, seenQuery) ? (
                <SectionUnavailable
                  what={t('projects.home.what.reviews')}
                  onRetry={retrySection(reviewsQuery, seenQuery)}
                />
              ) : reviews.length ? (
                <>
                  <TableBox className="max-md:hidden">
                    <RegistryGrid
                      label={t('projects.home.sections.awaitingReview')}
                      rows={reviews}
                      columns={homeReviewColumns(timeZone)}
                      getRowId={(review) => review.id}
                      selectable={false}
                    />
                  </TableBox>
                  {/* A phone gets the record and the way into its review. */}
                  <ul
                    aria-label={t('projects.home.sections.awaitingReview')}
                    className="m-0 flex list-none flex-col p-0 md:hidden"
                  >
                    {reviews.map((review) => (
                      <li
                        key={review.id}
                        className="flex items-center gap-3 border-b border-border-subtle py-2.5 last:border-0"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">
                            {review.title}
                          </span>
                          <span className="block truncate text-label text-fg-muted">
                            <span className="mono">{review.identifier}</span>
                            {review.projectTitle
                              ? ` · ${review.projectTitle}`
                              : ''}
                          </span>
                        </span>
                        <Button
                          size="sm"
                          nativeButton={false}
                          render={
                            <Link
                              to="/review/$revisionId"
                              params={{ revisionId: review.revisionId }}
                            />
                          }
                        >
                          {t('projects.home.columns.review')}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <EmptyState
                  className="py-2"
                  title={t('projects.home.noReviews')}
                  description={t('projects.home.noReviewsBody')}
                />
              )}
            </Section>

            <Section
              title={t('projects.home.sections.continueWorking')}
              action={
                <Link to="/experiments" className="text-label">
                  {t('projects.home.allRecent')}
                </Link>
              }
            >
              {recents.length ? (
                <TableBox>
                  <RegistryGrid
                    label={t('projects.home.sections.continueWorking')}
                    rows={recents}
                    columns={homeRecentColumns}
                    getRowId={(recent) => `${recent.kind}:${recent.id}`}
                    selectable={false}
                  />
                </TableBox>
              ) : (
                <EmptyState
                  className="py-2"
                  title={t('projects.home.noRecents')}
                  description={t('projects.home.noRecentsBody')}
                />
              )}
            </Section>
          </div>
        )}
      </div>

      {showFirstRun ? (
        <Inspector label={t('projects.home.sections.getSetUp')}>
          <InspectorSection title={t('projects.home.sections.yourProjects')}>
            {projects.length ? (
              <ul className="m-0 flex list-none flex-col p-0">
                {projects.map((project) => (
                  <li
                    key={project.id}
                    className="flex items-baseline gap-3 border-b border-border-subtle py-2 last:border-0"
                  >
                    <Link
                      to="/projects/$projectId"
                      params={{ projectId: project.id }}
                      className="min-w-0 flex-1 truncate"
                    >
                      {project.title}
                    </Link>
                    <span className="text-label capitalize text-fg-muted">
                      {project.accessLevel}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 text-label text-fg-muted">
                {onboarding?.workspace_role === 'owner' ||
                onboarding?.workspace_role === 'admin'
                  ? rich('projects.home.noProjectsYet', {
                      link: (text) => (
                        <Link to="/projects" search={{ new: true }}>
                          {text}
                        </Link>
                      ),
                    })
                  : t('projects.home.projectsAfterAdded')}
              </p>
            )}
          </InspectorSection>
          <InspectorSection title={t('projects.home.peopleToKnow')}>
            {peopleQuery.data?.length ? (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {peopleQuery.data.map((person) => (
                  <li key={person.id} className="flex items-baseline gap-3">
                    <span className="flex-1">{person.name}</span>
                    <span className="text-label capitalize text-fg-muted">
                      {person.role}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 text-label text-fg-muted">
                {t('projects.home.peopleEmpty')}
              </p>
            )}
          </InspectorSection>
          <InspectorSection title={t('projects.home.help')}>
            <ul className="m-0 flex list-none flex-col gap-2 p-0 text-label">
              <li>
                <Link to="/help/records">{t('projects.home.helpRecords')}</Link>
              </li>
              <li>
                <Link to="/help/shortcuts">
                  {t('projects.home.helpShortcuts')}
                </Link>
              </li>
            </ul>
          </InspectorSection>
        </Inspector>
      ) : (
        <Inspector label={t('projects.home.sections.today')}>
          <InspectorSection
            title={
              <span className="flex items-baseline">
                <span className="flex-1">
                  {t('projects.home.sections.today')}
                </span>
                <Link to="/schedule" className="font-normal">
                  {t('projects.home.fullSchedule')}
                </Link>
              </span>
            }
          >
            {sectionFailed(bookingsQuery) ? (
              <SectionUnavailable
                what={t('projects.home.what.todaysBookings')}
                onRetry={retrySection(bookingsQuery)}
              />
            ) : todayBookings.length ? (
              <ul className="m-0 flex list-none flex-col p-0">
                {todayBookings.map((b) => (
                  <li
                    key={b.id}
                    className="flex gap-3 border-b border-border-subtle py-2 last:border-0"
                  >
                    <span className="num w-10 shrink-0 font-medium text-link">
                      {new Date(b.startsAt).toLocaleTimeString('en-GB', {
                        timeZone,
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    <div className="min-w-0">
                      <div className="font-medium">{b.title}</div>
                      {b.location ? (
                        <div className="text-label text-fg-muted">
                          {b.location}
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 text-label text-fg-muted">
                {t('projects.home.noBookings')}
              </p>
            )}
          </InspectorSection>

          <InspectorSection
            title={
              <span className="flex items-baseline">
                <span className="flex-1">
                  {t('projects.home.sections.needsAttention')}
                </span>
                <Link to="/inbox" className="font-normal">
                  {t('projects.home.inbox')}
                </Link>
              </span>
            }
          >
            {sectionFailed(datasetIssuesQuery, materialsQuery, seenQuery) ? (
              <SectionUnavailable
                what={t('projects.home.what.needsAttention')}
                onRetry={retrySection(
                  datasetIssuesQuery,
                  materialsQuery,
                  seenQuery,
                )}
              />
            ) : datasetIssues.length || materials.length ? (
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {datasetIssues.map((f) => (
                  <li key={f.id} className="flex gap-2">
                    <span className="mt-0.5 text-danger">
                      <Icon name="warn" size={14} />
                    </span>
                    <div className="min-w-0">
                      <Link
                        to="/datasets"
                        search={{ dataset: f.id, archived: false }}
                      >
                        {f.identifier}
                      </Link>{' '}
                      · {f.label}
                      <div className="text-label text-fg-muted">{f.detail}</div>
                    </div>
                  </li>
                ))}
                {materials.map((material) => (
                  <li
                    key={material.recordId ?? material.identifier}
                    className="flex gap-2"
                  >
                    <span className="mt-0.5 text-warning-text">
                      <Icon name="warn" size={14} />
                    </span>
                    <div className="min-w-0">
                      <Link
                        to={
                          material.recordId
                            ? reagentPath(material.recordId)
                            : '/materials'
                        }
                      >
                        {material.identifier ?? material.title}
                      </Link>{' '}
                      · {homeMaterialExpiryLabel(material, appNow(), timeZone)}
                      <div className="text-label text-fg-muted">
                        {material.title}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 text-label text-fg-muted">
                {t('projects.home.nothingNeedsAttention')}
              </p>
            )}
          </InspectorSection>

          <InspectorSection title={t('projects.home.sections.recentActivity')}>
            {sectionFailed(activityQuery) ? (
              <SectionUnavailable
                what={t('projects.home.sections.recentActivity')}
                onRetry={retrySection(activityQuery)}
              />
            ) : activity.length ? (
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {collapseActivity(activity).map((a) => (
                  <li key={a.event.id} className="flex gap-3">
                    <span className="num w-10 shrink-0 text-label text-fg-muted">
                      {new Date(a.event.createdAt).toLocaleTimeString('en-GB', {
                        timeZone,
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    <div className="min-w-0 text-label">
                      <div>
                        <b className="font-medium">
                          {a.event.actorUserId === userId
                            ? t('projects.home.activity.you')
                            : (a.event.actorName ??
                              t('projects.home.activity.system'))}
                        </b>{' '}
                        {a.action} <ActivitySubject described={a} />
                        {a.count > 1
                          ? t('projects.home.activity.times', {
                              count: a.count,
                            })
                          : ''}
                      </div>
                      {(a.count > 1 ? [] : a.changes).map((change, index) => (
                        <div
                          key={`${change.label}:${index}`}
                          className="text-fg-muted"
                        >
                          {t('projects.home.activity.change', {
                            label: change.label,
                            value:
                              change.kind === 'changed'
                                ? t('projects.home.activity.changed', {
                                    from: change.from ?? '—',
                                    to: change.to ?? '—',
                                  })
                                : (change.to ?? change.from ?? change.kind),
                          })}
                        </div>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 text-label text-fg-muted">
                {t('projects.home.activity.none')}
              </p>
            )}
          </InspectorSection>
        </Inspector>
      )}
    </div>
  )
}

/**
 * QA2-Home-2 — an activity entry must name the thing it changed and offer a
 * way to open it. A subject with a canonical product route opens it; one
 * without (workspace settings, template versions, …) opens its authoritative
 * history instead, so no entry is inert.
 */
function ActivitySubject({ described }: { described: DescribedAuditEvent }) {
  const link = auditLinkFor(described.event)
  if (link)
    return (
      <a href={link.href} className="hover:text-link">
        {described.readableSubject}
      </a>
    )
  return (
    <>
      {described.readableSubject}{' '}
      <ObjectHistoryDialog
        objectId={described.event.entityUuid}
        objectLabel={
          ENTITY_LABELS[described.event.entityType] ??
          described.event.entityType
        }
        triggerLabel={t('projects.home.activity.history')}
      />
    </>
  )
}
