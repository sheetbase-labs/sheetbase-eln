/**
 * The trigger form's model: what a person picks, turned into the spec the
 * database stores and back again. Pure, so the mapping is tested without a
 * browser; the dialog only renders it.
 *
 * The presets are sugar over four stored kinds: "every N" is `interval`,
 * "every day" is `daily`, and weekdays, weekly and monthly are written as
 * `cron` so one stored shape carries every calendar rule. Reading a stored
 * cron back recognises those shapes and falls back to "Custom".
 */
import { describeCron, parseCron } from './pipeline-cron'
import {
  PIPELINE_TRIGGER_EVENTS,
  specBindings,
  specTimeZone,
  validateScheduleSpec,
} from './pipeline-schedule'
import type {
  InputBinding,
  MissedRunPolicy,
  PipelineScheduleKind,
} from './pipeline-schedule'
import { now as appNow } from '#/lib/clock'

export type Repeat =
  'interval' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'cron' | 'event'

export const REPEAT_LABELS: Record<Repeat, string> = {
  interval: 'Every few minutes or hours',
  daily: 'Every day',
  weekdays: 'Every weekday',
  weekly: 'Every week',
  monthly: 'Every month',
  cron: 'Custom (cron expression)',
  event: 'When something happens',
}

export const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

export type IntervalUnit = 'minutes' | 'hours' | 'days'

const UNIT_MINUTES: Record<IntervalUnit, number> = {
  minutes: 1,
  hours: 60,
  days: 1440,
}

/** How a pipeline input picks its Dataset Version in the form. */
export type InputMode = 'latest' | 'incremental' | 'pinned' | 'event'

export interface InputDraft {
  mode: InputMode
  datasetId: string
  versionId: string
}

export interface ScheduleDraft {
  repeat: Repeat
  intervalValue: string
  intervalUnit: IntervalUnit
  /** HH:MM, for daily, weekdays, weekly and monthly. */
  time: string
  weekday: number
  monthDay: string
  cron: string
  timeZone: string
  eventType: string
  datasetId: string
  instrumentId: string
  /** The input that receives the version an event delivered. */
  inputName: string
  inputs: Record<string, InputDraft | undefined>
  parameters: Record<string, string>
  missedRunPolicy: MissedRunPolicy
}

export function emptyDraft(timeZone: string): ScheduleDraft {
  return {
    repeat: 'daily',
    intervalValue: '1',
    intervalUnit: 'hours',
    time: '09:00',
    weekday: 1,
    monthDay: '1',
    cron: '0 9 * * 1-5',
    timeZone,
    eventType: 'dataset.versioned',
    datasetId: '',
    instrumentId: '',
    inputName: '',
    inputs: {},
    parameters: {},
    missedRunPolicy: 'run_once',
  }
}

const EVENT_LABELS: Record<string, string> = {
  'dataset.versioned': 'A Dataset gets a new version',
  'dataset.created': 'A Dataset is created',
  'dataset.updated': 'A Dataset is edited',
  'dataset.archived': 'A Dataset is archived',
  'dataset.restored': 'A Dataset is restored',
  'record.created': 'A record is created',
  'record.updated': 'A record is edited',
  'record.moved': 'A record is moved',
  'record.deleted': 'A record is deleted',
  'record.archived': 'A record is archived',
  'record.restored': 'A record is restored',
  'sheet.created': 'A Sheet is created',
  'sheet.updated': 'A Sheet is edited',
  'sheet.archived': 'A Sheet is archived',
  'sheet.restored': 'A Sheet is restored',
  'sheet.definition.created': 'A Sheet definition is created',
  'sheet.definition.updated': 'A Sheet definition is edited',
  'sheet.definition.versioned': 'A Sheet definition gets a new version',
  'notebook.submitted': 'A notebook is submitted for review',
  'review.decided': 'A review is decided',
  'notebook.signed': 'A notebook is signed',
  'notebook.template.created': 'A notebook template is created',
  'notebook.template.updated': 'A notebook template is edited',
  'notebook.template.versioned': 'A notebook template gets a new version',
  'pipeline.run.completed': 'A pipeline run finishes',
  'pipeline.run.created': 'A pipeline run starts',
  'pipeline.run.updated': 'A pipeline run changes',
}

/**
 * An event in the words a scientist uses. A name the table does not know is
 * spelled out ("sheet.row.moved" becomes "Sheet row moved") rather than shown
 * as a code.
 */
export function eventLabel(name: string): string {
  const known = EVENT_LABELS[name]
  if (known) return known
  const words = name.replace(/[._]+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : name
}

/** How a run was started, in words, for lists and headers. */
export function triggerLabel(kind: string): string {
  switch (kind) {
    case 'manual':
      return 'By hand'
    case 'scheduled':
      return 'On a schedule'
    case 'event':
      return 'When something happened'
    case 'webhook':
      return 'By a webhook'
    default:
      return kind
  }
}

/** Every event a trigger can listen for, as `[name, label]`. */
export function eventOptions(): Array<[string, string]> {
  return PIPELINE_TRIGGER_EVENTS.map((name) => [name, eventLabel(name)])
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function splitTime(time: string): [number, number] | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time.trim())
  return match ? [Number(match[1]), Number(match[2])] : null
}

function cronFor(draft: ScheduleDraft): string {
  const at = splitTime(draft.time)
  const minute = at ? at[1] : 0
  const hour = at ? at[0] : 0
  if (draft.repeat === 'weekdays') return `${minute} ${hour} * * 1-5`
  if (draft.repeat === 'weekly') {
    return `${minute} ${hour} * * ${draft.weekday}`
  }
  if (draft.repeat === 'monthly') {
    return `${minute} ${hour} ${Number(draft.monthDay)} * *`
  }
  return draft.cron.trim()
}

/** What the draft would store, ready for the create or update RPC. */
export function draftToSchedule(
  draft: ScheduleDraft,
  declaredInputs: string[],
  parameterValues: Record<string, unknown>,
): { kind: PipelineScheduleKind; spec: Record<string, unknown> } {
  const spec: Record<string, unknown> = {}
  let kind: PipelineScheduleKind
  const zone = draft.timeZone.trim() || 'UTC'
  if (draft.repeat === 'interval') {
    kind = 'interval'
    spec.intervalMinutes =
      Number(draft.intervalValue) * UNIT_MINUTES[draft.intervalUnit]
  } else if (draft.repeat === 'daily') {
    kind = 'daily'
    spec.dailyAt = draft.time.trim()
    spec.timeZone = zone
  } else if (draft.repeat === 'event') {
    kind = 'event'
    spec.eventType = draft.eventType
    if (draft.datasetId && draft.eventType === 'dataset.versioned') {
      spec.datasetId = draft.datasetId
    }
    if (draft.instrumentId && draft.eventType === 'dataset.versioned') {
      spec.instrumentId = draft.instrumentId
    }
    if (draft.inputName && draft.eventType === 'dataset.versioned') {
      spec.inputName = draft.inputName
    }
  } else {
    kind = 'cron'
    spec.cron = cronFor(draft)
    spec.timeZone = zone
  }

  const inputs: Record<string, InputBinding> = {}
  for (const name of declaredInputs) {
    const input: InputDraft | undefined = draft.inputs[name]
    if (!input || input.mode === 'event') continue
    if (input.mode === 'pinned') {
      inputs[name] = { mode: 'pinned', versionId: input.versionId }
    } else {
      inputs[name] = { mode: input.mode, datasetId: input.datasetId }
    }
  }
  if (Object.keys(inputs).length > 0) spec.inputs = inputs
  if (Object.keys(parameterValues).length > 0) spec.parameters = parameterValues
  spec.missedRunPolicy = draft.missedRunPolicy
  return { kind, spec }
}

/** The first thing wrong with a draft, in words a person can act on. */
export function draftError(
  draft: ScheduleDraft,
  declaredInputs: string[],
): string | null {
  if (draft.repeat === 'interval') {
    const minutes =
      Number(draft.intervalValue) * UNIT_MINUTES[draft.intervalUnit]
    if (
      !Number.isInteger(Number(draft.intervalValue)) ||
      minutes < 1 ||
      minutes > 525_600
    ) {
      return 'Enter a whole number for how often it runs, up to a year.'
    }
  }
  if (
    ['daily', 'weekdays', 'weekly', 'monthly'].includes(draft.repeat) &&
    !splitTime(draft.time)
  ) {
    return 'Enter the time of day as HH:MM.'
  }
  if (draft.repeat === 'monthly') {
    const day = Number(draft.monthDay)
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      return 'Choose a day of the month from 1 to 31.'
    }
  }
  if (draft.repeat === 'cron' && parseCron(draft.cron) === null) {
    return 'A cron expression has five fields: minute, hour, day of month, month, day of week.'
  }
  if (draft.repeat !== 'event' && draft.repeat !== 'interval') {
    // Zone is checked through the same validator the database mirrors.
    const { kind, spec } = draftToSchedule(draft, declaredInputs, {})
    const problem = validateScheduleSpec(kind, spec)
    if (problem && /timeZone/.test(problem.message)) {
      return 'Enter a valid time zone, e.g. Europe/London.'
    }
    if (problem && /never fires/.test(problem.message)) {
      return 'That cron expression never fires.'
    }
  }
  for (const name of declaredInputs) {
    const input: InputDraft | undefined = draft.inputs[name]
    if (!input || input.mode === 'event') continue
    if (input.mode === 'pinned' && !input.versionId) {
      return `Choose which Dataset Version ${name} reads.`
    }
    if (input.mode !== 'pinned' && !input.datasetId) {
      return `Choose which Dataset ${name} follows.`
    }
  }
  return null
}

/** The draft for a stored trigger, for editing it. */
export function scheduleToDraft(
  schedule: { kind: PipelineScheduleKind; spec: Record<string, unknown> },
  declaredInputs: string[],
  fallbackZone: string,
): ScheduleDraft {
  const { kind, spec } = schedule
  const draft = emptyDraft(
    typeof spec.timeZone === 'string' && spec.timeZone
      ? spec.timeZone
      : fallbackZone,
  )
  if (kind === 'interval') {
    draft.repeat = 'interval'
    const minutes = Number(spec.intervalMinutes)
    if (minutes % 1440 === 0) {
      draft.intervalUnit = 'days'
      draft.intervalValue = String(minutes / 1440)
    } else if (minutes % 60 === 0) {
      draft.intervalUnit = 'hours'
      draft.intervalValue = String(minutes / 60)
    } else {
      draft.intervalUnit = 'minutes'
      draft.intervalValue = String(minutes)
    }
  } else if (kind === 'daily') {
    draft.repeat = 'daily'
    draft.time = typeof spec.dailyAt === 'string' ? spec.dailyAt : draft.time
    // A daily trigger stored before zones were explicit ran on UTC.
    draft.timeZone =
      typeof spec.timeZone === 'string' && spec.timeZone ? spec.timeZone : 'UTC'
  } else if (kind === 'cron') {
    const cron = typeof spec.cron === 'string' ? spec.cron : ''
    draft.repeat = 'cron'
    draft.cron = cron
    const fields = parseCron(cron)
    if (
      fields &&
      fields.minutes.length === 1 &&
      fields.hours.length === 1 &&
      fields.months.length === 12
    ) {
      const time = `${pad(fields.hours[0])}:${pad(fields.minutes[0])}`
      if (fields.anyDayOfMonth && fields.daysOfWeek.join() === '1,2,3,4,5') {
        draft.repeat = 'weekdays'
        draft.time = time
      } else if (fields.anyDayOfMonth && fields.daysOfWeek.length === 1) {
        draft.repeat = 'weekly'
        draft.time = time
        draft.weekday = fields.daysOfWeek[0]
      } else if (fields.anyDayOfWeek && fields.daysOfMonth.length === 1) {
        draft.repeat = 'monthly'
        draft.time = time
        draft.monthDay = String(fields.daysOfMonth[0])
      }
    }
  } else {
    draft.repeat = 'event'
    draft.eventType =
      typeof spec.eventType === 'string' ? spec.eventType : draft.eventType
    draft.datasetId = typeof spec.datasetId === 'string' ? spec.datasetId : ''
    draft.instrumentId =
      typeof spec.instrumentId === 'string' ? spec.instrumentId : ''
    draft.inputName = typeof spec.inputName === 'string' ? spec.inputName : ''
  }
  const bound =
    kind === 'event' && draft.eventType === 'dataset.versioned'
      ? draft.inputName || declaredInputs[0]
      : undefined
  const bindings = specBindings(spec)
  for (const name of declaredInputs) {
    if (name === bound) {
      draft.inputs[name] = { mode: 'event', datasetId: '', versionId: '' }
    } else if (!(name in bindings)) {
      draft.inputs[name] = { mode: 'latest', datasetId: '', versionId: '' }
    } else {
      const binding = bindings[name]
      draft.inputs[name] =
        binding.mode === 'pinned'
          ? { mode: 'pinned', datasetId: '', versionId: binding.versionId }
          : { mode: binding.mode, datasetId: binding.datasetId, versionId: '' }
    }
  }
  if (spec.parameters && typeof spec.parameters === 'object') {
    for (const [name, value] of Object.entries(spec.parameters)) {
      draft.parameters[name] = String(value)
    }
  }
  draft.missedRunPolicy = spec.missedRunPolicy === 'skip' ? 'skip' : 'run_once'
  return draft
}

/** A stored trigger in plain words, or `—` when this build cannot read it. */
export function describeSchedule(
  kind: PipelineScheduleKind,
  spec: Record<string, unknown>,
  datasetNames: Map<string, string>,
): string {
  if (kind === 'interval') {
    const minutes = spec.intervalMinutes
    if (typeof minutes !== 'number' || !Number.isFinite(minutes)) return '—'
    if (minutes >= 1440 && minutes % 1440 === 0) {
      return minutes === 1440 ? 'Every day' : `Every ${minutes / 1440} days`
    }
    if (minutes >= 60 && minutes % 60 === 0) {
      return minutes === 60 ? 'Every hour' : `Every ${minutes / 60} hours`
    }
    return minutes === 1 ? 'Every minute' : `Every ${minutes} minutes`
  }
  if (kind === 'daily') {
    const at = spec.dailyAt
    if (typeof at !== 'string' || !at) return '—'
    return `Daily at ${at} (${specTimeZone(spec)})`
  }
  if (kind === 'cron') {
    const cron = spec.cron
    if (typeof cron !== 'string' || parseCron(cron) === null) return '—'
    return `${describeCron(cron)} (${specTimeZone(spec)})`
  }
  const eventType = spec.eventType
  if (typeof eventType !== 'string' || !eventType) return '—'
  const datasetId = typeof spec.datasetId === 'string' ? spec.datasetId : null
  if (!datasetId) return eventLabel(eventType)
  return `${eventLabel(eventType)} · ${datasetNames.get(datasetId) ?? 'Dataset no longer readable'}`
}

/**
 * What each input reads, one phrase per input: the line under a trigger that
 * says whether it follows the latest data or sits on a fixed version.
 */
export function describeInputs(
  spec: Record<string, unknown>,
  datasetNames: Map<string, string>,
): string[] {
  const phrases: string[] = []
  for (const [name, binding] of Object.entries(specBindings(spec))) {
    if (binding.mode === 'pinned') {
      phrases.push(`${name}: a fixed Dataset Version`)
      continue
    }
    const dataset = datasetNames.get(binding.datasetId) ?? 'a Dataset'
    phrases.push(
      binding.mode === 'latest'
        ? `${name}: latest version of ${dataset}`
        : `${name}: new versions of ${dataset} only`,
    )
  }
  return phrases
}

/** Parameter values a trigger passes, as `name=value` pairs. */
export function describeParameters(spec: Record<string, unknown>): string {
  const parameters = spec.parameters
  if (!parameters || typeof parameters !== 'object') return ''
  return Object.entries(parameters as Record<string, unknown>)
    .map(([name, value]) => `${name}=${String(value)}`)
    .join(', ')
}

/** "in 3 h", "2 d ago": how far an instant is from now, for a quick read. */
export function relativeTime(iso: string, now: Date = appNow()): string {
  const diff = Date.parse(iso) - now.getTime()
  if (Number.isNaN(diff)) return ''
  const abs = Math.abs(diff)
  const minutes = Math.round(abs / 60_000)
  let amount: string
  if (minutes < 1) return diff >= 0 ? 'any moment' : 'just now'
  if (minutes < 60) amount = `${minutes} min`
  else if (minutes < 60 * 48) amount = `${Math.round(minutes / 60)} h`
  else amount = `${Math.round(minutes / 1440)} d`
  return diff >= 0 ? `in ${amount}` : `${amount} ago`
}
