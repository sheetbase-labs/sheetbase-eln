/**
 * HTTP surface for executing pipeline runs.
 *
 * Executing a run never happens inside a request: POST only makes sure the run
 * is queued (or, for a decision on a waiting run, queues its continuation) and
 * returns at once; a worker (./pipeline-queue.server) does the work. GET reports
 * the run and its queue state so a client can follow it to the end.
 */
import { PooledClient } from '#/db/pool.server'
import { annotateRequest } from '#/lib/request-log'
import type { QueryResultRow } from 'pg'

import { env } from '#/env.server'
import { getAppSession } from '#/lib/auth'
import { createRateLimiter } from '#/lib/rate-limit'
import {
  tryPipelineDraft,
  validatePipelineResume,
} from './pipeline-execute.server'
import type {
  ExecConnection,
  PipelineExecuteDeps,
  PipelineTrialReport,
} from './pipeline-execute.server'
import {
  enqueuePipelineResume,
  enqueuePipelineRun,
  getPipelineJobState,
  wakePipelineWorker,
} from './pipeline-queue.server'
import type { PipelineJobState } from './pipeline-queue.server'
import { loadSigningKey, verifyRunManifest } from './pipeline-manifest.server'
import type {
  ManifestVerification,
  RunManifest,
} from './pipeline-manifest.server'
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
  if (status >= 500) annotateRequest({ error: { code, message } })
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
    if (access)
      annotateRequest({
        workspace: { id: access.workspace_id },
        pipeline_run: { id: runId },
      })
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

const trialLimiter = createRateLimiter({ maxRequests: 30, windowSeconds: 60 })
const TRIAL_BODY_BYTES = 512 * 1024

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * POST /api/pipelines/try-draft — run a configuration the editor holds, against
 * chosen input Dataset Versions, and answer with a preview of its result. Nothing
 * is saved or recorded: no run, no log, no output, no action. It executes the
 * same way a queued run does, but inside the request, because the person is
 * waiting for the answer and there is nothing to follow afterwards.
 *
 * Body: `{ workspaceId, configuration, inputVersions, parameters }`.
 * Answer: a PipelineTrialReport.
 */
export async function handlePipelineTryDraft(
  request: Request,
  deps: PipelineRunRequestDeps = defaultDeps,
): Promise<Response> {
  const session = await deps.getSession(request.headers)
  if (!session) {
    return responseError(401, 'unauthenticated', 'Authentication is required.')
  }
  const decision = trialLimiter.hit(`try-draft:${session.user.id}`)
  if (!decision.allowed) {
    return responseError(
      429,
      'rate_limited',
      `Too many trial runs. Try again in ${decision.retryAfterSeconds ?? 60} seconds.`,
    )
  }
  let body: unknown
  try {
    const text = await request.text()
    if (text.length > TRIAL_BODY_BYTES) {
      return responseError(413, 'body_too_large', 'The draft is too large.')
    }
    body = JSON.parse(text) as unknown
  } catch {
    return responseError(
      400,
      'invalid_request',
      'A JSON request body is required.',
    )
  }
  if (
    !isRecord(body) ||
    typeof body.workspaceId !== 'string' ||
    !UUID.test(body.workspaceId) ||
    !isRecord(body.configuration)
  ) {
    return responseError(
      400,
      'invalid_request',
      'workspaceId and configuration are required.',
    )
  }
  const inputVersions = isRecord(body.inputVersions) ? body.inputVersions : {}
  const parameters = isRecord(body.parameters) ? body.parameters : {}
  if (Object.values(inputVersions).some((id) => typeof id !== 'string')) {
    return responseError(
      400,
      'invalid_request',
      'inputVersions must map each input to a Dataset Version id.',
    )
  }
  annotateRequest({ workspace: { id: body.workspaceId } })
  const report: PipelineTrialReport = await tryPipelineDraft(
    session.user.id,
    {
      workspaceId: body.workspaceId,
      configuration: body.configuration,
      inputVersions: inputVersions as Record<string, string>,
      parameters,
    },
    pipelineExecuteDeps(deps),
  )
  if (!report.ok && report.errorCode === 'workspace_membership_required') {
    return responseError(403, report.errorCode, report.errorMessage)
  }
  return Response.json(report, { headers: { 'Cache-Control': 'no-store' } })
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
    if (access)
      annotateRequest({
        workspace: { id: access.workspace_id },
        pipeline_run: { id: runId },
      })
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

export interface PipelineManifestBody {
  runId: string
  sequence: number
  manifest: RunManifest
  manifestDigest: string
  previousDigest: string | null
  signature: string | null
  signatureAlgorithm: string | null
  keyId: string | null
  signedAt: string
  /** PEM of the key that verifies `signature`; null for an unsigned manifest. */
  publicKey: string | null
  /** The server's own check, so a reader sees at once whether it holds. */
  verification: ManifestVerification
}

/**
 * GET /api/pipelines/manifest?runId=… — the signed manifest for a succeeded run,
 * with the public key and the server's verification. An auditor can re-verify it
 * offline with scripts/verify-pipeline-manifest.mjs.
 */
export async function handlePipelineManifest(
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
    const { rows } = await conn.query<{
      sequence: string
      manifest: RunManifest
      manifest_digest: string
      previous_digest: string | null
      signature: string | null
      signature_algorithm: string | null
      key_id: string | null
      signed_at: Date
    }>(
      `SELECT sequence::text, manifest, manifest_digest, previous_digest,
              signature, signature_algorithm, key_id, signed_at
         FROM api.pipeline_run_manifests WHERE run_id = $1`,
      [runId],
    )
    const row = rows.at(0)
    if (!row)
      return responseError(
        404,
        'manifest_not_found',
        'This run has no manifest: only succeeded runs are recorded.',
      )
    const previous = await conn.query<{ manifest_digest: string }>(
      `SELECT manifest_digest FROM api.pipeline_run_manifests
        WHERE workspace_id = $1 AND sequence = $2::bigint - 1`,
      [access.workspace_id, row.sequence],
    )
    const key = loadSigningKey()
    const publicKey =
      key && key.keyId === row.key_id
        ? key.publicKey.export({ type: 'spki', format: 'pem' }).toString()
        : null
    const stored = {
      manifest: row.manifest,
      manifestDigest: row.manifest_digest,
      previousDigest: row.previous_digest,
      signature: row.signature,
    }
    const body: PipelineManifestBody = {
      runId,
      sequence: Number(row.sequence),
      manifest: row.manifest,
      manifestDigest: row.manifest_digest,
      previousDigest: row.previous_digest,
      signature: row.signature,
      signatureAlgorithm: row.signature_algorithm,
      keyId: row.key_id,
      signedAt: row.signed_at.toISOString(),
      publicKey,
      verification: verifyRunManifest(
        stored,
        publicKey,
        previous.rows.at(0)?.manifest_digest ?? null,
      ),
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
    const client = new PooledClient({
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
