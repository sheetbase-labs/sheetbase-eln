/**
 * Waking runs that wait for a remote job. Part of the pipeline sweep: ask the
 * scheduler about every open job (src/lib/pipeline-hpc.server.ts), then put each
 * run whose job is done back in the queue. The worker runs it from its first
 * step again, like any run that resumes; the remote job step finds its job and
 * carries on with the answer, or fails the run with the reason.
 */
import { sweepRemoteJobs } from './pipeline-hpc.server'
import type {
  HpcQueryable,
  RemoteJobDeps,
  RemoteSweepReport,
} from './pipeline-hpc.server'
import { wakePipelineWorker } from './pipeline-queue.server'

export interface SweepConnection extends HpcQueryable {
  begin: () => Promise<void>
  commit: () => Promise<void>
  rollback: () => Promise<void>
  end: () => Promise<void>
}

export interface RemoteResumeReport extends RemoteSweepReport {
  resumed: number
}

/** Put a waiting run back to running and queue it. False when it was not waiting. */
export async function resumeWaitingRun(
  conn: HpcQueryable,
  runId: string,
): Promise<boolean> {
  const { rows: runs } = await conn.query<{
    workspace_id: string
    actor_user_id: string | null
  }>(
    `SELECT workspace_id, actor_user_id FROM api.pipeline_runs
      WHERE id = $1 AND status = 'waiting' FOR UPDATE`,
    [runId],
  )

  const run = runs.at(0)

  // A run with no person to act as cannot be queued; it stays as it is.
  if (!run || !run.actor_user_id) return false

  await conn.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({
      role: 'authenticated',
      sub: run.actor_user_id,
      workspace_id: run.workspace_id,
    }),
  ])

  // The worker that put the run to wait may still hold its job for a moment.
  await conn.query(
    `UPDATE internal.pipeline_run_jobs
        SET state = 'done', finished_at = now(), claimed_by = NULL,
            lease_expires_at = NULL, last_error = 'Superseded by a resumption.'
      WHERE run_id = $1 AND kind = 'execute' AND state IN ('queued', 'claimed')`,
    [runId],
  )

  const { rowCount } = await conn.query(
    `UPDATE api.pipeline_runs SET status = 'running', result = '{}'::jsonb
      WHERE id = $1 AND status = 'waiting'`,
    [runId],
  )

  if (!rowCount) return false

  await conn.query(
    `INSERT INTO internal.pipeline_run_jobs(run_id, workspace_id, kind, actor_user_id)
     VALUES ($1, $2, 'execute', $3)
     ON CONFLICT DO NOTHING`,
    [runId, run.workspace_id, run.actor_user_id],
  )

  return true
}

async function transaction<T>(
  connect: () => Promise<SweepConnection>,
  fn: (conn: SweepConnection) => Promise<T>,
): Promise<T> {
  const conn = await connect()

  try {
    await conn.begin()

    const result = await fn(conn)

    await conn.commit()

    return result
  } catch (error) {
    await conn.rollback().catch(() => {})
    throw error
  } finally {
    await conn.end().catch(() => {})
  }
}

export async function wakeRemoteJobRuns(
  connect: () => Promise<SweepConnection>,
  deps: RemoteJobDeps,
): Promise<RemoteResumeReport> {
  const report = await sweepRemoteJobs((fn) => transaction(connect, fn), deps)
  let resumed = 0

  for (const runId of report.ready) {
    const woke = await transaction(connect, (conn) =>
      resumeWaitingRun(conn, runId),
    ).catch(() => false)

    if (woke) resumed += 1
  }

  if (resumed > 0) wakePipelineWorker()

  return { ...report, resumed }
}
