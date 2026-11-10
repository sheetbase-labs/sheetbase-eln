/**
 * AUTO-02 / EVENT-03 — Pipeline schedule math (pure, deterministic).
 *
 * Four trigger kinds:
 *   - interval: every N minutes
 *   - daily: at a fixed HH:MM wall-clock time in an explicit IANA zone
 *   - cron: a 5-field cron expression in an explicit IANA zone (the form's
 *     weekly, weekday and monthly presets are written as cron)
 *   - event: catalogue domain events, evaluated by the server sweep
 *     against the durable change_events stream since last_evaluated_sequence
 *
 * Event triggers reference the canonical catalogue names from
 * `./event-catalogue` (e.g. `dataset.versioned`, `record.created`). Wire
 * aliases and the pre-catalogue `dataset_version_created` name are accepted
 * at the intake boundary and normalize to the canonical name, which is what
 * is stored. The triggerable set is every stable catalogue entry with a
 * producer in the record/dataset/sheet/notebook families — the data-change
 * signals that merit automation.
 *
 * The database mirrors this logic in api.pipeline_schedule_next_run so the
 * RPCs can stamp next_run_at at create/update time; this module is used by
 * the scheduler sweep and its unit tests.
 */

import { z } from 'zod'
import { nextCronAfter, parseCron } from './pipeline-cron'
import {
  EVENT_CATALOGUE,
  eventByName,
  resolveEventAlias,
} from './event-catalogue'
import type { EventCatalogueEntry, PayloadCondition } from './event-catalogue'
import { dateTimeFormat } from '#/lib/intl-cache'

export type PipelineScheduleKind = 'interval' | 'daily' | 'cron' | 'event'

/**
 * How a trigger chooses the Dataset Version a pipeline input reads.
 *   - pinned: one exact version, every run (reproducible, never moves)
 *   - latest: the Dataset's newest version when the run starts
 *   - incremental: as latest, but the run only happens when the Dataset has a
 *     version newer than the last one this trigger processed (the watermark),
 *     so a daily trigger over a Dataset that did not change does nothing
 */
export type InputBinding =
  | { mode: 'pinned'; versionId: string }
  | { mode: 'latest'; datasetId: string }
  | { mode: 'incremental'; datasetId: string }

export const INPUT_BINDING_MODES = ['pinned', 'latest', 'incremental'] as const

/**
 * What a trigger does about runs it missed (the server was down at the
 * scheduled time, or events arrived while it was paused):
 *   - run_once: catch up with one run (events: process what is waiting)
 *   - skip: do nothing for what was missed and carry on from now
 */
export type MissedRunPolicy = 'run_once' | 'skip'

export const MISSED_RUN_POLICIES = ['run_once', 'skip'] as const

/** A timed run later than this after its due time counts as missed. */
export const MISSED_RUN_GRACE_MINUTES = 5

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const INPUT_NAME_RE = /^[a-z][a-z0-9_]{0,47}$/

/** Pre-catalogue name for `dataset.versioned`, accepted at the intake boundary. */
export const LEGACY_DATASET_VERSION_EVENT = 'dataset_version_created' as const

/** Catalogue families whose stable events can trigger pipelines. */
const TRIGGERABLE_FAMILY = new Set(['record', 'dataset', 'notebook', 'sheet'])

/**
 * A stable event can trigger a pipeline when its family is triggerable, or
 * when the catalogue marks it a pipeline consumer. An event that shares its
 * producer pair with others and is told apart by a payload test (`when`) is a
 * trigger only when the catalogue marks it a pipeline consumer; the sweep
 * applies the test.
 */
function isTriggerable(entry: EventCatalogueEntry): boolean {
  if (entry.producer?.when !== undefined) return entry.consumers.pipeline

  return TRIGGERABLE_FAMILY.has(entry.family) || entry.consumers.pipeline
}

/** Fields every trigger kind shares. */
export interface ScheduleSpecCommon {
  parameters?: Record<string, z.core.util.JSONType>
  /** Legacy fixed inputs; `inputs` bindings win where both name an input. */
  inputVersions?: Record<string, string>
  inputs?: Record<string, InputBinding>
  missedRunPolicy?: MissedRunPolicy
}

export interface IntervalSpec extends ScheduleSpecCommon {
  intervalMinutes: number
}

export interface DailySpec extends ScheduleSpecCommon {
  dailyAt: string // HH:MM
  /** Explicit IANA time zone (default 'UTC'); never the server local zone. */
  timeZone?: string
}

export interface CronSpec extends ScheduleSpecCommon {
  /** Five fields: minute hour day-of-month month day-of-week. */
  cron: string
  /** Explicit IANA time zone (default 'UTC'); never the server local zone. */
  timeZone?: string
}

export interface EventSpec extends ScheduleSpecCommon {
  /** Canonical catalogue event name (e.g. `dataset.versioned`). */
  eventType: string
  /**
   * Optional filter, meaningful only for `dataset.versioned`: only versions
   * of this Dataset trigger the pipeline. Ignored for other events.
   */
  datasetId?: string | null
  /**
   * Optional filter, meaningful only for `dataset.versioned`: only versions
   * made by an import from this instrument trigger the pipeline.
   */
  instrumentId?: string | null
  /** Which pipeline input receives the triggering event's entity uuid. */
  inputName?: string
}

/**
 * Normalize a trigger event name to its canonical catalogue name, or null
 * when it is not a triggerable event. Accepts canonical names, wire aliases
 * and the legacy `dataset_version_created` name.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Stored and HTTP event names enter here untrusted; decode the string before resolving catalogue aliases.
export function normalizeTriggerEventName(name: unknown): string | null {
  const parsed = z.string().min(1).safeParse(name)

  if (!parsed.success) return null

  const canonical =
    parsed.data === LEGACY_DATASET_VERSION_EVENT
      ? 'dataset.versioned'
      : resolveEventAlias(parsed.data)

  const entry = eventByName(canonical)

  if (!entry || entry.name !== canonical) return null

  if (entry.status !== 'stable' || entry.producer === null) return null

  if (!isTriggerable(entry)) return null

  return entry.name
}

/** Every canonical event name a pipeline event trigger can subscribe to. */
export const PIPELINE_TRIGGER_EVENTS: readonly string[] = Object.freeze(
  EVENT_CATALOGUE.filter(
    (entry) =>
      entry.status === 'stable' &&
      entry.producer !== null &&
      isTriggerable(entry),
  ).map((entry) => entry.name),
)

/**
 * Producer pair behind a trigger event name, or null when the name is not a
 * triggerable catalogue event. The sweep derives its change_events filter
 * from this — never from a hardcoded entity_type/operation pair.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This stored-event lookup immediately delegates raw name decoding to the canonical normalizer before accessing producer metadata.
export function producerForTriggerEvent(name: unknown): {
  entityType: string
  operation: string
  /** Narrows the pair to this event: a payload key that must (or must not) equal a value. */
  when?: PayloadCondition
} | null {
  const canonical = normalizeTriggerEventName(name)

  if (canonical === null) return null
  const producer = eventByName(canonical)?.producer

  if (!producer) return null

  const result: NonNullable<ReturnType<typeof producerForTriggerEvent>> = {
    entityType: producer.entityType,
    operation: producer.operation,
  }

  if (producer.when) result.when = producer.when

  return result
}

export const DAILY_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/

export type ScheduleSpecError = { message: string } | null

const scheduleEnvelope = z.object({
  intervalMinutes: z.unknown().optional(),
  dailyAt: z.unknown().optional(),
  cron: z.unknown().optional(),
  timeZone: z.unknown().optional(),
  eventType: z.unknown().optional(),
  datasetId: z.unknown().optional(),
  instrumentId: z.unknown().optional(),
  inputName: z.unknown().optional(),
  missedRunPolicy: z.unknown().optional(),
  parameters: z.unknown().optional(),
  inputs: z.unknown().optional(),
})

const inputBindingEnvelope = z.object({
  mode: z.unknown().optional(),
  versionId: z.unknown().optional(),
  datasetId: z.unknown().optional(),
})

// Validate the container without cloning away own keys such as __proto__.
const objectContainer = z.custom<object>(
  (value) => z.record(z.string(), z.unknown()).safeParse(value).success,
)

const timeZoneSchema = z.string().refine(isIanaTimeZone).nullish()
const uuidSchema = z.string().regex(UUID_RE)

export function validateScheduleSpec(
  kind: PipelineScheduleKind,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- HTTP and stored schedule specs are decoded immediately, then each field is validated in the established diagnostic order.
  spec: unknown,
): ScheduleSpecError {
  const parsed = scheduleEnvelope.safeParse(spec)

  if (!parsed.success) {
    return { message: 'schedule spec must be an object' }
  }

  const record = parsed.data
  const common = validateCommonSpec(kind, record)

  if (common) return common

  if (kind === 'interval') {
    if (
      !z.number().int().min(1).max(525_600).safeParse(record.intervalMinutes)
        .success
    ) {
      return {
        message: 'intervalMinutes must be an integer between 1 and 525600',
      }
    }

    return null
  }

  if (kind === 'daily') {
    if (!z.string().regex(DAILY_RE).safeParse(record.dailyAt).success) {
      return { message: 'dailyAt must be an HH:MM time' }
    }

    if (!timeZoneSchema.safeParse(record.timeZone).success) {
      return { message: 'timeZone must be a valid IANA time zone name' }
    }

    return null
  }

  if (kind === 'cron') {
    const cron = z
      .string()
      .refine((value) => parseCron(value) !== null)
      .safeParse(record.cron)

    if (!cron.success) {
      return {
        message:
          'cron must be five fields: minute hour day-of-month month day-of-week',
      }
    }

    if (!timeZoneSchema.safeParse(record.timeZone).success) {
      return { message: 'timeZone must be a valid IANA time zone name' }
    }

    if (nextCronAfter(cron.data, zoneOf(record), new Date()) === null) {
      return { message: 'cron never fires' }
    }

    return null
  }

  // kind === 'event' (the only remaining kind). Canonical catalogue names
  // are stored; wire aliases and the legacy dataset_version_created name are
  // accepted here and normalized by the writer (the RPC rewrites the spec).
  if (normalizeTriggerEventName(record.eventType) === null) {
    return { message: 'eventType must be a triggerable catalogue event name' }
  }

  if (!z.string().nullish().safeParse(record.datasetId).success) {
    return { message: 'datasetId must be a Dataset id or null' }
  }

  if (!uuidSchema.nullish().safeParse(record.instrumentId).success) {
    return { message: 'instrumentId must be an instrument id or null' }
  }

  if (
    !z.string().regex(INPUT_NAME_RE).nullish().safeParse(record.inputName)
      .success
  ) {
    return { message: 'inputName must be a valid input identifier' }
  }

  return null
}

function zoneOf(record: { timeZone?: unknown }): string {
  const zone = z.string().min(1).safeParse(record.timeZone)

  return zone.success ? zone.data : 'UTC'
}

/**
 * The parts of a spec every kind shares: input bindings, the missed-run
 * policy and parameters. Mirrors api.validate_pipeline_schedule_spec so a
 * spec the page accepts is one the database accepts.
 */
function validateCommonSpec(
  kind: PipelineScheduleKind,
  record: z.infer<typeof scheduleEnvelope>,
): ScheduleSpecError {
  if (
    !z.enum(MISSED_RUN_POLICIES).nullish().safeParse(record.missedRunPolicy)
      .success
  ) {
    return { message: 'missedRunPolicy must be run_once or skip' }
  }

  if (!objectContainer.nullish().safeParse(record.parameters).success) {
    return { message: 'parameters must be an object' }
  }

  if (record.inputs === undefined || record.inputs === null) return null

  const inputs = objectContainer.safeParse(record.inputs)

  if (!inputs.success) {
    return { message: 'inputs must be an object' }
  }

  for (const [name, raw] of Object.entries(inputs.data)) {
    if (!INPUT_NAME_RE.test(name)) {
      return { message: `input ${name} is not a valid input identifier` }
    }

    const parsedBinding = inputBindingEnvelope.safeParse(raw)

    if (!parsedBinding.success) {
      return { message: `input ${name} needs a binding` }
    }

    const binding = parsedBinding.data

    if (binding.mode === 'pinned') {
      if (!uuidSchema.safeParse(binding.versionId).success) {
        return { message: `input ${name} needs a Dataset Version to pin` }
      }
    } else if (binding.mode === 'latest' || binding.mode === 'incremental') {
      if (!uuidSchema.safeParse(binding.datasetId).success) {
        return { message: `input ${name} needs a Dataset` }
      }

      if (binding.mode === 'incremental' && kind === 'event') {
        return {
          message: `input ${name}: an event trigger already runs only on new data`,
        }
      }
    } else {
      return { message: `input ${name} has an unknown mode` }
    }
  }

  return null
}

/** The bindings a spec declares, with legacy `inputVersions` read as pinned. */
export function specBindings(spec: ScheduleSpecCommon) {
  const bindings = Object.fromEntries(
    Object.entries(spec.inputVersions ?? {}).flatMap(
      ([name, versionId]): Array<[string, InputBinding]> => {
        const parsed = z.string().safeParse(versionId)

        return parsed.success
          ? [[name, { mode: 'pinned', versionId: parsed.data }]]
          : []
      },
    ),
  )

  return { ...bindings, ...spec.inputs }
}

/** The zone a timed spec runs on (explicit, default UTC). */
export function specTimeZone(spec: { timeZone?: unknown }): string {
  return zoneOf(spec)
}

/** Next wall-clock occurrence for interval/daily/cron schedules. */
export function nextRunAt(
  kind: 'interval' | 'daily' | 'cron',
  spec: IntervalSpec | DailySpec | CronSpec,
  from: Date,
): Date | null {
  const error = validateScheduleSpec(kind, spec)

  if (error) return null

  if (kind === 'cron') {
    const cron = z
      .object({ cron: z.string(), timeZone: z.string().nullish() })
      .safeParse(spec)

    if (!cron.success) return null

    const zone = cron.data.timeZone ?? 'UTC'

    return isIanaTimeZone(zone)
      ? nextCronAfter(cron.data.cron, zone, from)
      : null
  }

  if (kind === 'interval') {
    const interval = z.object({ intervalMinutes: z.number() }).safeParse(spec)

    return interval.success
      ? new Date(from.getTime() + interval.data.intervalMinutes * 60_000)
      : null
  }

  // daily — next wall-clock occurrence in the explicit IANA zone
  const daily = z
    .object({ dailyAt: z.string(), timeZone: z.string().nullish() })
    .safeParse(spec)

  if (!daily.success) return null

  const zone = daily.data.timeZone ?? 'UTC'

  if (!isIanaTimeZone(zone)) return null

  return nextDailyInZone(from, daily.data.dailyAt, zone)
}

interface ZonedClock {
  y: number
  mo: number
  d: number
  /** Offset of the zone at the instant: wall-clock-as-UTC minus the instant. */
  offsetMs: number
}

function zonedParts(at: Date, zone: string): ZonedClock {
  const parts = dateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(at)

  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0)

  const hour = get('hour') % 24

  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    hour,
    get('minute'),
    get('second'),
  )

  return {
    y: get('year'),
    mo: get('month'),
    d: get('day'),
    offsetMs: asUtc - at.getTime(),
  }
}

function nextDailyInZone(from: Date, dailyAt: string, zone: string): Date {
  const [hour, minute] = dailyAt.split(':').map(Number)
  const now = zonedParts(from, zone)

  const candidate =
    Date.UTC(now.y, now.mo - 1, now.d, hour, minute) - now.offsetMs

  if (candidate <= from.getTime()) {
    // Tomorrow, with the offset re-probed so DST transitions are respected.
    const tomorrow = zonedParts(new Date(from.getTime() + 86_400_000), zone)

    return new Date(
      Date.UTC(tomorrow.y, tomorrow.mo - 1, tomorrow.d, hour, minute) -
        tomorrow.offsetMs,
    )
  }

  return new Date(candidate)
}

/** The next `count` run times, for the form's preview. */
export function upcomingRuns(
  kind: 'interval' | 'daily' | 'cron',
  spec: IntervalSpec | DailySpec | CronSpec,
  from: Date,
  count: number,
): Date[] {
  const runs: Date[] = []
  let cursor = from

  for (let i = 0; i < count; i += 1) {
    const next = nextRunAt(kind, spec, cursor)

    if (!next) break
    runs.push(next)
    cursor = next
  }

  return runs
}

const IANA_TZ_RE = /^(?:[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+|UTC|GMT)$/

export function isIanaTimeZone(value: string): boolean {
  if (!IANA_TZ_RE.test(value)) return false

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })

    return true
  } catch {
    return false
  }
}
