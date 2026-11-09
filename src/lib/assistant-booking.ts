import { z } from 'zod'

import { cancelBooking, createBooking, editBooking } from './calendar'
import type { BenchAction } from './assistant-bench'
import type { DataClient } from './data-client'
import { isPlanningAction } from './assistant-planning'
import { isLabworkAction } from './assistant-labwork'
import type { LabworkAction } from './assistant-labwork'
import { isPlatesAction } from './assistant-plates'
import type { PlatesAction } from './assistant-plates'
import { isExtensionToolAction } from './assistant-extensions'
import type { ExtensionToolAction } from './assistant-extensions'
import { isAutomationAction } from './assistant-automation'
import type { AutomationAction } from './assistant-automation'
import { isPlannerAction } from './assistant-planner'
import type { PlannerAction } from './assistant-planner'
import { isInstrumentsAction } from './assistant-instruments'
import type { InstrumentsAction } from './assistant-instruments'
import { isQcAction } from './assistant-qc'
import type { QcAction } from './assistant-qc'
import { isUpkeepAction } from './assistant-upkeep'
import type { UpkeepAction } from './assistant-upkeep'
import type { PlanningAction, PlanningActionResult } from './assistant-planning'

/**
 * Booking an instrument from the assistant.
 *
 * The model names an instrument and a time in the person's own words and
 * clock; the server finds the instrument, checks the slot and the instrument's
 * rules, and sends back a card. Nothing is booked until the person presses
 * Book: the card then calls the same booking RPCs the Schedule page calls, as
 * the signed-in person, so the database still refuses an overlap, a missing
 * qualification or a booking that breaks a rule.
 */

export const BOOKING_CREATE_TOOL = 'sheetbase.booking.create'
export const BOOKING_MOVE_TOOL = 'sheetbase.booking.move'
export const BOOKING_CANCEL_TOOL = 'sheetbase.booking.cancel'

/** "2026-11-06T09:30": a wall-clock time on the person's own clock. */
export const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

const localDateTime = z
  .string()
  .regex(LOCAL_DATE_TIME, 'Use YYYY-MM-DDTHH:MM on the person’s clock.')

const title = z.string().min(1).max(120)
const summary = z.string().min(1).max(400)

export const proposeBookingCreateSchema = z
  .object({
    title,
    summary,
    instrument: z
      .string()
      .min(1)
      .max(200)
      .describe(
        'The instrument as the person names it: its name or INS number.',
      ),
    start: localDateTime.describe(
      'Start, YYYY-MM-DDTHH:MM on the person’s clock.',
    ),
    end: localDateTime
      .optional()
      .describe('End, YYYY-MM-DDTHH:MM. Give this or durationMinutes.'),
    durationMinutes: z.number().int().min(5).max(43_200).optional(),
    bookingTitle: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        'What the run is, as it should read on the schedule, such as "ELISA plate 4". Leave out when it is for an experiment.',
      ),
    experiment: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('The experiment it is for, by identifier (EXP-12) or name.'),
    notes: z.string().max(2_000).optional(),
  })
  .strict()
  .refine((value) => value.end !== undefined || value.durationMinutes, {
    message: 'Give an end or a duration.',
  })

export const proposeBookingMoveSchema = z
  .object({
    title,
    summary,
    bookingId: z
      .string()
      .uuid()
      .describe('The booking, from a schedule lookup.'),
    start: localDateTime.describe(
      'New start, YYYY-MM-DDTHH:MM on the person’s clock.',
    ),
    end: localDateTime
      .optional()
      .describe('New end. Leave out to keep the same length.'),
  })
  .strict()

export const proposeBookingCancelSchema = z
  .object({
    title,
    summary,
    bookingId: z
      .string()
      .uuid()
      .describe('The booking, from a schedule lookup.'),
  })
  .strict()

/**
 * What a booking card does when the person presses its button. Plain data,
 * built and checked on the server, run in the browser as the person.
 */
export type AssistantAction =
  | BenchAction
  | {
      kind: 'booking.create'
      workspaceId: string
      instrumentId: string
      title: string
      startsAt: string
      endsAt: string
      timezone: string
      notes: string | null
      linkedExperimentRecordId: string | null
    }
  | {
      kind: 'booking.move'
      bookingId: string
      startsAt: string
      endsAt: string
      expectedMetadataVersion: number
    }
  | {
      kind: 'booking.cancel'
      bookingId: string
      expectedMetadataVersion: number
    }
  | PlanningAction
  | UpkeepAction
  | PlatesAction
  | QcAction
  | InstrumentsAction
  | AutomationAction
  | PlannerAction
  | LabworkAction
  | ExtensionToolAction

export type AssistantActionKind = AssistantAction['kind']

/** Run a card's action through the ordinary booking RPCs. */
export async function runAssistantAction(
  client: DataClient,
  action: AssistantAction,
): Promise<PlanningActionResult | undefined> {
  switch (action.kind) {
    case 'booking.create':
      await createBooking(client, action.workspaceId, {
        resourceId: action.instrumentId,
        title: action.title,
        startsAt: action.startsAt,
        endsAt: action.endsAt,
        timezone: action.timezone,
        status: 'tentative',
        notes: action.notes,
        linkedExperimentRecordId: action.linkedExperimentRecordId,
      })
      return
    case 'booking.move':
      await editBooking(client, {
        bookingId: action.bookingId,
        startsAt: action.startsAt,
        endsAt: action.endsAt,
        expectedMetadataVersion: action.expectedMetadataVersion,
      })
      return
    case 'booking.cancel':
      await cancelBooking(client, {
        bookingId: action.bookingId,
        expectedMetadataVersion: action.expectedMetadataVersion,
      })
      return
    default: {
      if (isPlanningAction(action)) {
        // Planning jobs load only when a card's button is pressed.
        const { runPlanningAction } = await import('./assistant-planning-run')
        return runPlanningAction(client, action)
      }
      if (isLabworkAction(action)) {
        // Lab-work jobs load only when a card's button is pressed.
        const { runLabworkAction } = await import('./assistant-labwork-run')
        return runLabworkAction(client, action)
      }
      if (isExtensionToolAction(action)) {
        // Extension tools load only when a card's button is pressed.
        const { runExtensionToolAction } =
          await import('./assistant-extensions-run')
        return runExtensionToolAction(action)
      }
      if (isAutomationAction(action)) {
        const { runAutomationAction } =
          await import('./assistant-automation-run')
        return runAutomationAction(client, action)
      }
      if (isPlannerAction(action)) {
        const { runPlannerAction } = await import('./assistant-planner-run')
        return runPlannerAction(client, action)
      }
      if (isInstrumentsAction(action)) {
        const { runInstrumentsAction } =
          await import('./assistant-instruments-run')
        return runInstrumentsAction(client, action)
      }
      if (isQcAction(action)) {
        const { runQcAction } = await import('./assistant-qc-run')
        return runQcAction(client, action)
      }
      if (isPlatesAction(action)) {
        // Plate jobs load only when a card's button is pressed.
        const { runPlatesAction } = await import('./assistant-plates-run')
        return runPlatesAction(client, action)
      }
      if (isUpkeepAction(action)) {
        // Upkeep jobs load only when a card's button is pressed.
        const { runUpkeepAction } = await import('./assistant-upkeep-run')
        return runUpkeepAction(client, action)
      }
      // Bench jobs load only when a card's button is pressed.
      const { runBenchAction } = await import('./assistant-bench-run')
      await runBenchAction(client, action)
    }
  }
}

// ---------------------------------------------------------------------------
// Wall-clock helpers. The person thinks in their own zone; the database stores
// instants. Kept free of the browser so the server can use them.
// ---------------------------------------------------------------------------

function offsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0)
  const hour = get('hour') === 24 ? 0 : get('hour')
  return (
    Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      hour,
      get('minute'),
      get('second'),
    ) - instant.getTime()
  )
}

/** The instant a wall-clock "YYYY-MM-DDTHH:MM" names in `timeZone`. */
export function instantFromLocal(local: string, timeZone: string): Date {
  const [date, time] = local.split('T') as [string, string]
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const [hh, mm] = time.split(':').map(Number) as [number, number]
  const wall = Date.UTC(y, m - 1, d, hh, mm)
  // Two passes settle the offset either side of a clock change.
  const first = wall - offsetMs(new Date(wall), timeZone)
  return new Date(wall - offsetMs(new Date(first), timeZone))
}

/** "2026-11-06T09:30" for an instant on `timeZone`'s clock. */
export function localFromInstant(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant)
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? '00'
  const hour = get('hour') === '24' ? '00' : get('hour')
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`
}

/** "Fri 6 Nov, 09:30–11:00" for the card and the model. */
export function describeSlot(start: Date, end: Date, timeZone: string): string {
  const day = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(start)
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const sameDay =
    localFromInstant(start, timeZone).slice(0, 10) ===
    localFromInstant(end, timeZone).slice(0, 10)
  return sameDay
    ? `${day}, ${time.format(start)}–${time.format(end)}`
    : `${day}, ${time.format(start)} – ${new Intl.DateTimeFormat('en-GB', {
        timeZone,
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      }).format(end)}, ${time.format(end)}`
}

export interface BusyInterval {
  start: Date
  end: Date
}

/**
 * Free stretches of at least `minutes` inside each day's working hours,
 * earliest first, never in the past. A stretch is the whole gap ("free
 * 08:00–12:30"), so the person can pick any start inside it. Starts snap to
 * the next quarter hour so a suggestion reads like a person would book it.
 */
export function findFreeGaps(input: {
  busy: readonly BusyInterval[]
  days: readonly string[]
  dayStart: string
  dayEnd: string
  minutes: number
  timeZone: string
  now: Date
  limit?: number
}): Array<{ start: Date; end: Date }> {
  const limit = input.limit ?? 20
  const quarter = 15 * 60_000
  const length = input.minutes * 60_000
  const busy = [...input.busy].sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  )
  const gaps: Array<{ start: Date; end: Date }> = []
  for (const day of input.days) {
    const open = instantFromLocal(`${day}T${input.dayStart}`, input.timeZone)
    const close = instantFromLocal(`${day}T${input.dayEnd}`, input.timeZone)
    let cursor = Math.max(open.getTime(), input.now.getTime())
    for (const interval of [
      ...busy.filter(
        (b) =>
          b.end.getTime() > open.getTime() &&
          b.start.getTime() < close.getTime(),
      ),
      { start: close, end: close },
    ]) {
      const snapped = Math.ceil(cursor / quarter) * quarter
      const gapEnd = Math.min(interval.start.getTime(), close.getTime())
      if (gapEnd - snapped >= length) {
        gaps.push({ start: new Date(snapped), end: new Date(gapEnd) })
        if (gaps.length >= limit) return gaps
      }
      cursor = Math.max(cursor, interval.end.getTime())
    }
  }
  return gaps
}
