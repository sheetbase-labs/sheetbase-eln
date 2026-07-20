/**
 * LIVE-002 integration proof: the real SSE deps (readChangeEvents replay
 * and subscribeToChangeEvents live LISTEN) behave against a freshly
 * migrated sheetbase_test with the LIVE-001 triggers active.
 *
 * Covers: bounded workspace-scoped replay, earliestAvailableSeq, live
 * delivery via LISTEN/NOTIFY, and cross-workspace isolation in the
 * subscription (notifications whose workspace_id does not match are
 * ignored).
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { readChangeEvents, subscribeToChangeEvents } from '#/lib/sse-subscribe'
import type { ChangeEventWire } from '#/lib/sse-events'

import { migratorUrl, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-000000000d0a'
const WS_B = '00000000-0000-4000-8000-000000000d0b'
const PROJ = '00000000-0000-4000-8000-000000000d1a'
const PROJ_B = '00000000-0000-4000-8000-000000000d1b'
const OWNER = 'sse-owner'
const OWNER_B = 'sse-owner-b'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())

  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${OWNER}', 'SSE Owner', 'sse@sheetbase.test', true),
      ('${OWNER_B}', 'SSE Owner B', 'sse-b@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS}', 'sse-ws', 'SSE WS'),
      ('${WS_B}', 'sse-ws-b', 'SSE WS B')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS}', '${OWNER}', 'owner'),
      ('${WS_B}', '${OWNER_B}', 'owner')`,
  )
  await migrator.query(
    `INSERT INTO api.projects (id, workspace_id, key, title) VALUES
      ('${PROJ}', '${WS}', 'sse-proj', 'SSE Project'),
      ('${PROJ_B}', '${WS_B}', 'sse-proj-b', 'SSE Project B')`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

function claims(userId: string, workspaceId: string): string {
  return JSON.stringify({
    sub: userId,
    workspace_id: workspaceId,
    role: 'authenticated',
  })
}

async function asAuthenticated(
  userId: string,
  workspaceId: string,
): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    claims(userId, workspaceId),
  ])
  return client
}

async function rpc<T = Record<string, unknown>>(
  client: Client,
  call: string,
): Promise<T> {
  const { rows } = await client.query<{ result: T }>(
    `SELECT to_jsonb(api.${call}) AS result`,
  )
  return rows[0].result as T
}

async function createRecord(
  client: Client,
  title: string,
  proj: string,
): Promise<{ record: { id: string }; blocks: Array<{ id: string }> }> {
  return rpc(
    client,
    `create_record_with_blocks(
      '${proj}'::uuid, 'experiment', '${title}',
      'draft', ARRAY[]::text[],
      '[{"type":"checklist","payload":{"items":[]},"order":1}]'::jsonb)`,
  )
}

describe('LIVE-002 readChangeEvents — replay', () => {
  it('returns workspace-scoped events after a cursor, in order, with earliestAvailableSeq', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    const a = await createRecord(owner, 'Replay A', PROJ)
    const b = await createRecord(owner, 'Replay B', PROJ)

    const full = await readChangeEvents(WS, 0, 100, migratorUrl())
    expect(full.events.length).toBeGreaterThan(0)
    expect(full.earliestAvailableSeq).toBeGreaterThan(0)
    const seqs = full.events.map((e) => e.sequence)
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1])
    }
    expect(full.events.every((e) => e.workspaceId === WS)).toBe(true)

    // Replay after the first event's sequence excludes it.
    const firstSeq = full.events[0].sequence
    const after = await readChangeEvents(WS, firstSeq, 100, migratorUrl())
    expect(after.events.every((e) => e.sequence > firstSeq)).toBe(true)
    expect(after.events.some((e) => e.entityUuid === b.record.id)).toBe(true)

    // The wire shape is camelCase.
    const sample = after.events[0]
    expect(sample).toMatchObject({
      workspaceId: WS,
      entityType: expect.any(String),
      operation: expect.any(String),
    })
    expect(sample).not.toHaveProperty('workspace_id')
  })

  it('reports hasMore when the bound is hit', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    // Create enough records to exceed a small bound. Each create emits 2
    // events (record + block), so 3 creates > bound 4.
    await createRecord(owner, 'Bound 1', PROJ)
    await createRecord(owner, 'Bound 2', PROJ)
    await createRecord(owner, 'Bound 3', PROJ)
    const replay = await readChangeEvents(WS, 0, 4, migratorUrl())
    expect(replay.events).toHaveLength(4)
    expect(replay.hasMore).toBe(true)
  })

  it('does not return events from another workspace', async () => {
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    await createRecord(ownerB, 'Other ws', PROJ_B)
    const wsReplay = await readChangeEvents(WS, 0, 100, migratorUrl())
    expect(wsReplay.events.every((e) => e.workspaceId === WS)).toBe(true)
  })
})

describe('LIVE-002 subscribeToChangeEvents — live delivery', () => {
  it('delivers live events for the workspace via LISTEN/NOTIFY', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    const received: ChangeEventWire[] = []
    const unsub = await subscribeToChangeEvents(
      WS,
      (e) => {
        received.push(e)
      },
      migratorUrl(),
    )

    // Give the LISTEN a moment to register.
    await new Promise((r) => setTimeout(r, 100))
    await createRecord(owner, 'Live delivery', PROJ)
    // Notify is async; poll briefly for delivery.
    for (let i = 0; i < 20 && received.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 50))
    }
    await unsub()
    expect(received.length).toBeGreaterThan(0)
    expect(received.every((e) => e.workspaceId === WS)).toBe(true)
  })

  it('does not deliver notifications from another workspace', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    const received: ChangeEventWire[] = []
    const unsub = await subscribeToChangeEvents(
      WS,
      (e) => {
        received.push(e)
      },
      migratorUrl(),
    )
    await new Promise((r) => setTimeout(r, 100))

    // Mutate WS_B; the WS subscription must not deliver it.
    await createRecord(ownerB, 'Isolation other', PROJ_B)
    // Mutate WS to confirm the subscription is still alive and would
    // deliver WS events.
    await createRecord(owner, 'Isolation self', PROJ)
    for (let i = 0; i < 20 && received.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 50))
    }
    await unsub()
    expect(received.length).toBeGreaterThan(0)
    expect(received.every((e) => e.workspaceId === WS)).toBe(true)
  })
})
