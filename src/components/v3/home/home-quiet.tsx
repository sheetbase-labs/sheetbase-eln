import { Link } from '@tanstack/react-router'

import { Icon } from '#/components/v3/icons'
import type { IconName } from '#/components/v3/icons'
import { Button } from '#/components/v3/ui/button'
import { Inspector, InspectorSection, Section } from '#/components/v3/ui/layout'
import { Progress } from '#/components/v3/ui/progress'
import { Dot, Status } from '#/components/v3/ui/status'
import type { Tone } from '#/components/v3/ui/status'
import { experimentStatus } from '#/components/v3/experiments/experiments-data'
import { collapseActivity } from '#/lib/audit-history'
import type { DescribedAuditEvent } from '#/lib/audit-history'
import type { CalendarBooking } from '#/lib/calendar'
import { HOME_UPCOMING_DAYS } from '#/lib/home-quiet'
import type {
  ComingUpGroup,
  ComingUpKind,
  FreeInstrument,
  HomePace,
  HomeWaitingItem,
  PickUpItem,
  ProjectApprovalProgress,
} from '#/lib/home-quiet'
import { formatRelativeTime } from '#/lib/notebook-data'
import { recentStatusLabel } from '#/lib/recents'
import type { RecentItem } from '#/lib/recents'
import { cn } from '#/lib/utils'
import { rich, t } from '#/copy'

const COMING_UP_ICON: Record<
  ComingUpKind,
  { icon: IconName; className: string }
> = {
  booking: { icon: 'calendar', className: 'text-fg-muted' },
  review: { icon: 'edit', className: 'text-review' },
  expiry: { icon: 'warn', className: 'text-warning-text' },
  milestone: { icon: 'clock', className: 'text-link' },
  'planned-end': { icon: 'clock', className: 'text-link' },
}

const START_SOMETHING = [
  {
    icon: 'flask',
    label: t('projects.homeQuiet.start.experiment'),
    to: '/experiments/new',
  },
  {
    icon: 'upload',
    label: t('projects.homeQuiet.start.import'),
    to: '/import',
  },
  {
    icon: 'template',
    label: t('projects.homeQuiet.start.sheet'),
    to: '/sheets/new',
  },
  { icon: 'scan', label: t('projects.homeQuiet.start.scan'), to: '/scan' },
] as const satisfies readonly { icon: IconName; label: string; to: string }[]

/** Status tone for a resolved recent item, from the v3 palette. Record
 * statuses reuse the experiment status mapping; lifecycle objects map
 * active/archived directly. */
export function recentTone(item: Pick<RecentItem, 'kind' | 'status'>): Tone {
  if (item.kind === 'record') return experimentStatus(item.status ?? '').tone
  if (item.status === 'active') return 'progress'
  if (item.status === 'archived' || item.status === 'retired') return 'stored'
  return 'none'
}

export interface HomeQuietProps {
  /** The page header, owned by the route so its actions stay route state. */
  header: React.ReactNode
  /** Quiet or near-quiet; the busy Home is a different surface. */
  pace: Exclude<HomePace, 'busy'>
  /** The single thing waiting, for the near-quiet banner. */
  waiting: HomeWaitingItem | null
  comingUp: ComingUpGroup[]
  pickUp: PickUpItem[]
  continueWorking: RecentItem[]
  projects: ProjectApprovalProgress[]
  todayBookings: CalendarBooking[]
  freeInstruments: FreeInstrument[]
  activity: DescribedAuditEvent[]
  userId: string
  timeZone: string
}

/**
 * R5-HOME-01 — Home when nothing (or only one thing) is waiting on the person.
 * Instead of empty review and recents tables the space goes to the all-clear,
 * what is coming in the next two weeks, work that could be picked up, how the
 * person's projects stand, and a Today / Start something / Team activity
 * inspector. Every page section is omitted rather than rendered empty, and the
 * inspector says something useful in every state.
 */
export function HomeQuiet(props: HomeQuietProps) {
  const {
    header,
    pace,
    waiting,
    comingUp,
    pickUp,
    continueWorking,
    projects,
    todayBookings,
    freeInstruments,
    activity,
    userId,
    timeZone,
  } = props

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">
        {header}
        <div className="flex flex-col gap-8 px-4 pb-10 pt-2 md:px-6">
          {pace === 'quiet' ? (
            <div className="flex items-center gap-3 rounded-lg border border-border-subtle bg-success-wash px-4 py-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface text-success">
                <Icon name="check" size={16} strokeWidth={2} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {t('projects.homeQuiet.allClear.title')}
                </div>
                <div className="text-label text-fg-muted">
                  {t('projects.homeQuiet.allClear.body')}
                </div>
              </div>
              <Link to="/inbox" className="shrink-0 text-label max-sm:hidden">
                {t('projects.homeQuiet.allClear.openInbox')}
              </Link>
            </div>
          ) : waiting ? (
            <div className="flex items-center gap-3 rounded-lg border border-border-subtle bg-review-wash px-4 py-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface text-review">
                <Icon name="edit" size={16} strokeWidth={2} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {t('projects.homeQuiet.oneWaiting')}
                </div>
                <div className="text-label text-fg-muted">
                  {waiting.text} · {waiting.why}
                </div>
              </div>
              <Link to={waiting.to} className="shrink-0 text-label">
                {waiting.action}
              </Link>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <Section
              title={t('projects.homeQuiet.comingUp.title')}
              count={t('projects.homeQuiet.comingUp.count', {
                weeks: HOME_UPCOMING_DAYS / 7,
              })}
              action={
                <Link to="/schedule" className="text-label">
                  {t('projects.homeQuiet.comingUp.schedule')}
                </Link>
              }
            >
              {comingUp.length ? (
                <ol className="m-0 flex list-none flex-col p-0">
                  {comingUp.map((group) => (
                    <li
                      key={group.day}
                      className="grid grid-cols-[84px_minmax(0,1fr)] gap-3 border-b border-border-subtle py-2.5 last:border-0"
                    >
                      <span className="num text-label font-medium text-fg-muted">
                        {group.label}
                      </span>
                      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                        {group.entries.map((entry) => (
                          <li key={entry.key} className="flex gap-2">
                            <span
                              aria-hidden="true"
                              className={cn(
                                'mt-0.5 shrink-0',
                                COMING_UP_ICON[entry.kind].className,
                              )}
                            >
                              <Icon
                                name={COMING_UP_ICON[entry.kind].icon}
                                size={14}
                              />
                            </span>
                            <span className="min-w-0">
                              {entry.time ? (
                                <span className="num mr-1.5 text-fg-muted">
                                  {entry.time}
                                </span>
                              ) : null}
                              <Link
                                to={entry.to}
                                className="text-fg hover:text-link"
                              >
                                {entry.text}
                              </Link>
                              <span className="block text-label text-fg-muted">
                                {entry.why}
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="m-0 text-label text-fg-muted">
                  {t('projects.homeQuiet.comingUp.empty')}
                </p>
              )}
            </Section>

            {pickUp.length ? (
              <Section
                title={t('projects.homeQuiet.pickUp')}
                count={pickUp.length}
              >
                <ul className="m-0 flex list-none flex-col p-0">
                  {pickUp.map((item) => (
                    <li
                      key={item.key}
                      className="flex items-center gap-3 border-b border-border-subtle py-2.5 last:border-0"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate">
                          {item.identifier ? (
                            <span className="mono text-fg-muted">
                              {item.identifier}
                            </span>
                          ) : null}{' '}
                          <Link
                            to={item.to}
                            className="text-fg hover:text-link"
                          >
                            {item.title}
                          </Link>
                        </div>
                        <div className="text-label text-fg-muted">
                          {item.why}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        className="max-sm:hidden"
                        nativeButton={false}
                        render={<Link to={item.to} />}
                      >
                        {item.action}
                      </Button>
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}
          </div>

          <Section
            title={t('projects.homeQuiet.projects.title')}
            action={
              <Link to="/projects" className="text-label">
                {t('projects.homeQuiet.projects.all')}
              </Link>
            }
          >
            {projects.length ? (
              <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-3">
                {projects.map((project) => (
                  <li
                    key={project.id}
                    className="flex flex-col gap-2.5 rounded-lg border border-border bg-surface p-3.5"
                  >
                    <div>
                      <div className="flex items-center gap-2 font-medium">
                        <Dot
                          tone={
                            project.total > 0 &&
                            project.approved === project.total
                              ? 'ok'
                              : 'progress'
                          }
                        />
                        <Link
                          to="/projects/$projectId"
                          params={{ projectId: project.id }}
                          className="truncate"
                        >
                          {project.title}
                        </Link>
                      </div>
                      <div className="text-label text-fg-muted">
                        {project.stage ??
                          t('projects.homeQuiet.projects.noStage')}
                      </div>
                    </div>
                    <div>
                      <Progress
                        label={t('projects.homeQuiet.projects.approvalFor', {
                          title: project.title,
                        })}
                        value={project.approved}
                        max={project.total}
                        tone="success"
                        valueText={t('projects.homeQuiet.projects.valueText', {
                          approved: project.approved,
                          total: project.total,
                        })}
                      />
                      <div className="num mt-1.5 flex flex-wrap gap-x-3 text-label text-fg-muted">
                        <span>
                          {rich('projects.homeQuiet.projects.approved', {
                            approved: project.approved,
                            total: project.total,
                            b: (children) => (
                              <b className="font-medium text-fg">{children}</b>
                            ),
                          })}
                        </span>
                        {project.inReview ? (
                          <span>
                            {t('projects.homeQuiet.projects.inReview', {
                              count: project.inReview,
                            })}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 text-label text-fg-muted">
                {t('projects.homeQuiet.projects.empty')}
              </p>
            )}
          </Section>

          {continueWorking.length ? (
            <Section
              title={t('projects.homeQuiet.continue.title')}
              action={
                <Link to="/experiments" className="text-label">
                  {t('projects.homeQuiet.continue.all')}
                </Link>
              }
            >
              <ul className="m-0 flex list-none flex-col p-0">
                {continueWorking.map((recent) => {
                  const status = recentStatusLabel(recent)
                  return (
                    <li
                      key={`${recent.kind}:${recent.id}`}
                      className="flex items-center gap-3 border-b border-border-subtle py-2 last:border-0"
                    >
                      <div className="min-w-0 flex-1 truncate">
                        {recent.identifier ? (
                          <span className="mono text-fg-muted">
                            {recent.identifier}
                          </span>
                        ) : null}{' '}
                        <Link
                          to={recent.destination}
                          className="text-fg hover:text-link"
                        >
                          {recent.label}
                        </Link>
                      </div>
                      {status ? (
                        <Status
                          tone={recentTone(recent)}
                          className="max-sm:hidden"
                        >
                          {status}
                        </Status>
                      ) : null}
                      <span className="num w-24 shrink-0 text-right text-label text-fg-muted">
                        {formatRelativeTime(recent.lastActivityAt)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </Section>
          ) : null}
        </div>
      </div>

      <Inspector label={t('projects.homeQuiet.today.title')}>
        <InspectorSection
          title={
            <span className="flex items-baseline">
              <span className="flex-1">
                {t('projects.homeQuiet.today.title')}
              </span>
              <Link to="/schedule" className="font-normal">
                {t('projects.homeQuiet.today.fullSchedule')}
              </Link>
            </span>
          }
        >
          {todayBookings.length ? (
            <ul className="m-0 flex list-none flex-col p-0">
              {todayBookings.map((booking) => (
                <li
                  key={booking.id}
                  className="flex gap-3 border-b border-border-subtle py-2 last:border-0"
                >
                  <span className="num w-10 shrink-0 font-medium text-link">
                    {new Date(booking.startsAt).toLocaleTimeString('en-GB', {
                      timeZone,
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <div className="min-w-0">
                    <div className="font-medium">{booking.title}</div>
                    {booking.location ? (
                      <div className="text-label text-fg-muted">
                        {booking.location}
                      </div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-fg-muted">
              {t('projects.homeQuiet.today.empty')}
            </p>
          )}
          {freeInstruments.length ? (
            <>
              <div className="mt-3 text-label font-medium">
                {t('projects.homeQuiet.today.freeNow')}
              </div>
              <ul className="m-0 mt-1 flex list-none flex-col p-0">
                {freeInstruments.map((instrument) => (
                  <li
                    key={instrument.id}
                    className="flex items-center gap-2 border-b border-border-subtle py-1.5 text-label last:border-0"
                  >
                    <Dot tone="ok" />
                    <Link
                      to="/instruments/$instrumentId"
                      params={{ instrumentId: instrument.id }}
                      className="flex min-w-0 flex-1 items-center gap-1.5"
                    >
                      {instrument.displayId ? (
                        <span className="mono shrink-0 text-fg-muted">
                          {instrument.displayId}
                        </span>
                      ) : null}
                      <span className="truncate">{instrument.name}</span>
                    </Link>
                    <span className="shrink-0 text-fg-muted">
                      {instrument.label}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <Button
            size="sm"
            icon="calendar"
            className="mt-3"
            nativeButton={false}
            render={<Link to="/schedule" />}
          >
            {t('projects.homeQuiet.today.book')}
          </Button>
        </InspectorSection>

        <InspectorSection title={t('projects.homeQuiet.start.title')}>
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {START_SOMETHING.map((action) => (
              <li key={action.to}>
                <Button
                  variant="quiet"
                  icon={action.icon}
                  className="w-full justify-start"
                  nativeButton={false}
                  render={<Link to={action.to} />}
                >
                  {action.label}
                </Button>
              </li>
            ))}
          </ul>
        </InspectorSection>

        <InspectorSection title={t('projects.homeQuiet.team.title')}>
          {activity.length ? (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {collapseActivity(activity).map((item) => {
                const change = item.count > 1 ? undefined : item.changes.at(0)
                return (
                  <li key={item.event.id} className="flex gap-3">
                    <span className="num w-16 shrink-0 text-label text-fg-muted">
                      {new Date(item.event.createdAt).toLocaleTimeString(
                        'en-GB',
                        { timeZone, hour: '2-digit', minute: '2-digit' },
                      )}
                    </span>
                    <div className="min-w-0 text-label">
                      <div>
                        <b className="font-medium">
                          {item.event.actorUserId === userId
                            ? t('projects.homeQuiet.team.you')
                            : (item.event.actorName ??
                              t('projects.homeQuiet.team.system'))}
                        </b>{' '}
                        {item.action} {item.readableSubject}
                        {item.count > 1
                          ? t('projects.homeQuiet.team.times', {
                              count: item.count,
                            })
                          : ''}
                      </div>
                      {change ? (
                        <div className="text-fg-muted">
                          {change.label}:{' '}
                          {change.kind === 'changed'
                            ? `${change.from ?? '—'} → ${change.to ?? '—'}`
                            : (change.to ?? change.from ?? change.kind)}
                        </div>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="m-0 text-label text-fg-muted">
              {t('projects.homeQuiet.team.empty')}
            </p>
          )}
        </InspectorSection>
      </Inspector>
    </div>
  )
}
