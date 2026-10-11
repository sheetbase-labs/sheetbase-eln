import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Icon } from '#/components/v3/icons'
import {
  Inspector,
  InspectorSection,
  PageHeader,
  Section,
} from '#/components/v3/ui/layout'
import { Dot, Status } from '#/components/v3/ui/status'
import type { Tone } from '#/components/v3/ui/status'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { HomeQuiet, recentTone } from '#/components/v3/home/home-quiet'
import { fetchProjectSummaries } from '#/components/v3/projects/project-data'
import {
  fetchCalendarBookings,
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
import {
  fetchWorkspaceCertifications,
  isCurrentStatement,
  signatureCertificationDataClient,
} from '#/lib/signature-certification'
import { describeAuditEvent, fetchAuditEvents } from '#/lib/audit-history'
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

/** UI port (roadmap-4/ui-app3): Home, matching the reference — a status chip
 * row, Awaiting your review, Continue working, and an inspector with Today,
 * Needs attention and Recent activity — all on real data. When the user has no
 * personal recents yet, Home shows the first-run setup state instead. */
export const Route = createFileRoute('/')({
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    return { context }
  },
  component: Home,
})

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
  return [
    {
      label: 'Account created',
      hint: input.accountHint ?? `You joined ${input.workspaceName}.`,
      done: true,
    },
    {
      label: 'Set up your electronic signature',
      hint: 'Required before you can author, review or approve records. Takes about 2 minutes.',
      done: input.signatureCertified,
      actionLabel: 'Set up signature',
      actionTo: '/settings/signatures',
    },
    {
      label: 'Open your first project',
      hint: project
        ? `You were added to ${project.title}.`
        : 'Your projects appear here once someone adds you.',
      done: input.hasOpenedProject,
      actionLabel: project ? 'Open project' : 'Browse projects',
      actionTo: project ? `/projects/${project.id}` : '/projects',
    },
    {
      label: 'Create an experiment from a protocol',
      hint: 'Templates set up sections, sheets and required fields for you.',
      done: input.hasExperiment,
      actionLabel: 'Browse protocols',
      actionTo: '/protocols',
    },
  ]
}

export function firstRunProgress(steps: FirstRunStep[]): {
  done: number
  total: number
} {
  return { done: steps.filter((step) => step.done).length, total: steps.length }
}

export function Home() {
  const { context } = Route.useRouteContext()
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
  const timeZone = workspaceQuery.data?.timezone ?? 'UTC'
  const now = new Date()
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

  const reviews = reviewsQuery.data ?? []
  const datasetIssues = datasetIssuesQuery.data ?? []
  const materials = materialsQuery.data ?? []
  const bookings = (bookingsQuery.data ?? []).filter(
    (b: CalendarBookingWire) => !b.cancelled_at,
  )
  const activity = (activityQuery.data?.events ?? []).map(describeAuditEvent)

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
        resourcesQuery.data ?? [],
        calendarBookings,
        now,
        timeZone,
      )
    : []

  const mine = (certificationsQuery.data ?? []).find((c) => c.userId === userId)
  const setupSteps = firstRunSteps({
    workspaceName: context.workspace?.name ?? 'this workspace',
    accountHint: onboarding?.invitation_accepted_at
      ? `You accepted your invitation on ${homeDueLabel(onboarding.invitation_accepted_at, new Date(), timeZone)}.`
      : onboarding
        ? `You joined ${context.workspace?.name ?? 'this workspace'}.`
        : 'Your account is ready.',
    signatureCertified: isCurrentStatement(mine),
    projects,
    hasOpenedProject: projectOpensQuery.data ?? false,
    hasExperiment: (experimentsQuery.data?.length ?? 0) > 0,
  })
  const progress = firstRunProgress(setupSteps)

  const chips = [
    {
      n: counts?.reviews,
      label: 'to review',
      tone: 'review' as Tone,
      to: '/inbox' as const,
    },
    {
      n: counts?.datasetsWithErrors,
      label:
        counts?.datasetsWithErrors === 1
          ? 'dataset with errors'
          : 'datasets with errors',
      tone: 'bad' as Tone,
      to: '/datasets' as const,
    },
    {
      n: counts?.experimentsInProgress,
      label: 'experiments in progress',
      tone: 'progress' as Tone,
      to: '/experiments' as const,
    },
    {
      n: counts?.instrumentRuns,
      label: 'instrument runs today',
      tone: 'analysis' as Tone,
      to: '/schedule' as const,
    },
  ]

  const today = new Date().toLocaleDateString('en-GB', {
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
  if (homeQueries.some((query) => query.isError)) {
    return (
      <div className="flex flex-1 flex-col gap-3 p-6" role="alert">
        <h1 className="text-section">Home could not be loaded</h1>
        <p>
          Some workspace information is unavailable. Try again to load your
          current work.
        </p>
        <Button
          onClick={() => {
            for (const query of homeQueries) void query.refetch()
          }}
        >
          Try again
        </Button>
      </div>
    )
  }
  if (homeQueries.some((query) => query.isPending)) {
    return (
      <div className="p-6" role="status">
        Loading your home…
      </div>
    )
  }

  const header = (
    <PageHeader
      className="border-b-0 bg-transparent"
      title="Home"
      meta={
        <span>
          {today} · {context.workspace?.name ?? 'Workspace'}
          {showFirstRun &&
          onboarding &&
          isSameDayInZone(new Date(onboarding.joined_at), new Date(), timeZone)
            ? ' · you joined today'
            : ''}
        </span>
      }
      actions={
        showFirstRun ? undefined : (
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
                Open notebook
              </Button>
            ) : null}
            <Button
              variant="primary"
              className="max-md:hidden"
              nativeButton={false}
              render={<Link to="/experiments/new" />}
            >
              New experiment
            </Button>
          </>
        )
      }
    />
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

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">
        {header}
        {showFirstRun ? (
          <div className="flex flex-col gap-6 px-4 pb-8 pt-2 md:px-6">
            <section className="flex max-w-[760px] flex-col gap-2">
              <div className="flex items-baseline gap-2">
                <h2 className="text-section">Get set up</h2>
                <span className="num text-label text-fg-muted">
                  {progress.done} of {progress.total} done
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

            <Section title="Continue working">
              <div className="max-w-[760px] rounded-md border border-dashed border-border-strong px-4 py-5 text-label text-fg-muted">
                Experiments, datasets and analyses you open or edit will appear
                here.
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
                title="Your bookings"
                action={
                  <Link to="/schedule" className="text-label">
                    Full schedule
                  </Link>
                }
              >
                {todayBookings.length ? (
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
                    Nothing scheduled today.
                  </p>
                )}
              </Section>
            </div>
            <nav
              aria-label="Summary"
              className="flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-border-subtle py-2.5"
            >
              {chips.map((c) => (
                <Link
                  key={c.label}
                  to={c.to}
                  className="inline-flex items-center gap-2 text-body text-fg no-underline hover:underline"
                >
                  <Dot tone={c.tone} />
                  <span>
                    <b className="num font-semibold">{c.n ?? '—'}</b> {c.label}
                  </span>
                </Link>
              ))}
              <span className="flex-1" />
              <Link to="/inbox" className="text-label">
                Open inbox · {counts?.inbox ?? '—'} items
              </Link>
            </nav>

            <Section
              title="Awaiting your review"
              count={counts?.reviews}
              action={
                <Link to="/inbox" className="text-label">
                  All in inbox
                </Link>
              }
            >
              {reviews.length ? (
                <TableBox>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Record</TableHead>
                        <TableHead>Project</TableHead>
                        <TableHead>Submitted by</TableHead>
                        <TableHead>Due</TableHead>
                        <TableHead>
                          <span className="sr-only">Action</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reviews.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell>
                            <span className="mono text-fg-muted">
                              {r.identifier}
                            </span>{' '}
                            {r.title}
                          </TableCell>
                          <TableCell>{r.projectTitle ?? '—'}</TableCell>
                          <TableCell>{r.submittedByName ?? '—'}</TableCell>
                          <TableCell className="num">
                            {homeDueLabel(r.dueAt, new Date(), timeZone)}
                          </TableCell>
                          <TableCell align="right">
                            <Button
                              size="sm"
                              nativeButton={false}
                              render={
                                <Link
                                  to="/review/$revisionId"
                                  params={{ revisionId: r.revisionId }}
                                />
                              }
                            >
                              Review
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableBox>
              ) : (
                <EmptyState
                  className="py-2"
                  title="Nothing awaiting your review"
                  body="Submitted records assigned to you appear here."
                />
              )}
            </Section>

            <Section
              title="Continue working"
              action={
                <Link to="/experiments" className="text-label">
                  All recent
                </Link>
              }
            >
              {recents.length ? (
                <TableBox>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Your last change</TableHead>
                        <TableHead align="right">Updated</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recents.map((r) => {
                        const status = recentStatusLabel(r)
                        return (
                          <TableRow key={`${r.kind}:${r.id}`}>
                            <TableCell>
                              {r.identifier ? (
                                <span className="mono text-fg-muted">
                                  {r.identifier}
                                </span>
                              ) : null}{' '}
                              <Link
                                to={r.destination}
                                className="text-fg hover:text-link"
                              >
                                {r.label}
                              </Link>
                            </TableCell>
                            <TableCell>
                              {status ? (
                                <Status tone={recentTone(r)}>{status}</Status>
                              ) : (
                                <span className="text-fg-muted">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-fg-muted">
                              {describeRecentChange(r)}
                            </TableCell>
                            <TableCell
                              align="right"
                              className="num text-fg-muted"
                            >
                              {formatRelativeTime(r.lastActivityAt)}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </TableBox>
              ) : (
                <EmptyState
                  className="py-2"
                  title="Nothing worked on recently"
                  body="Records you edit appear here."
                />
              )}
            </Section>
          </div>
        )}
      </div>

      {showFirstRun ? (
        <Inspector label="Get set up">
          <InspectorSection title="Your projects">
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
                Other projects in this workspace are visible once someone adds
                you.
              </p>
            )}
          </InspectorSection>
          <InspectorSection title="People to know">
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
                Project collaborators appear here once you are assigned a
                project.
              </p>
            )}
          </InspectorSection>
          <InspectorSection title="Help">
            <ul className="m-0 flex list-none flex-col gap-2 p-0 text-label">
              <li>
                <Link to="/help/records">
                  How records, reviews and signatures work
                </Link>
              </li>
              <li>
                <Link to="/help/shortcuts">Keyboard shortcuts</Link>
              </li>
            </ul>
          </InspectorSection>
        </Inspector>
      ) : (
        <Inspector label="Today">
          <InspectorSection
            title={
              <span className="flex items-baseline">
                <span className="flex-1">Today</span>
                <Link to="/schedule" className="font-normal">
                  Full schedule
                </Link>
              </span>
            }
          >
            {todayBookings.length ? (
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
                Nothing scheduled today.
              </p>
            )}
          </InspectorSection>

          <InspectorSection
            title={
              <span className="flex items-baseline">
                <span className="flex-1">Needs attention</span>
                <Link to="/inbox" className="font-normal">
                  Inbox
                </Link>
              </span>
            }
          >
            {datasetIssues.length || materials.length ? (
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
                        to="/materials"
                        search={{ selected: material.recordId ?? undefined }}
                      >
                        {material.identifier ?? material.title}
                      </Link>{' '}
                      ·{' '}
                      {homeMaterialExpiryLabel(material, new Date(), timeZone)}
                      <div className="text-label text-fg-muted">
                        {material.title}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 text-label text-fg-muted">
                Nothing needs attention right now.
              </p>
            )}
          </InspectorSection>

          <InspectorSection title="Recent activity">
            {activity.length ? (
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {activity.map((a) => (
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
                            ? 'You'
                            : (a.event.actorName ?? 'System')}
                        </b>{' '}
                        {a.action} {a.subject}
                      </div>
                      {a.changes.map((change, index) => (
                        <div
                          key={`${change.label}:${index}`}
                          className="text-fg-muted"
                        >
                          {change.label}:{' '}
                          {change.kind === 'changed'
                            ? `${change.from ?? '—'} → ${change.to ?? '—'}`
                            : (change.to ?? change.from ?? change.kind)}
                        </div>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 text-label text-fg-muted">
                No activity recorded yet.
              </p>
            )}
          </InspectorSection>
        </Inspector>
      )}
    </div>
  )
}
