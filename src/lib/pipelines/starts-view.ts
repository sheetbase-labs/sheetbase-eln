/**
 * What the Starts and runs tab works out from a pipeline's starts and rules:
 * the next planned starts, a test of the rules against the last days, and the
 * week timeline. Pure and browser safe; the tab supplies the rows.
 */
import { nextRunAt, specBindings } from '#/lib/pipeline-schedule'
import type { CronSpec, DailySpec, IntervalSpec } from '#/lib/pipeline-schedule'
import { dateTimeFormat } from '#/lib/intl-cache'
import type { PipelineScheduleWire } from '#/lib/pipelines/types'

import { judgeStart } from './start-rules'
import type { StartRules } from './start-rules'

/** What a stored start is, as a person names it. */
export type StartKind = 'snapshot' | 'event' | 'schedule'

export function startKind(
  schedule: Pick<PipelineScheduleWire, 'kind' | 'spec'>,
): StartKind {
  if (schedule.kind !== 'event') return 'schedule'

  const type = schedule.spec.eventType

  return type === 'dataset.versioned' || type === 'dataset_version_created'
    ? 'snapshot'
    : 'event'
}

type TimedSchedule = Pick<
  PipelineScheduleWire,
  'id' | 'kind' | 'spec' | 'enabled'
>

type TimedSpec = IntervalSpec | DailySpec | CronSpec

function timedSpec(spec: PipelineScheduleWire['spec']): TimedSpec {
  // SAFETY: `nextRunAt` validates the spec and returns null for one it cannot read.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- same reason.
  return Object.assign({}, spec) as unknown as TimedSpec
}

/** Each time a timed schedule fires from `from`, oldest first, up to `to`. */
export function occurrences(
  schedule: TimedSchedule,
  from: Date,
  to: Date,
  limit = 400,
): Date[] {
  if (schedule.kind === 'event') return []
  const out: Date[] = []
  let cursor = from

  while (out.length < limit) {
    const next = nextRunAt(schedule.kind, timedSpec(schedule.spec), cursor)

    if (!next || next.getTime() > to.getTime()) break
    out.push(next)
    cursor = next
  }

  return out
}

/** Does this start read an input only when it changed (so it may skip)? */
export function readsOnlyChanged(
  schedule: Pick<PipelineScheduleWire, 'spec'>,
): boolean {
  const bindings = specBindings(schedule.spec)

  return Object.values(bindings).some((b) => b.mode === 'incremental')
}

export interface NextStart {
  at: Date
  scheduleId: string
  /** `outside`: the hours rule would skip it. */
  state: 'planned' | 'outside'
  /** Only starts if an input changed since the last run. */
  onlyIfChanged: boolean
}

/** The next planned timed starts across every enabled schedule, soonest first. */
export function nextStarts(
  schedules: readonly TimedSchedule[],
  rules: StartRules,
  now: Date,
  count = 3,
): NextStart[] {
  const horizon = new Date(now.getTime() + 60 * 86_400_000)

  return schedules
    .filter((s) => s.enabled && s.kind !== 'event')
    .flatMap((s) =>
      occurrences(s, now, horizon, count * 4).map((at): NextStart => ({
        at,
        scheduleId: s.id,
        state: judgeStart(rules, { at, source: 'schedule' }).pass
          ? 'planned'
          : 'outside',
        onlyIfChanged: readsOnlyChanged(s),
      })),
    )
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, count)
}

export interface StartEvent {
  scheduleId: string
  eventId: string
  at: Date
  /** What it was, for the log: `DS-0311 S-15`. */
  label: string
  newRows: number
}

export interface PreviewRow {
  at: Date
  source: 'event' | 'schedule'
  label: string | null
  outcome: 'start' | 'batched' | 'skipped'
  reason: 'window' | 'rows' | null
  newRows: number | null
  /** Earlier snapshots a start took with it. */
  joined: number
}

export interface PreviewResult {
  rows: PreviewRow[]
  wouldStart: number
  wouldSkip: number
  batched: number
}

/**
 * What the rules would have done over the last `days`: every scheduled tick
 * and every snapshot a start heard, judged by the hours and the row condition,
 * with snapshots that arrived within the wait of each other joining one run.
 * It does not know which runs were going at the time, so it cannot show an
 * overlap skip.
 */
export function previewStarts(input: {
  schedules: readonly TimedSchedule[]
  events: readonly StartEvent[]
  rules: StartRules
  now: Date
  days: number
}): PreviewResult {
  const { rules, now } = input
  const since = new Date(now.getTime() - input.days * 86_400_000)
  const rows: PreviewRow[] = []

  for (const schedule of input.schedules) {
    if (!schedule.enabled) continue

    for (const at of occurrences(schedule, since, now)) {
      const verdict = judgeStart(rules, { at, source: 'schedule' })

      rows.push({
        at,
        source: 'schedule',
        label: null,
        outcome: verdict.pass ? 'start' : 'skipped',
        reason: verdict.pass ? null : verdict.condition,
        newRows: null,
        joined: 0,
      })
    }
  }

  const waitMs = rules.waitMinutes * 60_000
  const byStart = new Map<string, StartEvent[]>()

  for (const event of [...input.events].sort(
    (a, b) => a.at.getTime() - b.at.getTime(),
  )) {
    byStart.set(event.scheduleId, [
      ...(byStart.get(event.scheduleId) ?? []),
      event,
    ])
  }

  for (const events of byStart.values()) {
    let group: StartEvent[] = []

    const flush = () => {
      if (group.length === 0) return
      const last = group[group.length - 1]
      const newRows = group.reduce((sum, e) => sum + e.newRows, 0)
      const at = new Date(last.at.getTime() + waitMs)
      const verdict = judgeStart(rules, { at, source: 'event', newRows })

      for (const earlier of group.slice(0, -1)) {
        rows.push({
          at: earlier.at,
          source: 'event',
          label: earlier.label,
          outcome: 'batched',
          reason: null,
          newRows: earlier.newRows,
          joined: 0,
        })
      }

      rows.push({
        at: last.at,
        source: 'event',
        label: last.label,
        outcome: verdict.pass ? 'start' : 'skipped',
        reason: verdict.pass ? null : verdict.condition,
        newRows,
        joined: group.length - 1,
      })
      group = []
    }

    for (const event of events) {
      const previous = group.at(-1)

      if (previous && event.at.getTime() - previous.at.getTime() >= waitMs)
        flush()
      group.push(event)
    }

    flush()
  }

  rows.sort((a, b) => b.at.getTime() - a.at.getTime())

  return {
    rows,
    wouldStart: rows.filter((r) => r.outcome === 'start').length,
    wouldSkip: rows.filter((r) => r.outcome === 'skipped').length,
    batched: rows.filter((r) => r.outcome === 'batched').length,
  }
}

// ---------------------------------------------------------------------------
// The week timeline.
// ---------------------------------------------------------------------------

export type DotKind = 'ok' | 'wait' | 'bad' | 'skip' | 'live'

export interface TimelineItem {
  id: string
  at: Date
  kind: DotKind
  /** The run it stands for; skipped starts have none. */
  runId: string | null
  /** A short mark shown beside it, such as `#149`. */
  label?: string
}

export interface TimelineDay {
  key: string
  weekday: string
  day: number
  today: boolean
  items: (TimelineItem & { fraction: number })[]
}

const dayParts = (at: Date, timeZone: string) => {
  const parts = dateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)

  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0)

  return {
    key: `${get('year')}-${String(get('month')).padStart(2, '0')}-${String(get('day')).padStart(2, '0')}`,
    day: get('day'),
    minutes: get('hour') * 60 + get('minute'),
  }
}

/** The last `days` days, oldest first, each with its dots placed by time of day. */
export function buildTimeline(input: {
  items: readonly TimelineItem[]
  now: Date
  days: number
  timeZone: string
}): TimelineDay[] {
  const out: TimelineDay[] = []

  for (let back = input.days - 1; back >= 0; back -= 1) {
    const at = new Date(input.now.getTime() - back * 86_400_000)
    const { key, day } = dayParts(at, input.timeZone)

    out.push({
      key,
      day,
      weekday: dateTimeFormat('en-GB', {
        timeZone: input.timeZone,
        weekday: 'short',
      }).format(at),
      today: back === 0,
      items: [],
    })
  }

  const byKey = new Map(out.map((day) => [day.key, day]))

  for (const item of [...input.items].sort(
    (a, b) => a.at.getTime() - b.at.getTime(),
  )) {
    const { key, minutes } = dayParts(item.at, input.timeZone)
    byKey.get(key)?.items.push({ ...item, fraction: minutes / 1440 })
  }

  return out
}
