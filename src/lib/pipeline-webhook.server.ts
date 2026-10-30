import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { annotateRequest } from '#/lib/request-log'
import { PooledClient } from '#/db/pool.server'
import { isSameOriginRequest } from '#/lib/request-origin'
import { env } from '#/env.server'
import { getAppSession } from '#/lib/auth'
import { createRateLimiter } from './rate-limit'
import { enqueuePipelineRun, wakePipelineWorker } from './pipeline-queue.server'
import type { ExecConnection } from './pipeline-execute.server'

export interface PipelineWebhookDeps {
  getSession: (headers: Headers) => Promise<{ user: { id: string } } | null>
  connect: () => Promise<ExecConnection>
  /** Make sure the run is queued for a worker; it never executes inline. */
  enqueue: (runId: string) => Promise<void>
}
const connect = async (): Promise<ExecConnection> => {
  const client = new PooledClient({
    connectionString: env.DATABASE_URL,
    query_timeout: 15000,
  })
  await client.connect()
  return {
    query: (sql, values) => client.query(sql, values),
    begin: () => client.query('BEGIN').then(() => undefined),
    commit: () => client.query('COMMIT').then(() => undefined),
    rollback: () => client.query('ROLLBACK').then(() => undefined),
    end: () => client.end(),
  }
}
const defaults: PipelineWebhookDeps = {
  getSession: getAppSession,
  connect,
  enqueue: async (runId) => {
    const conn = await connect()
    try {
      await enqueuePipelineRun(conn, runId)
    } finally {
      await conn.end().catch(() => {})
    }
    wakePipelineWorker()
  },
}
const deliveryLimit = createRateLimiter({ maxRequests: 120, windowSeconds: 60 })
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const reply = (value: unknown, status = 200) => {
  if (status >= 500) annotateRequest({ error: value })
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}
const error = (status: number, message: string) =>
  reply({ error: message }, status)
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
async function body(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader()
  if (!reader) return {}
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const part = await reader.read()
    if (part.done) break
    size += part.value.length
    if (size > 65536) {
      await reader.cancel()
      throw new Error('body_limit')
    }
    chunks.push(part.value)
  }
  const parsed: unknown = JSON.parse(
    Buffer.concat(chunks).toString('utf8') || '{}',
  )
  if (!object(parsed)) throw new Error('invalid_body')
  return parsed
}
async function claims(conn: ExecConnection, actor: string, workspace: string) {
  await conn.query("SELECT set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({
      role: 'authenticated',
      sub: actor,
      workspace_id: workspace,
    }),
  ])
  await conn.query("SELECT api.require_capability($1, 'pipelines.manage')", [
    workspace,
  ])
}

/** Management uses a session; delivery uses a revocable bearer credential, never cookies. */
export async function handlePipelineWebhook(
  request: Request,
  definitionId: string,
  deps = defaults,
): Promise<Response> {
  if (!uuid.test(definitionId))
    return error(400, 'Invalid pipeline identifier.')
  const invoke = request.method === 'POST'
  annotateRequest({
    auth: invoke ? 'webhook_token' : 'session',
    pipeline: { definition_id: definitionId },
  })
  if (invoke && !deliveryLimit.hit('pipeline-webhook').allowed)
    return error(429, 'Too many webhook requests. Try again in a minute.')
  if (!invoke && !['GET', 'PUT'].includes(request.method))
    return error(405, 'Method not allowed.')
  const session = invoke ? null : await deps.getSession(request.headers)
  if (!invoke && !session) return error(401, 'Sign in to manage this webhook.')
  if (
    request.method === 'PUT' &&
    !isSameOriginRequest(request, env.BETTER_AUTH_URL)
  )
    return error(403, 'Use this application to manage the webhook.')
  const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(
    request.headers.get('authorization') ?? '',
  )?.[1]
  if (invoke && !token) return error(401, 'A valid webhook token is required.')
  const key = request.headers.get('idempotency-key')
  if (invoke && (!key || key.length > 128 || !/^[\x21-\x7e]+$/.test(key)))
    return error(
      400,
      'Supply an Idempotency-Key of 1–128 printable characters.',
    )
  let payload: Record<string, unknown> = {}
  try {
    if (request.method !== 'GET') payload = await body(request)
  } catch (cause) {
    return error(
      cause instanceof Error && cause.message === 'body_limit' ? 413 : 400,
      'Supply a JSON object no larger than 64 KB.',
    )
  }
  if (
    invoke &&
    ((payload.parameters !== undefined && !object(payload.parameters)) ||
      (payload.inputVersions !== undefined &&
        (!object(payload.inputVersions) ||
          Object.values(payload.inputVersions).some(
            (value) => typeof value !== 'string' || !uuid.test(value),
          ))))
  )
    return error(
      400,
      'Parameters and input versions must be objects with valid dataset version identifiers.',
    )
  if (
    !invoke &&
    request.method === 'PUT' &&
    !['rotate', 'disable'].includes(String(payload.action))
  )
    return error(400, 'Choose rotate or disable.')
  const conn = await deps.connect()
  let runId: string | undefined
  let actor: string | undefined
  let previousStatus: string | undefined
  try {
    await conn.begin()
    // Definition locking serializes first-time creation as well as credential rotation/delivery.
    const definition = (
      await conn.query<{ workspace_id: string }>(
        'SELECT workspace_id FROM api.pipeline_definitions WHERE id=$1 FOR UPDATE',
        [definitionId],
      )
    ).rows.at(0)
    if (!definition) {
      await conn.rollback()
      return error(404, 'Pipeline not found.')
    }
    const trigger = (
      await conn.query<{
        enabled: boolean
        secret_hash: string
        created_by_user_id: string
      }>(
        'SELECT enabled, secret_hash, created_by_user_id FROM internal.pipeline_webhook_triggers WHERE definition_id=$1 AND workspace_id=$2 FOR UPDATE',
        [definitionId, definition.workspace_id],
      )
    ).rows.at(0)
    if (!invoke) {
      await claims(conn, session!.user.id, definition.workspace_id)
      let secret: string | undefined
      let enabled = trigger?.enabled ?? false
      if (request.method === 'PUT') {
        enabled = payload.action === 'rotate'
        if (enabled) {
          secret = randomBytes(32).toString('base64url')
          await conn.query(
            'INSERT INTO internal.pipeline_webhook_triggers(definition_id,workspace_id,created_by_user_id,secret_hash,enabled) VALUES($1,$2,$3,$4,true) ON CONFLICT(definition_id) DO UPDATE SET created_by_user_id=EXCLUDED.created_by_user_id,secret_hash=EXCLUDED.secret_hash,enabled=true,updated_at=now()',
            [
              definitionId,
              definition.workspace_id,
              session!.user.id,
              hash(secret),
            ],
          )
        } else
          await conn.query(
            'UPDATE internal.pipeline_webhook_triggers SET enabled=false,updated_at=now() WHERE definition_id=$1',
            [definitionId],
          )
      }
      await conn.commit()
      return reply({
        enabled,
        url: new URL(`/api/pipelines/webhook/${definitionId}`, request.url)
          .href,
        ...(secret ? { token: secret } : {}),
      })
    }
    if (
      !trigger?.enabled ||
      !timingSafeEqual(
        Buffer.from(hash(token!), 'hex'),
        Buffer.from(trigger.secret_hash, 'hex'),
      )
    ) {
      await conn.rollback()
      return error(401, 'A valid webhook token is required.')
    }
    actor = trigger.created_by_user_id
    await claims(conn, actor, definition.workspace_id)
    const occurrence = `webhook:${definitionId}:${hash(key!)}`
    const existing = (
      await conn.query<{ id: string; status: string; same_request: boolean }>(
        'SELECT id, status, parameters=$3::jsonb AND input_versions=$4::jsonb AS same_request FROM api.pipeline_runs WHERE workspace_id=$1 AND trigger_occurrence_id=$2 ORDER BY started_at DESC LIMIT 1',
        [
          definition.workspace_id,
          occurrence,
          JSON.stringify(payload.parameters ?? {}),
          JSON.stringify(payload.inputVersions ?? {}),
        ],
      )
    ).rows.at(0)
    if (existing && !existing.same_request) {
      await conn.rollback()
      return error(
        409,
        'This Idempotency-Key was already used with different inputs.',
      )
    }
    if (existing) {
      runId = existing.id
      previousStatus = existing.status
    } else {
      const version = (
        await conn.query<{ id: string }>(
          "SELECT id FROM api.pipeline_definition_versions WHERE definition_id=$1 AND workspace_id=$2 AND lifecycle='published' ORDER BY version DESC LIMIT 1",
          [definitionId, definition.workspace_id],
        )
      ).rows.at(0)
      if (!version) {
        await conn.rollback()
        return error(
          409,
          'Publish a pipeline version before sending a webhook.',
        )
      }
      runId = (
        await conn.query<{ id: string }>(
          "SELECT (api.start_pipeline_run($1,$2,'event',$3::jsonb,$4::jsonb,NULL,$5,NULL)).id AS id",
          [
            definition.workspace_id,
            version.id,
            JSON.stringify(payload.parameters ?? {}),
            JSON.stringify(payload.inputVersions ?? {}),
            occurrence,
          ],
        )
      ).rows.at(0)?.id
    }
    await conn.commit()
  } catch {
    await conn.rollback()
    return error(
      403,
      'The webhook could not start a run. Check permissions and the published pipeline inputs.',
    )
  } finally {
    await conn.end()
  }
  if (!runId || !actor)
    return error(500, 'The pipeline run could not be created.')
  if (previousStatus && previousStatus !== 'running')
    return reply({ runId, status: previousStatus })
  // The run is queued, not executed here: a worker picks it up, so a slow
  // pipeline never holds the sender's request open and a restart cannot lose it.
  await deps.enqueue(runId)
  return reply({ runId, status: 'running' }, 202)
}
