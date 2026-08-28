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
import { Client } from 'pg'
import type { QueryResultRow } from 'pg'

import { env } from '#/env.server'
import { runPipelineExecution } from './pipeline-execute.server'
import type { PipelineExecuteDeps } from './pipeline-execute.server'
import { nextRunAt } from './pipeline-schedule'

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
  /** Reuse the server executor for a started run. */
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
}

interface StaleRun {
  id: string
  trigger_occurrence_id: string
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
  let started = 0
  try {
    await conn.begin()
    const { rows } = await conn.query<ScheduleRow>(
      `SELECT s.id, s.workspace_id, s.definition_id, s.kind, s.spec,
              s.enabled, s.last_run_at, s.next_run_at, s.last_evaluated_at,
              s.last_evaluated_sequence, s.created_by_user_id
         FROM api.pipeline_schedules s
         JOIN api.pipeline_definitions d ON d.id = s.definition_id
        WHERE s.enabled AND d.lifecycle = 'active'
        ORDER BY s.id`,
    )
    await conn.commit()

    for (const schedule of rows) {
      if (schedule.kind === 'event') {
        const fired = await sweepEventSchedule(deps, schedule, now)
        started += fired
      } else {
        const due = schedule.next_run_at
          ? new Date(schedule.next_run_at).getTime() <= now.getTime()
          : true
        if (due) {
          const fired = await sweepTimedSchedule(deps, schedule, now)
          started += fired
        } else {
          // Even when no tick is due, recover any stale crashed occurrence.
          const fired = await sweepStaleRecovery(deps, schedule)
          started += fired
        }
      }
    }
    return started
  } finally {
    await conn.end()
  }
}

async function sweepTimedSchedule(
  deps: PipelineSchedulerDeps,
  schedule: ScheduleRow,
  now: Date,
): Promise<number> {
  const conn = await deps.connect()
  const startedRunIds: string[] = []
  try {
    // Lock the schedule row so concurrent sweepers cannot double-fire.
    await conn.begin()
    const { rows } = await conn.query<ScheduleRow>(
      `SELECT id, workspace_id, definition_id, kind, spec, enabled, last_run_at,
              next_run_at, last_evaluated_at, last_evaluated_sequence,
              created_by_user_id
         FROM api.pipeline_schedules WHERE id = $1 FOR UPDATE`,
      [schedule.id],
    )
    const locked = rows.at(0)
    if (!locked || !locked.enabled || locked.kind === 'event') {
      await conn.rollback()
      return 0
    }
    // Stamp the schedule creator's identity so governed RPCs (run logs, the
    // start RPC) work throughout this evaluation.
    await setScheduleClaims(conn, locked)
    const versionId = await resolveLatestPublishedVersion(
      conn,
      locked.definition_id,
    )

    // Crash recovery FIRST: retry stale occurrences with their own
    // trigger_occurrence_id, independent of the current next_run_at.
    if (versionId) {
      const stale = await recoverStaleRuns(conn, locked)
      for (const s of stale) {
        const retryRunId = await startScheduledRun(
          conn,
          locked,
          versionId,
          s.input_versions,
          s.parameters,
          'scheduled',
          s.trigger_occurrence_id,
          s.id,
        )
        if (retryRunId) startedRunIds.push(retryRunId)
      }
    }

    const due = locked.next_run_at
      ? new Date(locked.next_run_at).getTime() <= now.getTime()
      : true
    if (!due) {
      await conn.commit()
    } else {
      if (versionId) {
        const occurrenceId = scheduledOccurrenceId(
          locked.id,
          locked.next_run_at,
        )
        const prior = await latestRunForOccurrence(
          conn,
          locked.workspace_id,
          occurrenceId,
        )
        if (prior && prior.status === 'succeeded') {
          // Already executed this occurrence (duplicate sweep): back off only.
          await conn.query(
            `UPDATE api.pipeline_schedules
                SET next_run_at = $2, updated_at = now()
              WHERE id = $1`,
            [locked.id, nextDue(locked, now)],
          )
        } else if (
          prior &&
          prior.status === 'running' &&
          !isStale(prior.started_at)
        ) {
          // In-flight (fresh) execution: never double-start.
          await conn.query(
            `UPDATE api.pipeline_schedules
                SET next_run_at = $2, updated_at = now()
              WHERE id = $1`,
            [locked.id, nextDue(locked, now)],
          )
        } else {
          const spec = locked.spec as {
            inputVersions?: Record<string, string>
            parameters?: Record<string, unknown>
          }
          const runId = await startScheduledRun(
            conn,
            locked,
            versionId,
            spec.inputVersions,
            spec.parameters,
            'scheduled',
            occurrenceId,
            prior?.id ?? null,
          )
          if (runId) {
            startedRunIds.push(runId)
            await conn.query(
              `UPDATE api.pipeline_schedules
                  SET last_run_at = now(), next_run_at = $2, updated_at = now()
                WHERE id = $1`,
              [locked.id, nextDue(locked, now)],
            )
          } else {
            // start failed (e.g. creator no longer a writer); back off.
            await conn.query(
              `UPDATE api.pipeline_schedules
                  SET next_run_at = $2, updated_at = now()
                WHERE id = $1`,
              [locked.id, nextDue(locked, now)],
            )
          }
        }
      } else {
        // No published version: back off.
        await conn.query(
          `UPDATE api.pipeline_schedules
              SET next_run_at = $2, updated_at = now()
            WHERE id = $1`,
          [locked.id, nextDue(locked, now)],
        )
      }
      await conn.commit()
    }
  } finally {
    await conn.end()
  }
  const creator = schedule.created_by_user_id ?? 'system'
  for (const runId of startedRunIds) {
    await deps.run(creator, runId)
  }
  return startedRunIds.length
}

/** Recover stale crashed occurrences even when no tick is currently due. */
async function sweepStaleRecovery(
  deps: PipelineSchedulerDeps,
  schedule: ScheduleRow,
): Promise<number> {
  const conn = await deps.connect()
  const startedRunIds: string[] = []
  try {
    await conn.begin()
    const { rows } = await conn.query<ScheduleRow>(
      `SELECT id, workspace_id, definition_id, kind, spec, enabled, last_run_at,
              next_run_at, last_evaluated_at, last_evaluated_sequence,
              created_by_user_id
         FROM api.pipeline_schedules WHERE id = $1 FOR UPDATE`,
      [schedule.id],
    )
    const locked = rows.at(0)
    if (!locked || !locked.enabled || locked.kind === 'event') {
      await conn.rollback()
      return 0
    }
    await setScheduleClaims(conn, locked)
    const versionId = await resolveLatestPublishedVersion(
      conn,
      locked.definition_id,
    )
    if (!versionId) {
      await conn.rollback()
      return 0
    }
    const stale = await recoverStaleRuns(conn, locked)
    for (const s of stale) {
      const retryRunId = await startScheduledRun(
        conn,
        locked,
        versionId,
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
  return startedRunIds.length
}

async function sweepEventSchedule(
  deps: PipelineSchedulerDeps,
  schedule: ScheduleRow,
): Promise<number> {
  const conn = await deps.connect()
  const startedRunIds: string[] = []
  let fired = 0
  try {
    await conn.begin()
    const { rows } = await conn.query<ScheduleRow>(
      `SELECT id, workspace_id, definition_id, kind, spec, enabled, last_run_at,
              next_run_at, last_evaluated_at, last_evaluated_sequence,
              created_by_user_id
         FROM api.pipeline_schedules WHERE id = $1 FOR UPDATE`,
      [schedule.id],
    )
    const locked = rows.at(0)
    if (!locked || !locked.enabled || locked.kind !== 'event') {
      await conn.rollback()
      return 0
    }
    await setScheduleClaims(conn, locked)
    const versionId = await resolveLatestPublishedVersion(
      conn,
      locked.definition_id,
    )

    // Crash recovery FIRST: retry stale event occurrences with their own
    // evt:<event_id> identity. The event cursor does not move backwards —
    // the event was already consumed; its run just needs recovery.
    if (versionId) {
      const stale = await recoverStaleRuns(conn, locked)
      for (const s of stale) {
        const retryRunId = await startScheduledRun(
          conn,
          locked,
          versionId,
          s.input_versions,
          s.parameters,
          'event',
          s.trigger_occurrence_id,
          s.id,
        )
        if (retryRunId) startedRunIds.push(retryRunId)
      }
    }

    const spec = locked.spec as {
      datasetId?: string | null
      inputName?: string
      inputVersions?: Record<string, string>
      parameters?: Record<string, unknown>
    }
    const cursor = Number(locked.last_evaluated_sequence ?? 0)
    const events = await conn.query<ChangeEventRow>(
      `SELECT id, entity_uuid, sequence
         FROM api.change_events
        WHERE workspace_id = $1
          AND entity_type = 'dataset_version'
          AND operation = 'create'
          AND sequence > $2::bigint
          AND ($3::uuid IS NULL OR payload->>'datasetId' IS NULL
               OR (payload->>'datasetId')::uuid = $3::uuid)
        ORDER BY sequence
        LIMIT ${MAX_EVENTS_PER_SWEEP}`,
      [locked.workspace_id, cursor, spec.datasetId ?? null],
    )
    const inputName =
      spec.inputName ?? (await firstInputName(locked.definition_id, conn))
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
      const inputVersions = { ...(spec.inputVersions ?? {}) }
      if (inputName) inputVersions[inputName] = event.entity_uuid
      const runId = await startScheduledRun(
        conn,
        locked,
        eventVersionId,
        inputVersions,
        spec.parameters,
        'event',
        occurrenceId,
        prior?.status === 'failed' ? prior.id : null,
      )
      if (runId) {
        await advanceEventCursor(conn, locked.id, event.sequence)
        await clearTriggerFailure(conn, locked.workspace_id, occurrenceId)
        await conn.commit()
        const creator = locked.created_by_user_id ?? 'system'
        await deps.run(creator, runId)
        fired += 1
      } else {
        // Durable, retryable failure — the event is NOT consumed. After the
        // retry budget the occurrence is explicitly abandoned (visible) and
        // the cursor advances, so a permanently failing event cannot block
        // the queue silently.
        const exhausted = await recordTriggerFailure(
          conn,
          locked,
          occurrenceId,
          event.id,
          'run_start_failed',
          'Scheduled run could not be started.',
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
    return fired
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
): Promise<{ id: string; status: string; started_at: string } | null> {
  const { rows } = await conn.query<RunRow>(
    `SELECT id, status, started_at FROM api.pipeline_runs
      WHERE workspace_id = $1 AND trigger_occurrence_id = $2
      ORDER BY started_at DESC LIMIT 1`,
    [workspaceId, occurrenceId],
  )
  return rows.at(0) ?? null
}

/**
 * Find stale running runs triggered by this schedule (via schedule_id — works
 * for both `sched:` and `evt:` occurrences), fail them as
 * `stale_run_reconciled`, and return their identities + stored inputs so the
 * caller can start a linked retry of the SAME occurrence.
 */
async function recoverStaleRuns(
  conn: SchedulerConnection,
  schedule: ScheduleRow,
): Promise<StaleRun[]> {
  const { rows } = await conn.query<{
    id: string
    trigger_occurrence_id: string
    input_versions: Record<string, string>
    parameters: Record<string, unknown>
  }>(
    `SELECT id, trigger_occurrence_id, input_versions, parameters
       FROM api.pipeline_runs
      WHERE schedule_id = $1
        AND status = 'running'
        AND started_at < clock_timestamp() - ($2 || ' seconds')::interval
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
    return null
  }
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
    run: async (actor, runId) => {
      const execDeps: PipelineExecuteDeps = {
        getSession: async () => ({ user: { id: actor } }),
        connect: defaultConnect,
      }
      return runPipelineExecution(actor, runId, execDeps)
    },
  }

  const tick = async () => {
    try {
      await sweepPipelines(deps)
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
  const client = new Client({ connectionString: env.DATABASE_URL })
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
  schedule: { kind: 'interval' | 'daily'; spec: Record<string, unknown> },
  now: Date,
): string | null {
  return (
    nextRunAt(schedule.kind, schedule.spec as never, now)?.toISOString() ?? null
  )
}
