/**
 * HTTP surface for executing pipeline runs.
 *
 * Executing a run never happens inside a request: POST only makes sure the run
 * is queued (or, for a decision on a waiting run, queues its continuation) and
 * returns at once; a worker (./pipeline-queue.server) does the work. GET reports
 * the run and its queue state so a client can follow it to the end.
 */
import { Client } from 'pg'
import type { QueryResultRow } from 'pg'

import { env } from '#/env.server'
import { getAppSession } from '#/lib/auth'
import { validatePipelineResume } from './pipeline-execute.server'
import type {
  ExecConnection,
  PipelineExecuteDeps,
} from './pipeline-execute.server'
import {
  enqueuePipelineResume,
  enqueuePipelineRun,
  getPipelineJobState,
  wakePipelineWorker,
} from './pipeline-queue.server'
import type { PipelineJobState } from './pipeline-queue.server'
import type { PipelineRunWire } from './pipelines/types'

export interface PipelineRunRequestDeps {
  getSession: (headers: Headers) => Promise<{ user: { id: string } } | null>
  connect: () => Promise<ExecConnection>
  /** Called after something is queued so a local worker looks right away. */
  wake?: () => void
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function responseError(
  status: number,
  code: string,
  message: string,
): Response {
  return Response.json({ error: { code, message } }, { status })
}

interface RunAccess {
  workspace_id: string
  status: string
  role: string | null
}

async function loadAccess(
  conn: ExecConnection,
  runId: string,
  userId: string,
): Promise<RunAccess | null> {
  const { rows } = await conn.query<RunAccess & QueryResultRow>(
    `SELECT r.workspace_id, r.status,
            (SELECT m.role FROM api.workspace_memberships m
              WHERE m.workspace_id = r.workspace_id AND m.user_id = $2
                AND m.suspended_at IS NULL) AS role
       FROM api.pipeline_runs r WHERE r.id = $1`,
    [runId, userId],
  )
  return rows.at(0) ?? null
}

async function loadRunWire(
  conn: ExecConnection,
  runId: string,
): Promise<PipelineRunWire | null> {
  const { rows } = await conn.query<PipelineRunWire & QueryResultRow>(
    'SELECT * FROM api.pipeline_runs WHERE id = $1',
    [runId],
  )
  return rows.at(0) ?? null
}

/** Statuses the answer path used to report, kept for the existing client. */
function answerStatus(code: string | undefined): number {
  if (code === 'run_not_found') return 404
  if (code === 'invalid_answer') return 400
  return 409
}

/**
 * POST /api/pipelines/execute
 *
 *  - `{ runId }` queues a started (`running`) run, idempotently, and answers
 *    202 with the run; a run that already settled answers 200 unchanged.
 *  - `{ runId, answer }` checks a decision on a waiting run and queues its
 *    resumption; a bad decision is refused here, before anything is queued.
 */
export async function handlePipelineExecute(
  request: Request,
  deps: PipelineRunRequestDeps = defaultDeps,
): Promise<Response> {
  const session = await deps.getSession(request.headers)
  if (!session) {
    return responseError(401, 'unauthenticated', 'Authentication is required.')
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return responseError(
      400,
      'invalid_request',
      'A JSON request body is required.',
    )
  }
  const runId =
    body &&
    typeof body === 'object' &&
    'runId' in body &&
    typeof body.runId === 'string'
      ? body.runId
      : null
  if (!runId || !UUID.test(runId)) {
    return responseError(400, 'invalid_request', 'A valid runId is required.')
  }
  const hasAnswer =
    body !== null && typeof body === 'object' && 'answer' in body
  const answer = hasAnswer ? (body as { answer: unknown }).answer : undefined
  const userId = session.user.id

  const conn = await deps.connect()
  try {
    const access = await loadAccess(conn, runId, userId)
    if (!access)
      return responseError(404, 'run_not_found', 'Pipeline run not found.')
    // GOV-01 writer set: anyone but the read-only viewer may run pipelines.
    if (!access.role || access.role === 'viewer') {
      return responseError(
        hasAnswer ? 409 : 422,
        'workspace_membership_required',
        'You are not a workspace writer for the workspace that owns this run.',
      )
    }

    if (hasAnswer) {
      const checked = await validatePipelineResume(
        userId,
        runId,
        answer,
        pipelineExecuteDeps(deps),
      )
      if (!checked.ok) {
        return responseError(
          answerStatus(checked.report.errorCode),
          checked.report.errorCode ?? 'execution_failed',
          checked.report.errorMessage ?? 'The decision was rejected.',
        )
      }
      const queued = await enqueuePipelineResume(conn, {
        runId,
        workspaceId: access.workspace_id,
        actorUserId: userId,
        answer,
      })
      if (!queued) {
        return responseError(
          409,
          'run_not_waiting',
          'This run is already being resumed.',
        )
      }
      ;(deps.wake ?? wakePipelineWorker)()
      return Response.json(await loadRunWire(conn, runId), { status: 202 })
    }

    if (access.status === 'running') {
      await enqueuePipelineRun(conn, runId)
      ;(deps.wake ?? wakePipelineWorker)()
      return Response.json(await loadRunWire(conn, runId), { status: 202 })
    }
    // Already settled (or waiting for a person): nothing to queue.
    return Response.json(await loadRunWire(conn, runId))
  } finally {
    await conn.end().catch(() => {})
  }
}

export interface PipelineRunStateBody {
  run: PipelineRunWire
  job: PipelineJobState | null
}

/**
 * GET /api/pipelines/execute?runId=… — the run and its queue state. A client
 * follows a run until `job` is absent or settled (`done` or `dead`).
 */
export async function handlePipelineRunState(
  request: Request,
  deps: PipelineRunRequestDeps = defaultDeps,
): Promise<Response> {
  const session = await deps.getSession(request.headers)
  if (!session) {
    return responseError(401, 'unauthenticated', 'Authentication is required.')
  }
  const runId = new URL(request.url).searchParams.get('runId')
  if (!runId || !UUID.test(runId)) {
    return responseError(400, 'invalid_request', 'A valid runId is required.')
  }
  const conn = await deps.connect()
  try {
    const access = await loadAccess(conn, runId, session.user.id)
    if (!access?.role)
      return responseError(404, 'run_not_found', 'Pipeline run not found.')
    const run = await loadRunWire(conn, runId)
    if (!run)
      return responseError(404, 'run_not_found', 'Pipeline run not found.')
    const body: PipelineRunStateBody = {
      run,
      job: await getPipelineJobState(conn, runId),
    }
    return Response.json(body, { headers: { 'Cache-Control': 'no-store' } })
  } finally {
    await conn.end().catch(() => {})
  }
}

function pipelineExecuteDeps(
  deps: PipelineRunRequestDeps,
): PipelineExecuteDeps {
  return { getSession: deps.getSession, connect: deps.connect }
}

const defaultDeps: PipelineRunRequestDeps = {
  getSession: getAppSession,
  async connect() {
    const client = new Client({
      connectionString: env.DATABASE_URL,
      query_timeout: 30_000,
    })
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
