/**
 * Repeating work: an instrument booked every week, an experiment started from a
 * template each month, a stability study pulled at fixed time points.
 *
 * A repeat is a schedule the database keeps. It makes the real bookings and
 * experiments (see `api.materialise_recurring_schedule`), so every booking and
 * experiment rule still applies; this module is the client's read of it, the
 * RPC wrappers, and the plain-words description of a rule.
 */
import { t } from '#/copy'
import type { DataClient } from './data-client'

export type RepeatKind = 'booking' | 'experiment'

export type RepeatStatus = 'active' | 'paused' | 'ended'

export type RepeatFrequency = 'daily' | 'weekly' | 'monthly' | 'offsets'

export interface RepeatScheduleWire {
  id: string
  kind: RepeatKind
  title: string
  status: RepeatStatus
  frequency: RepeatFrequency
  interval_count: number
  weekdays: number[] | null
  offsets_days: number[] | null
  starts_on: string
  ends_on: string | null
  max_occurrences: number | null
  timezone: string
  resource_id: string | null
  start_time: string | null
  end_time: string | null
  notebook_template_id: string | null
  lead_days: number
  project_id: string | null
  created_by_user_id: string
  created_at: string
}

export interface RepeatSchedule {
  id: string
  kind: RepeatKind
  title: string
  status: RepeatStatus
  frequency: RepeatFrequency
  intervalCount: number
  weekdays: number[]
  offsetsDays: number[]
  startsOn: string
  endsOn: string | null
  maxOccurrences: number | null
  timezone: string
  resourceId: string | null
  /** HH:MM in the schedule's time zone. */
  startTime: string | null
  endTime: string | null
  notebookTemplateId: string | null
  leadDays: number
  projectId: string | null
  createdByUserId: string
  createdAt: string
}

export interface RepeatOccurrenceWire {
  schedule_id: string
  occurrence_on: string
  outcome: 'created' | 'skipped' | 'failed'
  message: string | null
}

export interface RepeatOccurrence {
  scheduleId: string
  on: string
  outcome: 'created' | 'skipped' | 'failed'
  message: string | null
}

const hhmm = (value: string | null) => (value ? value.slice(0, 5) : null)

export function toRepeatSchedule(wire: RepeatScheduleWire): RepeatSchedule {
  return {
    id: wire.id,
    kind: wire.kind,
    title: wire.title,
    status: wire.status,
    frequency: wire.frequency,
    intervalCount: wire.interval_count,
    weekdays: [...(wire.weekdays ?? [])].sort((a, b) => a - b),
    offsetsDays: [...(wire.offsets_days ?? [])].sort((a, b) => a - b),
    startsOn: wire.starts_on,
    endsOn: wire.ends_on,
    maxOccurrences: wire.max_occurrences,
    timezone: wire.timezone,
    resourceId: wire.resource_id,
    startTime: hhmm(wire.start_time),
    endTime: hhmm(wire.end_time),
    notebookTemplateId: wire.notebook_template_id,
    leadDays: wire.lead_days,
    projectId: wire.project_id,
    createdByUserId: wire.created_by_user_id,
    createdAt: wire.created_at,
  }
}

export function toRepeatOccurrence(
  wire: RepeatOccurrenceWire,
): RepeatOccurrence {
  return {
    scheduleId: wire.schedule_id,
    on: wire.occurrence_on,
    outcome: wire.outcome,
    message: wire.message,
  }
}

// ---------------------------------------------------------------------------
// The repeat form: what a person picks, and what the database is asked for.
// ---------------------------------------------------------------------------

export interface RepeatForm {
  frequency: 'none' | 'daily' | 'weekly' | 'monthly'
  interval: number
  /** ISO weekdays: 1 = Monday … 7 = Sunday. */
  weekdays: number[]
  endMode: 'count' | 'date'
  count: number
  until: string
}

export const NO_REPEAT: RepeatForm = {
  frequency: 'none',
  interval: 1,
  weekdays: [],
  endMode: 'count',
  count: 8,
  until: '',
}

/** ISO weekday (1 = Monday … 7 = Sunday) of a `YYYY-MM-DD` day. */
export function isoWeekday(day: string): number {
  const d = new Date(`${day}T12:00:00Z`).getUTCDay()

  return d === 0 ? 7 : d
}

/** The first thing wrong with a repeat, in words, or `null` when it is sound. */
export function repeatFormError(
  form: RepeatForm,
  firstDay: string,
): string | null {
  if (form.frequency === 'none') return null

  if (
    !Number.isInteger(form.interval) ||
    form.interval < 1 ||
    form.interval > 52
  )
    return t('projects.recurring.errors.interval')

  if (form.frequency === 'weekly' && form.weekdays.length === 0)
    return t('projects.recurring.errors.weekdays')

  if (form.endMode === 'count') {
    if (!Number.isInteger(form.count) || form.count < 1 || form.count > 400)
      return t('projects.recurring.errors.count')
  } else if (!form.until || form.until < firstDay) {
    return t('projects.recurring.errors.until')
  }

  return null
}

export interface CreateRepeatInput {
  kind: RepeatKind
  title: string
  startsOn: string
  timezone: string
  frequency: RepeatFrequency
  interval?: number
  weekdays?: number[] | null
  offsetsDays?: number[] | null
  endsOn?: string | null
  maxOccurrences?: number | null
  resourceId?: string | null
  startTime?: string | null
  endTime?: string | null
  notebookTemplateId?: string | null
  leadDays?: number
  projectId?: string | null
  notes?: string | null
}

/** What making a repeat did: how many were made now, and what could not be. */
export interface RepeatResult {
  created: number
  skipped: number
  failed: number
  problems: { on: string; code: string; message: string }[]
}

export async function createRepeat(
  client: DataClient,
  input: CreateRepeatInput,
): Promise<{ schedule: RepeatSchedule; result: RepeatResult }> {
  const made = await client.rpc<{
    schedule: RepeatScheduleWire
    result: RepeatResult
  }>('create_recurring_schedule', {
    p_kind: input.kind,
    p_title: input.title,
    p_frequency: input.frequency,
    p_starts_on: input.startsOn,
    p_timezone: input.timezone,
    p_interval_count: input.interval ?? 1,
    p_weekdays: input.weekdays ?? null,
    p_offsets_days: input.offsetsDays ?? null,
    p_ends_on: input.endsOn ?? null,
    p_max_occurrences: input.maxOccurrences ?? null,
    p_resource_id: input.resourceId ?? null,
    p_start_time: input.startTime ?? null,
    p_end_time: input.endTime ?? null,
    p_notebook_template_id: input.notebookTemplateId ?? null,
    p_lead_days: input.leadDays ?? 0,
    p_project_id: input.projectId ?? null,
    p_notes: input.notes ?? null,
  })

  return { schedule: toRepeatSchedule(made.schedule), result: made.result }
}

/** The end of a repeat from the form: a count or a last day, never both. */
export function repeatFormToRule(
  form: RepeatForm,
): Pick<
  CreateRepeatInput,
  'frequency' | 'interval' | 'weekdays' | 'endsOn' | 'maxOccurrences'
> {
  if (form.frequency === 'none') throw new Error('not a repeat')

  return {
    frequency: form.frequency,
    interval: form.interval,
    weekdays: form.frequency === 'weekly' ? form.weekdays : null,
    endsOn: form.endMode === 'date' ? form.until : null,
    maxOccurrences: form.endMode === 'count' ? form.count : null,
  }
}

export async function fetchRepeatSchedules(
  client: DataClient,
  kind: RepeatKind,
): Promise<RepeatSchedule[]> {
  const rows = await client.list<RepeatScheduleWire>(
    'recurring_schedules',
    `?kind=eq.${kind}&order=created_at.desc&limit=100`,
  )

  return rows.map(toRepeatSchedule)
}

export async function setRepeatPaused(
  client: DataClient,
  scheduleId: string,
  paused: boolean,
): Promise<void> {
  await client.rpc('set_recurring_schedule_paused', {
    p_schedule_id: scheduleId,
    p_paused: paused,
  })
}

export async function endRepeat(
  client: DataClient,
  scheduleId: string,
  cancelUpcoming: boolean,
): Promise<{ cancelled: number }> {
  return client.rpc<{ cancelled: number }>('end_recurring_schedule', {
    p_schedule_id: scheduleId,
    p_cancel_upcoming: cancelUpcoming,
  })
}

// ---------------------------------------------------------------------------
// Words.
// ---------------------------------------------------------------------------

function listWords(items: string[]): string {
  return new Intl.ListFormat('en', {
    style: 'long',
    type: 'conjunction',
  }).format(items)
}

/** "Every week on Mon and Wed", "Days 0, 7 and 30 after the start". */
export function describeRepeatRule(schedule: {
  frequency: RepeatFrequency
  intervalCount: number
  weekdays: number[]
  offsetsDays: number[]
  startsOn: string
}): string {
  const every = schedule.intervalCount

  switch (schedule.frequency) {
    case 'daily':
      return every === 1
        ? t('projects.recurring.summary.daily')
        : t('projects.recurring.summary.dailyEvery', { count: every })
    case 'weekly': {
      const days = listWords(
        schedule.weekdays.map((d) =>
          t(
            `projects.recurring.weekdaysShort.${d}` as 'projects.recurring.weekdaysShort.1',
          ),
        ),
      )

      return every === 1
        ? t('projects.recurring.summary.weekly', { days })
        : t('projects.recurring.summary.weeklyEvery', { count: every, days })
    }

    case 'monthly': {
      const day = Number(schedule.startsOn.slice(8, 10))

      return every === 1
        ? t('projects.recurring.summary.monthly', { day })
        : t('projects.recurring.summary.monthlyEvery', { count: every, day })
    }

    case 'offsets':
      return t('projects.recurring.summary.offsets', {
        days: listWords(schedule.offsetsDays.map(String)),
      })
  }
}

/** The rule and where it stops: "Every week on Mon, 8 times". */
export function describeRepeat(
  schedule: Parameters<typeof describeRepeatRule>[0] & {
    endsOn: string | null
    maxOccurrences: number | null
  },
  formatDate: (day: string) => string = (day) => day,
): string {
  const rule = describeRepeatRule(schedule)

  if (schedule.frequency === 'offsets') return rule

  const ends =
    schedule.maxOccurrences != null
      ? schedule.maxOccurrences === 1
        ? t('projects.recurring.summary.endsOnce')
        : t('projects.recurring.summary.endsAfter', {
            count: schedule.maxOccurrences,
          })
      : schedule.endsOn
        ? t('projects.recurring.summary.endsOn', {
            date: formatDate(schedule.endsOn),
          })
        : null

  return ends
    ? t('projects.recurring.summary.joined', { repeat: rule, ends })
    : rule
}

/** Why an occurrence wasn't made, in a scientist's words. */
export function describeNotMade(message: string | null): string {
  const code = message?.split(':', 1)[0]?.trim()

  switch (code) {
    case 'SB020':
      return t('projects.recurring.dialog.reasons.clash')
    case 'SB115':
      return t('projects.recurring.dialog.reasons.unqualified')
    case 'SB116':
      return t('projects.recurring.dialog.reasons.calibration')
    case 'SB135':
      return t('projects.recurring.dialog.reasons.outOfService')
    case 'SB142':
      return t('projects.recurring.dialog.reasons.training')
    case 'SB143':
      return t('projects.recurring.dialog.reasons.tooLong')
    case 'SB144':
      return t('projects.recurring.dialog.reasons.tooFar')
    case 'SB090':
      return t('projects.recurring.dialog.reasons.noVersion')
    default:
      return t('projects.recurring.dialog.reasons.generic')
  }
}

/** One sentence on what making a repeat did, for the toast. */
export function describeRepeatResult(
  kind: RepeatKind,
  result: RepeatResult,
): string {
  const notMade = result.skipped + result.failed
  const parts: string[] = []

  if (kind === 'booking') {
    parts.push(
      t('projects.recurring.result.bookings', { count: result.created }),
    )
  } else if (result.created > 0) {
    parts.push(
      t('projects.recurring.result.experiments', { count: result.created }),
    )
  } else {
    parts.push(t('projects.recurring.result.scheduled'))
  }

  if (notMade > 0)
    parts.push(t('projects.recurring.result.notMade', { count: notMade }))

  return parts.join(' ')
}
