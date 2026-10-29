/**
 * AUTO-02 — Pipeline schedule/event sweep (server-side).
 *
 * Evaluates enabled schedules and starts + executes runs. Every scheduled
 * or event-triggered run carries a **stable trigger occurrence identity**
 * (`sched:<schedule_id>:<due_at_utc>` for interval/daily ticks,
 * `evt:<change_event_id>` for events) plus a `schedule_id` back-link, so:
 *
 *   - a duplicate sweep can never double-start the same occurrence
 *     (one running + one succeeded run per occurrence, enforced by partial
 *     unique indexes and the start RPC);
 *   - a crash between "run started" and "run executed" is reconciled by the
 *     staleness threshold (900s): the next sweep fails the stale run with
 *     `stale_run_reconciled` and starts a linked retry of the SAME
 *     occurrence (same `trigger_occurrence_id`, `retry_of_run_id` lineage),
 *     independent of the schedule's current `next_run_at` / event cursor —
 *     so crashed occurrences are recovered, never silently skipped;
 *   - a failed occurrence start is retried as a linked attempt.
 *
 * Event delivery is **at-least-once with durable failure records**: the
 * per-workspace change_events sequence cursor advances when a run starts;
 * if that run's execution crashes, the sweep recovers the stale run by its
 * `evt:<event_id>` occurrence identity (the cursor does not move backwards).
 * A run start failure keeps the cursor in place and is recorded in
 * `api.pipeline_trigger_failures`; after the retry budget the occurrence is
 * explicitly abandoned (visible), never silently dropped.
 *
 * Daily schedules use an explicit IANA time zone (`spec.timeZone`, default
 * UTC) — never the DB/server session time zone.
 */
import { PooledClient } from '#/db/pool.server'
import type { QueryResultRow } from 'pg'

import { env } from '#/env.server'
import { metrics } from '#/lib/metrics'
import {
  expirePipelinePrompts,
  releaseSettledRunArtefacts,
} from './pipeline-execute.server'
import { enqueuePipelineRun, wakePipelineWorker } from './pipeline-queue.server'
import {
  MISSED_RUN_GRACE_MINUTES,
  nextRunAt,
  normalizeTriggerEventName,
  producerForTriggerEvent,
  specBindings,
} from './pipeline-schedule'
import type {
  CronSpec,
  DailySpec,
  IntervalSpec,
  ScheduleSpecCommon,
} from './pipeline-schedule'

const SCHEDULE_COLUMNS = `id, workspace_id, definition_id, kind, spec, enabled,
  last_run_at, next_run_at, last_evaluated_at, last_evaluated_sequence,
  input_watermarks, created_by_user_id`
const SCHEDULE_COLUMNS_S = SCHEDULE_COLUMNS.split(',')
  .map((column) => `s.${column.trim()}`)
  .join(', ')

const SWEEP_INTERVAL_MS = 60_000
const MAX_EVENTS_PER_SWEEP = 20
const EVENT_RETRY_BUDGET = 3
const STALE_THRESHOLD_SECONDS = 900
const MAX_STALE_RECOVERIES_PER_SWEEP = 5

interface QueryResult<T extends QueryResultRow> {
  rows: T[]
}

export interface SchedulerConnection {
  query: <T extends QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<QueryResult<T>>
  begin: () => Promise<void>
  commit: () => Promise<void>
  rollback: () => Promise<void>
  end: () => Promise<void>
}

export interface PipelineSchedulerDeps {
  connect: () => Promise<SchedulerConnection>
  /**
   * Hand a started run to the execution queue. Runs are queued by the database
   * when they start, so the default only wakes a local worker; nothing executes
   * inside the sweep.
   */
  run: (actor: string, runId: string) => Promise<unknown>
}

interface ScheduleRow {
  id: string
  workspace_id: string
  definition_id: string
  kind: 'interval' | 'daily' | 'event'
  spec: Record<string, unknown>
  enabled: boolean
  last_run_at: string | null
  next_run_at: string | null
  last_evaluated_at: string | null
  last_evaluated_sequence: string | null
  input_watermarks: Record<string, string> | null
  created_by_user_id: string | null
}

interface ChangeEventRow {
  id: string
  entity_uuid: string
  sequence: string
}

interface RunRow {
  id: string
  status: string
  started_at: string
  /** A worker holds the run, or it is queued: it is not stale however old it is. */
  job_live: boolean
  input_versions: Record<string, string>
}

/** Receives why a run start was refused, for the activity log. */
interface StartFailure {
  message?: string
}

interface StaleRun {
  id: string
  trigger_occurrence_id: string
  definition_version_id: string
  input_versions: Record<string, string>
  parameters: Record<string, unknown>
}

/**
 * Evaluate all due schedules once. Returns the number of runs started.
 */
export async function sweepPipelines(
  deps: PipelineSchedulerDeps,
  now: Date = new Date(),
): Promise<number> {
  const conn = await deps.connect()
  const sweepStarted = Date.now()
  let started = 0
  let recovered = 0
  try {
    await conn.begin()
    const { rows } = await conn.query<ScheduleRow>(
      `SELECT ${SCHEDULE_COLUMNS_S}
         FROM api.pipeline_schedules s
         JOIN api.pipeline_definitions d ON d.id = s.definition_id
        WHERE s.enabled AND d.lifecycle = 'active'
        ORDER BY s.id`,
    )
    await conn.commit()

    for (const schedule of rows) {
      if (schedule.kind === 'event') {
        const outcome = await sweepEventSchedule(deps, schedule)
        started += outcome.fired
        recovered += outcome.recovered
      } else {
        const due = schedule.next_run_at
          ? new Date(schedule.next_run_at).getTime() <= now.getTime()
          : true
        if (due) {
          const outcome = await sweepTimedSchedule(deps, schedule, now)
          started += outcome.fired
          recovered += outcome.recovered
        } else {
          // Even when no tick is due, recover any stale crashed occurrence.
          const outcome = await sweepStaleRecovery(deps, schedule)
          started += outcome.fired
          recovered += outcome.recovered
        }
      }
    }
    metrics.schedulerSweepDuration.observe(
      {},
      (Date.now() - sweepStarted) / 1000,
    )
    if (started > 0) metrics.schedulerDueOccurrences.inc({}, started)
    if (recovered > 0) metrics.schedulerRecoveredOccurrences.inc({}, recovered)
    return started
  } finally {
    await conn.end()
  }
}

async function sweepTimedSchedule(
  deps: PipelineSchedulerDeps,
  schedule: ScheduleRow,
  now: Date,
): Promise<{ fired: number; recovered: number }> {
  const conn = await deps.connect()
  const startedRunIds: string[] = []
  let recovered = 0
  try {
    // Lock the schedule row so concurrent sweepers cannot double-fire.
    await conn.begin()
    const { rows } = await conn.query<ScheduleRow>(
      `SELECT ${SCHEDULE_COLUMNS}
         FROM api.pipeline_schedules WHERE id = $1 FOR UPDATE`,
      [schedule.id],
    )
    const locked = rows.at(0)
    if (!locked || !locked.enabled || locked.kind === 'event') {
      await conn.rollback()
      return { fired: 0, recovered: 0 }
    }
    // Stamp the schedule creator's identity so governed RPCs (run logs, the
    // start RPC) work throughout this evaluation.
    await setScheduleClaims(conn, locked)
    const versionId = await resolveLatestPublishedVersion(
      conn,
      locked.definition_id,
    )

    // Crash recovery FIRST: retry stale occurrences with their OWN pinned
    // Pipeline Definition Version and trigger_occurrence_id, independent of
    // the current next_run_at — reproducibility requires a retry to execute
    // the exact version the crashed attempt used.
    const stale = await recoverStaleRuns(conn, locked)
    recovered += stale.length
    for (const s of stale) {
      const retryRunId = await startScheduledRun(
        conn,
        locked,
        s.definition_version_id,
        s.input_versions,
        s.parameters,
        'scheduled',
        s.trigger_occurrence_id,
        s.id,
      )
      if (retryRunId) startedRunIds.push(retryRunId)
    }

    const due = locked.next_run_at
      ? new Date(locked.next_run_at).getTime() <= now.getTime()
      : true
    if (due) {
      const runId = await handleDueTick(
        conn,
        locked,
        versionId,
        now,
        startedRunIds,
      )
      if (runId) startedRunIds.push(runId)
    }
    await conn.commit()
  } finally {
    await conn.end()
  }
  const creator = schedule.created_by_user_id ?? 'system'
  for (const runId of startedRunIds) {
    await deps.run(creator, runId)
  }
  return { fired: startedRunIds.length, recovered }
}

type TimedSpec = (IntervalSpec | DailySpec | CronSpec) & ScheduleSpecCommon

/**
 * One due tick of an interval/daily/cron trigger. Either starts the run for
 * the occurrence or records, durably, why it did not; the schedule always
 * moves on to its next occurrence. Returns the started run's id.
 */
async function handleDueTick(
  conn: SchedulerConnection,
  locked: ScheduleRow,
  versionId: string | null,
  now: Date,
  retriedRunIds: string[],
): Promise<string | null> {
  const spec = locked.spec as unknown as TimedSpec
  const occurrenceId = scheduledOccurrenceId(locked.id, locked.next_run_at)
  const advance = () =>
    conn.query(
      `UPDATE api.pipeline_schedules
          SET next_run_at = $2, updated_at = now()
        WHERE id = $1`,
      [locked.id, nextDue(locked, now)],
    )

  if (!versionId) {
    await recordActivity(
      conn,
      locked,
      'skipped_no_version',
      occurrenceId,
      'The pipeline has no published version, so nothing was run.',
    )
    await advance()
    return null
  }
  const prior = await latestRunForOccurrence(
    conn,
    locked.workspace_id,
    occurrenceId,
  )
  if (prior && prior.status === 'succeeded') {
    // Already executed this occurrence (duplicate sweep): back off only.
    await advance()
    return null
  }
  if (
    prior &&
    prior.status === 'running' &&
    (prior.job_live || !isStale(prior.started_at))
  ) {
    // In-flight (fresh) execution, or a run a worker holds / is queued: never double-start.
    await advance()
    return null
  }

  // A tick that fires long after it was due was missed (server down, deploy).
  const lateMs = locked.next_run_at
    ? now.getTime() - new Date(locked.next_run_at).getTime()
    : 0
  if (
    !prior &&
    spec.missedRunPolicy === 'skip' &&
    lateMs > MISSED_RUN_GRACE_MINUTES * 60_000
  ) {
    const missed = countMissedTicks(locked, now)
    await recordActivity(
      conn,
      locked,
      'skipped_missed',
      occurrenceId,
      missed > 1
        ? `${missed} scheduled runs were missed and skipped, as this trigger is set to.`
        : 'A scheduled run was missed and skipped, as this trigger is set to.',
      { missed, dueAt: locked.next_run_at },
    )
    await advance()
    return null
  }

  // Never stack a new occurrence on one that is still working.
  if (!prior && (await hasFreshRunningRun(conn, locked.id, retriedRunIds))) {
    await recordActivity(
      conn,
      locked,
      'skipped_overlap',
      occurrenceId,
      'The previous run was still going, so this one was skipped.',
    )
    await advance()
    return null
  }

  // A retried occurrence reads exactly what the failed attempt read.
  let inputVersions: Record<string, string>
  let watermarks: Record<string, string> = {}
  if (prior) {
    inputVersions = prior.input_versions
  } else {
    const resolved = await resolveScheduleInputs(conn, locked, spec)
    if (resolved.skip) {
      await recordActivity(
        conn,
        locked,
        resolved.skip.kind,
        occurrenceId,
        resolved.skip.message,
      )
      await advance()
      return null
    }
    inputVersions = resolved.versions
    watermarks = resolved.watermarks
  }

  const failure: StartFailure = {}
  const runId = await startScheduledRun(
    conn,
    locked,
    versionId,
    inputVersions,
    spec.parameters,
    'scheduled',
    occurrenceId,
    prior?.id ?? null,
    failure,
  )
  if (runId) {
    await conn.query(
      `UPDATE api.pipeline_schedules
          SET last_run_at = now(), next_run_at = $2, updated_at = now(),
              input_watermarks = input_watermarks || $3::jsonb
        WHERE id = $1`,
      [locked.id, nextDue(locked, now), JSON.stringify(watermarks)],
    )
    return runId
  }
  // Start failed (e.g. the creator is no longer a writer): say so, back off.
  await recordActivity(
    conn,
    locked,
    'start_failed',
    occurrenceId,
    failure.message ?? 'The run could not be started.',
  )
  await advance()
  return null
}

/** Recover stale crashed occurrences even when no tick is currently due. */
async function sweepStaleRecovery(
  deps: PipelineSchedulerDeps,
  schedule: ScheduleRow,
): Promise<{ fired: number; recovered: number }> {
  const conn = await deps.connect()
  const startedRunIds: string[] = []
  let recovered = 0
  try {
    await conn.begin()
    const { rows } = await conn.query<ScheduleRow>(
      `SELECT ${SCHEDULE_COLUMNS}
         FROM api.pipeline_schedules WHERE id = $1 FOR UPDATE`,
      [schedule.id],
    )
    const locked = rows.at(0)
    if (!locked || !locked.enabled || locked.kind === 'event') {
      await conn.rollback()
      return { fired: 0, recovered: 0 }
    }
    await setScheduleClaims(conn, locked)
    // Stale retries use the crashed run's OWN pinned version; no latest
    // version resolution is needed for recovery.
    const stale = await recoverStaleRuns(conn, locked)
    recovered += stale.length
    for (const s of stale) {
      const retryRunId = await startScheduledRun(
        conn,
        locked,
        s.definition_version_id,
        s.input_versions,
        s.parameters,
        'scheduled',
        s.trigger_occurrence_id,
        s.id,
      )
      if (retryRunId) startedRunIds.push(retryRunId)
    }
    await conn.commit()
  } finally {
    await conn.end()
  }
  const creator = schedule.created_by_user_id ?? 'system'
  for (const runId of startedRunIds) {
    await deps.run(creator, runId)
  }
  return { fired: startedRunIds.length, recovered }
}

async function sweepEventSchedule(
  deps: PipelineSchedulerDeps,
  schedule: ScheduleRow,
): Promise<{ fired: number; recovered: number }> {
  const conn = await deps.connect()
  const startedRunIds: string[] = []
  let fired = 0
  let recovered = 0
  try {
    await conn.begin()
    const { rows } = await conn.query<ScheduleRow>(
      `SELECT ${SCHEDULE_COLUMNS}
         FROM api.pipeline_schedules WHERE id = $1 FOR UPDATE`,
      [schedule.id],
    )
    const locked = rows.at(0)
    if (!locked || !locked.enabled || locked.kind !== 'event') {
      await conn.rollback()
      return { fired: 0, recovered: 0 }
    }
    await setScheduleClaims(conn, locked)
    // The latest published version is re-resolved per consumed event so a
    // version publish mid-sweep is picked up; there is no stale hoisted value.
    const stale = await recoverStaleRuns(conn, locked)
    recovered += stale.length
    for (const s of stale) {
      const retryRunId = await startScheduledRun(
        conn,
        locked,
        s.definition_version_id,
        s.input_versions,
        s.parameters,
        'event',
        s.trigger_occurrence_id,
        s.id,
      )
      if (retryRunId) startedRunIds.push(retryRunId)
    }

    const spec = locked.spec as {
      eventType?: string | null
      datasetId?: string | null
      instrumentId?: string | null
      inputName?: string
      inputVersions?: Record<string, string>
      parameters?: Record<string, unknown>
    } & ScheduleSpecCommon
    // Trigger configuration references catalogue event names. The stored
    // value is canonical, but pre-catalogue rows may still carry the legacy
    // `dataset_version_created` name — normalize at read time so they keep
    // firing. Unknown (non-triggerable) names consume nothing: the cursor
    // stays in place rather than skipping events silently.
    const triggerEvent = normalizeTriggerEventName(spec.eventType)
    const producer = producerForTriggerEvent(spec.eventType)
    if (!triggerEvent || !producer) {
      await conn.rollback()
      return { fired, recovered }
    }
    const cursor = Number(locked.last_evaluated_sequence ?? 0)
    // The dataset filter is meaningful only for `dataset.versioned` (whose
    // payload carries the parent datasetId); other events ignore it.
    const datasetFilter =
      triggerEvent === 'dataset.versioned' ? (spec.datasetId ?? null) : null
    // The instrument filter likewise applies to `dataset.versioned` only: the
    // version must be the snapshot of an import from that instrument.
    const instrumentFilter =
      triggerEvent === 'dataset.versioned' ? (spec.instrumentId ?? null) : null
    const events = await conn.query<ChangeEventRow>(
      `SELECT id, entity_uuid, sequence
         FROM api.change_events
        WHERE workspace_id = $1
          AND entity_type = $2
          AND operation = $3
          AND sequence > $4::bigint
          AND ($5::uuid IS NULL OR payload->>'datasetId' IS NULL
               OR (payload->>'datasetId')::uuid = $5::uuid)
          AND ($6::uuid IS NULL OR EXISTS (
                SELECT 1 FROM api.dataset_imports di
                 WHERE di.workspace_id = api.change_events.workspace_id
                   AND di.snapshot_version_id = api.change_events.entity_uuid
                   AND di.instrument_id = $6::uuid))
        ORDER BY sequence
        LIMIT ${MAX_EVENTS_PER_SWEEP}`,
      [
        locked.workspace_id,
        producer.entityType,
        producer.operation,
        cursor,
        datasetFilter,
        instrumentFilter,
      ],
    )
    // Only `dataset.versioned` supplies an input version (the created
    // Dataset Version id). Other events fire with the schedule's configured
    // inputs; an explicitly configured inputName still binds the triggering
    // entity (a misconfigured binding fails the start visibly via the
    // durable failure path rather than silently).
    const inputName =
      triggerEvent === 'dataset.versioned'
        ? (spec.inputName ?? (await firstInputName(locked.definition_id, conn)))
        : spec.inputName
    await conn.commit()

    for (const runId of startedRunIds) {
      const creator = locked.created_by_user_id ?? 'system'
      await deps.run(creator, runId)
    }
    fired += startedRunIds.length

    for (const event of events.rows) {
      // Each event is consumed exactly once: the cursor advances only with a
      // durable disposition (started run, or explicitly abandoned failure).
      await conn.begin()
      const { rows: fresh } = await conn.query<{
        last_evaluated_sequence: string | null
      }>(
        `SELECT last_evaluated_sequence FROM api.pipeline_schedules WHERE id = $1 FOR UPDATE`,
        [locked.id],
      )
      const currentCursor = Number(fresh.at(0)?.last_evaluated_sequence ?? 0)
      if (Number(event.sequence) <= currentCursor) {
        await conn.rollback()
        continue
      }
      const eventVersionId = await resolveLatestPublishedVersion(
        conn,
        locked.definition_id,
      )
      if (!eventVersionId) {
        await conn.rollback()
        break
      }
      const occurrenceId = eventOccurrenceId(event.id)
      const prior = await latestRunForOccurrence(
        conn,
        locked.workspace_id,
        occurrenceId,
      )
      // Other inputs follow their bindings (pinned, or the Dataset's latest
      // version now); the triggering entity binds to the event's input. A
      // retried occurrence reads exactly what the failed attempt read.
      const failure: StartFailure = {}
      let inputVersions: Record<string, string> | null
      if (prior?.status === 'failed') {
        inputVersions = prior.input_versions
      } else {
        const resolved = await resolveScheduleInputs(
          conn,
          locked,
          spec,
          inputName ? { name: inputName, versionId: event.entity_uuid } : null,
        )
        inputVersions = resolved.skip ? null : resolved.versions
        if (resolved.skip) failure.message = resolved.skip.message
      }
      const runId = inputVersions
        ? await startScheduledRun(
            conn,
            locked,
            eventVersionId,
            inputVersions,
            spec.parameters,
            'event',
            occurrenceId,
            prior?.status === 'failed' ? prior.id : null,
            failure,
          )
        : null
      if (runId) {
        await advanceEventCursor(conn, locked.id, event.sequence)
        await clearTriggerFailure(conn, locked.workspace_id, occurrenceId)
        await conn.commit()
        metrics.schedulerEventsProcessed.inc()
        const creator = locked.created_by_user_id ?? 'system'
        await deps.run(creator, runId)
        fired += 1
      } else {
        // Durable, retryable failure — the event is NOT consumed. After the
        // retry budget the occurrence is explicitly abandoned (visible) and
        // the cursor advances, so a permanently failing event cannot block
        // the queue silently.
        await recordActivity(
          conn,
          locked,
          inputVersions ? 'start_failed' : 'input_unresolved',
          occurrenceId,
          failure.message ?? 'The run could not be started.',
          { eventId: event.id },
        )
        const exhausted = await recordTriggerFailure(
          conn,
          locked,
          occurrenceId,
          event.id,
          'run_start_failed',
          failure.message ?? 'Scheduled run could not be started.',
        )
        if (exhausted) {
          await advanceEventCursor(conn, locked.id, event.sequence)
          await conn.commit()
        } else {
          await conn.commit()
          break
        }
      }
    }
    return { fired, recovered }
  } finally {
    await conn.end()
  }
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function scheduledOccurrenceId(
  scheduleId: string,
  dueAt: string | null,
): string {
  const due = dueAt
    ? new Date(dueAt).toISOString().replace(/[:.]/g, '-')
    : new Date().toISOString().replace(/[:.]/g, '-')
  return `sched:${scheduleId}:${due}`
}

function eventOccurrenceId(eventId: string): string {
  return `evt:${eventId}`
}

function isStale(startedAt: string): boolean {
  return (
    Date.now() - new Date(startedAt).getTime() > STALE_THRESHOLD_SECONDS * 1000
  )
}

async function latestRunForOccurrence(
  conn: SchedulerConnection,
  workspaceId: string,
  occurrenceId: string,
): Promise<RunRow | null> {
  const { rows } = await conn.query<RunRow>(
    `SELECT id, status, started_at, input_versions,
            internal.pipeline_run_job_is_live(id) AS job_live
       FROM api.pipeline_runs
      WHERE workspace_id = $1 AND trigger_occurrence_id = $2
      ORDER BY started_at DESC LIMIT 1`,
    [workspaceId, occurrenceId],
  )
  return rows.at(0) ?? null
}

/**
 * Find stale running runs triggered by this schedule (via schedule_id — works
 * for both `sched:` and `evt:` occurrences), fail them as
 * `stale_run_reconciled`, and return their identities + pinned version +
 * stored inputs so the caller can start a linked retry of the SAME
 * occurrence and the SAME Pipeline Definition Version (reproducibility).
 */
async function recoverStaleRuns(
  conn: SchedulerConnection,
  schedule: ScheduleRow,
): Promise<StaleRun[]> {
  const { rows } = await conn.query<{
    id: string
    trigger_occurrence_id: string
    definition_version_id: string
    input_versions: Record<string, string>
    parameters: Record<string, unknown>
  }>(
    `SELECT id, trigger_occurrence_id, definition_version_id,
            input_versions, parameters
       FROM api.pipeline_runs
      WHERE schedule_id = $1
        AND status = 'running'
        AND started_at < clock_timestamp() - ($2 || ' seconds')::interval
        AND NOT internal.pipeline_run_job_is_live(id)
      ORDER BY started_at
      LIMIT ${MAX_STALE_RECOVERIES_PER_SWEEP}`,
    [schedule.id, STALE_THRESHOLD_SECONDS],
  )
  for (const run of rows) {
    // Log while still running, then fail (append_pipeline_run_log only
    // accepts running runs).
    await conn
      .query(
        `SELECT api.append_pipeline_run_log($1, $2, 'warning', 'reconcile', $3, $4::jsonb)`,
        [
          schedule.workspace_id,
          run.id,
          'Stale running trigger occurrence reconciled by the sweep.',
          JSON.stringify({ reason: 'stale_run_reconciled' }),
        ],
      )
      .catch(() => {})
    await conn.query(
      `UPDATE api.pipeline_runs SET
         status = 'failed',
         error_code = 'stale_run_reconciled',
         error_message = 'run exceeded the staleness threshold and was reconciled',
         finished_at = clock_timestamp()
       WHERE id = $1`,
      [run.id],
    )
  }
  return rows.map((r) => ({
    id: r.id,
    trigger_occurrence_id: r.trigger_occurrence_id,
    definition_version_id: r.definition_version_id,
    input_versions: r.input_versions,
    parameters: r.parameters,
  }))
}

async function setScheduleClaims(
  conn: SchedulerConnection,
  schedule: ScheduleRow,
): Promise<void> {
  await conn.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({
      role: 'authenticated',
      sub: schedule.created_by_user_id ?? 'system',
      workspace_id: schedule.workspace_id,
    }),
  ])
}

async function advanceEventCursor(
  conn: SchedulerConnection,
  scheduleId: string,
  sequence: string,
): Promise<void> {
  await conn.query(
    `UPDATE api.pipeline_schedules
        SET last_evaluated_sequence = $2, last_evaluated_at = now(),
            last_run_at = now(), updated_at = now()
      WHERE id = $1`,
    [scheduleId, Number(sequence)],
  )
}

/**
 * Record (or update) a durable trigger-start failure. Returns true when the
 * retry budget is exhausted and the occurrence should be abandoned.
 */
async function recordTriggerFailure(
  conn: SchedulerConnection,
  schedule: ScheduleRow,
  occurrenceId: string,
  eventId: string | null,
  errorCode: string,
  errorMessage: string,
): Promise<boolean> {
  const { rows } = await conn.query<{ attempt: number; status: string }>(
    `SELECT attempt, status FROM api.pipeline_trigger_failures
      WHERE workspace_id = $1 AND trigger_occurrence_id = $2 FOR UPDATE`,
    [schedule.workspace_id, occurrenceId],
  )
  const existing = rows.at(0)
  const attempt = existing ? existing.attempt + 1 : 1
  if (attempt >= EVENT_RETRY_BUDGET) {
    await conn.query(
      `INSERT INTO api.pipeline_trigger_failures(
         workspace_id, schedule_id, trigger_occurrence_id, event_id,
         error_code, error_message, attempt, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'abandoned')
       ON CONFLICT (workspace_id, trigger_occurrence_id) DO UPDATE SET
         attempt = EXCLUDED.attempt, status = 'abandoned',
         error_code = EXCLUDED.error_code, error_message = EXCLUDED.error_message,
         updated_at = now()`,
      [
        schedule.workspace_id,
        schedule.id,
        occurrenceId,
        eventId,
        errorCode,
        errorMessage,
        attempt,
      ],
    )
    return true
  }
  await conn.query(
    `INSERT INTO api.pipeline_trigger_failures(
       workspace_id, schedule_id, trigger_occurrence_id, event_id,
       error_code, error_message, attempt, status
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
     ON CONFLICT (workspace_id, trigger_occurrence_id) DO UPDATE SET
       attempt = EXCLUDED.attempt, error_code = EXCLUDED.error_code,
       error_message = EXCLUDED.error_message, updated_at = now()`,
    [
      schedule.workspace_id,
      schedule.id,
      occurrenceId,
      eventId,
      errorCode,
      errorMessage,
      attempt,
    ],
  )
  return false
}

async function clearTriggerFailure(
  conn: SchedulerConnection,
  workspaceId: string,
  occurrenceId: string,
): Promise<void> {
  await conn.query(
    `DELETE FROM api.pipeline_trigger_failures
      WHERE workspace_id = $1 AND trigger_occurrence_id = $2`,
    [workspaceId, occurrenceId],
  )
}

async function firstInputName(
  definitionId: string,
  conn: SchedulerConnection,
): Promise<string | null> {
  const { rows } = await conn.query<{ configuration: Record<string, unknown> }>(
    `SELECT configuration FROM api.pipeline_definition_versions
      WHERE definition_id = $1 AND lifecycle = 'published'
      ORDER BY version DESC LIMIT 1`,
    [definitionId],
  )
  const config = rows.at(0)?.configuration
  if (!config || !Array.isArray(config.inputs) || config.inputs.length === 0) {
    return null
  }
  const first = config.inputs[0] as { name?: unknown }
  return typeof first.name === 'string' ? first.name : null
}

async function resolveLatestPublishedVersion(
  conn: SchedulerConnection,
  definitionId: string,
): Promise<string | null> {
  const { rows } = await conn.query<{ id: string }>(
    `SELECT id FROM api.pipeline_definition_versions
      WHERE definition_id = $1 AND lifecycle = 'published'
      ORDER BY version DESC LIMIT 1`,
    [definitionId],
  )
  return rows.at(0)?.id ?? null
}

async function startScheduledRun(
  conn: SchedulerConnection,
  schedule: ScheduleRow,
  versionId: string,
  inputVersions?: Record<string, string>,
  parameters?: Record<string, unknown>,
  triggerKind: 'scheduled' | 'event' = 'scheduled',
  occurrenceId?: string,
  retryOfRunId?: string | null,
  failure?: StartFailure,
): Promise<string | null> {
  const creator = schedule.created_by_user_id ?? 'system'
  await conn.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({
      role: 'authenticated',
      sub: creator,
      workspace_id: schedule.workspace_id,
    }),
  ])
  try {
    await conn.query('SAVEPOINT sb_schedule_start')
    const { rows } = await conn.query<{ id: string }>(
      `SELECT (api.start_pipeline_run(
         $1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8
       )).id AS id`,
      [
        schedule.workspace_id,
        versionId,
        triggerKind,
        JSON.stringify(parameters ?? {}),
        JSON.stringify(inputVersions ?? {}),
        retryOfRunId ?? null,
        occurrenceId ?? null,
        schedule.id,
      ],
    )
    await conn.query('RELEASE SAVEPOINT sb_schedule_start')
    return rows.at(0)?.id ?? null
  } catch (error) {
    // e.g. the schedule creator left the workspace or the version was
    // retired between resolution and start. Restore the transaction so the
    // caller can record a durable failure; the run never starts.
    await conn.query('ROLLBACK TO SAVEPOINT sb_schedule_start').catch(() => {})
    if (failure) {
      failure.message = `The run could not be started: ${
        error instanceof Error ? error.message : 'the database refused it'
      }`
    }
    return null
  }
}

type ActivityKind =
  | 'skipped_missed'
  | 'skipped_unchanged'
  | 'skipped_overlap'
  | 'skipped_no_version'
  | 'input_unresolved'
  | 'start_failed'

/** Kinds that repeat every tick until something changes: one row, counted. */
const COLLAPSING_ACTIVITY: readonly ActivityKind[] = [
  'skipped_unchanged',
  'skipped_overlap',
  'skipped_no_version',
  'input_unresolved',
]

/**
 * Record what a trigger did instead of running. A skip that repeats every
 * tick (nothing new, still no version) updates one row with a count rather
 * than writing a row a minute; the row starts over once a run has started.
 */
async function recordActivity(
  conn: SchedulerConnection,
  schedule: ScheduleRow,
  kind: ActivityKind,
  occurrenceId: string | null,
  message: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  if (COLLAPSING_ACTIVITY.includes(kind)) {
    const { rows } = await conn.query<{
      id: string
      kind: string
      occurred_at: string
      detail: { count?: number }
    }>(
      `SELECT id, kind, occurred_at, detail
         FROM api.pipeline_schedule_activity
        WHERE schedule_id = $1
        ORDER BY occurred_at DESC LIMIT 1`,
      [schedule.id],
    )
    const last = rows.at(0)
    if (
      last &&
      last.kind === kind &&
      (!schedule.last_run_at ||
        new Date(schedule.last_run_at) < new Date(last.occurred_at))
    ) {
      await conn.query(
        `UPDATE api.pipeline_schedule_activity
            SET occurred_at = now(), message = $2, occurrence_id = $3,
                detail = $4::jsonb
          WHERE id = $1`,
        [
          last.id,
          message,
          occurrenceId,
          JSON.stringify({ ...detail, count: (last.detail.count ?? 1) + 1 }),
        ],
      )
      return
    }
  }
  await conn.query(
    `INSERT INTO api.pipeline_schedule_activity(
       workspace_id, schedule_id, kind, occurrence_id, message, detail
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      schedule.workspace_id,
      schedule.id,
      kind,
      occurrenceId,
      message,
      JSON.stringify({ ...detail, count: 1 }),
    ],
  )
}

/** How many occurrences fell between the due time and now (capped). */
function countMissedTicks(schedule: ScheduleRow, now: Date): number {
  if (schedule.kind === 'event' || !schedule.next_run_at) return 1
  let cursor = new Date(schedule.next_run_at)
  let missed = 0
  while (cursor.getTime() <= now.getTime() && missed < 1000) {
    missed += 1
    const next = nextRunAt(schedule.kind, schedule.spec as never, cursor)
    if (!next) break
    cursor = next
  }
  return Math.max(missed, 1)
}

/**
 * Is a run this trigger started earlier still working (and not stuck)? Retries
 * of crashed occurrences started in this same sweep do not count.
 */
async function hasFreshRunningRun(
  conn: SchedulerConnection,
  scheduleId: string,
  ignoreRunIds: string[],
): Promise<boolean> {
  const { rows } = await conn.query<{ found: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM api.pipeline_runs
        WHERE schedule_id = $1 AND status IN ('running', 'waiting')
          AND NOT (id = ANY($3::uuid[]))
          AND (started_at >= clock_timestamp() - ($2 || ' seconds')::interval
               OR internal.pipeline_run_job_is_live(id))
     ) AS found`,
    [scheduleId, STALE_THRESHOLD_SECONDS, ignoreRunIds],
  )
  return rows.at(0)?.found === true
}

async function latestDatasetVersion(
  conn: SchedulerConnection,
  workspaceId: string,
  datasetId: string,
): Promise<string | null> {
  const { rows } = await conn.query<{ id: string }>(
    `SELECT id FROM api.dataset_versions
      WHERE workspace_id = $1 AND dataset_id = $2
      ORDER BY created_at DESC, id DESC LIMIT 1`,
    [workspaceId, datasetId],
  )
  return rows.at(0)?.id ?? null
}

interface ResolvedInputs {
  /** The Dataset Version each input reads on this run. */
  versions: Record<string, string>
  /** New watermarks for `incremental` inputs, stored once the run starts. */
  watermarks: Record<string, string>
  /** Set when no run should start, and why. */
  skip?: { kind: ActivityKind; message: string }
}

/**
 * Turn a trigger's input bindings into the exact Dataset Versions for one
 * run. `bound` pins the entity an event delivered. A trigger with
 * `incremental` inputs runs only when at least one has a version newer than
 * its watermark; a Dataset with no versions yet cannot be read, so nothing
 * starts and the activity log says which one.
 */
async function resolveScheduleInputs(
  conn: SchedulerConnection,
  schedule: ScheduleRow,
  spec: ScheduleSpecCommon,
  bound: { name: string; versionId: string } | null = null,
): Promise<ResolvedInputs> {
  const versions: Record<string, string> = {}
  const watermarks: Record<string, string> = {}
  const known = schedule.input_watermarks ?? {}
  let incremental = 0
  let changed = 0
  for (const [name, binding] of Object.entries(specBindings(spec))) {
    if (bound && name === bound.name) continue
    if (binding.mode === 'pinned') {
      versions[name] = binding.versionId
      continue
    }
    const latest = await latestDatasetVersion(
      conn,
      schedule.workspace_id,
      binding.datasetId,
    )
    if (!latest) {
      return {
        versions,
        watermarks,
        skip: {
          kind: 'input_unresolved',
          message: `Input ${name} has no Dataset Version to read yet.`,
        },
      }
    }
    versions[name] = latest
    if (binding.mode === 'incremental') {
      incremental += 1
      if (known[name] !== latest) {
        changed += 1
        watermarks[name] = latest
      }
    }
  }
  if (incremental > 0 && changed === 0) {
    return {
      versions,
      watermarks,
      skip: {
        kind: 'skipped_unchanged',
        message:
          'No new Dataset Version since the last run, so nothing was run.',
      },
    }
  }
  if (bound) versions[bound.name] = bound.versionId
  return { versions, watermarks }
}

// ---------------------------------------------------------------------------
// Sweep driver.
// ---------------------------------------------------------------------------

let sweepTimer: ReturnType<typeof setInterval> | null = null
const startedGlobalKey = '__sheetbasePipelineSchedulerStarted'

export function startPipelineScheduler(): void {
  if (typeof window !== 'undefined') return
  // Never run under test runners or CLI tooling.
  if (
    process.env.NODE_ENV === 'test' ||
    process.env.VITEST === 'true' ||
    process.env.SHEETBASE_SCHEDULER_ENABLED === 'false'
  ) {
    return
  }
  const g = globalThis as unknown as Record<string, unknown>
  if (g[startedGlobalKey]) return
  g[startedGlobalKey] = true

  const deps: PipelineSchedulerDeps = {
    connect: defaultConnect,
    run: async (_actor, runId) => {
      const conn = await defaultConnect()
      try {
        await enqueuePipelineRun(conn, runId)
      } finally {
        await conn.end().catch(() => {})
      }
      wakePipelineWorker()
    },
  }

  const tick = async () => {
    try {
      await sweepPipelines(deps)
      // PIPE-02.2: an unanswered prompt applies the outcome its author
      // configured for a run that nobody answered. This path acts as the
      // pipeline, not a person, so a human session is never needed — and if
      // that ever changes it must fail loudly rather than act as a fake user.
      const sweepDeps = {
        getSession: async () => {
          throw new Error('A pipeline sweep must not require a human session.')
        },
        connect: defaultConnect,
      }
      await expirePipelinePrompts(sweepDeps)
      // PIPE-04.2: a settled run's artefacts are temporary unless it kept them.
      await releaseSettledRunArtefacts(sweepDeps)
    } catch (error) {
      // The sweep must never take the server down; failure is logged and
      // retried on the next interval.
      console.warn(
        JSON.stringify({
          level: 'warn',
          message: 'pipeline schedule sweep failed',
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString(),
        }),
      )
    }
  }
  // First sweep shortly after boot, then on the interval.
  const first = setTimeout(() => void tick(), 5_000)
  first.unref()
  sweepTimer = setInterval(() => void tick(), SWEEP_INTERVAL_MS)
  sweepTimer.unref()
}

async function defaultConnect(): Promise<SchedulerConnection> {
  const client = new PooledClient({ connectionString: env.DATABASE_URL })
  await client.connect()
  return {
    query: async (text, values = []) => client.query(text, values),
    begin: () => client.query('BEGIN').then(() => undefined),
    commit: () => client.query('COMMIT').then(() => undefined),
    rollback: () => client.query('ROLLBACK').then(() => undefined),
    end: () => client.end(),
  }
}

function nextDue(
  schedule: Pick<ScheduleRow, 'kind' | 'spec'>,
  now: Date,
): string | null {
  if (schedule.kind === 'event') return null
  return (
    nextRunAt(schedule.kind, schedule.spec as never, now)?.toISOString() ?? null
  )
}
