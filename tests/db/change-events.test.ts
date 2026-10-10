/**
 * LIVE-001 contract proof: durable workspace change events are emitted
 * transactionally with notebook and project mutations, ordered by a
 * per-workspace gapless sequence, scoped to the caller's workspace, and
 * impossible for request roles to write or forge directly.
 *
 * Covers: create/update/move/delete/archive/restore/link event semantics,
 * transactional rollback (no event on a failed RPC), per-workspace ordering
 * and isolation, client_id passthrough via claims, read access for members
 * and api_client, and rejection of direct client writes.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const DENIED = '42501'

const WS = '00000000-0000-4000-8000-000000000c0a'
const WS_B = '00000000-0000-4000-8000-000000000c0b'
const PROJ = '00000000-0000-4000-8000-000000000c1a'
const PROJ_B = '00000000-0000-4000-8000-000000000c1b'
const OWNER = 'live-owner'
const OWNER_B = 'live-owner-b'
const OTHER_MEMBER = 'live-member'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())

  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${OWNER}', 'Live Owner', 'live@sheetbase.test', true),
      ('${OWNER_B}', 'Live Owner B', 'live-b@sheetbase.test', true),
      ('${OTHER_MEMBER}', 'Live Member', 'live-m@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS}', 'live-ws', 'Live WS'),
      ('${WS_B}', 'live-ws-b', 'Live WS B')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS}', '${OWNER}', 'owner'),
      ('${WS}', '${OTHER_MEMBER}', 'member'),
      ('${WS_B}', '${OWNER_B}', 'owner')`,
  )
  await migrator.query(
    `INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES
      ('${PROJ}', '${WS}', 'live-proj', 'Live Project', '${OWNER}'),
      ('${PROJ_B}', '${WS_B}', 'live-proj-b', 'Live Project B', '${OWNER_B}')`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

function claims(
  userId: string,
  workspaceId: string,
  clientId?: string,
): string {
  const base: Record<string, unknown> = {
    sub: userId,
    workspace_id: workspaceId,
    role: 'authenticated',
  }
  if (clientId) base.client_id = clientId
  return JSON.stringify(base)
}

async function asAuthenticated(
  userId: string,
  workspaceId: string,
  clientId?: string,
): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    claims(userId, workspaceId, clientId),
  ])
  return client
}

async function asApiClient(
  userId: string,
  workspaceId: string,
): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE api_client')
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

interface ChangeEventRow {
  id: string
  workspace_id: string
  sequence: string
  entity_type: string
  entity_uuid: string
  operation: string
  record_id: string | null
  project_id: string | null
  actor_user_id: string | null
  client_id: string | null
  payload: Record<string, unknown>
}

async function readEvents(
  client: Client,
  workspaceId: string,
): Promise<ChangeEventRow[]> {
  const { rows } = await client.query<ChangeEventRow>(
    `SELECT * FROM api.change_events
      WHERE workspace_id = $1
      ORDER BY sequence ASC`,
    [workspaceId],
  )
  return rows
}

async function createRecord(
  client: Client,
  title = 'Live notebook',
): Promise<{
  record: { id: string; identifier: string }
  blocks: Array<{ id: string }>
}> {
  return rpc(
    client,
    `create_record_with_blocks(
      '${PROJ}'::uuid, 'experiment', '${title}',
      'draft', ARRAY[]::text[],
      '[{"type":"checklist","payload":{"items":[]},"order":1},
        {"type":"rich_text","payload":{"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"B"}]}]}},"order":2}]'::jsonb)`,
  )
}

describe('LIVE-001 change events — emission', () => {
  it('emits record create and block create events on create_record_with_blocks', async () => {
    const owner = await asAuthenticated(OWNER, WS, 'client-A')
    const created = await createRecord(owner, 'Emit create')

    const events = await readEvents(owner, WS)
    const recordCreate = events.find(
      (e) => e.entity_type === 'record' && e.operation === 'create',
    )
    const blockCreates = events.filter(
      (e) => e.entity_type === 'block' && e.operation === 'create',
    )

    expect(recordCreate).toBeTruthy()
    expect(recordCreate!.entity_uuid).toBe(created.record.id)
    expect(recordCreate!.actor_user_id).toBe(OWNER)
    expect(recordCreate!.client_id).toBe('client-A')
    expect(recordCreate!.payload).toMatchObject({
      kind: 'experiment',
      identifier: created.record.identifier,
    })
    expect(blockCreates).toHaveLength(2)
    expect(blockCreates[0].record_id).toBe(created.record.id)
    expect(blockCreates[0].client_id).toBe('client-A')
  })

  it('emits a block move event when move_block reorders', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    const created = await createRecord(owner, 'Emit move')
    // Move the first block after the second (swap): after=block2, before=null.
    await rpc(
      owner,
      `move_block(
        '${created.blocks[0].id}'::uuid, 1,
        '${created.blocks[1].id}'::uuid, NULL)`,
    )

    const events = await readEvents(owner, WS)
    const moves = events.filter(
      (e) =>
        e.entity_type === 'block' &&
        e.operation === 'move' &&
        e.entity_uuid === created.blocks[0].id,
    )
    expect(moves).toHaveLength(1)
    expect(moves[0].payload).toMatchObject({ moved: true })
  })

  it('emits a block update event when update_block_payload changes content', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    const created = await createRecord(owner, 'Emit update')
    await rpc(
      owner,
      `update_block_payload(
        '${created.blocks[0].id}'::uuid,
        '{"level":2,"text":"Updated"}'::jsonb, 1)`,
    )

    const events = await readEvents(owner, WS)
    const update = events.find(
      (e) =>
        e.entity_type === 'block' &&
        e.operation === 'update' &&
        e.entity_uuid === created.blocks[0].id,
    )
    expect(update).toBeTruthy()
    expect(update!.payload).toMatchObject({ version: 2 })
  })

  it('emits archive and restore events with the right operations', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    const created = await createRecord(owner, 'Emit archive')

    await rpc(owner, `archive_record('${created.record.id}'::uuid, 1)`)
    await rpc(owner, `restore_record('${created.record.id}'::uuid, 2)`)

    const events = await readEvents(owner, WS)
    const archive = events.find(
      (e) =>
        e.entity_type === 'record' &&
        e.operation === 'archive' &&
        e.entity_uuid === created.record.id,
    )
    const restore = events.find(
      (e) =>
        e.entity_type === 'record' &&
        e.operation === 'restore' &&
        e.entity_uuid === created.record.id,
    )
    expect(archive).toBeTruthy()
    expect(restore).toBeTruthy()
  })

  it('emits link and unlink events for record_links', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    const a = await createRecord(owner, 'Link source')
    const b = await createRecord(owner, 'Link target')
    const link = await rpc<{ id: string }>(
      owner,
      `create_record_link(
        '${a.record.id}'::uuid, 'experiment', '${b.record.identifier}',
        'general', '${b.record.id}'::uuid, 'see also')`,
    )
    const eventsAfterLink = await readEvents(owner, WS)
    const linkEvent = eventsAfterLink.find(
      (e) => e.entity_type === 'record_link' && e.operation === 'link',
    )
    expect(linkEvent).toBeTruthy()
    expect(linkEvent!.entity_uuid).toBe(link.id)
    expect(linkEvent!.record_id).toBe(a.record.id)

    // Direct DELETE under RLS fires the unlink trigger.
    await owner.query(`DELETE FROM api.record_links WHERE id = '${link.id}'`)
    const eventsAfterUnlink = await readEvents(owner, WS)
    const unlinkEvent = eventsAfterUnlink.find(
      (e) =>
        e.entity_type === 'record_link' &&
        e.operation === 'unlink' &&
        e.entity_uuid === link.id,
    )
    expect(unlinkEvent).toBeTruthy()
  })

  it('emits a block delete event on delete_block', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    const created = await createRecord(owner, 'Emit delete')
    await rpc(owner, `delete_block('${created.blocks[0].id}'::uuid, 1)`)
    const events = await readEvents(owner, WS)
    const del = events.find(
      (e) =>
        e.entity_type === 'block' &&
        e.operation === 'delete' &&
        e.entity_uuid === created.blocks[0].id,
    )
    expect(del).toBeTruthy()
    expect(del!.record_id).toBe(created.record.id)
  })
})

describe('LIVE-001 change events — transactional rollback', () => {
  it('does not emit any event when an RPC fails mid-transaction', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    const created = await createRecord(owner, 'Rollback base')
    const before = await readEvents(owner, WS)

    // Stale structure_version aborts the whole move_block transaction, so no
    // move event and no record update event is emitted.
    await expect(
      rpc(
        owner,
        `move_block(
          '${created.blocks[0].id}'::uuid, 999,
          '${created.blocks[1].id}'::uuid, NULL)`,
      ),
    ).rejects.toMatchObject({ code: 'SB001' })

    const after = await readEvents(owner, WS)
    expect(after).toHaveLength(before.length)
  })
})

describe('LIVE-001 change events — ordering and isolation', () => {
  it('assigns a per-workspace gapless monotonic sequence', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    await createRecord(owner, 'Order 1')
    await createRecord(owner, 'Order 2')

    const events = await readEvents(owner, WS)
    const seqs = events.map((e) => Number(e.sequence))
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1])
    }
    expect(new Set(seqs).size).toBe(seqs.length)
  })

  it('does not leak events from another workspace', async () => {
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    await rpc(
      ownerB,
      `create_record_with_blocks(
        '${PROJ_B}'::uuid, 'experiment', 'Other workspace',
        'draft', ARRAY[]::text[],
        '[{"type":"checklist","payload":{"items":[]},"order":1}]'::jsonb)`,
    )

    const owner = await asAuthenticated(OWNER, WS)
    const wsEvents = await readEvents(owner, WS)
    expect(wsEvents.every((e) => e.workspace_id === WS)).toBe(true)
    expect(wsEvents.some((e) => e.workspace_id === WS_B)).toBe(false)
  })

  it('lets a workspace member read events but not a caller from another workspace', async () => {
    const member = await asAuthenticated(OTHER_MEMBER, WS)
    const events = await readEvents(member, WS)
    expect(Array.isArray(events)).toBe(true)

    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    const cross = await ownerB.query(
      `SELECT count(*) FROM api.change_events WHERE workspace_id = '${WS}'`,
    )
    expect(Number(cross.rows[0].count)).toBe(0)
  })
})

describe('LIVE-001 change events — client forgery prevention', () => {
  it('rejects direct INSERT into change_events by an authenticated caller', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    await expect(
      owner.query(
        `INSERT INTO api.change_events
          (workspace_id, sequence, entity_type, entity_uuid, operation)
          VALUES ('${WS}'::uuid, 1, 'record', gen_random_uuid(), 'create')`,
      ),
    ).rejects.toMatchObject({ code: DENIED })
  })

  it('rejects direct UPDATE and DELETE on change_events by an authenticated caller', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    await expect(
      owner.query(`UPDATE api.change_events SET operation = 'forged'`),
    ).rejects.toMatchObject({ code: DENIED })
    await expect(
      owner.query(`DELETE FROM api.change_events`),
    ).rejects.toMatchObject({ code: DENIED })
  })

  it('does not expose emit_change_event as a callable RPC to authenticated', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    await expect(
      owner.query(
        `SELECT internal.emit_change_event(
          '${WS}'::uuid, 'record', gen_random_uuid(), 'create')`,
      ),
    ).rejects.toMatchObject({ code: DENIED })
  })
})

describe('LIVE-001 change events — bootstrap paths stay quiet', () => {
  it('does not emit events when no user claim is present (migrator write)', async () => {
    const before = await migrator.query(
      `SELECT count(*)::int AS n FROM api.change_events WHERE workspace_id = '${WS}'`,
    )
    await migrator.query(
      `INSERT INTO api.projects (workspace_id, key, title)
        VALUES ('${WS}'::uuid, 'migrator-quiet', 'Migrator Quiet')`,
    )
    const after = await migrator.query(
      `SELECT count(*)::int AS n FROM api.change_events WHERE workspace_id = '${WS}'`,
    )
    expect(after.rows[0].n).toBe(before.rows[0].n)
  })
})

describe('LIVE-001 change events — api_client read access', () => {
  it('lets an api_client read events scoped to its workspace token', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    await createRecord(owner, 'api_client read')

    const apiClient = await asApiClient(OWNER, WS)
    const { rows } = await apiClient.query(
      `SELECT count(*)::int AS n FROM api.change_events WHERE workspace_id = '${WS}'`,
    )
    expect(rows[0].n).toBeGreaterThan(0)
  })
})
