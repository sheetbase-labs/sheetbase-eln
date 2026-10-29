/**
 * PIPE-EXEC — the durable pipeline run queue and its worker.
 *
 * Every started run has a row in `internal.pipeline_run_jobs`, inserted by a
 * trigger in the same transaction that created the run, so a run cannot exist
 * without something that will execute it. Workers claim jobs with
 * `FOR UPDATE SKIP LOCKED` under a lease that a heartbeat keeps renewing:
 *
 *   - any number of workers (one per web replica, or dedicated ones) can run
 *     side by side and never take the same job;
 *   - a worker that dies stops heartbeating, its lease expires and another
 *     worker re-claims the job; after `max_attempts` claims the job is
 *     abandoned and its run failed visibly rather than left running;
 *   - the HTTP route only enqueues and reads state, so a request never holds a
 *     pipeline open, and a closed tab or a restart does not orphan a run.
 *
 * The executor (`runPipelineExecution` / `resumePipelineRun`) is unchanged and
 * stays idempotent: a re-claimed job re-enters it, and its advisory lock keeps
 * two executors off the same run even if a lease is lost while one is alive.
 */
import { randomUUID } from 'node:crypto'

import { PooledClient } from '#/db/pool.server'
import type { QueryResultRow } from 'pg'

import { env } from '#/env.server'
import {
  failStuckPipelineRun,
  resumePipelineRun,
  runPipelineExecution,
} from './pipeline-execute.server'
import type {
  PipelineExecuteDeps,
  PipelineExecuteReport,
} from './pipeline-execute.server'

export interface QueueConnection {
  query: <T extends QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: T[]; rowCount?: number | null }>
  end: () => Promise<void>
}

export type PipelineJobKind = 'execute' | 'resume'

export interface PipelineJob {
  id: string
  runId: string
  workspaceId: string
  kind: PipelineJobKind
  actorUserId: string
  payload: Record<string, unknown>
  attempts: number
  maxAttempts: number
}

export interface PipelineJobState {
  kind: PipelineJobKind
  state: 'queued' | 'claimed' | 'done' | 'dead'
  attempts: number
  maxAttempts: number
  availableAt: string
  claimedAt: string | null
  leaseExpiresAt: string | null
  lastError: string | null
  enqueuedAt: string
  finishedAt: string | null
}

/** A worker that stops heartbeating loses its job after this long. */
export const JOB_LEASE_SECONDS = 120
const POLL_INTERVAL_MS = 2_000
const ORPHAN_SCAN_INTERVAL_MS = 30_000
/** Failures that retrying cannot fix: the run is failed, not retried. */
const PERMANENT_ERROR_CODES = new Set([
  'workspace_membership_required',
  'run_not_found',
])

interface JobRow {
  id: string
  run_id: string
  workspace_id: string
  kind: PipelineJobKind
  actor_user_id: string
  payload: Record<string, unknown>
  attempts: number
  max_attempts: number
}

function toJob(row: JobRow): PipelineJob {
  return {
    id: row.id,
    runId: row.run_id,
    workspaceId: row.workspace_id,
    kind: row.kind,
    actorUserId: row.actor_user_id,
    payload: row.payload,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
  }
}

// ---------------------------------------------------------------------------
// Enqueue.
// ---------------------------------------------------------------------------

/**
 * Make sure a running run has a job. Runs started by `api.start_pipeline_run`
 * already do (the trigger), so this is the idempotent safety net for runs that
 * predate the queue and for an execute request that arrives first.
 */
export async function enqueuePipelineRun(
  conn: QueueConnection,
  runId: string,
): Promise<void> {
  await conn.query(
    `INSERT INTO internal.pipeline_run_jobs(run_id, workspace_id, kind, actor_user_id)
     SELECT r.id, r.workspace_id, 'execute', r.actor_user_id
       FROM api.pipeline_runs r
      WHERE r.id = $1 AND r.status = 'running' AND r.actor_user_id IS NOT NULL
     ON CONFLICT DO NOTHING`,
    [runId],
  )
}

/**
 * Queue the continuation of a waiting run once a person has decided. The
 * decision is validated and recorded by the worker through the same executor
 * path an inline resume used; the job carries it.
 */
export async function enqueuePipelineResume(
  conn: QueueConnection,
  input: {
    runId: string
    workspaceId: string
    actorUserId: string
    answer: unknown
  },
): Promise<boolean> {
  // A run only waits once its executor has committed, so an execute job still
  // open at this point is just about to settle: retire it so it cannot block
  // the resumption (the worker that held it no longer owns the job).
  await conn.query(
    `UPDATE internal.pipeline_run_jobs
        SET state = 'done', finished_at = now(), claimed_by = NULL,
            lease_expires_at = NULL, last_error = 'Superseded by a resumption.'
      WHERE run_id = $1 AND kind = 'execute' AND state IN ('queued', 'claimed')
        AND EXISTS (SELECT 1 FROM api.pipeline_runs r
                     WHERE r.id = $1 AND r.status = 'waiting')`,
    [input.runId],
  )
  const { rowCount } = await conn.query(
    `INSERT INTO internal.pipeline_run_jobs(run_id, workspace_id, kind, actor_user_id, payload)
     VALUES ($1, $2, 'resume', $3, $4::jsonb)
     ON CONFLICT DO NOTHING`,
    [
      input.runId,
      input.workspaceId,
      input.actorUserId,
      JSON.stringify({ answer: input.answer }),
    ],
  )
  return (rowCount ?? 0) > 0
}

/** The newest job for a run, or null when it never had one. */
export async function getPipelineJobState(
  conn: QueueConnection,
  runId: string,
): Promise<PipelineJobState | null> {
  const { rows } = await conn.query<{
    kind: PipelineJobKind
    state: PipelineJobState['state']
    attempts: number
    max_attempts: number
    available_at: Date
    claimed_at: Date | null
    lease_expires_at: Date | null
    last_error: string | null
    enqueued_at: Date
    finished_at: Date | null
  }>(
    `SELECT kind, state, attempts, max_attempts, available_at, claimed_at,
            lease_expires_at, last_error, enqueued_at, finished_at
       FROM internal.pipeline_run_jobs
      WHERE run_id = $1
      ORDER BY enqueued_at DESC LIMIT 1`,
    [runId],
  )
  const row = rows.at(0)
  if (!row) return null
  const iso = (value: Date | null) => (value ? value.toISOString() : null)
  return {
    kind: row.kind,
    state: row.state,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    availableAt: row.available_at.toISOString(),
    claimedAt: iso(row.claimed_at),
    leaseExpiresAt: iso(row.lease_expires_at),
    lastError: row.last_error,
    enqueuedAt: row.enqueued_at.toISOString(),
    finishedAt: iso(row.finished_at),
  }
}

// ---------------------------------------------------------------------------
// Claim, heartbeat, settle.
// ---------------------------------------------------------------------------

/**
 * Take the oldest ready job, or an expired claim that still has attempts left.
 * SKIP LOCKED lets concurrent workers pass over each other's picks.
 */
export async function claimPipelineJob(
  conn: QueueConnection,
  workerId: string,
  leaseSeconds: number = JOB_LEASE_SECONDS,
): Promise<PipelineJob | null> {
  const { rows } = await conn.query<JobRow>(
    `WITH next AS (
       SELECT id FROM internal.pipeline_run_jobs
        WHERE (state = 'queued' AND available_at <= now())
           OR (state = 'claimed' AND lease_expires_at < now() AND attempts < max_attempts)
        ORDER BY available_at, enqueued_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
     UPDATE internal.pipeline_run_jobs j
        SET state = 'claimed', claimed_by = $1, claimed_at = now(),
            lease_expires_at = now() + make_interval(secs => $2::int),
            attempts = j.attempts + 1
       FROM next
      WHERE j.id = next.id
      RETURNING j.id, j.run_id, j.workspace_id, j.kind, j.actor_user_id,
                j.payload, j.attempts, j.max_attempts`,
    [workerId, leaseSeconds],
  )
  const row = rows.at(0)
  return row ? toJob(row) : null
}

/** Extend the lease while the job is still ours. False means it was taken. */
export async function heartbeatPipelineJob(
  conn: QueueConnection,
  jobId: string,
  workerId: string,
  leaseSeconds: number = JOB_LEASE_SECONDS,
): Promise<boolean> {
  const { rowCount } = await conn.query(
    `UPDATE internal.pipeline_run_jobs
        SET lease_expires_at = now() + make_interval(secs => $3::int)
      WHERE id = $1 AND claimed_by = $2 AND state = 'claimed'`,
    [jobId, workerId, leaseSeconds],
  )
  return (rowCount ?? 0) > 0
}

async function finishJob(
  conn: QueueConnection,
  job: PipelineJob,
  workerId: string,
  state: 'done' | 'dead',
  lastError: string | null,
): Promise<void> {
  await conn.query(
    `UPDATE internal.pipeline_run_jobs
        SET state = $3, finished_at = now(), claimed_by = NULL,
            lease_expires_at = NULL, last_error = $4
      WHERE id = $1 AND claimed_by = $2 AND state = 'claimed'`,
    [job.id, workerId, state, lastError],
  )
}

/** Put a claimed job back, to be tried again after `delaySeconds`. */
async function releaseJob(
  conn: QueueConnection,
  job: PipelineJob,
  workerId: string,
  delaySeconds: number,
  lastError: string | null,
  countAttempt: boolean,
): Promise<void> {
  await conn.query(
    `UPDATE internal.pipeline_run_jobs
        SET state = 'queued', claimed_by = NULL, lease_expires_at = NULL,
            available_at = now() + make_interval(secs => $3::int),
            attempts = CASE WHEN $5::boolean THEN attempts ELSE greatest(attempts - 1, 0) END,
            last_error = $4
      WHERE id = $1 AND claimed_by = $2 AND state = 'claimed'`,
    [job.id, workerId, delaySeconds, lastError, countAttempt],
  )
}

/** Retry delay: 10s, 40s, 90s ... after the nth failed attempt. */
export function retryDelaySeconds(attempt: number): number {
  return 10 * attempt * attempt
}

export interface PipelineWorkerDeps {
  /** Opens the connection the queue statements run on. */
  connect: () => Promise<QueueConnection>
  execute: (actor: string, runId: string) => Promise<PipelineExecuteReport>
  resume: (
    actor: string,
    runId: string,
    answer: unknown,
  ) => Promise<PipelineExecuteReport>
  /** Fail a run whose job can no longer be attempted. */
  failRun: (runId: string, code: string, message: string) => Promise<void>
  workerId: string
  leaseSeconds?: number
  /** How long a job waits after finding its run or workspace busy. */
  busyDelaySeconds?: number
}

/**
 * Abandon jobs whose lease expired with no attempts left: the run is failed
 * with a visible reason instead of staying `running` forever.
 */
export async function reapAbandonedJobs(
  conn: QueueConnection,
  deps: Pick<PipelineWorkerDeps, 'failRun'>,
): Promise<number> {
  const { rows } = await conn.query<{ run_id: string }>(
    `UPDATE internal.pipeline_run_jobs
        SET state = 'dead', finished_at = now(), claimed_by = NULL,
            lease_expires_at = NULL,
            last_error = 'The worker executing this run stopped responding.'
      WHERE state = 'claimed' AND lease_expires_at < now() AND attempts >= max_attempts
      RETURNING run_id`,
  )
  for (const row of rows)
    await deps
      .failRun(
        row.run_id,
        'worker_lost',
        'The worker executing this run stopped responding and no attempts remain.',
      )
      .catch(() => {})
  return rows.length
}

/**
 * Give runs that have no job at all one (runs started before the queue existed,
 * or by a path that bypassed the trigger). A run that ever had a job is left to
 * the lease and staleness rules.
 */
export async function adoptOrphanedRuns(
  conn: QueueConnection,
): Promise<number> {
  const { rowCount } = await conn.query(
    `INSERT INTO internal.pipeline_run_jobs(run_id, workspace_id, kind, actor_user_id)
     SELECT r.id, r.workspace_id, 'execute', r.actor_user_id
       FROM api.pipeline_runs r
      WHERE r.status = 'running' AND r.actor_user_id IS NOT NULL
        AND r.started_at < now() - interval '30 seconds'
        AND NOT EXISTS (SELECT 1 FROM internal.pipeline_run_jobs j WHERE j.run_id = r.id)
     ON CONFLICT DO NOTHING`,
  )
  return rowCount ?? 0
}

async function runStatus(
  conn: QueueConnection,
  runId: string,
): Promise<string | null> {
  const { rows } = await conn.query<{ status: string }>(
    'SELECT status FROM api.pipeline_runs WHERE id = $1',
    [runId],
  )
  return rows.at(0)?.status ?? null
}

/**
 * Run one claimed job to a settled state. The run row is the source of truth:
 * if the executor left it `running` the job is retried (or abandoned), and if
 * the run reached any other state the job is done.
 */
export async function processPipelineJob(
  conn: QueueConnection,
  job: PipelineJob,
  deps: PipelineWorkerDeps,
): Promise<'done' | 'retry' | 'dead' | 'deferred'> {
  const lease = deps.leaseSeconds ?? JOB_LEASE_SECONDS
  const heartbeat = setInterval(
    () =>
      void heartbeatPipelineJob(conn, job.id, deps.workerId, lease).catch(
        () => {},
      ),
    Math.max(1_000, (lease * 1000) / 3),
  )
  heartbeat.unref()
  let report: PipelineExecuteReport | null = null
  let thrown: string | null = null
  try {
    report =
      job.kind === 'resume'
        ? await deps.resume(job.actorUserId, job.runId, job.payload.answer)
        : await deps.execute(job.actorUserId, job.runId)
  } catch (error) {
    thrown = error instanceof Error ? error.message : String(error)
  } finally {
    clearInterval(heartbeat)
  }

  const status = await runStatus(conn, job.runId)
  const errorMessage = thrown ?? report?.errorMessage ?? null
  const errorCode = report?.errorCode

  if (
    !thrown &&
    (report?.errorCode === 'run_not_running' ||
      report?.errorCode === 'workspace_busy')
  ) {
    // Another executor holds the run, or the workspace, right now: look again
    // shortly without spending an attempt.
    await releaseJob(
      conn,
      job,
      deps.workerId,
      deps.busyDelaySeconds ?? 5,
      errorMessage,
      false,
    )
    return 'deferred'
  }
  if (status !== 'running') {
    // The run reached a state of its own (finished, waiting, cancelled, gone).
    // A rejected answer leaves the run waiting; keep the reason for the job.
    await finishJob(
      conn,
      job,
      deps.workerId,
      'done',
      report?.ok ? null : errorMessage,
    )
    return 'done'
  }
  if (!thrown && report?.ok && job.kind === 'resume') {
    await finishJob(conn, job, deps.workerId, 'done', null)
    return 'done'
  }
  // Still running: the executor stopped before it could settle the run.
  const permanent =
    errorCode !== undefined && PERMANENT_ERROR_CODES.has(errorCode)
  if (permanent || job.attempts >= job.maxAttempts) {
    await finishJob(conn, job, deps.workerId, 'dead', errorMessage)
    await deps
      .failRun(
        job.runId,
        errorCode ?? 'job_failed',
        errorMessage ?? 'The pipeline run could not be executed.',
      )
      .catch(() => {})
    return 'dead'
  }
  await releaseJob(
    conn,
    job,
    deps.workerId,
    retryDelaySeconds(job.attempts),
    errorMessage,
    true,
  )
  return 'retry'
}

/**
 * Claim and run jobs until none is ready, up to `concurrency` at a time and
 * `maxJobs` in total. Returns how many jobs it processed.
 */
export async function runPipelineJobs(
  deps: PipelineWorkerDeps,
  options: { concurrency?: number; maxJobs?: number } = {},
): Promise<number> {
  const concurrency = options.concurrency ?? 1
  const maxJobs = options.maxJobs ?? Number.POSITIVE_INFINITY
  const claimConn = await deps.connect()
  let processed = 0
  let claimed = 0
  let drained = false
  const lanes: Array<Promise<void>> = []
  try {
    await reapAbandonedJobs(claimConn, deps)
    const lane = async () => {
      // Each lane settles on its own connection so a heartbeat is never queued
      // behind another lane's statements.
      const conn = await deps.connect()
      try {
        while (!drained && claimed < maxJobs) {
          const job = await claimPipelineJob(
            claimConn,
            deps.workerId,
            deps.leaseSeconds,
          )
          if (!job) {
            drained = true
            return
          }
          claimed += 1
          await processPipelineJob(conn, job, deps)
          processed += 1
        }
      } finally {
        await conn.end().catch(() => {})
      }
    }
    for (let i = 0; i < concurrency; i += 1) lanes.push(lane())
    await Promise.all(lanes)
  } finally {
    await claimConn.end().catch(() => {})
  }
  return processed
}

// ---------------------------------------------------------------------------
// Process-level worker.
// ---------------------------------------------------------------------------

async function connectQueue(): Promise<QueueConnection> {
  const client = new PooledClient({ connectionString: env.DATABASE_URL })
  await client.connect()
  return {
    query: async (text, values = []) => client.query(text, values),
    end: () => client.end(),
  }
}

/** Execution dependencies for a job: the actor is the job's, never a request's. */
function executeDeps(actor: string): PipelineExecuteDeps {
  return {
    getSession: async () => ({ user: { id: actor } }),
    connect: async () => {
      const client = new PooledClient({ connectionString: env.DATABASE_URL })
      await client.connect()
      return {
        query: async (text, values = []) => client.query(text, values),
        begin: () => client.query('BEGIN').then(() => undefined),
        commit: () => client.query('COMMIT').then(() => undefined),
        rollback: () => client.query('ROLLBACK').then(() => undefined),
        end: () => client.end(),
      }
    },
  }
}

export function createPipelineWorkerDeps(
  workerId: string = `${process.env.HOSTNAME ?? 'worker'}:${process.pid}:${randomUUID().slice(0, 8)}`,
): PipelineWorkerDeps {
  return {
    connect: connectQueue,
    workerId,
    execute: (actor, runId) =>
      runPipelineExecution(actor, runId, executeDeps(actor)),
    resume: (actor, runId, answer) =>
      resumePipelineRun(actor, runId, answer, executeDeps(actor)),
    failRun: (runId, code, message) =>
      failStuckPipelineRun(executeDeps('system'), runId, code, message),
  }
}

let wake: (() => void) | null = null

/** Nudge this process's worker to look for jobs now instead of at the next poll. */
export function wakePipelineWorker(): void {
  wake?.()
}

let stopWorker: (() => void) | null = null
const startedGlobalKey = '__sheetbasePipelineWorkerStarted'

/**
 * Start the worker loop in this process. Disable it on a replica that should
 * only serve requests with SHEETBASE_PIPELINE_WORKER=false; set
 * PIPELINE_WORKER_CONCURRENCY to run more than two jobs at once.
 */
export function startPipelineWorker(
  deps: PipelineWorkerDeps = createPipelineWorkerDeps(),
): void {
  if (typeof window !== 'undefined') return
  if (
    process.env.NODE_ENV === 'test' ||
    process.env.VITEST === 'true' ||
    process.env.SHEETBASE_PIPELINE_WORKER === 'false'
  ) {
    return
  }
  const g = globalThis as unknown as Record<string, unknown>
  if (g[startedGlobalKey]) return
  g[startedGlobalKey] = true

  const parsed = Number.parseInt(
    process.env.PIPELINE_WORKER_CONCURRENCY ?? '',
    10,
  )
  const concurrency = Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, 1), 8)
    : 2
  let stopped = false
  stopWorker = () => {
    stopped = true
    wake?.()
  }
  let lastAdopted = 0

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms)
      timer.unref()
      wake = () => {
        clearTimeout(timer)
        resolve()
      }
    })

  void (async () => {
    // Give the server a moment to finish booting before the first claim.
    await sleep(2_000)
    // `stopped` is flipped by the returned stop() while this loop awaits.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (!stopped) {
      try {
        if (Date.now() - lastAdopted > ORPHAN_SCAN_INTERVAL_MS) {
          lastAdopted = Date.now()
          const conn = await deps.connect()
          try {
            await adoptOrphanedRuns(conn)
          } finally {
            await conn.end().catch(() => {})
          }
        }
        const processed = await runPipelineJobs(deps, { concurrency })
        if (processed === 0) await sleep(POLL_INTERVAL_MS)
      } catch (error) {
        console.warn(
          JSON.stringify({
            level: 'warn',
            message: 'pipeline worker pass failed',
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString(),
          }),
        )
        await sleep(POLL_INTERVAL_MS * 5)
      }
    }
  })()
}

export function stopPipelineWorker(): void {
  stopWorker?.()
}
