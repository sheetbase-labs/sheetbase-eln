/**
 * Browser side of the points that send data out:
 *
 * - `GET/POST /api/plugins/connections` (administrators): what a plugin's
 *   publishers, channels and connectors need set up;
 * - `GET/POST /api/plugins/channels` (each person): the notification channels
 *   plugins add and where the person wants theirs sent;
 * - `POST /api/plugins/data` with `kind: 'publish'`: send rows to another system.
 */

export interface ConnectionSettingWire {
  name: string
  label: string
  secret: boolean
  required: boolean
  isSet: boolean
  /** Only for a setting that is not a secret. */
  value: string | null
}

export interface ConnectionWire {
  extensionId: string
  extensionKey: string
  extensionName: string
  point: 'connectors' | 'publishers' | 'notification-channels'
  itemId: string
  title: string
  hosts: string[]
  off: boolean
  settings: ConnectionSettingWire[]
}

export interface ChannelWire {
  extensionKey: string
  extensionName: string
  channelId: string
  title: string
  description: string
  destinationLabel: string
  destinationHint: string | null
  ready: boolean
  mine: {
    destination: string
    scope: 'phone' | 'all'
    lastSentAt: string | null
    lastError: string | null
  } | null
}

export interface PublishResult {
  message: string
  link?: string
  requests: number
}

export const connectionsQueryKey = ['plugins', 'connections'] as const
export const channelsQueryKey = ['plugins', 'channels'] as const

async function read<T>(response: Response, fallback: string): Promise<T> {
  const body = (await response.json().catch(() => null)) as
    (T & { error?: string | { message?: string } }) | null
  if (!response.ok || !body) {
    const error = body?.error
    throw new Error(
      (typeof error === 'string' ? error : error?.message) ?? fallback,
    )
  }
  return body
}

const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

export async function listConnections(): Promise<ConnectionWire[]> {
  const body = await read<{ connections: ConnectionWire[] }>(
    await fetch('/api/plugins/connections', { cache: 'no-store' }),
    'The connections could not be read.',
  )
  return body.connections
}

export async function saveConnection(input: {
  extensionId: string
  point: ConnectionWire['point']
  itemId: string
  /** A value sets a setting, `null` clears it, a setting left out is kept. */
  values: Record<string, string | null>
}): Promise<ConnectionWire> {
  const body = await read<{ connection: ConnectionWire }>(
    await fetch('/api/plugins/connections', json(input)),
    'The connection could not be saved.',
  )
  return body.connection
}

export async function listChannels(): Promise<ChannelWire[]> {
  const body = await read<{ channels: ChannelWire[] }>(
    await fetch('/api/plugins/channels', { cache: 'no-store' }),
    'The channels could not be read.',
  )
  return body.channels
}

export async function changeChannel(
  input:
    | {
        action: 'save'
        extensionKey: string
        channelId: string
        destination: string
        scope: 'phone' | 'all'
      }
    | { action: 'remove' | 'test'; extensionKey: string; channelId: string },
): Promise<ChannelWire[]> {
  const body = await read<{ channels: ChannelWire[] }>(
    await fetch('/api/plugins/channels', json(input)),
    'The channel could not be changed.',
  )
  return body.channels
}

export async function publishRows(input: {
  extensionKey: string
  publisherId: string
  name: string
  rows: Array<Record<string, unknown>>
  parameters: Record<string, unknown>
}): Promise<PublishResult> {
  return read<PublishResult>(
    await fetch('/api/plugins/data', json({ kind: 'publish', ...input })),
    'The data could not be sent.',
  )
}
