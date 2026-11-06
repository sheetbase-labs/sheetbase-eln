/**
 * The SCIM 2.0 endpoint (`/api/scim/v2`): an identity provider creates,
 * changes and switches off people, and keeps groups, with a per-workspace
 * bearer token made in Settings. The rules live in the database
 * (`internal.scim_*`, migration 0105); this file speaks the protocol.
 */
import { createHash } from 'node:crypto'

import { PooledClient } from '#/db/pool.server'
import { env } from '#/env.server'
import { createRateLimiter } from './rate-limit'
import { annotateRequest } from './request-log'
import {
  SCIM_CONTENT_TYPE,
  ScimError,
  errorBody,
  groupChangesFromPatch,
  listResponse,
  parseFilter,
  parsePaging,
  readGroup,
  readUser,
  resourceTypes,
  schemas,
  serviceProviderConfig,
  toScimGroup,
  toScimUser,
  userChangesFromPatch,
} from './scim'
import type {
  GroupChanges,
  GroupDoc,
  Page,
  UserChanges,
  UserDoc,
} from './scim'

export interface ScimPrincipal {
  tokenId: string
  workspaceId: string
  actorUserId: string | null
}

/** What the endpoint needs from the database; tests supply their own. */
export interface ScimStore {
  authenticate: (secretHash: string) => Promise<ScimPrincipal | null>
  listUsers: (
    p: ScimPrincipal,
    filter: { userName?: string; externalId?: string },
    start: number,
    count: number,
  ) => Promise<Page<UserDoc>>
  getUser: (p: ScimPrincipal, id: string) => Promise<UserDoc | null>
  createUser: (p: ScimPrincipal, changes: UserChanges) => Promise<UserDoc>
  updateUser: (
    p: ScimPrincipal,
    id: string,
    changes: UserChanges,
  ) => Promise<UserDoc>
  deleteUser: (p: ScimPrincipal, id: string) => Promise<void>
  listGroups: (
    p: ScimPrincipal,
    filter: { displayName?: string },
    start: number,
    count: number,
  ) => Promise<Page<GroupDoc>>
  getGroup: (p: ScimPrincipal, id: string) => Promise<GroupDoc | null>
  setGroup: (
    p: ScimPrincipal,
    id: string | null,
    changes: GroupChanges,
  ) => Promise<GroupDoc>
  deleteGroup: (p: ScimPrincipal, id: string) => Promise<void>
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const MAX_BODY = 1024 * 1024

/** The calls the database raises with codes the protocol has words for. */
function fromDatabase(error: unknown): never {
  if (error instanceof ScimError) throw error
  const code = (error as { code?: string } | null)?.code
  const message = error instanceof Error ? error.message : 'Request failed.'
  if (code === '23505') throw new ScimError(409, 'uniqueness', message)
  if (code === '22023') throw new ScimError(400, 'invalidValue', message)
  if (code === 'P0002') throw new ScimError(404, null, message)
  if (code === 'SB052') throw new ScimError(403, 'mutability', message)
  throw error
}

const connectDatabase = async () => {
  const client = new PooledClient({
    connectionString: env.DATABASE_URL,
    query_timeout: 15000,
  })
  await client.connect()
  return client
}

async function withDatabase<T>(
  run: (query: PooledClient['query']) => Promise<T>,
): Promise<T> {
  const client = await connectDatabase()
  try {
    return await run(client.query.bind(client) as PooledClient['query'])
  } catch (error) {
    return fromDatabase(error)
  } finally {
    await client.end().catch(() => {})
  }
}

async function one<T>(
  sql: string,
  values: unknown[],
): Promise<T | null> {
  return withDatabase(async (query) => {
    const { rows } = await query(sql, values)
    return (rows[0]?.doc ?? null) as T | null
  })
}

export const databaseScimStore: ScimStore = {
  async authenticate(secretHash) {
    return withDatabase(async (query) => {
      const { rows } = await query(
        'SELECT token_id, workspace_id, actor_user_id FROM internal.scim_authenticate($1)',
        [secretHash],
      )
      const row = rows[0] as
        | { token_id: string; workspace_id: string; actor_user_id: string | null }
        | undefined
      return row
        ? {
            tokenId: row.token_id,
            workspaceId: row.workspace_id,
            actorUserId: row.actor_user_id,
          }
        : null
    })
  },
  async listUsers(p, filter, start, count) {
    const page = await one<Page<UserDoc>>(
      'SELECT internal.scim_list_users($1::uuid, $2, $3, $4, $5) AS doc',
      [p.workspaceId, filter.userName ?? null, filter.externalId ?? null, start, count],
    )
    return page ?? { total: 0, rows: [] }
  },
  getUser: (p, id) =>
    one<UserDoc>('SELECT internal.scim_user_doc($1::uuid, $2::uuid) AS doc', [
      p.workspaceId,
      id,
    ]),
  async createUser(p, changes) {
    const doc = await one<UserDoc>(
      'SELECT internal.scim_provision_user($1::uuid, $2, $3::jsonb) AS doc',
      [p.workspaceId, p.actorUserId, JSON.stringify(changes)],
    )
    if (!doc) throw new ScimError(500, null, 'The user was not created.')
    return doc
  },
  async updateUser(p, id, changes) {
    const doc = await one<UserDoc>(
      'SELECT internal.scim_update_user($1::uuid, $2, $3::uuid, $4::jsonb) AS doc',
      [p.workspaceId, p.actorUserId, id, JSON.stringify(changes)],
    )
    if (!doc) throw new ScimError(404, null, 'User not found.')
    return doc
  },
  async deleteUser(p, id) {
    await one('SELECT internal.scim_delete_user($1::uuid, $2, $3::uuid) AS doc', [
      p.workspaceId,
      p.actorUserId,
      id,
    ])
  },
  async listGroups(p, filter, start, count) {
    const page = await one<Page<GroupDoc>>(
      'SELECT internal.scim_list_groups($1::uuid, $2, $3, $4) AS doc',
      [p.workspaceId, filter.displayName ?? null, start, count],
    )
    return page ?? { total: 0, rows: [] }
  },
  getGroup: (p, id) =>
    one<GroupDoc>('SELECT internal.scim_group_doc($1::uuid, $2::uuid) AS doc', [
      p.workspaceId,
      id,
    ]),
  async setGroup(p, id, changes) {
    const doc = await one<GroupDoc>(
      'SELECT internal.scim_set_group($1::uuid, $2, $3::uuid, $4::jsonb) AS doc',
      [p.workspaceId, p.actorUserId, id, JSON.stringify(changes)],
    )
    if (!doc) throw new ScimError(500, null, 'The group was not saved.')
    return doc
  },
  async deleteGroup(p, id) {
    await one('SELECT internal.scim_delete_group($1::uuid, $2, $3::uuid) AS doc', [
      p.workspaceId,
      p.actorUserId,
      id,
    ])
  },
}

export interface ScimDeps {
  store: ScimStore
  /** The address people reach the app on; the SCIM base is `${baseUrl}/api/scim/v2`. */
  baseUrl: string
}

const defaults = (): ScimDeps => ({
  store: databaseScimStore,
  baseUrl: env.BETTER_AUTH_URL.replace(/\/+$/, ''),
})

// A provider's full sync can be a few thousand calls; this is per token.
const callLimit = createRateLimiter({ maxRequests: 600, windowSeconds: 60 })
const failedLimit = createRateLimiter({ maxRequests: 30, windowSeconds: 60 })

function reply(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': SCIM_CONTENT_TYPE,
      'Cache-Control': 'no-store',
      ...headers,
    },
  })
}

function failure(error: ScimError, headers: HeadersInit = {}) {
  return reply(errorBody(error), error.status, headers)
}

async function readBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader()
  if (!reader) return {}
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const part = await reader.read()
    if (part.done) break
    size += part.value.length
    if (size > MAX_BODY) {
      await reader.cancel()
      throw new ScimError(413, 'tooMany', 'The request is larger than 1 MB.')
    }
    chunks.push(part.value)
  }
  try {
    const text = Buffer.concat(chunks).toString('utf8')
    return text.trim() === '' ? {} : JSON.parse(text)
  } catch {
    throw new ScimError(400, 'invalidSyntax', 'The body is not valid JSON.')
  }
}

function checkId(id: string): void {
  if (!uuid.test(id)) throw new ScimError(404, null, 'Not found.')
}

/** Everything under `/api/scim/v2`. `path` is what follows that prefix. */
export async function handleScimRequest(
  request: Request,
  path: string,
  deps: ScimDeps = defaults(),
): Promise<Response> {
  const base = `${deps.baseUrl}/api/scim/v2`
  const presented = /^Bearer (\S+)$/i.exec(
    request.headers.get('authorization') ?? '',
  )?.[1]
  annotateRequest({ auth: 'scim_token', scim: { method: request.method, path } })
  const challenge = { 'WWW-Authenticate': 'Bearer realm="scim"' }
  if (!presented) {
    return failure(
      new ScimError(401, null, 'Send the SCIM token as a bearer token.'),
      challenge,
    )
  }
  try {
    const principal = await deps.store.authenticate(hash(presented))
    if (!principal) {
      if (!failedLimit.hit('scim-bad-token').allowed) {
        return failure(new ScimError(429, null, 'Too many failed attempts.'))
      }
      return failure(
        new ScimError(401, null, 'That token is not valid or was revoked.'),
        challenge,
      )
    }
    annotateRequest({ scim: { workspace_id: principal.workspaceId } })
    const limited = callLimit.hit(principal.tokenId)
    if (!limited.allowed) {
      return failure(
        new ScimError(429, null, 'Slow down and try again shortly.'),
        { 'Retry-After': String(limited.retryAfterSeconds ?? 60) },
      )
    }
    return await route(request, path, principal, deps, base)
  } catch (error) {
    if (error instanceof ScimError) return failure(error)
    annotateRequest({ error })
    return failure(new ScimError(500, null, 'The identity provider call failed.'))
  }
}

async function route(
  request: Request,
  rawPath: string,
  principal: ScimPrincipal,
  deps: ScimDeps,
  base: string,
): Promise<Response> {
  const { store } = deps
  const url = new URL(request.url)
  const segments = rawPath.split('/').filter(Boolean)
  const [resource, id, ...extra] = segments
  const method = request.method
  const noMethod = () =>
    failure(new ScimError(405, null, 'That method is not supported here.'))

  if (extra.length > 0) throw new ScimError(404, null, 'Not found.')

  switch (resource) {
    case 'ServiceProviderConfig':
      return method === 'GET' && !id
        ? reply(serviceProviderConfig(base))
        : noMethod()
    case 'ResourceTypes': {
      if (method !== 'GET') return noMethod()
      const all = resourceTypes(base)
      if (!id) return reply(listResponse(all, all.length, 1))
      const found = all.find((type) => type.id === id)
      if (!found) throw new ScimError(404, null, 'Not found.')
      return reply(found)
    }
    case 'Schemas': {
      if (method !== 'GET') return noMethod()
      const all = schemas(base)
      if (!id) return reply(listResponse(all, all.length, 1))
      const found = all.find((schema) => schema.id === id)
      if (!found) throw new ScimError(404, null, 'Not found.')
      return reply(found)
    }
    case 'Users':
      return users(request, id, principal, store, base, url)
    case 'Groups':
      return groups(request, id, principal, store, base, url)
    default:
      throw new ScimError(404, null, 'Not found.')
  }
}

async function users(
  request: Request,
  id: string | undefined,
  principal: ScimPrincipal,
  store: ScimStore,
  base: string,
  url: URL,
): Promise<Response> {
  const method = request.method
  if (!id) {
    if (method === 'GET') {
      const filter = parseFilter(url.searchParams.get('filter'), [
        'userName',
        'externalId',
        'emails.value',
      ])
      const { start, count } = parsePaging(url.searchParams)
      const page = await store.listUsers(
        principal,
        {
          userName:
            filter?.attribute === 'userName' ||
            filter?.attribute === 'emails.value'
              ? filter.value
              : undefined,
          externalId:
            filter?.attribute === 'externalId' ? filter.value : undefined,
        },
        start,
        count,
      )
      return reply(
        listResponse(
          page.rows.map((row) => toScimUser(row, base)),
          page.total,
          start,
        ),
      )
    }
    if (method === 'POST') {
      const changes = readUser(await readBody(request))
      const doc = await store.createUser(principal, changes)
      return reply(toScimUser(doc, base), 201, {
        Location: `${base}/Users/${doc.id}`,
      })
    }
    return failure(new ScimError(405, null, 'That method is not supported here.'))
  }
  checkId(id)
  if (method === 'GET') {
    const doc = await store.getUser(principal, id)
    if (!doc) throw new ScimError(404, null, 'User not found.')
    return reply(toScimUser(doc, base))
  }
  if (method === 'PUT') {
    const changes = readUser(await readBody(request))
    // PUT replaces the user; a missing active means still active.
    const doc = await store.updateUser(principal, id, {
      ...changes,
      externalId: changes.externalId ?? null,
      active: changes.active ?? true,
    })
    return reply(toScimUser(doc, base))
  }
  if (method === 'PATCH') {
    const changes = userChangesFromPatch(await readBody(request))
    const doc = await store.updateUser(principal, id, changes)
    return reply(toScimUser(doc, base))
  }
  if (method === 'DELETE') {
    await store.deleteUser(principal, id)
    return reply(null, 204)
  }
  return failure(new ScimError(405, null, 'That method is not supported here.'))
}

async function groups(
  request: Request,
  id: string | undefined,
  principal: ScimPrincipal,
  store: ScimStore,
  base: string,
  url: URL,
): Promise<Response> {
  const method = request.method
  if (!id) {
    if (method === 'GET') {
      const filter = parseFilter(url.searchParams.get('filter'), ['displayName'])
      const { start, count } = parsePaging(url.searchParams)
      const page = await store.listGroups(
        principal,
        { displayName: filter?.value },
        start,
        count,
      )
      return reply(
        listResponse(
          page.rows.map((row) => toScimGroup(row, base)),
          page.total,
          start,
        ),
      )
    }
    if (method === 'POST') {
      const changes = readGroup(await readBody(request))
      const doc = await store.setGroup(principal, null, changes)
      return reply(toScimGroup(doc, base), 201, {
        Location: `${base}/Groups/${doc.id}`,
      })
    }
    return failure(new ScimError(405, null, 'That method is not supported here.'))
  }
  checkId(id)
  if (method === 'GET') {
    const doc = await store.getGroup(principal, id)
    if (!doc) throw new ScimError(404, null, 'Group not found.')
    return reply(toScimGroup(doc, base))
  }
  if (method === 'PUT') {
    const changes = readGroup(await readBody(request))
    const doc = await store.setGroup(principal, id, {
      ...changes,
      members: changes.members ?? [],
    })
    return reply(toScimGroup(doc, base))
  }
  if (method === 'PATCH') {
    const current = await store.getGroup(principal, id)
    if (!current) throw new ScimError(404, null, 'Group not found.')
    const changes = groupChangesFromPatch(
      await readBody(request),
      current.members.map((member) => member.value),
    )
    const doc = await store.setGroup(principal, id, changes)
    return reply(toScimGroup(doc, base))
  }
  if (method === 'DELETE') {
    await store.deleteGroup(principal, id)
    return reply(null, 204)
  }
  return failure(new ScimError(405, null, 'That method is not supported here.'))
}
