/**
 * GET/POST /api/plugins/connections: how Settings → Plugins reads and sets what
 * a connector, a publisher or a notification channel asked an administrator
 * for (an address, a token). Owners and administrators only, checked by the
 * database as for every other plugin change. A secret is sealed when it is
 * saved and is never sent back: the page learns only that it is set.
 * Server-only.
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
import { parseExtensionManifest } from './manifest'
import {
  SETTINGS_POINTS,
  databaseSettingsStore,
  describeSettings,
  settingsScope,
} from './plugin-settings.server'
import type { SettingsPoint, SettingsStore } from './plugin-settings.server'
import { auditSettingsChange } from './runtime-settings-route.server'

const bodySchema = z.strictObject({
  extensionId: z.string().uuid(),
  point: z.enum(SETTINGS_POINTS),
  itemId: z.string().regex(/^[a-z][a-z0-9-]{0,48}$/),
  /** A value sets the setting; `null` clears it. Settings left out are kept. */
  values: z.record(z.string(), z.string().max(6000).nullable()),
})

export interface PluginConnectionsRouteDeps {
  auth: SessionAuthDeps
  makeClient: (token: string) => DataClient
  store: SettingsStore
  audit: typeof auditSettingsChange
}

export interface ConnectionWire {
  extensionId: string
  extensionKey: string
  extensionName: string
  point: SettingsPoint
  itemId: string
  title: string
  hosts: string[]
  /** Switched off by an administrator, so nothing here is used. */
  off: boolean
  settings: ReturnType<typeof describeSettings>
}

export async function handlePluginConnections(
  request: Request,
  deps: PluginConnectionsRouteDeps = defaultRouteDeps(),
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

  const installs = await listExtensions(client)

  const describe = async (
    install: (typeof installs)[number],
  ): Promise<ConnectionWire[]> => {
    let manifest

    try {
      manifest = parseExtensionManifest(install.manifest)
    } catch {
      return []
    }

    const stored = await deps.store.list(context.workspaceId, install.id)
    const out: ConnectionWire[] = []
    const disabled = new Set(install.disabled_points)

    for (const point of SETTINGS_POINTS) {
      for (const declaration of manifest.contributions[point] ?? []) {
        if (declaration.settings.length === 0) continue
        out.push({
          extensionId: install.id,
          extensionKey: install.key,
          extensionName: install.name,
          point,
          itemId: declaration.id,
          title: declaration.title,
          hosts: declaration.hosts,
          off: disabled.has(point),
          settings: describeSettings(
            declaration,
            stored.filter(
              (row) => row.scope === settingsScope(point, declaration.id),
            ),
          ),
        })
      }
    }

    return out
  }

  if (request.method === 'GET') {
    const connections = (await Promise.all(installs.map(describe))).flat()

    return Response.json(
      { connections },
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
  const install = installs.find((entry) => entry.id === body.extensionId)

  if (!install)
    return requestErrorResponse(
      404,
      'not_found',
      'That plugin is not installed.',
    )

  const connection = (await describe(install)).find(
    (entry) => entry.point === body.point && entry.itemId === body.itemId,
  )

  if (!connection)
    return requestErrorResponse(
      404,
      'not_found',
      'That plugin has no connection like that.',
    )
  const known = new Map(connection.settings.map((s) => [s.name, s]))

  const writes: Array<{ name: string; value: string | null; secret: boolean }> =
    []

  for (const [name, value] of Object.entries(body.values)) {
    const setting = known.get(name)

    if (!setting)
      return requestErrorResponse(
        400,
        'bad_request',
        `This connection has no setting called ${name}.`,
      )

    if (value !== null && value.trim() === '') {
      writes.push({ name, value: null, secret: setting.secret })
      continue
    }

    writes.push({ name, value, secret: setting.secret })
  }

  await deps.store.save(
    context.workspaceId,
    install.id,
    settingsScope(body.point, body.itemId),
    writes,
    context.userId,
  )
  await deps.audit({
    workspaceId: context.workspaceId,
    actorUserId: context.userId,
    extensionId: install.id,
    payload: {
      change: 'settings_changed',
      extensionKey: install.key,
      setting: 'connection',
      point: body.point,
      itemId: body.itemId,
      // Which settings were set or cleared; never the values.
      names: writes.map((write) => write.name),
    },
  })

  return Response.json({
    connection: (await describe(install)).find(
      (entry) => entry.point === body.point && entry.itemId === body.itemId,
    ),
  })
}

function defaultRouteDeps(): PluginConnectionsRouteDeps {
  return {
    auth: realSessionAuthDeps,
    makeClient: createServerDataClient,
    store: databaseSettingsStore(),
    audit: auditSettingsChange,
  }
}
