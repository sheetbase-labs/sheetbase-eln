/**
 * AUTO-02 / EVENT-03 — Pipeline schedule math (pure, deterministic).
 *
 * v1 supports three trigger kinds:
 *   - interval: every N minutes
 *   - daily: at a fixed HH:MM wall-clock time (server local time zone)
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

import {
  EVENT_CATALOGUE,
  eventByName,
  resolveEventAlias,
} from './event-catalogue'

export type PipelineScheduleKind = 'interval' | 'daily' | 'event'

/** Pre-catalogue name for `dataset.versioned`, accepted at the intake boundary. */
export const LEGACY_DATASET_VERSION_EVENT = 'dataset_version_created' as const

/** Catalogue families whose stable events can trigger pipelines. */
const TRIGGERABLE_FAMILY: Record<string, true | undefined> = {
  record: true,
  dataset: true,
  notebook: true,
  sheet: true,
}

export interface IntervalSpec {
  intervalMinutes: number
  parameters?: Record<string, unknown>
  inputVersions?: Record<string, string>
}

export interface DailySpec {
  dailyAt: string // HH:MM
  /** Explicit IANA time zone (default 'UTC'); never the server local zone. */
  timeZone?: string
  parameters?: Record<string, unknown>
  inputVersions?: Record<string, string>
}

export interface EventSpec {
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
  /** Fixed inputs for the pipeline's other inputs. */
  inputVersions?: Record<string, string>
  parameters?: Record<string, unknown>
}

/**
 * Normalize a trigger event name to its canonical catalogue name, or null
 * when it is not a triggerable event. Accepts canonical names, wire aliases
 * and the legacy `dataset_version_created` name.
 */
export function normalizeTriggerEventName(name: unknown): string | null {
  if (typeof name !== 'string' || name.length === 0) return null
  const canonical =
    name === LEGACY_DATASET_VERSION_EVENT
      ? 'dataset.versioned'
      : resolveEventAlias(name)
  const entry = eventByName(canonical)
  if (!entry || entry.name !== canonical) return null
  if (entry.status !== 'stable' || entry.producer === null) return null
  if (TRIGGERABLE_FAMILY[entry.family] !== true) return null
  return entry.name
}

/** Every canonical event name a pipeline event trigger can subscribe to. */
export const PIPELINE_TRIGGER_EVENTS: readonly string[] = Object.freeze(
  EVENT_CATALOGUE.filter(
    (entry) =>
      entry.status === 'stable' &&
      entry.producer !== null &&
      TRIGGERABLE_FAMILY[entry.family] === true,
  ).map((entry) => entry.name),
)

/**
 * Producer pair behind a trigger event name, or null when the name is not a
 * triggerable catalogue event. The sweep derives its change_events filter
 * from this — never from a hardcoded entity_type/operation pair.
 */
export function producerForTriggerEvent(
  name: unknown,
): { entityType: string; operation: string } | null {
  const canonical = normalizeTriggerEventName(name)
  if (canonical === null) return null
  const producer = eventByName(canonical)?.producer
  if (!producer) return null
  return { entityType: producer.entityType, operation: producer.operation }
}

export const DAILY_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/

export type ScheduleSpecError = { message: string } | null

export function validateScheduleSpec(
  kind: PipelineScheduleKind,
  spec: unknown,
): ScheduleSpecError {
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    return { message: 'schedule spec must be an object' }
  }
  const record = spec as Record<string, unknown>
  if (kind === 'interval') {
    if (
      typeof record.intervalMinutes !== 'number' ||
      !Number.isInteger(record.intervalMinutes) ||
      record.intervalMinutes < 1 ||
      record.intervalMinutes > 525_600
    ) {
      return {
        message: 'intervalMinutes must be an integer between 1 and 525600',
      }
    }
    return null
  }
  if (kind === 'daily') {
    if (typeof record.dailyAt !== 'string' || !DAILY_RE.test(record.dailyAt)) {
      return { message: 'dailyAt must be an HH:MM time' }
    }
    if (
      record.timeZone !== undefined &&
      record.timeZone !== null &&
      (typeof record.timeZone !== 'string' || !isIanaTimeZone(record.timeZone))
    ) {
      return { message: 'timeZone must be a valid IANA time zone name' }
    }
    return null
  }
  // kind === 'event' (the only remaining kind). Canonical catalogue names
  // are stored; wire aliases and the legacy dataset_version_created name are
  // accepted here and normalized by the writer (the RPC rewrites the spec).
  if (normalizeTriggerEventName(record.eventType) === null) {
    return { message: 'eventType must be a triggerable catalogue event name' }
  }
  if (
    record.datasetId !== undefined &&
    record.datasetId !== null &&
    typeof record.datasetId !== 'string'
  ) {
    return { message: 'datasetId must be a Dataset id or null' }
  }
  if (
    record.instrumentId !== undefined &&
    record.instrumentId !== null &&
    (typeof record.instrumentId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        record.instrumentId,
      ))
  ) {
    return { message: 'instrumentId must be an instrument id or null' }
  }
  if (
    record.inputName !== undefined &&
    record.inputName !== null &&
    (typeof record.inputName !== 'string' ||
      !/^[a-z][a-z0-9_]{0,47}$/.test(record.inputName))
  ) {
    return { message: 'inputName must be a valid input identifier' }
  }
  return null
}

/** Next wall-clock occurrence for interval/daily schedules. */
export function nextRunAt(
  kind: 'interval' | 'daily',
  spec: IntervalSpec | DailySpec,
  from: Date,
): Date | null {
  const error = validateScheduleSpec(kind, spec)
  if (error) return null
  if (kind === 'interval') {
    const minutes = (spec as IntervalSpec).intervalMinutes
    return new Date(from.getTime() + minutes * 60_000)
  }
  // daily — next wall-clock occurrence in the explicit IANA zone
  const daily = spec as DailySpec
  const zone = daily.timeZone ?? 'UTC'
  if (!isIanaTimeZone(zone)) return null
  return nextDailyInZone(from, daily.dailyAt, zone)
}

interface ZonedClock {
  y: number
  mo: number
  d: number
  /** Offset of the zone at the instant: wall-clock-as-UTC minus the instant. */
  offsetMs: number
}

function zonedParts(at: Date, zone: string): ZonedClock {
  const parts = new Intl.DateTimeFormat('en-US', {
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
