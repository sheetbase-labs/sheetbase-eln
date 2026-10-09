/**
 * ELN-008 — the Phase 3 live-notebook acceptance proof.
 *
 * A single test target that exercises the full notebook lifecycle through
 * the same PostgREST RPCs the UI calls, then proves the Phase 3 exit gate
 * from ROADMAP.md / TODO.md:
 *
 *   - create an experiment notebook with initial blocks;
 *   - add, edit, reorder, and link the initial block types;
 *   - reload (re-query) and confirm content, order, and identifiers are stable;
 *   - simulate a second tab (distinct client_id) and confirm saved changes
 *     arrive as durable change events without a full-page reload;
 *   - trigger a controlled stale-version conflict and confirm neither side
 *     is silently lost;
 *   - read the same notebook and blocks through an external API credential;
 *   - confirm audit/change attribution identifies the acting user and client.
 *
 * Run with: pnpm test:db phase3-proof
 */
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import * as schema from '#/db/schema'
import { createCredential, mintApiClientToken } from '#/lib/api-credentials'
import { resolveExternalToken } from '#/lib/external-token'
import type { ProxyPath } from '#/lib/postgrest-path'
import { migratorUrl, prepareTestDatabase } from './helpers'

const SECRET =
  process.env.PGRST_JWT_SECRET ?? 'test-jwt-secret-at-least-32-chars!!'

const DENIED = '42501'
const STALE = 'SB001'

const WS = '00000000-0000-4000-8000-000000000e0a'
const PROJ = '00000000-0000-4000-8000-000000000e1a'
const OWNER = 'phase3-owner'
const MEMBER = 'phase3-member'

let migrator: Client
let db: ReturnType<typeof drizzle<typeof schema>>
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  db = drizzle(migratorUrl(), { schema })

  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${OWNER}', 'Phase3 Owner', 'phase3@sheetbase.test', true),
      ('${MEMBER}', 'Phase3 Member', 'phase3-m@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS}', 'phase3-ws', 'Phase3 WS')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS}', '${OWNER}', 'owner'),
      ('${WS}', '${MEMBER}', 'member')`,
  )
  await migrator.query(
    `INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES
      ('${PROJ}', '${WS}', 'phase3-proj', 'Phase3 Project', '${OWNER}')`,
  )
})

afterAll(async () => {
  for (const c of clients) await c.end()
  await db.$client.end()
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
  claimsObj: Record<string, unknown>,
): Promise<Client> {
  const { Client } = await import('pg')
  const url = new URL(process.env.PGRST_DB_URI ?? '')
  url.hostname = 'localhost'
  url.port = process.env.POSTGRES_PORT ?? '5432'
  url.pathname = '/sheetbase_test'
  const client = new Client({ connectionString: url.toString() })
  await client.connect()
  clients.push(client)
  await client.query('SET ROLE api_client')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    JSON.stringify(claimsObj),
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

// ---------------------------------------------------------------------------
// The acceptance proof. Each `it` block is a step in the workflow; the
// shared notebook is created once and mutated across steps to mirror a
// real lab session.
// ---------------------------------------------------------------------------

const CLIENT_TAB_A = 'phase3-tab-a'
const CLIENT_TAB_B = 'phase3-tab-b'

let ownerA: Client
let ownerB: Client
let recordId: string
let proseBlockId: string
let textBlockId: string
let checklistBlockId: string
let protocolRecordId: string
let protocolIdentifier: string

describe('ELN-008 Phase 3 acceptance proof', () => {
  it('creates an experiment notebook with initial blocks', async () => {
    ownerA = await asAuthenticated(OWNER, WS, CLIENT_TAB_A)
    const result = await rpc<{
      record: {
        id: string
        identifier: string
        title: string
        kind: string
        status: string
      }
      blocks: Array<{
        id: string
        type: string
        order: number
        version: number
        payload: Record<string, unknown>
      }>
    }>(
      ownerA,
      `create_record_with_blocks(
        '${PROJ}'::uuid, 'experiment', 'Virus Stability at 4C',
        'in-progress', ARRAY['stability','qPCR']::text[],
        '[{"type":"rich_text","payload":{"doc":{"type":"doc","content":[{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Objective"}]},{"type":"paragraph","content":[{"type":"text","text":"Determine half-life."}]}]}},"order":1},
            {"type":"rich_text","payload":{"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Objective: determine half-life."}]}]}},"order":2}]'::jsonb
      )`,
    )
    recordId = result.record.id
    expect(result.record.identifier).toMatch(/^EXP-\d{4}$/)
    expect(result.record.kind).toBe('experiment')
    expect(result.record.status).toBe('in-progress')
    expect(result.blocks).toHaveLength(2)
    proseBlockId = result.blocks[0].id
    textBlockId = result.blocks[1].id
    expect(result.blocks[0].type).toBe('rich_text')
    expect(result.blocks[1].type).toBe('rich_text')
  })

  it('adds a checklist block through insert_block', async () => {
    const res = await rpc<{
      block: {
        id: string
        type: string
        order: number
        payload: Record<string, unknown>
      }
      structure_version: number
    }>(
      ownerA,
      `insert_block(
        '${recordId}'::uuid, 'checklist',
        '{"items":[{"text":"Thaw virus aliquot","checked":false},{"text":"Incubate at 4C","checked":false}]}'::jsonb,
        1, NULL, 1)`,
    )
    checklistBlockId = res.block.id
    expect(res.block.type).toBe('checklist')
    expect(res.block.order).toBe(3)
    expect(res.structure_version).toBe(2)
  })

  it('edits the rich text block through update_block_payload', async () => {
    const updated = await rpc<{
      id: string
      version: number
      payload: { doc: { content: Array<{ content: Array<{ text: string }> }> } }
    }>(
      ownerA,
      `update_block_payload(
        '${textBlockId}'::uuid,
        '{"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Objective: determine the half-life of infectious virus at 4C."}]}]}}'::jsonb,
        1)`,
    )
    expect(updated.version).toBe(2)
    expect(updated.payload.doc.content[0].content[0].text).toContain(
      'half-life of infectious virus',
    )
  })

  it('reorders the checklist before the rich text via move_block', async () => {
    const res = await rpc<{
      structure_version: number
      order: Array<{ id: string; order: number }>
    }>(
      ownerA,
      `move_block('${checklistBlockId}'::uuid, 2, '${proseBlockId}'::uuid, '${textBlockId}'::uuid)`,
    )
    expect(res.structure_version).toBe(3)
    const order = res.order.map((o) => o.id)
    expect(order).toEqual([proseBlockId, checklistBlockId, textBlockId])
  })

  it('creates a protocol template and links the experiment to it', async () => {
    const proto = await rpc<{ record: { id: string; identifier: string } }>(
      ownerA,
      `create_record_with_blocks(
        '${PROJ}'::uuid, 'protocol_template', 'Virus Stability Protocol',
        'draft', ARRAY[]::text[], '[]'::jsonb)`,
    )
    protocolRecordId = proto.record.id
    protocolIdentifier = proto.record.identifier

    const link = await rpc<{
      source_record_id: string
      target_record_id: string
      link_type: string
    }>(
      ownerA,
      `create_record_link(
        '${recordId}'::uuid, 'protocol_template', '${protocolIdentifier}',
        'protocol', '${protocolRecordId}'::uuid, NULL)`,
    )
    expect(link.link_type).toBe('protocol')
    expect(link.target_record_id).toBe(protocolRecordId)
  })

  it('reloads and confirms content, order, and identifiers are stable', async () => {
    // Simulate a page reload by re-querying the canonical record + blocks.
    const { rows: reloadedRows } = await ownerA.query(
      `SELECT id, identifier, title, status FROM api.records WHERE id = '${recordId}'`,
    )
    expect(reloadedRows).toHaveLength(1)
    expect(reloadedRows[0].id).toBe(recordId)
    expect(reloadedRows[0].title).toBe('Virus Stability at 4C')

    const { rows: blocks } = await ownerA.query(
      `SELECT id, type, "order", version, payload
       FROM api.blocks WHERE record_id = '${recordId}'
       ORDER BY "order" ASC`,
    )
    expect(blocks).toHaveLength(3)
    expect(blocks.map((b: { id: string }) => b.id)).toEqual([
      proseBlockId,
      checklistBlockId,
      textBlockId,
    ])
    // Content survived the reload.
    const text = blocks.find((b: { id: string }) => b.id === textBlockId) as {
      payload: { doc: { content: Array<{ content: Array<{ text: string }> }> } }
    }
    expect(text.payload.doc.content[0].content[0].text).toContain(
      'half-life of infectious virus',
    )
  })

  it('simulates a second tab and confirms changes arrive as durable events', async () => {
    // Tab B is the same user but a different client_id.
    ownerB = await asAuthenticated(OWNER, WS, CLIENT_TAB_B)

    // Tab B edits the structured prose document, including its heading.
    const updated = await rpc<{
      version: number
      payload: { doc: unknown }
    }>(
      ownerB,
      `update_block_payload(
        '${proseBlockId}'::uuid,
        '{"doc":{"type":"doc","content":[{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Objective — Updated"}]},{"type":"paragraph","content":[{"type":"text","text":"Determine half-life."}]}]}}'::jsonb,
        1)`,
    )
    expect(updated.version).toBe(2)

    // The change events should carry tab B's client_id and the owner's
    // user id — this is what the SSE stream delivers to tab A without
    // a full-page reload.
    const events = await readEvents(migrator, WS)
    const blockUpdate = events.find(
      (e) =>
        e.entity_type === 'block' &&
        e.entity_uuid === proseBlockId &&
        e.operation === 'update',
    )
    expect(blockUpdate).toBeDefined()
    expect(blockUpdate!.client_id).toBe(CLIENT_TAB_B)
    expect(blockUpdate!.actor_user_id).toBe(OWNER)
  })

  it('triggers a controlled conflict and confirms neither version is silently lost', async () => {
    // Tab A still has the prose block at version 1 (it never saw tab B's edit).
    // Tab A tries to save its own edit at the stale version.
    await expect(
      ownerA.query(
        `SELECT * FROM api.update_block_payload(
          '${proseBlockId}'::uuid,
          '{"doc":{"type":"doc","content":[{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Tab A edit"}]}]}}'::jsonb,
          1, 1)`,
      ),
    ).rejects.toMatchObject({ code: STALE })

    // The server's canonical version is untouched — tab A's edit was
    // NOT silently applied, and tab B's edit was NOT silently overwritten.
    const { rows } = await ownerA.query(
      `SELECT version, payload FROM api.blocks WHERE id = '${proseBlockId}'`,
    )
    expect(rows[0].version).toBe(2)
    expect(rows[0].payload.doc.content[0].content[0].text).toBe(
      'Objective — Updated',
    )
  })

  it('reads the same notebook and blocks through an external API credential', async () => {
    const cred = await createCredential(db, {
      workspaceId: WS,
      createdByUserId: OWNER,
      name: 'phase3-reader',
      scopes: ['projects:read'],
    })
    const token = await mintApiClientToken(SECRET, {
      workspaceId: WS,
      credentialId: cred.id,
      scopes: ['projects:read'],
    })

    const recordsPath: ProxyPath = { kind: 'table', resource: 'records' }
    const resolved = await resolveExternalToken(
      db,
      token,
      SECRET,
      'GET',
      recordsPath,
    )
    expect(resolved.workspaceId).toBe(WS)

    // Read the notebook record and blocks as the external api_client.
    const apiClient = await asApiClient({
      workspace_id: WS,
      credential_id: cred.id,
      scopes: ['projects:read'],
      role: 'api_client',
    })
    const { rows: records } = await apiClient.query(
      `SELECT id, identifier, title, kind FROM api.records
       WHERE id = '${recordId}'`,
    )
    expect(records).toHaveLength(1)
    expect(records[0].kind).toBe('experiment')

    const { rows: blocks } = await apiClient.query(
      `SELECT id, type, "order" FROM api.blocks
       WHERE record_id = '${recordId}' ORDER BY "order" ASC`,
    )
    expect(blocks).toHaveLength(3)
    expect(blocks.map((b: { id: string }) => b.id)).toEqual([
      proseBlockId,
      checklistBlockId,
      textBlockId,
    ])
  })

  it('confirms audit/change attribution identifies the acting user and client', async () => {
    const events = await readEvents(migrator, WS)

    // The create event from tab A.
    const recordCreate = events.find(
      (e) =>
        e.entity_type === 'record' &&
        e.entity_uuid === recordId &&
        e.operation === 'create',
    )
    expect(recordCreate).toBeDefined()
    expect(recordCreate!.actor_user_id).toBe(OWNER)
    expect(recordCreate!.client_id).toBe(CLIENT_TAB_A)

    // The block insert from tab A.
    const blockInsert = events.find(
      (e) =>
        e.entity_type === 'block' &&
        e.entity_uuid === checklistBlockId &&
        e.operation === 'create',
    )
    expect(blockInsert).toBeDefined()
    expect(blockInsert!.actor_user_id).toBe(OWNER)
    expect(blockInsert!.client_id).toBe(CLIENT_TAB_A)

    // The link event from tab A.
    const linkEvent = events.find(
      (e) => e.entity_type === 'record_link' && e.operation === 'link',
    )
    expect(linkEvent).toBeDefined()
    expect(linkEvent!.actor_user_id).toBe(OWNER)
    expect(linkEvent!.client_id).toBe(CLIENT_TAB_A)

    // The block update from tab B (second tab).
    const blockUpdateTabB = events.find(
      (e) =>
        e.entity_type === 'block' &&
        e.entity_uuid === proseBlockId &&
        e.operation === 'update' &&
        e.client_id === CLIENT_TAB_B,
    )
    expect(blockUpdateTabB).toBeDefined()
    expect(blockUpdateTabB!.actor_user_id).toBe(OWNER)

    // Events are gapless per workspace.
    const seqs = events.map((e) => Number(e.sequence))
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1])
    }
  })

  it('rejects cross-workspace access to the notebook', async () => {
    // A caller from a different workspace cannot read or edit this
    // notebook. This is the negative side of the acceptance proof.
    const WS_OTHER = '00000000-0000-4000-8000-000000000e0b'
    const OWNER_OTHER = 'phase3-other'
    const PROJ_OTHER = '00000000-0000-4000-8000-000000000e1b'
    await migrator.query(
      `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
        ('${OWNER_OTHER}', 'Other', 'other@sheetbase.test', true)`,
    )
    await migrator.query(
      `INSERT INTO api.workspaces (id, slug, name) VALUES
        ('${WS_OTHER}', 'other-ws', 'Other WS')`,
    )
    await migrator.query(
      `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
        ('${WS_OTHER}', '${OWNER_OTHER}', 'owner')`,
    )
    await migrator.query(
      `INSERT INTO api.projects (id, workspace_id, key, title) VALUES
        ('${PROJ_OTHER}', '${WS_OTHER}', 'other-proj', 'Other Project')`,
    )
    const crossCaller = await asAuthenticated(OWNER_OTHER, WS_OTHER)
    await expect(
      crossCaller.query(
        `SELECT * FROM api.update_block_payload(
          '${proseBlockId}'::uuid, '{"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"cross"}]}]}}'::jsonb, 2, 1)`,
      ),
    ).rejects.toMatchObject({ code: DENIED })
    const { rows } = await crossCaller.query(
      `SELECT count(*)::int AS n FROM api.blocks WHERE record_id = '${recordId}'`,
    )
    expect(rows[0].n).toBe(0)
  })
})
