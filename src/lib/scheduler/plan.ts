/**
 * The lab scheduler's planner: where the parts of an experiment can go.
 *
 * Pure. Given the parts still to do (each with the day it was meant for, who
 * does it, how long it takes, which instruments it needs and how long to wait
 * after it), the lab's working hours, who is away, what is already booked and the
 * rules each instrument has, it lays the parts out in order and says, for every
 * slot, what stands in its way. It never books anything: a person looks at the
 * plan and accepts it (`api.accept_schedule_proposal`), and the database applies
 * the booking rules again then.
 *
 * Times are minutes since the Unix epoch, in whole minutes, so the arithmetic is
 * exact; the lab's time zone only decides where a working day starts and ends.
 */

export interface WorkingHours {
  /** IANA time zone, such as `Europe/London`. */
  timezone: string
  /** Minutes after local midnight the working day starts and ends. */
  startMinute: number
  endMinute: number
  /** ISO weekdays that are worked: 1 is Monday, 7 is Sunday. */
  days: readonly number[]
}

export const DEFAULT_HOURS: WorkingHours = {
  timezone: 'UTC',
  startMinute: 540,
  endMinute: 1020,
  days: [1, 2, 3, 4, 5],
}

export interface PlanNeed {
  resourceId: string
  resourceName: string
  minutes: number
}

export interface PlanPart {
  partId: string
  number: number
  title: string
  /** Days from the experiment's day 0. */
  dayOffset: number
  assigneeUserId: string | null
  handsOnMinutes: number
  /** How long to wait after this part before the next can start (an incubation). */
  waitAfterMinutes: number
  needs: PlanNeed[]
}

export interface Busy {
  start: number
  end: number
}

export interface ResourceRules {
  maxBookingMinutes: number | null
  maxAdvanceDays: number | null
  outOfService: boolean
}

export interface PlanInput {
  /** The calendar day (`2026-11-07`) that day 0 of the experiment falls on. */
  anchorOn: string
  /** Nothing is placed before this moment (epoch minutes). */
  notBefore: number
  hours: WorkingHours
  /** The parts still to do, in order. */
  parts: PlanPart[]
  /** What is already booked, by instrument. */
  busy: ReadonlyMap<string, readonly Busy[]>
  rules: ReadonlyMap<string, ResourceRules>
  /** Days a person is away, by user id, as `[from, to]` calendar days, inclusive. */
  absences: ReadonlyMap<string, ReadonlyArray<readonly [string, string]>>
  /** Why a person cannot book an instrument (`resourceId:userId`), such as no current qualification. */
  gaps: ReadonlyMap<string, string>
  /** Who the plan is for, when a part has no assignee. */
  requesterId: string
}

export type ConflictCode =
  | 'no_slot'
  | 'no_working_day'
  | 'max_booking_exceeded'
  | 'too_far_ahead'
  | 'out_of_service'
  | 'not_qualified'
  | 'later_than_planned'

export interface Conflict {
  code: ConflictCode
  message: string
}

export interface PlanItem {
  partId: string
  partNumber: number
  partTitle: string
  title: string
  kind: 'instrument' | 'hands_on'
  resourceId: string | null
  resourceName: string | null
  assigneeUserId: string | null
  /** ISO timestamps; null when no slot was found. */
  startsAt: string | null
  endsAt: string | null
  minutes: number
  /** The calendar day it landed on, in the lab's time zone. */
  plannedOn: string | null
  conflicts: Conflict[]
}

export interface PlanResult {
  items: PlanItem[]
  /** Conflicts that stop something being booked as proposed. `later_than_planned` is only a note. */
  conflictCount: number
}

const MAX_DAYS_SEARCHED = 90
const SLOT_STEP = 5

// ---------------------------------------------------------------------------
// Time zones
// ---------------------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(timezone: string): Intl.DateTimeFormat {
  let f = formatters.get(timezone)

  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    })
    formatters.set(timezone, f)
  }

  return f
}

interface LocalParts {
  date: string
  isoWeekday: number
  minuteOfDay: number
  asUtcMs: number
}

const WEEKDAYS = new Map<string, number>([
  ['Mon', 1],
  ['Tue', 2],
  ['Wed', 3],
  ['Thu', 4],
  ['Fri', 5],
  ['Sat', 6],
  ['Sun', 7],
])

function localParts(epochMinutes: number, timezone: string): LocalParts {
  const parts: Record<string, string> = {}

  for (const p of formatter(timezone).formatToParts(
    new Date(epochMinutes * 60_000),
  )) {
    parts[p.type] = p.value
  }

  const asUtcMs = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  )

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    isoWeekday: WEEKDAYS.get(parts.weekday) ?? 1,
    minuteOfDay: Number(parts.hour) * 60 + Number(parts.minute),
    asUtcMs,
  }
}

/** Minutes the zone is ahead of UTC at that moment. */
function offsetMinutes(epochMinutes: number, timezone: string): number {
  return Math.round(
    (localParts(epochMinutes, timezone).asUtcMs - epochMinutes * 60_000) /
      60_000,
  )
}

/** The moment a local clock time (`2026-11-07`, minute of the day) happens. */
export function localToEpoch(
  date: string,
  minuteOfDay: number,
  timezone: string,
): number {
  const [y, m, d] = date.split('-').map(Number)
  const naive = Date.UTC(y, m - 1, d, 0, minuteOfDay) / 60_000
  let guess = naive - offsetMinutes(naive, timezone)
  // Across a clock change the offset at the guess can differ; settle on it.
  guess = naive - offsetMinutes(guess, timezone)

  return guess
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)

  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

export function dayOfEpoch(epochMinutes: number, timezone: string): string {
  return localParts(epochMinutes, timezone).date
}

function isoWeekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay()

  return day === 0 ? 7 : day
}

const roundUp = (minutes: number): number =>
  Math.ceil(minutes / SLOT_STEP) * SLOT_STEP

function iso(epochMinutes: number): string {
  return new Date(epochMinutes * 60_000).toISOString()
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

function isAway(
  absences: PlanInput['absences'],
  userId: string | null,
  date: string,
): boolean {
  if (!userId) return false

  return (absences.get(userId) ?? []).some(
    ([from, to]) => date >= from && date <= to,
  )
}

/** The first moment from `from` the instrument is free for `minutes`, on this day's working hours. */
function freeSlot(
  busy: readonly Busy[],
  from: number,
  dayEnd: number,
  minutes: number,
  longNeed: boolean,
): number | null {
  let start = roundUp(from)
  const sorted = [...busy].sort((a, b) => a.start - b.start)

  for (let guard = 0; guard < sorted.length + 2; guard++) {
    const clash = sorted.find((b) => b.start < start + minutes && b.end > start)

    if (!clash) break
    start = roundUp(clash.end)
  }

  if (!longNeed && start + minutes > dayEnd) return null

  if (start >= dayEnd) return null

  return start
}

export function planSchedule(input: PlanInput): PlanResult {
  const { hours } = input
  const dayLength = hours.endMinute - hours.startMinute
  const workingDays = new Set(hours.days)
  const placed = new Map<string, Busy[]>()

  const busyFor = (resourceId: string): Busy[] => [
    ...(input.busy.get(resourceId) ?? []),
    ...(placed.get(resourceId) ?? []),
  ]

  const items: PlanItem[] = []
  let conflictCount = 0
  let cursor = input.notBefore

  for (const part of input.parts) {
    const plannedDay = addDays(input.anchorOn, part.dayOffset)
    const who = part.assigneeUserId ?? input.requesterId
    const partItems: PlanItem[] = []

    const earliestOfPart = Math.max(
      cursor,
      localToEpoch(plannedDay, hours.startMinute, hours.timezone),
    )

    let day = dayOfEpoch(earliestOfPart, hours.timezone)
    let found = false

    for (
      let tries = 0;
      tries < MAX_DAYS_SEARCHED && !found;
      tries++, day = addDays(day, 1)
    ) {
      if (!workingDays.has(isoWeekdayOf(day))) continue

      if (isAway(input.absences, part.assigneeUserId, day)) continue
      const dayStart = localToEpoch(day, hours.startMinute, hours.timezone)
      const dayEnd = localToEpoch(day, hours.endMinute, hours.timezone)
      const t = Math.max(earliestOfPart, dayStart)

      if (t >= dayEnd) continue

      // Try to fit every instrument the part needs, one after another, on this day.
      const trial: Array<{ need: PlanNeed; start: number }> = []
      let ok = true
      let at = t

      for (const need of part.needs) {
        const long = need.minutes > dayLength

        const slot = freeSlot(
          busyFor(need.resourceId),
          at,
          dayEnd,
          need.minutes,
          long,
        )

        if (slot === null) {
          ok = false
          break
        }

        trial.push({ need, start: slot })
        at = slot + need.minutes
      }

      if (!ok) continue
      // The person's own time has to fit too.
      const first = trial.length > 0 ? trial[0].start : t

      if (
        part.handsOnMinutes <= dayLength &&
        first + part.handsOnMinutes > dayEnd
      ) {
        continue
      }

      found = true

      for (const { need, start } of trial) {
        const end = start + need.minutes
        placed.set(need.resourceId, [
          ...(placed.get(need.resourceId) ?? []),
          { start, end },
        ])
        const rules = input.rules.get(need.resourceId)
        const conflicts: Conflict[] = []

        if (rules?.outOfService) {
          conflicts.push({
            code: 'out_of_service',
            message: `${need.resourceName} is out of service.`,
          })
        }

        if (
          rules?.maxBookingMinutes != null &&
          need.minutes > rules.maxBookingMinutes
        ) {
          conflicts.push({
            code: 'max_booking_exceeded',
            message: `${need.resourceName} can be booked for at most ${rules.maxBookingMinutes} minutes at a time.`,
          })
        }

        if (
          rules?.maxAdvanceDays != null &&
          start > input.notBefore + rules.maxAdvanceDays * 1440
        ) {
          conflicts.push({
            code: 'too_far_ahead',
            message: `${need.resourceName} can only be booked ${rules.maxAdvanceDays} days ahead.`,
          })
        }

        const gap = input.gaps.get(`${need.resourceId}:${who}`)

        if (gap) conflicts.push({ code: 'not_qualified', message: gap })
        partItems.push({
          partId: part.partId,
          partNumber: part.number,
          partTitle: part.title,
          title: part.title,
          kind: 'instrument',
          resourceId: need.resourceId,
          resourceName: need.resourceName,
          assigneeUserId: part.assigneeUserId,
          startsAt: iso(start),
          endsAt: iso(end),
          minutes: need.minutes,
          plannedOn: dayOfEpoch(start, hours.timezone),
          conflicts,
        })
      }

      const handsStart = first
      const handsEnd = handsStart + part.handsOnMinutes

      if (part.handsOnMinutes > 0 || partItems.length === 0) {
        partItems.push({
          partId: part.partId,
          partNumber: part.number,
          partTitle: part.title,
          title: part.title,
          kind: 'hands_on',
          resourceId: null,
          resourceName: null,
          assigneeUserId: part.assigneeUserId,
          startsAt: iso(handsStart),
          endsAt: iso(handsEnd),
          minutes: part.handsOnMinutes,
          plannedOn: day,
          conflicts: [],
        })
      }

      const lastEnd = Math.max(
        handsEnd,
        ...trial.map((x) => x.start + x.need.minutes),
      )

      cursor = lastEnd + part.waitAfterMinutes

      if (day > plannedDay) {
        const note: Conflict = {
          code: 'later_than_planned',
          message: `Planned for ${plannedDay}; the first time it can happen is ${day}.`,
        }

        for (const item of partItems) item.conflicts.push(note)
      }
    }

    if (!found) {
      const none: Conflict = part.needs.length
        ? {
            code: 'no_slot',
            message: `No time in the next ${MAX_DAYS_SEARCHED} days when ${part.needs.map((n) => n.resourceName).join(' and ')} ${part.needs.length > 1 ? 'are' : 'is'} free for this part.`,
          }
        : {
            code: 'no_working_day',
            message: `No working day in the next ${MAX_DAYS_SEARCHED} days when ${part.assigneeUserId ? 'its owner is' : 'the lab is'} in.`,
          }

      partItems.push({
        partId: part.partId,
        partNumber: part.number,
        partTitle: part.title,
        title: part.title,
        kind: part.needs.length ? 'instrument' : 'hands_on',
        resourceId: part.needs[0]?.resourceId ?? null,
        resourceName: part.needs[0]?.resourceName ?? null,
        assigneeUserId: part.assigneeUserId,
        startsAt: null,
        endsAt: null,
        minutes: part.needs[0]?.minutes ?? part.handsOnMinutes,
        plannedOn: null,
        conflicts: [none],
      })
    }

    for (const item of partItems) {
      conflictCount += item.conflicts.filter(
        (c) => c.code !== 'later_than_planned',
      ).length
    }

    items.push(...partItems)
  }

  return { items, conflictCount }
}
