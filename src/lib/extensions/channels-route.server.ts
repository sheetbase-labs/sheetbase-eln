/**
 * GET/POST /api/plugins/channels: the notification channels plugins add, and
 * where a person wants theirs sent. Any signed-in member sees the channels that
 * are ready and manages their own; nobody can read or change anyone else's.
 *
 * - GET lists the channels, whether an administrator has finished setting each
 *   up, and the person's own choice for each;
 * - `save` turns a channel on for the person (where to send it, and which
 *   notifications);
 * - `remove` turns it off;
 * - `test` sends the person a test message through it right now.
 *
 * Server-only.
 */
import { z } from 'zod'

import { parseExtensionManifest } from './manifest'
import { databaseSettingsStore, settingsScope } from './plugin-settings.server'
import type { SettingsStore } from './plugin-settings.server'
import { runChannelDelivery } from './outgoing-runtime.server'
import { defaultRouteDeps, failure, refuse, reply } from './run-route.server'
import type { ExtensionRunRouteDeps } from './run-route.server'

const id = z.string().regex(/^[a-z][a-z0-9-]{0,48}$/)

const bodySchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('save'),
    extensionKey: id,
    channelId: id,
    destination: z.string().trim().min(1).max(500),
    scope: z.enum(['phone', 'all']),
  }),
  z.strictObject({
    action: z.literal('remove'),
    extensionKey: id,
    channelId: id,
  }),
  z.strictObject({
    action: z.literal('test'),
    extensionKey: id,
    channelId: id,
  }),
])

export interface ChannelWire {
  extensionKey: string
  extensionName: string
  channelId: string
  title: string
  description: string
  destinationLabel: string
  destinationHint: string | null
  /** An administrator still has to finish setting it up. */
  ready: boolean
  mine: {
    destination: string
    scope: 'phone' | 'all'
    lastSentAt: string | null
    lastError: string | null
  } | null
}

export interface ChannelsRouteDeps extends ExtensionRunRouteDeps {
  settings: SettingsStore
  /** The address a test message links to. */
  baseUrl: string
}

const installRowSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  manifest: z.unknown(),
  disabled_points: z.array(z.string()),
})

const subscriptionRowSchema = z.object({
  extension_id: z.string(),
  channel_id: z.string(),
  destination: z.string(),
  scope: z.enum(['phone', 'all']),
  last_sent_at: z.string().nullable(),
  last_error: z.string().nullable(),
})

const installRowsSchema = z.array(installRowSchema)

const subscriptionRowsSchema = z.array(subscriptionRowSchema)

/** One install whose manifest offers notification channels. */
type ChannelInstall = {
  install: z.infer<typeof installRowSchema>
  channels: NonNullable<
    ReturnType<
      typeof parseExtensionManifest
    >['contributions']['notification-channels']
  >
}

async function listChannels(
  deps: ChannelsRouteDeps,
  workspaceId: string,
  userId: string,
): Promise<ChannelWire[]> {
  const [{ db }, { sql }] = await Promise.all([
    import('#/db/client.server'),
    import('drizzle-orm'),
  ])

  const installs = installRowsSchema.parse(
    (
      await db.execute(
        sql`SELECT id, key, name, manifest, disabled_points
              FROM api.extensions
             WHERE workspace_id = ${workspaceId}::uuid AND status = 'enabled'
             ORDER BY name`,
      )
    ).rows,
  )

  const mine = subscriptionRowsSchema.parse(
    (
      await db.execute(
        sql`SELECT extension_id, channel_id, destination, scope, last_sent_at, last_error
              FROM internal.plugin_channel_subscriptions
             WHERE workspace_id = ${workspaceId}::uuid AND user_id = ${userId}`,
      )
    ).rows,
  )

  const offered: ChannelInstall[] = []

  for (const install of installs) {
    if (install.disabled_points.includes('notification-channels')) continue
    let manifest

    try {
      manifest = parseExtensionManifest(install.manifest)
    } catch {
      continue
    }

    const channels = manifest.contributions['notification-channels'] ?? []

    if (channels.length === 0) continue
    offered.push({ install, channels })
  }

  const settingsByInstall = new Map(
    await Promise.all(
      offered.map(
        async ({ install }) =>
          [
            install.id,
            await deps.settings.list(workspaceId, install.id),
          ] as const,
      ),
    ),
  )

  const out: ChannelWire[] = []

  for (const { install, channels } of offered) {
    const stored = settingsByInstall.get(install.id) ?? []

    for (const channel of channels) {
      const scope = settingsScope('notification-channels', channel.id)

      const ready = channel.settings.every(
        (setting) =>
          !setting.required ||
          stored.some(
            (row) => row.scope === scope && row.name === setting.name,
          ),
      )

      const choice = mine.find(
        (row) =>
          row.extension_id === install.id && row.channel_id === channel.id,
      )

      out.push({
        extensionKey: install.key,
        extensionName: install.name,
        channelId: channel.id,
        title: channel.title,
        description: channel.description,
        destinationLabel: channel.destination.label,
        destinationHint: channel.destination.hint ?? null,
        ready,
        mine: choice
          ? {
              destination: choice.destination,
              scope: choice.scope,
              lastSentAt: choice.last_sent_at,
              lastError: choice.last_error,
            }
          : null,
      })
    }
  }

  return out
}

export async function handleChannels(
  request: Request,
  deps: ChannelsRouteDeps = {
    ...defaultRouteDeps(),
    settings: databaseSettingsStore(),
    baseUrl: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
  },
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST')
    return refuse(405, 'Use GET or POST.')
  const session = await deps.getSession(request.headers)

  if (!session) return refuse(401, 'Sign in to use plugins.')
  const member = await deps.getMember(session.user.id)

  if (!member) return refuse(403, 'You need a workspace to use plugins.')

  if (request.method === 'GET')
    return reply({
      channels: await listChannels(deps, member.workspaceId, session.user.id),
    })
  let raw: unknown

  try {
    raw = await request.json()
  } catch {
    return refuse(400, 'Send a JSON body.')
  }

  const parsed = bodySchema.safeParse(raw)

  if (!parsed.success) return refuse(400, 'The request could not be read.')
  const body = parsed.data

  const install = await deps.runtime.loadInstall(
    member.workspaceId,
    body.extensionKey,
  )

  if (!install || install.status !== 'enabled')
    return refuse(404, 'That plugin is not installed.')

  const [{ db }, { sql }] = await Promise.all([
    import('#/db/client.server'),
    import('drizzle-orm'),
  ])

  if (body.action === 'remove') {
    await db.execute(
      sql`DELETE FROM internal.plugin_channel_subscriptions
           WHERE user_id = ${session.user.id}
             AND workspace_id = ${member.workspaceId}::uuid
             AND extension_id = ${install.id}::uuid
             AND channel_id = ${body.channelId}`,
    )

    return reply({
      channels: await listChannels(deps, member.workspaceId, session.user.id),
    })
  }

  let manifest

  try {
    manifest = parseExtensionManifest(install.manifest)
  } catch {
    return refuse(409, 'That plugin’s declaration can’t be read.')
  }

  const channel = manifest.contributions['notification-channels']?.find(
    (entry) => entry.id === body.channelId,
  )

  if (!channel || install.disabledPoints.includes('notification-channels'))
    return refuse(404, 'That plugin doesn’t offer this channel.')

  if (body.action === 'save') {
    await db.execute(
      sql`INSERT INTO internal.plugin_channel_subscriptions
            (workspace_id, user_id, extension_id, channel_id, destination, scope)
          VALUES (${member.workspaceId}::uuid, ${session.user.id}, ${install.id}::uuid,
                  ${body.channelId}, ${body.destination}, ${body.scope})
          ON CONFLICT (user_id, extension_id, channel_id)
          DO UPDATE SET destination = EXCLUDED.destination, scope = EXCLUDED.scope,
                        last_error = NULL, last_error_at = NULL`,
    )

    return reply({
      channels: await listChannels(deps, member.workspaceId, session.user.id),
    })
  }

  // test: send the person a message now, to where they saved, or tell them why not.
  const saved = z
    .array(z.object({ destination: z.string() }))
    .parse(
      (
        await db.execute(
          sql`SELECT destination FROM internal.plugin_channel_subscriptions
               WHERE user_id = ${session.user.id}
                 AND workspace_id = ${member.workspaceId}::uuid
                 AND extension_id = ${install.id}::uuid
                 AND channel_id = ${body.channelId}`,
        )
      ).rows,
    )
    .at(0)

  if (!saved) return refuse(400, 'Save where to send it first.')

  try {
    await runChannelDelivery(
      {
        workspaceId: member.workspaceId,
        actorUserId: session.user.id,
        extensionKey: body.extensionKey,
        channelId: body.channelId,
        destination: saved.destination,
        notification: {
          event: 'test',
          title: 'A test from Sheetbase',
          body: 'If you can read this, notifications will reach you here.',
          link: deps.baseUrl,
          at: new Date().toISOString(),
        },
      },
      deps.runtime,
    )
    await db.execute(
      sql`UPDATE internal.plugin_channel_subscriptions
             SET last_sent_at = now(), last_error = NULL, last_error_at = NULL
           WHERE user_id = ${session.user.id}
             AND workspace_id = ${member.workspaceId}::uuid
             AND extension_id = ${install.id}::uuid
             AND channel_id = ${body.channelId}`,
    )

    return reply({
      sent: true,
      channels: await listChannels(deps, member.workspaceId, session.user.id),
    })
  } catch (error) {
    return failure(error)
  }
}
