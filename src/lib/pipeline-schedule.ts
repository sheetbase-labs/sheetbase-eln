/**
 * AUTO-02 — Pipeline schedule math (pure, deterministic).
 *
 * v1 supports three trigger kinds:
 *   - interval: every N minutes
 *   - daily: at a fixed HH:MM wall-clock time (server local time zone)
 *   - event: dataset_version_created events, evaluated by the server sweep
 *     against the durable change_events stream since last_evaluated_at
 *
 * The database mirrors this logic in api.pipeline_schedule_next_run so the
 * RPCs can stamp next_run_at at create/update time; this module is used by
 * the scheduler sweep and its unit tests.
 */

export type PipelineScheduleKind = 'interval' | 'daily' | 'event'

export interface IntervalSpec {
  intervalMinutes: number
  parameters?: Record<string, unknown>
  inputVersions?: Record<string, string>
}

export interface DailySpec {
  dailyAt: string // HH:MM
  parameters?: Record<string, unknown>
  inputVersions?: Record<string, string>
}

export interface EventSpec {
  eventType: 'dataset_version_created'
  /** Optional filter: only events for this Dataset trigger the pipeline. */
  datasetId?: string | null
  /** Which pipeline input receives the created Dataset Version id. */
  inputName?: string
  /** Fixed inputs for the pipeline's other inputs. */
  inputVersions?: Record<string, string>
  parameters?: Record<string, unknown>
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
    return null
  }
  // kind === 'event' (the only remaining kind)
  if (record.eventType !== 'dataset_version_created') {
    return { message: 'eventType must be dataset_version_created' }
  }
  if (
    record.datasetId !== undefined &&
    record.datasetId !== null &&
    typeof record.datasetId !== 'string'
  ) {
    return { message: 'datasetId must be a Dataset id or null' }
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
  // daily
  const daily = spec as DailySpec
  const [hour, minute] = daily.dailyAt.split(':').map(Number)
  const candidate = new Date(from)
  candidate.setHours(hour, minute, 0, 0)
  if (candidate.getTime() <= from.getTime()) {
    candidate.setDate(candidate.getDate() + 1)
  }
  return candidate
}
