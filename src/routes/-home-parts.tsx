/**
 * Home's rendered sections: the page header, the status chips, the first-run
 * checklist, the busy page's tables and the inspector.
 */
import { Link } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import { Notice } from '#/components/ui/alert'
import { Icon } from '#/components/icons'
import {
  Inspector,
  InspectorSection,
  PageHeader,
  Section,
} from '#/components/ui/layout'
import { Dot } from '#/components/ui/status'
import { TableBox } from '#/components/ui/table'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import { EmptyState } from '#/components/ui/empty-state'
import { Skeleton } from '#/components/ui/skeleton'
import { AskAiButton } from '#/components/assist/ask-ai-button'
import { HomeBrief } from '#/components/assist/home-brief'
import { JoinedWelcome } from '#/components/shell/joined-welcome'
import { ObjectHistoryDialog } from '#/components/audit/object-history-dialog'
import {
  auditLinkFor,
  collapseActivity,
  ENTITY_LABELS,
} from '#/lib/audit-history'
import { homeMaterialExpiryLabel } from '#/lib/home-data'
import type {
  CollapsedActivity,
  DescribedAuditEvent,
} from '#/lib/audit-history'
import { reagentPath } from '#/lib/navigation'
import { cn } from '#/lib/utils'
import { now as appNow } from '#/lib/clock'
import { rich, t } from '#/copy'

import { HOME_ACTIVITY_ROWS } from './-home-model'
import { homeRecentColumns, homeReviewColumns } from './-home-columns'
import type { HomeReviewRow } from './-home-columns'
import type { CalendarBooking } from '#/lib/calendar'
import type { WorkItem } from '#/lib/work-items/data'
import type { RecentItem } from '#/lib/recents'

/** A material that still needs attention, as Home reads it. */
export type AttentionMaterial = Pick<
  WorkItem,
  'recordId' | 'identifier' | 'title' | 'dueAt' | 'reason'
>

/** The one booking shape the sections state. */
export type TodayBooking = Pick<
  CalendarBooking,
  'id' | 'title' | 'location' | 'startsAt'
>

/** A section that could not be read says so and offers the retry. */
export function SectionUnavailable({
  what,
  onRetry,
}: {
  what: string
  onRetry: () => void
}): React.ReactElement {
  return (
    <div className="flex items-center gap-2 text-label text-fg-muted">
      <span>{t('projects.home.unavailable.section', { what })}</span>
      <Button size="sm" variant="quiet" onClick={onRetry}>
        {t('common.actions.tryAgain')}
      </Button>
    </div>
  )
}

/**
 * QA2-Home-2 — an activity entry must name the thing it changed and offer a
 * way to open it. A subject with a canonical product route opens it; one
 * without (workspace settings, template versions, …) opens its authoritative
 * history instead, so no entry is inert.
 */
export function ActivitySubject({
  described,
}: {
  described: DescribedAuditEvent
}): React.ReactElement {
  const link = auditLinkFor(described.event)

  if (link)
    return (
      <a href={link.href} className="hover:text-link">
        {described.sentenceSubject}
      </a>
    )

  // An object with no page of its own opens its history from the subject, so
  // the line reads as one sentence instead of breaking around a button.
  return (
    <ObjectHistoryDialog
      objectId={described.event.entityUuid}
      objectLabel={
        ENTITY_LABELS[described.event.entityType] ?? described.event.entityType
      }
      inline={{
        text: described.sentenceSubject,
        label: t('projects.home.activity.subjectHistory', {
          subject: described.sentenceSubject,
        }),
      }}
    />
  )
}

/** The brief dialog, opened from the page header. */
export function HomeBriefButton({
  open,
  onOpenChange,
  ready,
  input,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  ready: boolean
  input: React.ComponentProps<typeof HomeBrief>['input']
}): React.ReactElement {
  return (
    <HomeBrief
      open={open}
      onOpenChange={onOpenChange}
      ready={ready}
      input={input}
    />
  )
}

/** The page header: what Home is, today's date, the workspace and its actions. */
export function HomeHeader({
  showFirstRun,
  today,
  workspaceName,
  joinedToday,
  openNotebookId,
  briefButton,
  unavailable,
  onRetryUnavailable,
}: {
  showFirstRun: boolean
  today: string
  workspaceName: string
  joinedToday: boolean
  openNotebookId: string | undefined
  briefButton: React.ReactNode
  unavailable: { label: string }[]
  onRetryUnavailable: () => void
}): React.ReactElement {
  return (
    <>
      <PageHeader
        className="border-b-0 bg-transparent"
        title={t('projects.home.title')}
        meta={
          <span>
            {t('projects.home.meta', { today, workspace: workspaceName })}
            {joinedToday ? t('projects.home.joinedToday') : ''}
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
              {briefButton}
              <AskAiButton />
            </>
          )
        }
      />
      {unavailable.length ? (
        <div className="px-4 pb-2 md:px-6">
          <Notice
            tone="warn"
            title={t('projects.home.unavailable.partTitle')}
            action={
              <Button size="sm" onClick={onRetryUnavailable}>
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
}

/** The counts Home states at the top of the work, each leading to its set. */
export function HomeChips({
  counts,
  inboxCount,
}: {
  counts:
    | {
        reviews: number
        datasetsWithErrors: number
        experimentsInProgress: number
        instrumentRuns: number
      }
    | undefined
  inboxCount: number | undefined
}): React.ReactElement {
  // QA2-Home-1: a chip leads to the set it counts, so the destination opens
  // filtered to that set instead of its unfiltered default.
  const chipClass =
    'inline-flex items-center gap-1.5 text-label text-fg-muted no-underline hover:text-fg hover:underline'

  return (
    <nav
      aria-label={t('projects.home.summary')}
      className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-label text-fg-muted"
    >
      <Link to="/inbox" search={{ type: 'reviews' }} className={chipClass}>
        <Dot tone="review" />
        <span>
          <b className="num font-semibold">{counts?.reviews ?? '—'}</b>{' '}
          {t('projects.home.toReview')}
        </span>
      </Link>
      <Link to="/datasets" search={{ tab: 'issues' }} className={chipClass}>
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
          {counts?.experimentsInProgress === 1
            ? t('projects.home.experimentInProgress')
            : t('projects.home.experimentsInProgress')}
        </span>
      </Link>
      <Link to="/schedule" className={chipClass}>
        <Dot tone="analysis" />
        <span>
          <b className="num font-semibold">{counts?.instrumentRuns ?? '—'}</b>{' '}
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
  )
}

/** A booking as a phone states it: when, what and where. */
export function TodayBookingsList({
  bookings,
  timeZone,
  className,
}: {
  bookings: TodayBooking[]
  timeZone: string
  className?: string
}): React.ReactElement {
  return (
    <ul className={cn('m-0 flex list-none flex-col p-0', className)}>
      {bookings.map((b) => (
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
              <div className="text-label text-fg-muted">{b.location}</div>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  )
}

/** The bookings section a phone shows first: what the person is doing next. */
export function HomeBookingsSection({
  bookings,
  timeZone,
  failed,
  onRetry,
}: {
  bookings: TodayBooking[]
  timeZone: string
  failed: boolean
  onRetry: () => void
}): React.ReactElement {
  return (
    <div className="md:hidden">
      <Section
        title={t('projects.home.sections.yourBookings')}
        action={
          <Link to="/schedule" className="text-label">
            {t('projects.home.fullSchedule')}
          </Link>
        }
      >
        {failed ? (
          <SectionUnavailable
            what={t('projects.home.sections.yourBookings')}
            onRetry={onRetry}
          />
        ) : bookings.length ? (
          <TodayBookingsList bookings={bookings} timeZone={timeZone} />
        ) : (
          <p className="m-0 text-label text-fg-muted">
            {t('projects.home.noBookings')}
          </p>
        )}
      </Section>
    </div>
  )
}

/** The person's own recent work. */
export function HomeRecentsSection({
  recents,
}: {
  recents: RecentItem[]
}): React.ReactElement {
  return (
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
  )
}

/** The submissions waiting on this reader, with the way into each. */
export function HomeReviewsSection({
  reviews,
  count,
  failed,
  onRetry,
  timeZone,
}: {
  reviews: HomeReviewRow[]
  count: number | undefined
  failed: boolean
  onRetry: () => void
  timeZone: string
}): React.ReactElement {
  return (
    <Section
      title={t('projects.home.sections.awaitingReview')}
      count={count}
      action={
        <Link to="/inbox" className="text-label">
          {t('projects.home.allInInbox')}
        </Link>
      }
    >
      {failed ? (
        <SectionUnavailable
          what={t('projects.home.what.reviews')}
          onRetry={onRetry}
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
                    {review.projectTitle ? ` · ${review.projectTitle}` : ''}
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
  )
}

/** The busy Home's work: today, the counts, what is waiting and what is recent. */
export function HomeBusySections({
  todayBookings,
  timeZone,
  bookingsFailed,
  onRetryBookings,
  counts,
  inboxCount,
  reviewsSettledEmpty,
  reviews,
  reviewsFailed,
  onRetryReviews,
  recents,
}: {
  todayBookings: TodayBooking[]
  timeZone: string
  bookingsFailed: boolean
  onRetryBookings: () => void
  counts: React.ComponentProps<typeof HomeChips>['counts']
  inboxCount: number | undefined
  reviewsSettledEmpty: boolean
  reviews: HomeReviewRow[]
  reviewsFailed: boolean
  onRetryReviews: () => void
  recents: RecentItem[]
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-7 px-4 pb-8 pt-2 md:px-6">
      {/* MOB-01.2: on a phone the inspector is a sheet behind a tap, so
                today's bookings are page content — the first thing a bench user
                needs is what they are doing next. */}
      <HomeBookingsSection
        bookings={todayBookings}
        timeZone={timeZone}
        failed={bookingsFailed}
        onRetry={onRetryBookings}
      />
      <HomeChips counts={counts} inboxCount={inboxCount} />

      {reviewsSettledEmpty ? (
        <>
          <HomeRecentsSection recents={recents} />
          {/* Nothing to review is one line, not a section: the work
                    the person can pick up comes first. */}
          <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-label text-fg-muted">
            <Icon name="check" size={14} className="text-success-text" />
            <span>{t('projects.home.noReviews')}</span>
            <Link to="/inbox" className="text-label">
              {t('projects.home.allInInbox')}
            </Link>
          </p>
        </>
      ) : (
        <>
          <HomeReviewsSection
            reviews={reviews}
            count={counts?.reviews}
            failed={reviewsFailed}
            onRetry={onRetryReviews}
            timeZone={timeZone}
          />
          <HomeRecentsSection recents={recents} />
        </>
      )}
    </div>
  )
}

/** The first-run checklist, for a person who has not opened anything yet. */
export function HomeFirstRunSections({
  workspaceId,
  workspaceName,
  userId,
  email,
  role,
  setupSteps,
  progress,
}: {
  workspaceId: string | undefined
  workspaceName: string
  userId: string
  email: string
  role: string | undefined
  setupSteps: {
    label: string
    hint: string
    done: boolean
    actionLabel?: string
    actionTo?: string
  }[]
  progress: { done: number; total: number }
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-6 px-4 pb-8 pt-2 md:px-6">
      {workspaceId ? (
        <JoinedWelcome
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          userId={userId}
          email={email}
          role={role}
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
                <div className="text-label text-fg-muted">{step.hint}</div>
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
  )
}

/** One row of the recent-activity list: who, what, and what changed. */
export function ActivityRow({
  described,
  userId,
  timeZone,
}: {
  described: CollapsedActivity
  userId: string
  timeZone: string
}): React.ReactElement {
  return (
    <li className="flex gap-3">
      <span className="num w-10 shrink-0 text-label text-fg-muted">
        {new Date(described.event.createdAt).toLocaleTimeString('en-GB', {
          timeZone,
          hour: '2-digit',
          minute: '2-digit',
        })}
      </span>
      <div className="min-w-0 text-label">
        <div>
          <b className="font-medium">
            {described.event.actorUserId === userId
              ? t('projects.home.activity.you')
              : (described.event.actorName ??
                t('projects.home.activity.system'))}
          </b>{' '}
          {described.action} <ActivitySubject described={described} />
          {described.others > 0
            ? t('projects.home.activity.andMore', {
                count: described.others,
              })
            : described.count > 1
              ? t('projects.home.activity.times', {
                  count: described.count,
                })
              : ''}
        </div>
        {(described.count > 1 ? [] : described.changes).map((change) => (
          <div key={`${change.label}:${change.kind}`} className="text-fg-muted">
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
  )
}

/** Today, what needs attention and what changed while the person was away. */
export function HomeInspectorToday({
  todayBookings,
  timeZone,
  bookingsFailed,
  onRetryBookings,
  datasetIssues,
  materials,
  attentionFailed,
  onRetryAttention,
  activity,
  activityFailed,
  onRetryActivity,
  userId,
}: {
  todayBookings: TodayBooking[]
  timeZone: string
  bookingsFailed: boolean
  onRetryBookings: () => void
  datasetIssues: {
    id: string
    identifier: string
    label: string
    detail: string
  }[]
  materials: AttentionMaterial[]
  attentionFailed: boolean
  onRetryAttention: () => void
  activity: DescribedAuditEvent[]
  activityFailed: boolean
  onRetryActivity: () => void
  userId: string
}): React.ReactElement {
  return (
    <Inspector label={t('projects.home.sections.today')}>
      <InspectorSection
        title={
          <span className="flex items-baseline">
            <span className="flex-1">{t('projects.home.sections.today')}</span>
            <Link to="/schedule" className="font-normal">
              {t('projects.home.fullSchedule')}
            </Link>
          </span>
        }
      >
        {bookingsFailed ? (
          <SectionUnavailable
            what={t('projects.home.what.todaysBookings')}
            onRetry={onRetryBookings}
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
                    <div className="text-label text-fg-muted">{b.location}</div>
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
        {attentionFailed ? (
          <SectionUnavailable
            what={t('projects.home.what.needsAttention')}
            onRetry={onRetryAttention}
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
        {activityFailed ? (
          <SectionUnavailable
            what={t('projects.home.sections.recentActivity')}
            onRetry={onRetryActivity}
          />
        ) : activity.length ? (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {collapseActivity(activity)
              .slice(0, HOME_ACTIVITY_ROWS)
              .map((described) => (
                <ActivityRow
                  key={described.event.id}
                  described={described}
                  userId={userId}
                  timeZone={timeZone}
                />
              ))}
          </ul>
        ) : (
          <p className="m-0 text-label text-fg-muted">
            {t('projects.home.activity.none')}
          </p>
        )}
      </InspectorSection>
    </Inspector>
  )
}

/** Who is here, which projects the person can open, and where to read more. */
export function HomeInspectorFirstRun({
  projects,
  role,
  people,
}: {
  projects: { id: string; title: string; accessLevel: string }[]
  role: string | undefined
  people: { id: string; name: string; role: string }[]
}): React.ReactElement {
  return (
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
            {role === 'owner' || role === 'admin'
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
        {people.length ? (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {people.map((person) => (
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
            <Link to="/help/shortcuts">{t('projects.home.helpShortcuts')}</Link>
          </li>
        </ul>
      </InspectorSection>
    </Inspector>
  )
}

/** The whole page could not be read: say so and offer the retry. */
export function HomeUnavailable({
  onRetry,
}: {
  onRetry: () => void
}): React.ReactElement {
  return (
    <div className="flex flex-1 flex-col gap-3 p-6" role="alert">
      <h1 className="text-section">
        {t('projects.home.unavailable.pageTitle')}
      </h1>
      <p>{t('projects.home.unavailable.pageBody')}</p>
      <Button onClick={onRetry}>{t('common.actions.tryAgain')}</Button>
    </div>
  )
}

/** The page while its reads are outstanding. */
export function HomeLoading(): React.ReactElement {
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
