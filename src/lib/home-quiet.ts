/**
 * R5-HOME-01 — the quiet Home read model.
 *
 * Home's calm states are decided by counts the ELN already serves, and every
 * row they show comes from an existing read model: `api.my_work_items` (the
 * Inbox), `api.my_notifications` (the bell), the Dataset summary RPC,
 * `calendar_bookings` with `calendar_resources` and the instrument registry
 * (ADR-0054: an instrument's calendar resource is derived from it, so a
 * booking's `resource_id` names the instrument), the person's project summaries
 * with their own experiment counts, `api.records.planned_end` and the project
 * milestones in `api.study_tasks`. Nothing here invents a second work-item
 * view, a fixture or a parallel state store.
 */
import { addDays } from './calendar'
import type { CalendarBooking, CalendarInstrument } from './calendar'
import type { DataClient } from './data-client'
import { recordDestination } from './navigation'
import type { RecentItem } from './recents'
import type { ProjectSummary } from '#/components/v3/projects/project-data'

// ---------------------------------------------------------------------------
// The pace ladder.
// ---------------------------------------------------------------------------

/**
 * The three counts that decide whether anything is waiting on the person:
 * actionable Inbox work items, Datasets with unresolved validation issues, and
 * unread notifications. They are exactly the counts Home already loads, so the
 * pace adds no read.
 */
export interface HomeWaitingCounts {
  inbox: number
  datasetsWithErrors: number
  unreadNotifications: number
}

export type HomePace = 'quiet' | 'near-quiet' | 'busy'

/**
 * The pace rule, stated once: nothing waiting is quiet; exactly one thing
 * waiting is near-quiet (Home stays calm and names it); two or more is busy and
 * Home is the work surface instead. "Waiting" spans all three authorities.
 */
export function homePace(counts: HomeWaitingCounts): HomePace {
  const waiting =
    counts.inbox + counts.datasetsWithErrors + counts.unreadNotifications
  if (waiting === 0) return 'quiet'
  if (waiting === 1) return 'near-quiet'
  return 'busy'
}

/** The single thing near-quiet names, with the reason it is there. */
export interface HomeWaitingItem {
  text: string
  /** Why this is the thing waiting on the person. */
  why: string
  action: string
  to: string
}

/**
 * Names the one thing that keeps Home out of its all-clear state, preferring
 * the most specific source the page already holds (a review, an expiring lot, a
 * flagged Dataset) over a bare count.
 */
export function homeWaitingItem(input: {
  counts: HomeWaitingCounts
  reviews: { revisionId: string; identifier: string | null }[]
  materials: {
    recordId: string | null
    identifier: string | null
    reason: string
  }[]
  datasetIssues: { id: string; identifier: string; label: string }[]
}): HomeWaitingItem | null {
  const review = input.reviews.at(0)
  if (review) {
    return {
      text: `Review ${review.identifier ?? 'a submitted record'} is due`,
      why: 'Assigned to you for review',
      action: 'Open review',
      to: `/review/${review.revisionId}`,
    }
  }
  const material = input.materials.at(0)
  if (material) {
    return {
      text: `${material.identifier ?? 'A material lot'} — ${material.reason}`,
      why: 'A lot used in your work is expiring',
      action: 'Open lot',
      to: material.recordId
        ? `/materials?selected=${material.recordId}`
        : '/materials',
    }
  }
  const dataset = input.datasetIssues.at(0)
  if (dataset) {
    return {
      text: `${dataset.identifier} — ${dataset.label}`,
      why: 'A Dataset has unresolved issues',
      action: 'Open dataset',
      to: `/datasets?dataset=${dataset.id}&archived=false`,
    }
  }
  if (input.counts.unreadNotifications === 1) {
    return {
      text: 'One unread notification',
      why: 'Something arrived for you',
      action: 'Open inbox',
      to: '/inbox',
    }
  }
  return {
    text: 'One item in your inbox',
    why: 'It needs action from you',
    action: 'Open inbox',
    to: '/inbox',
  }
}

// ---------------------------------------------------------------------------
// Coming up in the next two weeks.
// ---------------------------------------------------------------------------

export const HOME_UPCOMING_DAYS = 14

export interface HomeUpcomingWindow {
  /** ISO instants bounding timestamp sources (bookings, due dates). */
  start: string
  end: string
  /** Wall-calendar days bounding date-only sources (`records.planned_end`). */
  startDate: string
  endDate: string
}

/** ISO calendar day for an instant in a timezone (en-CA is YYYY-MM-DD). */
export function homeIsoDay(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function homeUpcomingWindow(
  now: Date,
  timeZone: string,
): HomeUpcomingWindow {
  const end = addDays(now, HOME_UPCOMING_DAYS)
  return {
    start: now.toISOString(),
    end: end.toISOString(),
    startDate: homeIsoDay(now, timeZone),
    endDate: homeIsoDay(end, timeZone),
  }
}

export type ComingUpKind =
  'booking' | 'review' | 'expiry' | 'milestone' | 'planned-end'

export interface ComingUpEntry {
  /** Stable key across renders. */
  key: string
  kind: ComingUpKind
  /** ISO instant the entry is grouped and ordered by. */
  at: string
  /** Wall-clock time when the source has one. */
  time: string | null
  text: string
  /** Why this entry is on the person's Home. */
  why: string
  to: string
}

export interface ComingUpGroup {
  /** ISO calendar day in the workspace timezone. */
  day: string
  label: string
  entries: ComingUpEntry[]
}

export interface UpcomingRecordEnd {
  id: string
  identifier: string | null
  title: string
  projectId: string | null
  /** Wall-calendar date (`records.planned_end`). */
  plannedEnd: string
}

export interface UpcomingMilestone {
  id: string
  projectId: string
  name: string
  status: string
  dueAt: string
}

/**
 * A date-only source has no time of day. Anchor it at midday UTC so that
 * grouping it in any workspace timezone still lands on its own calendar day.
 */
function dateOnlyInstant(date: string): string {
  return new Date(`${date}T12:00:00.000Z`).toISOString()
}

export function buildComingUp(input: {
  bookings: CalendarBooking[]
  resourceNames: Map<string, string>
  reviews: { revisionId: string; identifier: string | null; dueAt: string }[]
  materials: {
    recordId: string | null
    identifier: string | null
    title: string
    dueAt: string | null
    reason: string
  }[]
  plannedEnds: UpcomingRecordEnd[]
  milestones: UpcomingMilestone[]
  projectNames: Map<string, string>
  now: Date
  timeZone: string
}): ComingUpEntry[] {
  const window = homeUpcomingWindow(input.now, input.timeZone)
  const startMs = Date.parse(window.start)
  const endMs = Date.parse(window.end)
  const entries: ComingUpEntry[] = []

  for (const booking of input.bookings) {
    const at = Date.parse(booking.startsAt)
    if (Number.isNaN(at) || at < startMs || at > endMs) continue
    const resource = input.resourceNames.get(booking.resourceId)
    entries.push({
      key: `booking:${booking.id}`,
      kind: 'booking',
      at: booking.startsAt,
      time: new Date(booking.startsAt).toLocaleTimeString('en-GB', {
        timeZone: input.timeZone,
        hour: '2-digit',
        minute: '2-digit',
      }),
      text: resource ? `${resource} · ${booking.title}` : booking.title,
      why: 'You are booked',
      to: '/schedule',
    })
  }

  for (const review of input.reviews) {
    const at = Date.parse(review.dueAt)
    if (Number.isNaN(at) || at < startMs || at > endMs) continue
    entries.push({
      key: `review:${review.revisionId}`,
      kind: 'review',
      at: review.dueAt,
      time: null,
      text: `Review ${review.identifier ?? 'a submitted record'}`,
      why: 'Assigned to you for review',
      to: `/review/${review.revisionId}`,
    })
  }

  for (const material of input.materials) {
    if (!material.dueAt) continue
    const at = Date.parse(material.dueAt)
    if (Number.isNaN(at) || at < startMs || at > endMs) continue
    entries.push({
      key: `expiry:${material.recordId ?? material.identifier ?? material.title}`,
      kind: 'expiry',
      at: material.dueAt,
      time: null,
      text: `${material.identifier ?? material.title} — ${material.reason}`,
      why: 'A lot used in your work expires',
      to: material.recordId
        ? `/materials?selected=${material.recordId}`
        : '/materials',
    })
  }

  for (const milestone of input.milestones) {
    const at = Date.parse(milestone.dueAt)
    if (Number.isNaN(at) || at < startMs || at > endMs) continue
    const project = input.projectNames.get(milestone.projectId)
    entries.push({
      key: `milestone:${milestone.id}`,
      kind: 'milestone',
      at: milestone.dueAt,
      time: null,
      text: milestone.name,
      why: project ? `${project} milestone` : 'Project milestone',
      to: `/projects/${milestone.projectId}/milestones`,
    })
  }

  for (const record of input.plannedEnds) {
    if (
      record.plannedEnd < window.startDate ||
      record.plannedEnd > window.endDate
    )
      continue
    const project = record.projectId
      ? input.projectNames.get(record.projectId)
      : undefined
    entries.push({
      key: `planned-end:${record.id}`,
      kind: 'planned-end',
      at: dateOnlyInstant(record.plannedEnd),
      time: null,
      text: `Planned end of ${record.identifier ?? record.title}`,
      why: project ? `Experiment in ${project}` : 'Your experiment',
      to: recordDestination('experiment', record.id),
    })
  }

  return entries.sort((a, b) => {
    const order = a.at.localeCompare(b.at)
    return order !== 0 ? order : a.key.localeCompare(b.key)
  })
}

/** Groups entries into the workspace's calendar days, Today first. */
export function groupComingUp(
  entries: ComingUpEntry[],
  now: Date,
  timeZone: string,
): ComingUpGroup[] {
  const today = homeIsoDay(now, timeZone)
  const tomorrow = homeIsoDay(addDays(now, 1), timeZone)
  const groups = new Map<string, ComingUpGroup>()
  for (const entry of entries) {
    const day = homeIsoDay(new Date(entry.at), timeZone)
    const group = groups.get(day) ?? {
      day,
      label:
        day === today
          ? 'Today'
          : day === tomorrow
            ? 'Tomorrow'
            : new Date(entry.at)
                .toLocaleDateString('en-GB', {
                  timeZone,
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                })
                .replace('Sept', 'Sep'),
      entries: [],
    }
    group.entries.push(entry)
    groups.set(day, group)
  }
  return [...groups.values()].sort((a, b) => a.day.localeCompare(b.day))
}

// ---------------------------------------------------------------------------
// Per-project approval progress.
// ---------------------------------------------------------------------------

export interface ProjectApprovalProgress {
  id: string
  title: string
  stage: string | null
  /** The project's own experiment count, from `project_list_summary`. */
  total: number
  approved: number
  inReview: number
}

/**
 * Approval progress for one project, from the project's own record counts: the
 * experiment total the project summary already reports, plus exact counts of
 * its approved and in-review experiments.
 */
export async function fetchProjectApprovalProgress(
  client: DataClient,
  projects: Pick<
    ProjectSummary,
    'id' | 'title' | 'stage' | 'experimentCount'
  >[],
): Promise<ProjectApprovalProgress[]> {
  return Promise.all(
    projects.map(async (project) => {
      const scope =
        `?project_id=eq.${encodeURIComponent(project.id)}` +
        '&kind=eq.experiment&archived_at=is.null'
      const [approved, inReview] = await Promise.all([
        client.count('records', `${scope}&status=eq.approved`),
        client.count('records', `${scope}&status=eq.in_review`),
      ])
      return {
        id: project.id,
        title: project.title,
        stage: project.stage,
        total: project.experimentCount,
        approved,
        inReview,
      }
    }),
  )
}

// ---------------------------------------------------------------------------
// Pick something up.
// ---------------------------------------------------------------------------

export interface PickUpItem {
  key: string
  identifier: string | null
  title: string
  why: string
  action: string
  to: string
}

/** Experiment statuses that mean the person's own work is not finished. */
const UNFINISHED_RECORD_STATUS: Record<string, true> = {
  draft: true,
  planned: true,
  in_progress: true,
  paused: true,
}

/**
 * Work the person could pick up, from their own recents: records they touched
 * that are still draft, planned, in progress or on hold. Finished, submitted
 * and reviewed records stay in Continue working instead.
 */
export function pickUpItems(
  recents: RecentItem[],
  statusLabel: (item: RecentItem) => string | null,
  describeChange: (item: RecentItem) => string,
  limit = 4,
): PickUpItem[] {
  const items: PickUpItem[] = []
  for (const recent of recents) {
    if (recent.kind !== 'record') continue
    if (!recent.status || !(recent.status in UNFINISHED_RECORD_STATUS)) continue
    const label = statusLabel(recent)
    items.push({
      key: `pick-up:${recent.kind}:${recent.id}`,
      identifier: recent.identifier,
      title: recent.label,
      why: [label, describeChange(recent)].filter(Boolean).join(' · '),
      action:
        recent.status === 'draft' || recent.status === 'planned'
          ? 'Continue draft'
          : 'Open experiment',
      to: recent.destination,
    })
    if (items.length === limit) break
  }
  return items
}

/** Recents that are not pick-ups, capped for the compact Continue working list. */
export function continueWorkingItems(
  recents: RecentItem[],
  pickUp: PickUpItem[],
  limit = 3,
): RecentItem[] {
  const picked = new Set(pickUp.map((item) => item.key))
  return recents
    .filter((recent) => !picked.has(`pick-up:${recent.kind}:${recent.id}`))
    .slice(0, limit)
}

// ---------------------------------------------------------------------------
// Free instruments, for the inspector's Today section.
// ---------------------------------------------------------------------------

export interface FreeInstrument {
  id: string
  displayId: string | null
  name: string
  /** "Free until 14:00" or "Free all day". */
  label: string
}

/**
 * Instruments with no booking covering now, and when their next booking
 * starts. ADR-0054: the booking's `resource_id` IS the instrument id, so this
 * joins the registry to the same booking window the page already holds, and a
 * retired instrument is not offered.
 */
export function freeInstruments(
  instruments: CalendarInstrument[],
  bookings: CalendarBooking[],
  now: Date,
  timeZone: string,
  limit = 4,
): FreeInstrument[] {
  const nowMs = now.getTime()
  const today = homeIsoDay(now, timeZone)
  const active = bookings.filter(
    (booking) =>
      booking.status !== 'cancelled' &&
      booking.cancelledAt === null &&
      Date.parse(booking.endsAt) > nowMs,
  )
  const free: FreeInstrument[] = []
  for (const instrument of instruments) {
    if (instrument.retiredAt !== null) continue
    const covering = active.some(
      (booking) =>
        booking.resourceId === instrument.id &&
        Date.parse(booking.startsAt) <= nowMs,
    )
    if (covering) continue
    const next = active
      .filter(
        (booking) =>
          booking.resourceId === instrument.id &&
          Date.parse(booking.startsAt) > nowMs,
      )
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .at(0)
    const startsToday = next
      ? homeIsoDay(new Date(next.startsAt), timeZone) === today
      : false
    free.push({
      id: instrument.id,
      displayId: instrument.displayId,
      name: instrument.name,
      label:
        next && startsToday
          ? `Free until ${new Date(next.startsAt).toLocaleTimeString('en-GB', {
              timeZone,
              hour: '2-digit',
              minute: '2-digit',
            })}`
          : 'Free all day',
    })
    if (free.length === limit) break
  }
  return free
}

// ---------------------------------------------------------------------------
// Fetchers.
// ---------------------------------------------------------------------------

/** Unread notifications for the caller — the same authority the bell reads. */
export function fetchUnreadNotificationCount(
  client: DataClient,
): Promise<number> {
  return client.count('my_notifications', '?read_at=is.null')
}

/** Experiments in the workspace whose planned end falls inside the window. */
export async function fetchUpcomingRecordEnds(
  client: DataClient,
  workspaceId: string,
  window: HomeUpcomingWindow,
): Promise<UpcomingRecordEnd[]> {
  const rows = await client.list<{
    id: string
    identifier: string | null
    title: string
    project_id: string | null
    planned_end: string
  }>(
    'records',
    `?workspace_id=eq.${encodeURIComponent(workspaceId)}` +
      '&kind=eq.experiment&archived_at=is.null&deleted_at=is.null' +
      `&planned_end=gte.${window.startDate}&planned_end=lte.${window.endDate}` +
      '&select=id,identifier,title,project_id,planned_end' +
      '&order=planned_end.asc,id.asc&limit=50',
  )
  return rows.map((row) => ({
    id: row.id,
    identifier: row.identifier,
    title: row.title,
    projectId: row.project_id,
    plannedEnd: row.planned_end,
  }))
}

/** Milestones of the person's projects due inside the window. */
export async function fetchUpcomingMilestones(
  client: DataClient,
  projectIds: string[],
  window: HomeUpcomingWindow,
): Promise<UpcomingMilestone[]> {
  if (!projectIds.length) return []
  const rows = await client.list<{
    id: string
    project_id: string
    title: string
    status: string
    due_at: string
  }>(
    'study_tasks',
    `?project_id=in.(${projectIds.map(encodeURIComponent).join(',')})` +
      '&task_type=eq.milestone&status=neq.delivered' +
      `&due_at=gte.${encodeURIComponent(window.start)}` +
      `&due_at=lte.${encodeURIComponent(window.end)}` +
      '&select=id,project_id,title,status,due_at' +
      '&order=due_at.asc,id.asc&limit=50',
  )
  return rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    name: row.title,
    status: row.status,
    dueAt: row.due_at,
  }))
}
