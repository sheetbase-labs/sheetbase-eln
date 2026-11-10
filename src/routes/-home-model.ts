/**
 * Home's reads and its derived model.
 *
 * The route used to hold twenty-odd queries and every derivation in one
 * function. They are grouped here by what they answer: the workspace's own
 * counts and recents, the person's projects, the first-run checklist, the quiet
 * Home's own window, and the work Home names on top of those.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import {
  fetchProjectSummaries,
  fetchWorkspaceMemberIdentities,
} from '#/components/projects/project-data'
import {
  fetchCalendarBookings,
  fetchCalendarInstruments,
  fetchCalendarResources,
  isSameDayInZone,
  toCalendarBooking,
} from '#/lib/calendar'
import type { CalendarBookingWire } from '#/lib/calendar'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  describeRecentChange,
  fetchRecentItems,
  recentStatusLabel,
} from '#/lib/recents'
import {
  fetchWorkspaceCertifications,
  isCurrentStatement,
  signatureCertificationDataClient,
} from '#/lib/signature-certification'
import {
  BOOKKEEPING_ENTITIES,
  describeAuditEvent,
  fetchAuditEvents,
  isRoutineAuditCheck,
} from '#/lib/audit-history'
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
  fetchHomeDatasetIssues,
  fetchHomeMaterials,
  fetchHomePeople,
  fetchHomeReviews,
  hasOpenedHomeProject,
  homeAssignedProjects,
  homeDayRange,
  homeDueLabel,
  homeMaterialExpiryLabel,
} from '#/lib/home-data'
import {
  fetchLabSetupSkipped,
  rememberSetupSkipped,
  setupWasSkipped,
  skipLabSetup,
} from '#/lib/lab-setup'
import {
  fetchWorkspaceGeneral,
  workspaceGeneralQueryKey,
} from '#/lib/workspace-general'
import {
  fetchMyOnboardingState,
  fetchMyProjectAssignments,
  workspaceAccessKeys,
} from '#/lib/workspace-access'
import { fetchSeenItemKeys, workItemsQueryKeys } from '#/lib/work-items/data'
import { needsAction } from '#/lib/work-items/predicate'
import { useDisplayTimeZone } from '#/lib/display-time-zone'
import { now as appNow } from '#/lib/clock'
import { t } from '#/copy'
import type { CurrentContext } from '#/lib/current-user'
import type { ShellCounts } from '#/lib/shell-counts.server'

import {
  firstRunProgress,
  firstRunSteps,
  unavailableSections,
} from './-home-first-run'
import type { HomeQueryState } from './-home-first-run'

/** Rows Home's recent activity shows, and how many events it reads to fill
 * them. */
export const HOME_ACTIVITY_ROWS = 6
export const HOME_ACTIVITY_READ = 24

/** No seen keys until that read answers; an empty set marks nothing seen. */
const EMPTY_SEEN: ReadonlySet<string> = new Set()

/**
 * The workspace's counts, its time zone and the person's recents — the reads
 * that decide which Home is drawn.
 */
export function useHomeBaseReads({
  workspaceId,
  userId,
  briefOpen,
}: {
  workspaceId: string | undefined
  userId: string
  briefOpen: boolean
}) {
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

  const skippedQuery = useQuery({
    queryKey: ['lab-setup-skipped', workspaceId, userId],
    queryFn: () => fetchLabSetupSkipped(notebookDataClient, workspaceId!),
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

  const activityQuery = useQuery({
    queryKey: ['home-activity', workspaceId, userId],
    // Read past the rows Home shows: routine checks are dropped and runs fold.
    queryFn: () =>
      fetchAuditEvents(notebookDataClient, { limit: HOME_ACTIVITY_READ }),
    enabled: Boolean(workspaceId),
  })

  // QA2-Inbox-1: the same seen state the Inbox list drops items by, so the
  // reviews and materials Home names cannot outlive what the Inbox lists.
  const seenQuery = useQuery({
    queryKey: workItemsQueryKeys.seen(),
    queryFn: () => fetchSeenItemKeys(),
    enabled: Boolean(workspaceId),
  })

  const counts = countsQuery.data

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
  const recents = recentsQuery.data ?? []
  const showFirstRun = recentsQuery.isSuccess && recents.length === 0
  // R5-HOME-01: the calm page shows the person's projects, so their project
  // summaries are shared with the first-run state rather than re-read.
  const calm = !showFirstRun && pace !== 'busy'
  const needsProjects = showFirstRun || calm || briefOpen

  return {
    reviewsQuery,
    materialsQuery,
    workspaceQuery,
    skippedQuery,
    countsQuery,
    bookingsQuery,
    datasetIssuesQuery,
    recentsQuery,
    activityQuery,
    seenQuery,
    counts,
    timeZone,
    now,
    range,
    upcomingWindow,
    recents,
    showFirstRun,
    calm,
    needsProjects,
    pace,
    waitingCounts,
  }
}

export type HomeBaseReads = ReturnType<typeof useHomeBaseReads>

/**
 * The person's own projects, and the counts that hang off them. Shared by the
 * first-run checklist and the quiet Home so neither re-reads them.
 */
export function useHomeProjectsReads({
  workspaceId,
  userId,
  needsProjects,
  showFirstRun,
  calm,
  briefOpen,
  upcomingWindow,
  dayStart,
}: {
  workspaceId: string | undefined
  userId: string
  needsProjects: boolean
  showFirstRun: boolean
  calm: boolean
  briefOpen: boolean
  upcomingWindow: ReturnType<typeof homeUpcomingWindow>
  /** The local day the coming-up window is anchored to, for the query key. */
  dayStart: string
}) {
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

  // R5-HOME-01 — the person's project milestones due in the coming-up window.
  const milestonesQuery = useQuery({
    queryKey: [
      'home-upcoming-milestones',
      workspaceId,
      userId,
      dayStart,
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
    enabled:
      (calm || briefOpen) && projectsQuery.isSuccess && projects.length > 0,
  })

  return {
    assignmentsQuery,
    projectsQuery,
    projects,
    projectIds,
    projectOpensQuery,
    peopleQuery,
    milestonesQuery,
    approvalsQuery,
  }
}

export type HomeProjectsReads = ReturnType<typeof useHomeProjectsReads>

/** GAP 2 — first-run setup state, read only when it will be shown. */
export function useHomeFirstRunReads({
  workspaceId,
  userId,
  enabled,
  projects,
  projectOpensQuery,
  workspaceName,
  setupDone,
  timeZone,
}: {
  workspaceId: string | undefined
  userId: string
  enabled: boolean
  projects: HomeProjectsReads['projects']
  projectOpensQuery: HomeProjectsReads['projectOpensQuery']
  workspaceName: string
  setupDone: boolean
  timeZone: string
}) {
  const onboardingQuery = useQuery({
    queryKey: workspaceAccessKeys.onboarding(workspaceId ?? '', userId),
    queryFn: () => fetchMyOnboardingState(notebookDataClient),
    enabled: Boolean(workspaceId) && enabled,
  })

  const onboarding = onboardingQuery.data

  const certificationsQuery = useQuery({
    queryKey: ['home-first-run-certifications', workspaceId, userId],
    queryFn: () =>
      fetchWorkspaceCertifications(
        signatureCertificationDataClient,
        workspaceId!,
      ),
    enabled: Boolean(workspaceId) && enabled,
  })

  const membersQuery = useQuery({
    queryKey: ['home-first-run-members', workspaceId, userId],
    queryFn: () => fetchWorkspaceMemberIdentities(),
    enabled:
      enabled &&
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
    enabled: Boolean(workspaceId) && enabled,
  })

  const mine = (certificationsQuery.data ?? []).find(
    (certification) => certification.userId === userId,
  )

  const setupSteps = firstRunSteps({
    workspaceName,
    accountHint: onboarding?.invitation_accepted_at
      ? t('projects.home.firstRun.acceptedOn', {
          date: homeDueLabel(
            onboarding.invitation_accepted_at,
            appNow(),
            timeZone,
          ),
        })
      : onboarding
        ? t('projects.home.firstRun.joined', { workspace: workspaceName })
        : t('projects.home.firstRun.accountReady'),
    signatureCertified: isCurrentStatement(mine),
    projects,
    hasOpenedProject: projectOpensQuery.data ?? false,
    hasExperiment: (experimentsQuery.data?.length ?? 0) > 0,
    role: onboarding?.workspace_role,
    memberCount: membersQuery.data?.length,
    setupDone,
  })

  return {
    onboardingQuery,
    onboarding,
    certificationsQuery,
    membersQuery,
    experimentsQuery,
    mine,
    setupSteps,
    progress: firstRunProgress(setupSteps),
  }
}

export type HomeFirstRunReads = ReturnType<typeof useHomeFirstRunReads>

/** The quiet Home's own reads: instruments, planned ends and free capacity. */
export function useHomeQuietReads({
  workspaceId,
  userId,
  calm,
  workspaceReady,
  range,
  upcomingWindow,
}: {
  workspaceId: string | undefined
  userId: string
  calm: boolean
  /** The workspace's own read has answered; the quiet reads wait for it. */
  workspaceReady: boolean
  range: ReturnType<typeof homeDayRange>
  upcomingWindow: ReturnType<typeof homeUpcomingWindow>
}) {
  const resourcesQuery = useQuery({
    queryKey: ['home-resources', workspaceId],
    queryFn: () => fetchCalendarResources(notebookDataClient, workspaceId!),
    enabled: Boolean(workspaceId) && workspaceReady && calm,
  })

  // ADR-0054 — the free-instrument list is the registry, not the mirror of it.
  const instrumentsQuery = useQuery({
    queryKey: ['home-instruments', workspaceId],
    queryFn: () => fetchCalendarInstruments(notebookDataClient, workspaceId!),
    enabled: Boolean(workspaceId) && workspaceReady && calm,
  })

  const upcomingEndsQuery = useQuery({
    queryKey: ['home-upcoming', workspaceId, userId, range.start],
    queryFn: () =>
      fetchUpcomingRecordEnds(notebookDataClient, workspaceId!, upcomingWindow),
    enabled: Boolean(workspaceId) && workspaceReady && calm,
  })

  return { resourcesQuery, instrumentsQuery, upcomingEndsQuery }
}

export type HomeQuietReads = ReturnType<typeof useHomeQuietReads>

/**
 * The work Home names: the reviews and materials that still need action, the
 * bookings still on, the audit trail minus bookkeeping, and the one waiting
 * item the near-quiet banner states.
 */
export function useHomeWorkReads({
  base,
  projects,
}: {
  base: HomeBaseReads
  projects: HomeProjectsReads
}) {
  const seen = base.seenQuery.data ?? EMPTY_SEEN

  const reviews = (base.reviewsQuery.data ?? []).filter((review) =>
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

  // Settled with nothing to review: Home says so in one line, below the work.
  const reviewsSettledEmpty =
    base.reviewsQuery.isSuccess &&
    base.seenQuery.isSuccess &&
    reviews.length === 0

  const datasetIssues = base.datasetIssuesQuery.data ?? []

  const materials = (base.materialsQuery.data ?? []).filter((material) =>
    needsAction(material, seen),
  )

  const bookings = (base.bookingsQuery.data ?? []).filter(
    (booking: CalendarBookingWire) => !booking.cancelled_at,
  )

  // Access bookkeeping is not something anyone did to their work; it stays in
  // the audit log, not in Home's recent activity.
  const activity = (base.activityQuery.data?.events ?? [])
    .filter(
      (event) =>
        !BOOKKEEPING_ENTITIES.has(event.entityType) &&
        !isRoutineAuditCheck(event),
    )
    .map(describeAuditEvent)

  // The booking read now spans the "Coming up" window; the busy Home still
  // means today.
  const calendarBookings = bookings.map((booking) => toCalendarBooking(booking))

  const todayBookings = calendarBookings.filter((booking) =>
    isSameDayInZone(new Date(booking.startsAt), base.now, base.timeZone),
  )

  const waiting =
    base.pace === 'near-quiet' && base.waitingCounts
      ? homeWaitingItem({
          counts: base.waitingCounts,
          reviews: reviews.map((review) => ({
            revisionId: review.revisionId,
            identifier: review.identifier,
          })),
          materials: materials.map((material) => ({
            recordId: material.recordId,
            identifier: material.identifier,
            reason: homeMaterialExpiryLabel(material, base.now, base.timeZone),
          })),
          datasetIssues: datasetIssues.map((issue) => ({
            id: issue.id,
            identifier: issue.identifier,
            label: issue.label,
          })),
        })
      : null

  const pickUp = base.calm
    ? pickUpItems(base.recents, recentStatusLabel, describeRecentChange)
    : []

  const continueWorking = base.calm
    ? continueWorkingItems(base.recents, pickUp)
    : base.recents

  return {
    seen,
    reviews,
    reviewsSettledEmpty,
    datasetIssues,
    materials,
    bookings,
    activity,
    calendarBookings,
    todayBookings,
    waiting,
    pickUp,
    continueWorking,
    approvals: projects.approvalsQuery.data ?? [],
  }
}

export type HomeWorkReads = ReturnType<typeof useHomeWorkReads>

/** What is coming up and what is free: the quiet Home's two lists. */
export function useHomeQuietPlan({
  base,
  projects,
  quiet,
  work,
}: {
  base: HomeBaseReads
  projects: HomeProjectsReads
  quiet: HomeQuietReads
  work: HomeWorkReads
}) {
  const comingUp = base.calm
    ? groupComingUp(
        buildComingUp({
          bookings: work.calendarBookings,
          // A booking names a resource id, which is the instrument id for an
          // instrument booking (its resource row mirrors the registry). Rooms
          // and other resources name themselves here.
          resourceNames: new Map(
            (quiet.resourcesQuery.data ?? []).map((resource) => [
              resource.id,
              resource.name,
            ]),
          ),
          reviews: work.reviews.flatMap((review) =>
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
          materials: work.materials.map((material) => ({
            recordId: material.recordId,
            identifier: material.identifier,
            title: material.title,
            dueAt: material.dueAt,
            reason: homeMaterialExpiryLabel(material, base.now, base.timeZone),
          })),
          plannedEnds: quiet.upcomingEndsQuery.data ?? [],
          milestones: projects.milestonesQuery.data ?? [],
          projectNames: new Map(
            projects.projects.map((project) => [project.id, project.title]),
          ),
          now: base.now,
          timeZone: base.timeZone,
        }),
        base.now,
        base.timeZone,
      )
    : []

  const instrumentsFree = base.calm
    ? freeInstruments(
        quiet.instrumentsQuery.data ?? [],
        work.calendarBookings,
        base.now,
        base.timeZone,
      )
    : []

  return { comingUp, instrumentsFree }
}

/**
 * The whole page's model: every read Home makes, the sections it reports as
 * unavailable, and the values its header, sections and inspector state.
 */
export function useHomeModel({
  context,
  shellCounts,
  briefOpen,
}: {
  context: CurrentContext
  shellCounts: ShellCounts
  briefOpen: boolean
}) {
  const workspaceId = context.workspace?.id

  const userId = context.user.id

  const workspaceName =
    context.workspace?.name ?? t('projects.home.firstRun.thisWorkspace')

  const base = useHomeBaseReads({ workspaceId, userId, briefOpen })

  const projects = useHomeProjectsReads({
    workspaceId,
    userId,
    needsProjects: base.needsProjects,
    showFirstRun: base.showFirstRun,
    calm: base.calm,
    briefOpen,
    upcomingWindow: base.upcomingWindow,
    dayStart: base.range.start,
  })

  const firstRun = useHomeFirstRunReads({
    workspaceId,
    userId,
    enabled: base.showFirstRun,
    projects: projects.projects,
    projectOpensQuery: projects.projectOpensQuery,
    workspaceName,
    setupDone: Boolean(base.workspaceQuery.data?.setupCompletedAt),
    timeZone: base.timeZone,
  })

  const quiet = useHomeQuietReads({
    workspaceId,
    userId,
    calm: base.calm,
    workspaceReady: base.workspaceQuery.isSuccess,
    range: base.range,
    upcomingWindow: base.upcomingWindow,
  })

  const work = useHomeWorkReads({ base, projects })
  const plan = useHomeQuietPlan({ base, projects, quiet, work })

  const shellInbox = 'inbox' in shellCounts ? shellCounts.inbox : undefined

  const inboxCount =
    shellInbox != null ? Number(shellInbox) : base.counts?.inbox

  const homeQueries = [
    base.workspaceQuery,
    base.countsQuery,
    base.bookingsQuery,
    base.datasetIssuesQuery,
    base.recentsQuery,
    base.reviewsQuery,
    base.materialsQuery,
    base.seenQuery,
    base.activityQuery,
    ...(base.showFirstRun
      ? [
          firstRun.onboardingQuery,
          firstRun.certificationsQuery,
          projects.assignmentsQuery,
          projects.projectsQuery,
          projects.projectOpensQuery,
          projects.peopleQuery,
          firstRun.experimentsQuery,
        ]
      : []),
    ...(base.calm
      ? [
          quiet.resourcesQuery,
          quiet.upcomingEndsQuery,
          // The calm page owns the project cards, so it waits for them too.
          projects.assignmentsQuery,
          projects.projectsQuery,
          // These two stay disabled (and so must stay out of the gate) when the
          // person has no project of their own to report on.
          ...(projects.projectsQuery.isSuccess && projects.projectIds.length > 0
            ? [projects.milestonesQuery, projects.approvalsQuery]
            : []),
        ]
      : []),
  ]

  // Home degrades one section at a time. Only the two reads that decide which
  // Home to draw (the workspace's time zone and the person's recents) take the
  // whole page down with them; every other read that fails leaves its own
  // section saying so, with a way to retry, and the rest of Home stays usable.
  const pageFailed = [base.workspaceQuery, base.recentsQuery].some(
    (query) => query.isError,
  )

  const unavailable = unavailableSections([
    { label: t('projects.home.sections.counts'), queries: [base.countsQuery] },
    {
      label: t('projects.home.sections.yourBookings'),
      queries: [base.bookingsQuery],
    },
    {
      label: t('projects.home.sections.needsAttention'),
      queries: [base.datasetIssuesQuery, base.materialsQuery, base.seenQuery],
    },
    {
      label: t('projects.home.sections.awaitingReview'),
      queries: [base.reviewsQuery, base.seenQuery],
    },
    {
      label: t('projects.home.sections.recentActivity'),
      queries: [base.activityQuery],
    },
    ...(base.showFirstRun
      ? [
          {
            label: t('projects.home.sections.getSetUp'),
            queries: [
              firstRun.onboardingQuery,
              firstRun.certificationsQuery,
              projects.assignmentsQuery,
              projects.projectsQuery,
              projects.projectOpensQuery,
              projects.peopleQuery,
              firstRun.experimentsQuery,
            ],
          },
        ]
      : []),
    ...(base.calm
      ? [
          {
            label: t('projects.home.sections.comingUp'),
            queries: [
              quiet.resourcesQuery,
              quiet.upcomingEndsQuery,
              projects.milestonesQuery,
            ],
          },
          {
            label: t('projects.home.sections.yourProjects'),
            queries: [
              projects.assignmentsQuery,
              projects.projectsQuery,
              projects.approvalsQuery,
            ],
          },
        ]
      : []),
  ])

  const retryUnavailable = () => {
    for (const section of unavailable)
      for (const query of section.queries)
        if (query.isError) void query.refetch()
  }

  const retryAll = () => {
    for (const query of homeQueries) void query.refetch()
  }

  const sectionFailed = (...queries: HomeQueryState[]) =>
    queries.some((query) => query.isError)

  const retrySection =
    (...queries: HomeQueryState[]) =>
    () => {
      for (const query of queries) if (query.isError) void query.refetch()
    }

  const today = appNow().toLocaleDateString('en-GB', {
    timeZone: base.timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  return {
    context,
    workspaceId,
    userId,
    workspaceName,
    /** The header names the workspace, and says which one when it has none. */
    headerWorkspaceName:
      context.workspace?.name ?? t('projects.home.workspace'),
    ...base,
    inboxCount,
    homeQueries,
    pageFailed,
    unavailable,
    retryUnavailable,
    retryAll,
    sectionFailed,
    retrySection,
    projects: projects.projects,
    projectIds: projects.projectIds,
    approvals: work.approvals,
    onboarding: firstRun.onboarding,
    onboardingQuery: firstRun.onboardingQuery,
    certificationsQuery: firstRun.certificationsQuery,
    peopleQuery: projects.peopleQuery,
    projectsQuery: projects.projectsQuery,
    skippedQuery: base.skippedQuery,
    setupSteps: firstRun.setupSteps,
    progress: firstRun.progress,
    today,
    openNotebookId: base.recents.find((recent) => recent.kind === 'record')?.id,
    joinedToday:
      base.showFirstRun &&
      Boolean(firstRun.onboarding) &&
      isSameDayInZone(
        new Date(firstRun.onboarding!.joined_at),
        appNow(),
        base.timeZone,
      ),
    readWork: work,
    comingUp: plan.comingUp,
    instrumentsFree: plan.instrumentsFree,
    approvalsQuery: projects.approvalsQuery,
    briefReady:
      projects.projectsQuery.isSuccess &&
      (projects.projects.length === 0 || projects.approvalsQuery.isSuccess),
    briefInput: {
      reviews: work.reviews.map((review) => ({
        identifier: review.identifier,
        title: review.title,
        projectTitle: review.projectTitle,
      })),
      materials: work.materials.map((material) => ({
        identifier: material.identifier ?? '',
        reason: homeMaterialExpiryLabel(material, base.now, base.timeZone),
      })),
      datasetIssues: work.datasetIssues.map((issue) => ({
        identifier: issue.identifier,
        label: issue.label,
      })),
      todayBookings: work.todayBookings.length,
      projects: work.approvals,
    },
  }
}

/**
 * The first-visit lab setup prompt: it opens for an owner whose workspace has
 * not finished setup and who has not skipped it here or elsewhere.
 */
export function useLabSetupPrompt({
  workspaceId,
  role,
  forceSetup,
  workspaceQuery,
  skippedQuery,
}: {
  workspaceId: string | undefined
  role: string | undefined
  forceSetup: true | undefined
  workspaceQuery: {
    isSuccess: boolean
    data?: { setupCompletedAt?: string | null } | null
  }
  skippedQuery: { isPending: boolean; data?: boolean }
}) {
  const [setupClosed, setSetupClosed] = useState(false)

  const setupDone = Boolean(workspaceQuery.data?.setupCompletedAt)
  // Wait for both answers before offering setup, so the dialog never flashes
  // open while the workspace or the person's earlier skip is still loading. A
  // failed skip read falls back to this browser's own memory.
  const skippedElsewhere = skippedQuery.data === true

  const open =
    !setupClosed &&
    role === 'owner' &&
    Boolean(workspaceId) &&
    workspaceQuery.isSuccess &&
    !skippedQuery.isPending &&
    !setupDone &&
    (forceSetup === true ||
      !(skippedElsewhere || setupWasSkipped(workspaceId!)))

  /** Closing remembers the skip here, and on the workspace when it can. */
  const close = () => {
    if (forceSetup !== true && workspaceId) {
      rememberSetupSkipped(workspaceId)
      // Best effort: this browser already remembers it.
      void skipLabSetup(notebookDataClient, workspaceId).catch(() => undefined)
    }

    setSetupClosed(true)
  }

  return { open, close }
}
