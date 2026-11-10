/**
 * Browser side of the points that send data out:
 *
 * - `GET/POST /api/plugins/connections` (administrators): what a plugin's
 *   publishers, channels and connectors need set up;
 * - `GET/POST /api/plugins/channels` (each person): the notification channels
 *   plugins add and where the person wants theirs sent;
 * - `POST /api/plugins/data` with `kind: 'publish'`: send rows to another system.
 */
import { z } from 'zod'

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

/** One row a publisher sends: the values it read, by column name. */
export type PublishRow = Record<string, z.core.util.JSONType>

/** The parameters a publisher reads with. */
export type PublishParameters = Record<string, z.core.util.JSONType>

export const connectionsQueryKey = ['plugins', 'connections'] as const
export const channelsQueryKey = ['plugins', 'channels'] as const

/** A setting a connection offers, as the route describes it. */
const connectionSettingWire = z.object({
  name: z.string(),
  label: z.string(),
  secret: z.boolean(),
  required: z.boolean(),
  isSet: z.boolean(),
  value: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
})

/** One connection a plugin point needs set up. */
const connectionWire = z.object({
  extensionId: z.string(),
  extensionKey: z.string(),
  extensionName: z.string(),
  point: z.enum(['connectors', 'publishers', 'notification-channels']),
  itemId: z.string(),
  title: z.string(),
  hosts: z.array(z.string()),
  off: z.boolean(),
  settings: z.array(connectionSettingWire),
})

/** One notification channel a plugin adds. */
const channelWire = z.object({
  extensionKey: z.string(),
  extensionName: z.string(),
  channelId: z.string(),
  title: z.string(),
  description: z.string(),
  destinationLabel: z.string(),
  destinationHint: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  ready: z.boolean(),
  mine: z
    .object({
      destination: z.string(),
      scope: z.enum(['phone', 'all']),
      lastSentAt: z
        .string()
        .nullish()
        .transform((value) => value ?? null),
      lastError: z
        .string()
        .nullish()
        .transform((value) => value ?? null),
    })
    .nullish()
    .transform((value) => value ?? null),
})

/** What a publish answered. */
const publishResult = z.object({
  message: z.string(),
  link: z.string().optional(),
  requests: z.number(),
})

/** The error a failed plugin call states: a sentence or a message object. */
const statedError = z.union([
  z.string().transform((text) => ({ message: text })),
  z.object({ message: z.string() }),
])

const failureBody = z.object({ error: statedError })

async function read<Schema extends z.ZodType>(
  response: Response,
  schema: Schema,
  fallback: string,
): Promise<z.output<Schema>> {
  const body = await response.json().catch(() => null)
  const parsed = schema.safeParse(body)

  if (!response.ok || !parsed.success) {
    const stated = failureBody.safeParse(body).data

    throw new Error(stated?.error.message ?? fallback)
  }

  return parsed.data
}

const json = <Body>(body: Body) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

export async function listConnections(): Promise<ConnectionWire[]> {
  const body = await read(
    await fetch('/api/plugins/connections', { cache: 'no-store' }),
    z.object({ connections: z.array(connectionWire) }),
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
  const body = await read(
    await fetch('/api/plugins/connections', json(input)),
    z.object({ connection: connectionWire }),
    'The connection could not be saved.',
  )

  return body.connection
}

export async function listChannels(): Promise<ChannelWire[]> {
  const body = await read(
    await fetch('/api/plugins/channels', { cache: 'no-store' }),
    z.object({ channels: z.array(channelWire) }),
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
  const body = await read(
    await fetch('/api/plugins/channels', json(input)),
    z.object({ channels: z.array(channelWire) }),
    'The channel could not be changed.',
  )

  return body.channels
}

export async function publishRows(input: {
  extensionKey: string
  publisherId: string
  name: string
  rows: PublishRow[]
  parameters: PublishParameters
}): Promise<PublishResult> {
  return read(
    await fetch('/api/plugins/data', json({ kind: 'publish', ...input })),
    publishResult,
    'The data could not be sent.',
  )
}
