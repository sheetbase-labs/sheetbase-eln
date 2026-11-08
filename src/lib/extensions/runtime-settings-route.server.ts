/**
 * GET/POST /api/plugins/runtime: how Settings → Plugins reads and changes a
 * plugin's Python packages, approved hosts and run limits. Owners and
 * administrators only, checked by the database as for every other plugin
 * change. Server-only.
 */
import { z } from 'zod'

import { createServerDataClient } from '../connectors/enterprise/execution.server'
import type { DataClient } from '../data-client'
import {
  realSessionAuthDeps,
  requestErrorResponse,
  resolveSessionAuth,
} from '../request-auth'
import type { SessionAuthDeps } from '../request-auth'
import { listExtensions } from './client'
import { validateLimitOverrides } from './runtime-config'
import {
  databaseStore,
  describeRuntime,
  ensureEnvironment,
  refreshEnvironment,
  runnerEnvironments,
} from './runtime-settings.server'
import type { EnvironmentRunner, RuntimeStore } from './runtime-settings.server'

const bodySchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('set-limits'),
      extensionId: z.string().uuid(),
      /** Only what differs from the defaults; an empty object restores them all. */
      limits: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z
    .object({
      action: z.literal('reinstall-packages'),
      extensionId: z.string().uuid(),
    })
    .strict(),
])

export interface PluginRuntimeRouteDeps {
  auth: SessionAuthDeps
  makeClient: (token: string) => DataClient
  store: RuntimeStore
  runner: EnvironmentRunner
  /** Writes the audit event (`extension.settings.changed`). */
  audit: (event: {
    workspaceId: string
    actorUserId: string
    extensionId: string
    payload: Record<string, unknown>
  }) => Promise<void>
}

export async function handlePluginRuntime(
  request: Request,
  deps: PluginRuntimeRouteDeps = defaultRouteDeps(),
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST')
    return requestErrorResponse(405, 'method_not_allowed', 'Use GET or POST.')
  const auth = await resolveSessionAuth(request.headers, deps.auth)
  if (!auth.ok)
    return requestErrorResponse(auth.status, auth.code, auth.message)
  const { context } = auth
  const client = deps.makeClient(context.token)
  try {
    await client.rpc('require_capability', {
      p_workspace_id: context.workspaceId,
      p_capability: 'extensions.manage',
    })
  } catch {
    return requestErrorResponse(
      403,
      'forbidden',
      'Only an owner or administrator can manage plugins.',
    )
  }
  if (request.method === 'GET') {
    const rows = await deps.store.list(context.workspaceId)
    const settled = await Promise.all(
      rows.map((row) => refreshEnvironment(deps, context.workspaceId, row)),
    )
    return Response.json(
      { runtime: settled.map((s) => describeRuntime(s.row, s.packages)) },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return requestErrorResponse(400, 'bad_request', 'Send a JSON body.')
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success)
    return requestErrorResponse(
      400,
      'bad_request',
      'The request could not be read.',
    )
  const body = parsed.data
  const row = await deps.store.load(context.workspaceId, body.extensionId)
  const installs = await listExtensions(client)
  const install = installs.find((entry) => entry.id === body.extensionId)
  if (!row || !install)
    return requestErrorResponse(
      404,
      'not_found',
      'That plugin is not installed.',
    )
  if (body.action === 'set-limits') {
    const checked = validateLimitOverrides(body.limits)
    if (checked.errors.length > 0)
      return requestErrorResponse(400, 'bad_limits', checked.errors.join('; '))
    await deps.store.saveOverrides(
      context.workspaceId,
      body.extensionId,
      checked.value,
    )
    await deps.audit({
      workspaceId: context.workspaceId,
      actorUserId: context.userId,
      extensionId: body.extensionId,
      payload: {
        change: 'settings_changed',
        extensionKey: install.key,
        setting: 'limits',
        overrides: checked.value,
      },
    })
    return Response.json({
      runtime: describeRuntime({ ...row, limitOverrides: checked.value }),
    })
  }
  const asked = await ensureEnvironment(
    deps,
    context.workspaceId,
    // Forget a failure so the runner is asked afresh.
    {
      ...row,
      environmentState:
        row.environmentState === 'failed' ? 'none' : row.environmentState,
    },
  )
  await deps.audit({
    workspaceId: context.workspaceId,
    actorUserId: context.userId,
    extensionId: body.extensionId,
    payload: {
      change: 'settings_changed',
      extensionKey: install.key,
      setting: 'packages',
    },
  })
  return Response.json({ runtime: describeRuntime(asked) })
}

export async function auditSettingsChange(event: {
  workspaceId: string
  actorUserId: string
  extensionId: string
  payload: Record<string, unknown>
}): Promise<void> {
  const { db } = await import('#/db/client.server')
  const { sql } = await import('drizzle-orm')
  await db.execute(
    sql`SELECT internal.emit_change_event_as_actor(
      ${event.actorUserId}, ${event.workspaceId}::uuid, 'extension', ${event.extensionId}::uuid,
      'update', NULL, NULL, ${JSON.stringify(event.payload)}::jsonb)`,
  )
}

function defaultRouteDeps(): PluginRuntimeRouteDeps {
  return {
    auth: realSessionAuthDeps,
    makeClient: createServerDataClient,
    store: databaseStore(),
    runner: runnerEnvironments,
    audit: auditSettingsChange,
  }
}
