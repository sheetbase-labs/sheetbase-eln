/**
 * AUTO-02 — Pipeline schedule/event sweep (server-side).
 *
 * Evaluates enabled schedules and starts + executes runs:
 *
 *   - interval/daily schedules fire when next_run_at <= now against the
 *     latest published version of the definition, with the schedule's fixed
 *     parameters and input_versions.
 *   - event schedules poll the durable change_events stream (LIVE-001) for
 *     dataset_version_created events since last_evaluated_at and fire one
 *     run per event. This is a polling approximation of event delivery, not
 *     real-time push — documented in docs/pipelines.md.
 *
 * Every run is started through api.start_pipeline_run with the schedule
 * creator's identity (manual/scheduled/event trigger vocabulary) and
 * executed by the same server executor as browser runs. Schedule rows are
 * locked FOR UPDATE only for the start decision, never for execution, so
 * concurrent sweepers (or a long run) cannot double-fire or block each
 * other. All failures are contained — the sweep never crashes the server.
 */
import { Client } from 'pg'
import type { QueryResultRow } from 'pg'

import { env } from '#/env.server'
import { runPipelineExecution } from './pipeline-execute.server'
import type { PipelineExecuteDeps } from './pipeline-execute.server'
import { nextRunAt } from './pipeline-schedule'

const SWEEP_INTERVAL_MS = 60_000
const MAX_EVENTS_PER_SWEEP = 20

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
  created_by_user_id: string | null
}

interface ChangeEventRow {
  entity_uuid: string
  created_at: string
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
              s.created_by_user_id
         FROM api.pipeline_schedules s
         JOIN api.pipeline_definitions d ON d.id = s.definition_id
        WHERE s.enabled AND d.lifecycle = 'active'
        ORDER BY s.id`,
    )
    await conn.commit()

    for (const schedule of rows) {
      if (schedule.kind === 'event') {
        const fired = await sweepEventSchedule(deps, schedule)
        started += fired
      } else {
        const due = schedule.next_run_at
          ? new Date(schedule.next_run_at).getTime() <= now.getTime()
          : true
        if (due) {
          const fired = await sweepTimedSchedule(deps, schedule, now)
          if (fired) started += 1
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
): Promise<boolean> {
  const conn = await deps.connect()
  try {
    // Lock the schedule row so concurrent sweepers cannot double-fire.
    await conn.begin()
    const { rows } = await conn.query<ScheduleRow>(
      `SELECT id, workspace_id, definition_id, kind, spec, enabled, last_run_at,
              next_run_at, last_evaluated_at, created_by_user_id
         FROM api.pipeline_schedules WHERE id = $1 FOR UPDATE`,
      [schedule.id],
    )
    const locked = rows.at(0)
    if (!locked || !locked.enabled || locked.kind === 'event') {
      await conn.rollback()
      return false
    }
    const due = locked.next_run_at
      ? new Date(locked.next_run_at).getTime() <= now.getTime()
      : true
    if (!due) {
      await conn.rollback()
      return false
    }

    const versionId = await resolveLatestPublishedVersion(
      conn,
      locked.definition_id,
    )
    if (!versionId) {
      // No published version yet: skip and back off.
      await conn.query(
        `UPDATE api.pipeline_schedules
            SET next_run_at = $2, updated_at = now()
          WHERE id = $1`,
        [locked.id, nextDue({ kind: locked.kind, spec: locked.spec }, now)],
      )
      await conn.commit()
      return false
    }

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
    )
    if (runId) {
      await conn.query(
        `UPDATE api.pipeline_schedules
            SET last_run_at = now(), next_run_at = $2, updated_at = now()
          WHERE id = $1`,
        [locked.id, nextDue({ kind: locked.kind, spec: locked.spec }, now)],
      )
    } else {
      // start failed (e.g. creator no longer a writer); back off one cycle.
      await conn.query(
        `UPDATE api.pipeline_schedules
            SET next_run_at = $2, updated_at = now()
          WHERE id = $1`,
        [locked.id, nextDue({ kind: locked.kind, spec: locked.spec }, now)],
      )
    }
    await conn.commit()

    if (runId) {
      const creator = locked.created_by_user_id ?? 'system'
      await deps.run(creator, runId)
      return true
    }
    return false
  } finally {
    await conn.end()
  }
}

async function sweepEventSchedule(
  deps: PipelineSchedulerDeps,
  schedule: ScheduleRow,
): Promise<number> {
  const conn = await deps.connect()
  let fired = 0
  try {
    await conn.begin()
    const { rows } = await conn.query<ScheduleRow>(
      `SELECT id, workspace_id, definition_id, kind, spec, enabled, last_run_at,
              next_run_at, last_evaluated_at, created_by_user_id
         FROM api.pipeline_schedules WHERE id = $1 FOR UPDATE`,
      [schedule.id],
    )
    const locked = rows.at(0)
    if (!locked || !locked.enabled || locked.kind !== 'event') {
      await conn.rollback()
      return 0
    }
    const spec = locked.spec as {
      datasetId?: string | null
      inputName?: string
      inputVersions?: Record<string, string>
      parameters?: Record<string, unknown>
    }
    const cursor = locked.last_evaluated_at
      ? new Date(locked.last_evaluated_at).toISOString()
      : new Date(0).toISOString()
    const events = await conn.query<ChangeEventRow>(
      `SELECT entity_uuid, created_at
         FROM api.change_events
        WHERE workspace_id = $1
          AND entity_type = 'dataset_version'
          AND operation = 'create'
          AND created_at > $2::timestamptz
          AND ($3::uuid IS NULL OR payload->>'datasetId' IS NULL
               OR (payload->>'datasetId')::uuid = $3::uuid)
        ORDER BY created_at, sequence
        LIMIT ${MAX_EVENTS_PER_SWEEP}`,
      [locked.workspace_id, cursor, spec.datasetId ?? null],
    )
    const inputName =
      spec.inputName ?? (await firstInputName(locked.definition_id, conn))
    await conn.rollback()

    for (const event of events.rows) {
      // Each event is consumed exactly once: the cursor is advanced in the
      // same transaction that starts the run, before execution begins on a
      // separate connection. A concurrent sweeper therefore skips it.
      await conn.begin()
      const { rows: fresh } = await conn.query<{
        last_evaluated_at: string | null
      }>(
        `SELECT last_evaluated_at FROM api.pipeline_schedules WHERE id = $1 FOR UPDATE`,
        [locked.id],
      )
      const cursorRow = fresh.at(0)
      const currentCursor = cursorRow?.last_evaluated_at
        ? new Date(cursorRow.last_evaluated_at).toISOString()
        : new Date(0).toISOString()
      if (
        new Date(event.created_at).getTime() <=
        new Date(currentCursor).getTime()
      ) {
        await conn.rollback()
        continue
      }
      const versionId = await resolveLatestPublishedVersion(
        conn,
        locked.definition_id,
      )
      if (!versionId) {
        await conn.rollback()
        break
      }
      const inputVersions = { ...(spec.inputVersions ?? {}) }
      if (inputName) inputVersions[inputName] = event.entity_uuid
      const runId = await startScheduledRun(
        conn,
        locked,
        versionId,
        inputVersions,
        spec.parameters,
        'event',
      )
      // The event is consumed whether or not the start succeeded; a failed
      // start is best-effort and not retried (documented).
      await conn.query(
        `UPDATE api.pipeline_schedules
            SET last_evaluated_at = $2, last_run_at = now(), updated_at = now()
          WHERE id = $1`,
        [locked.id, event.created_at],
      )
      await conn.commit()
      if (runId) {
        const creator = locked.created_by_user_id ?? 'system'
        await deps.run(creator, runId)
        fired += 1
      }
    }
    return fired
  } finally {
    await conn.end()
  }
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
         $1, $2, $3, $4::jsonb, $5::jsonb, NULL, NULL
       )).id AS id`,
      [
        schedule.workspace_id,
        versionId,
        triggerKind,
        JSON.stringify(parameters ?? {}),
        JSON.stringify(inputVersions ?? {}),
      ],
    )
    await conn.query('RELEASE SAVEPOINT sb_schedule_start')
    return rows.at(0)?.id ?? null
  } catch (error) {
    // e.g. the schedule creator left the workspace or the version was
    // retired between resolution and start. Restore the transaction so the
    // caller can back off cleanly; the run never starts.
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
