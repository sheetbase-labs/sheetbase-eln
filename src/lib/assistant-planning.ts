import { z } from 'zod'

import type { CreateRepeatInput } from './recurring'
import type { ManifestLine } from './shipments'

/**
 * Planning and follow-up from the assistant: starting an experiment from a
 * template, handing work to someone or asking them, repeating a booking,
 * starting a step timer, sending and receiving shipments.
 *
 * Like booking, the model names things in the person's words, the server finds
 * them and sends back a card, and nothing happens until the person presses the
 * button. The card then calls the same RPCs the pages call, as the signed-in
 * person, so every permission and rule still applies. Signing, approving and
 * deciding stay with people and have no tool here.
 */

export const INBOX_READ_TOOL = 'sheetbase.inbox.read'
export const STEPS_READ_TOOL = 'sheetbase.steps.read'
export const SERIES_READ_TOOL = 'sheetbase.series.read'
export const PARTS_READ_TOOL = 'sheetbase.parts.read'
export const GATES_READ_TOOL = 'sheetbase.gates.read'

export const EXPERIMENT_START_TOOL = 'sheetbase.experiment.start'
export const RECORD_ASSIGN_TOOL = 'sheetbase.record.assign'
export const RECORD_ASK_TOOL = 'sheetbase.record.ask'
export const BOOKING_REPEAT_TOOL = 'sheetbase.booking.repeat'
export const TIMER_START_TOOL = 'sheetbase.timer.start'
export const SHIPMENT_SEND_TOOL = 'sheetbase.shipment.send'
export const SHIPMENT_RECEIVE_TOOL = 'sheetbase.shipment.receive'
export const STEP_DONE_TOOL = 'sheetbase.step.complete'
export const STEP_RESULT_TOOL = 'sheetbase.step.result'
export const SERIES_ADD_TOOL = 'sheetbase.series.add_member'
export const SERIES_REMOVE_TOOL = 'sheetbase.series.remove_member'
export const PART_ADD_TOOL = 'sheetbase.part.add'
export const PART_UPDATE_TOOL = 'sheetbase.part.update'
export const PART_DONE_TOOL = 'sheetbase.part.complete'
export const GATE_GO_ON_TOOL = 'sheetbase.gate.go_on'
export const PART_SIGNOFF_REQUEST_TOOL = 'sheetbase.part.request_signoff'

export const PLANNING_PROPOSE_TOOL_NAMES = [
  EXPERIMENT_START_TOOL,
  RECORD_ASSIGN_TOOL,
  RECORD_ASK_TOOL,
  BOOKING_REPEAT_TOOL,
  TIMER_START_TOOL,
  SHIPMENT_SEND_TOOL,
  SHIPMENT_RECEIVE_TOOL,
  STEP_DONE_TOOL,
  STEP_RESULT_TOOL,
  SERIES_ADD_TOOL,
  SERIES_REMOVE_TOOL,
  PART_ADD_TOOL,
  PART_UPDATE_TOOL,
  PART_DONE_TOOL,
  GATE_GO_ON_TOOL,
  PART_SIGNOFF_REQUEST_TOOL,
] as const

export type PlanningProposeToolName =
  (typeof PLANNING_PROPOSE_TOOL_NAMES)[number]

const title = z.string().min(1).max(120)
const summary = z.string().min(1).max(400)
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.')
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM.')
const named = (what: string) => z.string().min(1).max(200).describe(what)

export const inboxReadSchema = z.strictObject({
  limit: z.number().int().min(1).max(50).optional(),
})

export const stepsReadSchema = z.strictObject({
  record: named('The experiment by identifier (EXP-12) or title.'),
})

export const seriesReadSchema = z.strictObject({
  record: named(
    'The series, or any experiment in it, by identifier (EXP-12) or title.',
  ),
})

export const proposeSeriesAddSchema = z.strictObject({
  title,
  summary,
  series: named(
    'The experiment that heads the series, by identifier (EXP-12) or title. It becomes a series if it is not one yet.',
  ),
  experiment: named('The experiment to add, by identifier or title.'),
  plannedOn: day
    .optional()
    .describe('The day it is planned to run, YYYY-MM-DD. Optional.'),
})

export const proposeSeriesRemoveSchema = z.strictObject({
  title,
  summary,
  experiment: named(
    'The experiment to take out of its series, by identifier or title.',
  ),
})

export const partsReadSchema = z.strictObject({
  record: named('The experiment by identifier (EXP-12) or title.'),
})

export const gatesReadSchema = z.strictObject({
  record: named('The experiment by identifier (EXP-12) or title.'),
  part: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'Only the gates that hold this part, by its number ("4") or words from its title. Leave out for every gate of the experiment.',
    ),
})

const partWords = z
  .string()
  .min(1)
  .max(200)
  .describe(
    'The part by its number ("3", "part 3") or words from its title ("dose"). Leave out for the current part.',
  )
  .optional()

export const proposePartAddSchema = z.strictObject({
  title,
  summary,
  record: named('The experiment by identifier (EXP-12) or title.'),
  part: z.string().min(1).max(200).describe('The title of the new part.'),
  day: z
    .number()
    .int()
    .min(0)
    .max(3650)
    .optional()
    .describe(
      'The day it falls on, counted from the start of the experiment (day 0). Default: the day after the part before.',
    ),
})

export const proposePartUpdateSchema = z.strictObject({
  title,
  summary,
  record: named('The experiment by identifier (EXP-12) or title.'),
  part: partWords,
  newTitle: z.string().min(1).max(200).optional().describe('A new title.'),
  day: z.number().int().min(0).max(3650).optional(),
  assignee: named('The person who does it, by name.').optional(),
  unassign: z
    .boolean()
    .optional()
    .describe(
      'true to clear who does it: the experiment owner is told instead.',
    ),
})

export const proposePartDoneSchema = z.strictObject({
  title,
  summary,
  record: named('The experiment by identifier (EXP-12) or title.'),
  part: partWords,
  done: z
    .boolean()
    .optional()
    .describe(
      'false to reopen. Default true. Only for a part with no steps: a part with steps is done when its steps are.',
    ),
})

export const proposeGateGoOnSchema = z.strictObject({
  title,
  summary,
  record: named('The experiment by identifier (EXP-12) or title.'),
  part: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'The part that is not open yet, by its number ("4") or words from its title.',
    ),
  gate: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'Words from the name of a gate on the page, when it is a gate on the page and not a part.',
    ),
  reason: z
    .string()
    .min(1)
    .max(2000)
    .describe(
      'Why the person is going on before it is open, in their words. Ask them if they have not said. It is kept with the experiment and shown to the reviewer.',
    ),
})

export const proposePartSignoffRequestSchema = z.strictObject({
  title,
  summary,
  record: named('The experiment by identifier (EXP-12) or title.'),
  part: partWords,
  person: named(
    'The person to ask, by name: to sign a finished part, or to countersign one that is signed.',
  ),
  note: z.string().min(1).max(500).optional().describe('A line for them.'),
})

const stepWords = z
  .string()
  .min(1)
  .max(200)
  .optional()
  .describe(
    'Words from the step, such as "incubate". Leave out for the current step, the first one not yet done.',
  )

export const proposeStepDoneSchema = z.strictObject({
  title,
  summary,
  record: named('The experiment by identifier (EXP-12) or title.'),
  step: stepWords,
  done: z
    .boolean()
    .optional()
    .describe('false to reopen a finished step. Default true.'),
  note: z
    .string()
    .max(2_000)
    .optional()
    .describe('A note for the step, such as what was done differently.'),
})

export const proposeStepResultSchema = z.strictObject({
  title,
  summary,
  record: named('The experiment by identifier (EXP-12) or title.'),
  step: stepWords,
  label: z.string().min(1).max(200).describe('What was measured.'),
  value: z
    .union([z.string().min(1).max(200), z.number()])
    .describe('The measured value.'),
  unit: z.string().max(40).optional(),
})

export const proposeExperimentStartSchema = z.strictObject({
  title,
  summary,
  template: named(
    'The template as the person names it: its title or PRT number.',
  ),
  project: named('The project by name or key.'),
  experimentTitle: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'A title for the new experiment. Leave out to use the template’s.',
    ),
})

export const proposeRecordAssignSchema = z.strictObject({
  title,
  summary,
  record: named('The record by identifier (EXP-12) or title.'),
  assignee: named('The person, by name.'),
})

export const proposeRecordAskSchema = z.strictObject({
  title,
  summary,
  record: named('The record by identifier (EXP-12) or title.'),
  people: z
    .array(named('A person, by name.'))
    .min(1)
    .max(10)
    .describe('Who to mention in the comment.'),
  message: z
    .string()
    .min(1)
    .max(2_000)
    .describe(
      'The comment, written as the person would write it. Do not include an @ mention; the people are added for you.',
    ),
})

export const proposeBookingRepeatSchema = z
  .strictObject({
    title,
    summary,
    instrument: named('The instrument by name or INS number.'),
    firstDay: day.describe('The first day, YYYY-MM-DD on the person’s clock.'),
    startTime: clock,
    endTime: clock.optional(),
    durationMinutes: z.number().int().min(5).max(1_440).optional(),
    frequency: z.enum(['daily', 'weekly', 'monthly']),
    every: z
      .number()
      .int()
      .min(1)
      .max(52)
      .optional()
      .describe('Every N days, weeks or months. Default 1.'),
    weekdays: z
      .array(z.number().int().min(1).max(7))
      .min(1)
      .max(7)
      .optional()
      .describe(
        'Weekly only: 1 = Monday … 7 = Sunday. Default is the first day’s weekday.',
      ),
    count: z
      .number()
      .int()
      .min(1)
      .max(400)
      .optional()
      .describe('How many times in all.'),
    until: day.optional().describe('Or the last day.'),
    bookingTitle: z.string().min(1).max(200).optional(),
    notes: z.string().max(2_000).optional(),
  })
  .refine((value) => value.endTime !== undefined || value.durationMinutes, {
    message: 'Give an end time or a duration.',
  })
  .refine((value) => value.count !== undefined || value.until !== undefined, {
    message: 'Give how many times, or the last day.',
  })

export const proposeTimerStartSchema = z.strictObject({
  title,
  summary,
  record: named('The notebook or protocol by identifier (EXP-12) or title.'),
  step: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'Words from the step, such as "incubation". Leave out when there is one timed step.',
    ),
  minutes: z
    .number()
    .min(0.5)
    .max(10_080)
    .optional()
    .describe('Length in minutes. Leave out to use the step’s own duration.'),
})

export const proposeShipmentSendSchema = z.strictObject({
  title,
  summary,
  counterparty: named('Who it goes to, or comes from.'),
  direction: z
    .enum(['outbound', 'inbound'])
    .optional()
    .describe('Default outbound.'),
  carrier: z.string().max(120).optional(),
  trackingReference: z.string().max(120).optional(),
  expectedOn: day.optional(),
  project: z.string().min(1).max(200).optional(),
  notes: z.string().max(2_000).optional(),
  items: z
    .array(
      z
        .strictObject({
          record: z
            .string()
            .min(1)
            .max(200)
            .optional()
            .describe('A sample or record by identifier, when it is one.'),
          title: z.string().min(1).max(200).optional(),
          quantity: z.number().positive().optional(),
          unit: z.string().max(40).optional(),
          note: z.string().max(400).optional(),
        })
        .refine((item) => item.record || item.title, {
          message: 'Each item needs a record or a title.',
        }),
    )
    .min(1)
    .max(200),
  markSent: z
    .boolean()
    .optional()
    .describe('Mark it as on its way as soon as it is created. Default true.'),
})

export const proposeShipmentReceiveSchema = z.strictObject({
  title,
  summary,
  shipment: named(
    'The shipment by number (SHP-0012), or words from who it is from.',
  ),
  missing: z
    .array(z.string().min(1).max(200))
    .max(200)
    .optional()
    .describe('Items that did not arrive, by title or identifier.'),
  conditionNote: z.string().max(1_000).optional(),
})

/** What a planning card does when its button is pressed. */
export type PlanningAction =
  | {
      kind: 'experiment.start'
      templateRecordId: string
      projectId: string
      title: string | null
    }
  | {
      kind: 'record.assign'
      recordId: string
      expectedMetadataVersion: number
      userId: string
    }
  | {
      kind: 'record.comment'
      recordId: string
      body: string
      mentions: string[]
    }
  | { kind: 'booking.repeat'; input: CreateRepeatInput }
  | { kind: 'timer.start'; blockId: string; seconds: number | null }
  | { kind: 'step.done'; blockId: string; done: boolean; note: string | null }
  | {
      kind: 'part.add'
      recordId: string
      title: string
      dayOffset: number | null
    }
  | {
      kind: 'part.update'
      partId: string
      title: string | null
      dayOffset: number | null
      assigneeUserId: string | null
      clearAssignee: boolean
    }
  | { kind: 'part.done'; partId: string; done: boolean }
  | {
      kind: 'gate.go_on'
      blockId: string | null
      partId: string | null
      reason: string
    }
  | {
      kind: 'part.signoff_request'
      partId: string
      userId: string
      note: string | null
    }
  | {
      kind: 'step.result'
      blockId: string
      label: string
      value: string
      unit: string | null
    }
  | {
      kind: 'series.add'
      seriesRecordId: string
      memberRecordId: string
      plannedOn: string | null
    }
  | { kind: 'series.remove'; memberRecordId: string }
  | {
      kind: 'shipment.create'
      input: {
        direction: 'outbound' | 'inbound'
        counterparty: string
        carrier: string
        trackingReference: string
        expectedOn: string
        notes: string
        projectId: string | null
        lines: ManifestLine[]
      }
      markSent: boolean
    }
  | {
      kind: 'shipment.receive'
      shipmentId: string
      results: Array<{
        item_id: string
        received: boolean
        note: string | null
      }>
      conditionNote: string
    }

export type PlanningActionKind = PlanningAction['kind']

export function isPlanningAction(action: {
  kind: string
}): action is PlanningAction {
  return [
    'experiment.start',
    'record.assign',
    'record.comment',
    'booking.repeat',
    'timer.start',
    'step.done',
    'step.result',
    'series.add',
    'series.remove',
    'part.add',
    'part.update',
    'part.done',
    'gate.go_on',
    'part.signoff_request',
    'shipment.create',
    'shipment.receive',
  ].includes(action.kind)
}

/** What running a card gave back, for the card to link to. */
export interface PlanningActionResult {
  openHref?: string
}

// ---------------------------------------------------------------------------
// The dates a repeat falls on. Mirrors internal.recurring_dates, so the card
// shows the dates the database will make.
// ---------------------------------------------------------------------------

function isoWeekdayOf(dayText: string): number {
  const d = new Date(`${dayText}T12:00:00Z`).getUTCDay()

  return d === 0 ? 7 : d
}

function addDays(dayText: string, days: number): string {
  const date = new Date(`${dayText}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)

  return date.toISOString().slice(0, 10)
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) /
      86_400_000,
  )
}

/** The dates a repeat lands on, first to last, up to `limit`. */
export function repeatDates(input: {
  firstDay: string
  frequency: 'daily' | 'weekly' | 'monthly'
  every: number
  weekdays: number[]
  count: number | null
  until: string | null
  limit?: number
}): string[] {
  const limit = Math.min(input.count ?? 400, input.limit ?? 400)
  const out: string[] = []
  const last = input.until ?? addDays(input.firstDay, 3_660)
  const weekStart = addDays(input.firstDay, -(isoWeekdayOf(input.firstDay) - 1))

  const [fy, fm, fd] = input.firstDay.split('-').map(Number) as [
    number,
    number,
    number,
  ]

  for (
    let cursor = input.firstDay;
    cursor <= last && out.length < limit;
    cursor = addDays(cursor, 1)
  ) {
    let hit = false

    if (input.frequency === 'daily') {
      hit = daysBetween(input.firstDay, cursor) % input.every === 0
    } else if (input.frequency === 'weekly') {
      hit =
        input.weekdays.includes(isoWeekdayOf(cursor)) &&
        Math.floor(daysBetween(weekStart, cursor) / 7) % input.every === 0
    } else {
      const [cy, cm, cd] = cursor.split('-').map(Number) as [
        number,
        number,
        number,
      ]

      const monthsApart = cy * 12 + cm - (fy * 12 + fm)
      const lastOfMonth = new Date(Date.UTC(cy, cm, 0)).getUTCDate()
      hit = monthsApart % input.every === 0 && cd === Math.min(fd, lastOfMonth)
    }

    if (hit) out.push(cursor)
  }

  return out
}
