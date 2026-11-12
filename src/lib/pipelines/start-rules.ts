/**
 * Start rules: what sits across all of a pipeline's starts (new snapshots, a
 * webhook, schedules). Stored on the pipeline as `start_rules`; read by the
 * scheduler, the webhook, the Starts and runs tab and its "Test against the
 * last 7 days". Pure and browser safe, so all of them judge a start the same
 * way. `api.normalise_pipeline_start_rules` in the database checks the same
 * shape on the way in.
 */
import { z } from 'zod'

import { dateTimeFormat } from '#/lib/intl-cache'

export const WINDOW_DAYS = ['daily', 'weekdays', 'weekends'] as const

export type WindowDays = (typeof WINDOW_DAYS)[number]

export const CONDITION_MATCHES = ['all', 'any'] as const
export const MISSED_RUNS = ['run_once', 'skip'] as const

const hhmm = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/)

export const startWindowSchema = z.object({
  days: z.enum(WINDOW_DAYS),
  from: hhmm,
  to: hhmm,
  timeZone: z.string().min(1),
})

export const startRulesSchema = z.object({
  conditionsMatch: z.enum(CONDITION_MATCHES).default('all'),
  window: startWindowSchema.nullable().default(null),
  minNewRows: z.number().int().min(1).max(1_000_000).nullable().default(null),
  waitMinutes: z.number().int().min(0).max(1440).default(0),
  whileRunning: z.literal('skip').default('skip'),
  missedRuns: z.enum(MISSED_RUNS).default('run_once'),
})

export type StartRules = z.infer<typeof startRulesSchema>

export type StartWindow = z.infer<typeof startWindowSchema>

/** No extra rules: every start starts a run. */
export const DEFAULT_START_RULES: StartRules = startRulesSchema.parse({})

/** What stored rules mean; anything unreadable counts as no extra rules. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Stored JSON is decoded here before any field is read.
export function parseStartRules(raw: unknown): StartRules {
  const parsed = startRulesSchema.safeParse(raw ?? {})

  return parsed.success ? parsed.data : DEFAULT_START_RULES
}

/** Where a start came from. */
export type StartSource = 'event' | 'schedule' | 'webhook'

export type StartVerdict =
  { pass: true } | { pass: false; condition: 'window' | 'rows'; reason: string }

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** Weekday (0 = Sunday) and minutes since midnight at `at` in `timeZone`. */
export interface LocalClock {
  weekday: number
  minutes: number
}

export function localClock(at: Date, timeZone: string): LocalClock {
  const parts = dateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)

  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? ''

  const name = get('weekday')
  const weekday = DAY_NAMES.findIndex((day) => day === name)

  return {
    weekday: weekday < 0 ? 0 : weekday,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  }
}

const toMinutes = (hhmmValue: string) => {
  const [h, m] = hhmmValue.split(':').map(Number)

  return h * 60 + m
}

/** Is `at` inside the window (days, hours, zone)? Opens inclusive, closes exclusive. */
export function inStartWindow(window: StartWindow, at: Date): boolean {
  const { weekday, minutes } = localClock(at, window.timeZone)
  const weekend = weekday === 0 || weekday === 6

  if (window.days === 'weekdays' && weekend) return false

  if (window.days === 'weekends' && !weekend) return false

  return minutes >= toMinutes(window.from) && minutes < toMinutes(window.to)
}

export interface StartContext {
  at: Date
  source: StartSource
  /** Rows the snapshot added; only snapshot events have one. */
  newRows?: number | null
}

/**
 * Do the conditions let this start through? The window judges every start;
 * the row condition judges snapshot events and lets a schedule or a webhook
 * through. With "all", every condition that applies must hold; with "any",
 * one is enough.
 */
export function judgeStart(rules: StartRules, ctx: StartContext): StartVerdict {
  const failures: Extract<StartVerdict, { pass: false }>[] = []
  let applied = 0

  if (rules.window) {
    applied += 1

    if (!inStartWindow(rules.window, ctx.at)) {
      failures.push({
        pass: false,
        condition: 'window',
        reason: 'Outside the hours it may start',
      })
    }
  }

  if (
    rules.minNewRows !== null &&
    ctx.newRows !== undefined &&
    ctx.newRows !== null
  ) {
    applied += 1

    if (ctx.newRows < rules.minNewRows) {
      failures.push({
        pass: false,
        condition: 'rows',
        reason: `Fewer than ${rules.minNewRows} new rows`,
      })
    }
  }

  if (applied === 0) return { pass: true }

  if (rules.conditionsMatch === 'any')
    return failures.length < applied ? { pass: true } : failures[0]

  return failures[0] ?? { pass: true }
}

/** Has the newest event waited long enough? `waitMinutes` of 0 never waits. */
export function batchIsReady(
  rules: StartRules,
  lastEventAt: Date,
  now: Date,
): boolean {
  return (
    rules.waitMinutes <= 0 ||
    now.getTime() - lastEventAt.getTime() >= rules.waitMinutes * 60_000
  )
}
