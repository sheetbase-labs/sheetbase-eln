/**
 * ELN-003 contract proof: the notebook RPCs (create_record_with_blocks,
 * update_block_payload, move_block, archive_record, restore_record,
 * create_record_link) behave over PostgREST roles with real claim GUCs.
 * Covers create, load, edit, reorder, link, archive, restore, the
 * optimistic-concurrency stale_version error (SB001), the missing_link
 * error (SB002), and permission denial for cross-workspace callers.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const DENIED = '42501'
const STALE = 'SB001'
const MISSING_LINK = 'SB002'

const WS = '00000000-0000-4000-8000-000000000a0a'
const WS_B = '00000000-0000-4000-8000-000000000a0b'
const PROJ = '00000000-0000-4000-8000-000000000a1a'
const PROJ_B = '00000000-0000-4000-8000-000000000a1b'
const OWNER = 'nb-rpc-owner'
const OWNER_B = 'nb-rpc-owner-b'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())

  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${OWNER}', 'NB RPC Owner', 'nb-rpc@sheetbase.test', true),
      ('${OWNER_B}', 'NB RPC Owner B', 'nb-rpc-b@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS}', 'nb-rpc-ws', 'NB RPC WS'),
      ('${WS_B}', 'nb-rpc-ws-b', 'NB RPC WS B')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS}', '${OWNER}', 'owner'),
      ('${WS_B}', '${OWNER_B}', 'owner')`,
  )
  await migrator.query(
    `INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES
      ('${PROJ}', '${WS}', 'nb-rpc-proj', 'NB RPC Project', '${OWNER}'),
      ('${PROJ_B}', '${WS_B}', 'nb-rpc-proj-b', 'NB RPC Project B', '${OWNER_B}')`,
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

async function rpcByName<T = Record<string, unknown>>(
  client: Client,
  call: string,
): Promise<T> {
  // call looks like: create_record_with_blocks('uuid','experiment','Title').
  // to_jsonb() normalises both jsonb-returning and composite-returning RPCs
  // to a single object the test can read uniformly (the raw pg driver
  // returns composite columns as strings; PostgREST does this JSON-ifying
  // for the real HTTP path).
  const { rows } = await client.query<{ result: T }>(
    `SELECT to_jsonb(api.${call}) AS result`,
  )
  return rows[0].result as T
}

describe('create_record_with_blocks', () => {
  it('creates a record and its initial blocks in one transaction', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    const result = await rpcByName<{
      record: { identifier: string; title: string; kind: string }
      blocks: Array<{
        id: string
        type: string
        order: number
        version: number
      }>
    }>(
      owner,
      `create_record_with_blocks(
        '${PROJ}'::uuid,
        'experiment',
        'Virus Stability',
        'draft',
        ARRAY['stability']::text[],
        '[{"type":"rich_text","payload":{"doc":{"type":"doc","content":[{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Objective"}]},{"type":"paragraph","content":[{"type":"text","text":"Objective text."}]}]}},"order":1},
            {"type":"rich_text","payload":{"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Objective text."}]}]}},"order":2}]'::jsonb
      )`,
    )
    expect(result.record.identifier).toMatch(/^EXP-\d{4}$/)
    expect(result.record.title).toBe('Virus Stability')
    expect(result.blocks).toHaveLength(2)
    expect(result.blocks[0].type).toBe('rich_text')
    expect(result.blocks[1].version).toBe(1)
  })

  it('assigns sequential order when the client omits order', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    const result = await rpcByName<{
      blocks: Array<{ type: string; order: number }>
    }>(
      owner,
      `create_record_with_blocks(
        '${PROJ}'::uuid, 'experiment', 'No order blocks',
        'draft', ARRAY[]::text[],
        '[{"type":"checklist","payload":{"items":[]}},
            {"type":"rich_text","payload":{"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"B"}]}]}}}]'::jsonb
      )`,
    )
    expect(result.blocks.map((b) => b.order)).toEqual([1, 2])
  })

  it('rejects an unsupported kind', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    await expect(
      owner.query(
        `SELECT * FROM api.create_record_with_blocks(
          '${PROJ}'::uuid, 'assay', 'Bad', 'draft', ARRAY[]::text[], '[]'::jsonb)`,
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('rejects a caller from another workspace', async () => {
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    await expect(
      ownerB.query(
        `SELECT * FROM api.create_record_with_blocks(
          '${PROJ}'::uuid, 'experiment', 'Cross', 'draft', ARRAY[]::text[], '[]'::jsonb)`,
      ),
    ).rejects.toMatchObject({ code: DENIED })
  })
})

describe('update_block_payload', () => {
  it('updates a block and bumps its version', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    const created = await rpcByName<{
      blocks: Array<{ id: string; version: number }>
    }>(
      owner,
      `create_record_with_blocks(
        '${PROJ}'::uuid, 'experiment', 'Edit me',
        'draft', ARRAY[]::text[],
        '[{"type":"rich_text","payload":{"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"before"}]}]}},"order":1}]'::jsonb)`,
    )
    const block = created.blocks[0]
    const updated = await rpcByName<{
      id: string
      version: number
      payload: { doc: { content: Array<{ content: Array<{ text: string }> }> } }
    }>(
      owner,
      `update_block_payload(
        '${block.id}'::uuid,
        '{"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"after"}]}]}}'::jsonb,
        1)`,
    )
    expect(updated.version).toBe(2)
    expect(updated.payload.doc.content[0].content[0].text).toBe('after')
  })

  it('rejects a stale block version with SB001', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    const created = await rpcByName<{
      blocks: Array<{ id: string; version: number }>
    }>(
      owner,
      `create_record_with_blocks(
        '${PROJ}'::uuid, 'experiment', 'Stale edit',
        'draft', ARRAY[]::text[],
        '[{"type":"rich_text","payload":{"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"x"}]}]}},"order":1}]'::jsonb)`,
    )
    const block = created.blocks[0]
    await expect(
      owner.query(
        `SELECT * FROM api.update_block_payload(
          '${block.id}'::uuid, '{"body":"y"}'::jsonb, 99, 1)`,
      ),
    ).rejects.toMatchObject({ code: STALE })
  })

  it('rejects a block in another workspace', async () => {
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    await expect(
      ownerB.query(
        `SELECT * FROM api.update_block_payload(
          '00000000-0000-0000-0000-000000000000'::uuid,
          '{"body":"y"}'::jsonb, 1, 1)`,
      ),
    ).rejects.toMatchObject({ code: DENIED })
  })
})

describe('move_block', () => {
  async function seedThree(client: Client): Promise<{
    recordId: string
    a: string
    b: string
    c: string
    sv: number
  }> {
    const created = await rpcByName<{
      record: { id: string }
      blocks: Array<{ id: string; order: number }>
    }>(
      client,
      `create_record_with_blocks(
        '${PROJ}'::uuid, 'experiment', 'Movable',
        'draft', ARRAY[]::text[],
        '[{"type":"checklist","payload":{"items":[]},"order":1},
            {"type":"checklist","payload":{"items":[]},"order":2},
            {"type":"checklist","payload":{"items":[]},"order":3}]'::jsonb)`,
    )
    return {
      recordId: created.record.id,
      a: created.blocks[0].id,
      b: created.blocks[1].id,
      c: created.blocks[2].id,
      sv: 1,
    }
  }

  it('moves a block to the end atomically and bumps structure_version', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    const { a, sv } = await seedThree(owner)
    const result = await rpcByName<{
      structure_version: number
      order: Array<{ id: string; order: number }>
    }>(owner, `move_block('${a}'::uuid, ${sv}, NULL, NULL)`)
    // Only block a moved (to end); structure_version bumped.
    expect(result.structure_version).toBe(sv + 1)
    const order = result.order.map((o) => o.id)
    expect(order).toHaveLength(3)
    // a should now be last.
    expect(order[order.length - 1]).toBe(a)
  })

  it('moves a block between two neighbours via fractional indexing', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    const { a, b, c, sv } = await seedThree(owner)
    // Move C between A and B: after=A, before=B.
    const result = await rpcByName<{
      order: Array<{ id: string; order: number }>
    }>(owner, `move_block('${c}'::uuid, ${sv}, '${a}'::uuid, '${b}'::uuid)`)
    const order = result.order.map((o) => o.id)
    expect(order).toEqual([a, c, b])
  })

  it('rejects a stale structure_version with SB001', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    const { a, sv } = await seedThree(owner)
    await expect(
      owner.query(
        `SELECT * FROM api.move_block('${a}'::uuid, ${sv + 99}, NULL, NULL)`,
      ),
    ).rejects.toMatchObject({ code: STALE })
  })
})

describe('archive and restore', () => {
  it('archives a record and restores it, bumping metadata_version', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    const created = await rpcByName<{
      record: {
        id: string
        metadata_version: number
        archived_at: string | null
      }
    }>(
      owner,
      `create_record_with_blocks(
        '${PROJ}'::uuid, 'experiment', 'Archivable',
        'draft', ARRAY[]::text[], '[]'::jsonb)`,
    )
    const record = created.record
    const archived = await rpcByName<{
      metadata_version: number
      archived_at: string | null
    }>(
      owner,
      `archive_record('${record.id}'::uuid, ${record.metadata_version})`,
    )
    expect(archived.archived_at).not.toBeNull()
    expect(archived.metadata_version).toBe(record.metadata_version + 1)

    const restored = await rpcByName<{
      metadata_version: number
      archived_at: string | null
    }>(
      owner,
      `restore_record('${record.id}'::uuid, ${archived.metadata_version})`,
    )
    expect(restored.archived_at).toBeNull()
    expect(restored.metadata_version).toBe(archived.metadata_version + 1)
  })

  it('rejects a stale metadata_version with SB001', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    const created = await rpcByName<{ record: { id: string } }>(
      owner,
      `create_record_with_blocks(
        '${PROJ}'::uuid, 'experiment', 'Stale archive',
        'draft', ARRAY[]::text[], '[]'::jsonb)`,
    )
    await expect(
      owner.query(
        `SELECT * FROM api.archive_record('${created.record.id}'::uuid, 999)`,
      ),
    ).rejects.toMatchObject({ code: STALE })
  })
})

describe('create_record_link', () => {
  it('creates a link to a target record in the same workspace', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    const exp = await rpcByName<{ record: { id: string; identifier: string } }>(
      owner,
      `create_record_with_blocks(
        '${PROJ}'::uuid, 'experiment', 'Linker', 'draft', ARRAY[]::text[], '[]'::jsonb)`,
    )
    const proto = await rpcByName<{
      record: { id: string; identifier: string }
    }>(
      owner,
      `create_record_with_blocks(
        '${PROJ}'::uuid, 'protocol_template', 'Proto', 'draft', ARRAY[]::text[], '[]'::jsonb)`,
    )
    const link = await rpcByName<{
      source_record_id: string
      target_record_id: string
      link_type: string
    }>(
      owner,
      `create_record_link(
        '${exp.record.id}'::uuid, 'protocol_template', '${proto.record.identifier}',
        'protocol', '${proto.record.id}'::uuid, NULL)`,
    )
    expect(link.link_type).toBe('protocol')
    expect(link.target_record_id).toBe(proto.record.id)
  })

  it('rejects a link to a target in another workspace with SB002', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    const exp = await rpcByName<{ record: { id: string } }>(
      owner,
      `create_record_with_blocks(
        '${PROJ}'::uuid, 'experiment', 'Cross link', 'draft', ARRAY[]::text[], '[]'::jsonb)`,
    )
    const crossTarget = await rpcByName<{ record: { id: string } }>(
      await asAuthenticated(OWNER_B, WS_B),
      `create_record_with_blocks(
        '${PROJ_B}'::uuid, 'experiment', 'Other ws', 'draft', ARRAY[]::text[], '[]'::jsonb)`,
    )
    await expect(
      owner.query(
        `SELECT * FROM api.create_record_link(
          '${exp.record.id}'::uuid, 'experiment', 'EXP-9999',
          'general', '${crossTarget.record.id}'::uuid, NULL)`,
      ),
    ).rejects.toMatchObject({ code: MISSING_LINK })
  })
})

describe('safe reads through PostgREST tables', () => {
  it('lets a member load records and blocks for their workspace', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    const { rows: records } = await owner.query(
      `SELECT identifier, title FROM api.records ORDER BY identifier`,
    )
    expect(records.length).toBeGreaterThan(0)
    const { rows: blocks } = await owner.query(
      `SELECT count(*)::int AS n FROM api.blocks`,
    )
    expect(blocks[0].n).toBeGreaterThan(0)
  })

  it('hides another workspace records and blocks', async () => {
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    const { rows } = await ownerB.query(
      `SELECT count(*)::int AS n FROM api.records WHERE project_id = '${PROJ}'`,
    )
    expect(rows[0].n).toBe(0)
  })
})

describe('insert_block', () => {
  async function seedEmpty(client: Client): Promise<{ recordId: string }> {
    const created = await rpcByName<{ record: { id: string } }>(
      client,
      `create_record_with_blocks(
        '${PROJ}'::uuid, 'experiment', 'Insert Target',
        'draft', ARRAY[]::text[], '[]'::jsonb)`,
    )
    return { recordId: created.record.id }
  }

  it('appends a block at the end and bumps structure_version', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    const { recordId } = await seedEmpty(owner)
    const res = await rpcByName<{
      block: {
        id: string
        type: string
        order: number
        payload: { text: string }
      }
      structure_version: number
    }>(
      owner,
      `insert_block(
        '${recordId}'::uuid, 'checklist',
        '{"items":[]}'::jsonb, 1, NULL, 1)`,
    )
    expect(res.block.type).toBe('checklist')
    expect(res.block.payload.items).toEqual([])
    expect(res.block.order).toBe(1)
    expect(res.structure_version).toBe(2)
  })

  it('inserts after an anchor via fractional indexing', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    const { recordId } = await seedEmpty(owner)
    const first = await rpcByName<{
      block: { id: string; order: number }
      structure_version: number
    }>(
      owner,
      `insert_block(
        '${recordId}'::uuid, 'checklist',
        '{"items":[]}'::jsonb, 1, NULL, 1)`,
    )
    const second = await rpcByName<{
      block: { id: string; order: number }
      structure_version: number
    }>(
      owner,
      `insert_block(
        '${recordId}'::uuid, 'checklist',
        '{"items":[]}'::jsonb, 1, NULL, ${first.structure_version})`,
    )
    // Insert between A (order 1) and B (order 2).
    const mid = await rpcByName<{
      block: { id: string; order: number }
      structure_version: number
    }>(
      owner,
      `insert_block(
        '${recordId}'::uuid, 'rich_text',
        '{"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"mid"}]}]}}'::jsonb, 1, '${first.block.id}'::uuid, ${second.structure_version})`,
    )
    expect(mid.block.order).toBeGreaterThan(first.block.order)
    expect(mid.block.order).toBeLessThan(second.block.order)

    const { rows } = await owner.query(
      `SELECT id, "order" FROM api.blocks WHERE record_id = '${recordId}' ORDER BY "order" ASC`,
    )
    expect(rows.map((r: { id: string }) => r.id)).toEqual([
      first.block.id,
      mid.block.id,
      second.block.id,
    ])
  })

  it('rejects a stale structure_version with SB001', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    const { recordId } = await seedEmpty(owner)
    await expect(
      owner.query(
        `SELECT * FROM api.insert_block(
          '${recordId}'::uuid, 'checklist',
          '{"items":[]}'::jsonb, 1, NULL, 999)`,
      ),
    ).rejects.toMatchObject({ code: STALE })
  })

  it('rejects an anchor from a different record', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    const { recordId } = await seedEmpty(owner)
    const other = await seedEmpty(owner)
    const foreign = await rpcByName<{ block: { id: string } }>(
      owner,
      `insert_block(
        '${other.recordId}'::uuid, 'checklist',
        '{"items":[]}'::jsonb, 1, NULL, 1)`,
    )
    // after_block_id points into a different record: FK-style rejection.
    await expect(
      owner.query(
        `SELECT * FROM api.insert_block(
          '${recordId}'::uuid, 'checklist',
          '{"items":[]}'::jsonb, 1, '${foreign.block.id}'::uuid, 1)`,
      ),
    ).rejects.toMatchObject({ code: '23503' })
  })

  it('rejects a caller from another workspace', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    const { recordId } = await seedEmpty(owner)
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    await expect(
      ownerB.query(
        `SELECT * FROM api.insert_block(
          '${recordId}'::uuid, 'checklist',
          '{"items":[]}'::jsonb, 1, NULL, 1)`,
      ),
    ).rejects.toMatchObject({ code: DENIED })
  })

  // NOTE-01: the before anchor makes undo a single atomic insert — a
  // deleted first block is restored at the start without a second,
  // non-atomic move_block call.
  it('inserts before an anchor at the start of the record (atomic undo)', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    const { recordId } = await seedEmpty(owner)
    const first = await rpcByName<{
      block: { id: string; order: number }
      structure_version: number
    }>(
      owner,
      `insert_block(
        '${recordId}'::uuid, 'checklist',
        '{"items":[]}'::jsonb, 1, NULL, 1)`,
    )
    const second = await rpcByName<{
      block: { id: string }
      structure_version: number
    }>(
      owner,
      `insert_block(
        '${recordId}'::uuid, 'checklist',
        '{"items":[]}'::jsonb, 1, '${first.block.id}'::uuid, ${first.structure_version})`,
    )
    // (null, before) resolves to the start of the record in one RPC.
    const restored = await rpcByName<{
      block: { id: string; order: number }
      structure_version: number
      rebalanced: boolean
      order: Array<{ id: string; order: number }>
    }>(
      owner,
      `insert_block(
        '${recordId}'::uuid, 'rich_text',
        '{"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"undo"}]}]}}'::jsonb, 1, NULL, ${second.structure_version}, '${first.block.id}'::uuid)`,
    )
    expect(restored.block.order).toBeLessThan(first.block.order)
    expect(restored.structure_version).toBe(4)
    expect(restored.rebalanced).toBe(false)
    expect(restored.order.map((b) => b.id)).toEqual([
      restored.block.id,
      first.block.id,
      second.block.id,
    ])

    const { rows } = await owner.query(
      `SELECT id, "order" FROM api.blocks WHERE record_id = '${recordId}' ORDER BY "order" ASC`,
    )
    expect(rows.map((r: { id: string }) => r.id)).toEqual([
      restored.block.id,
      first.block.id,
      second.block.id,
    ])
  })

  it('inserts strictly between both anchors and rejects inverted anchors', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    const { recordId } = await seedEmpty(owner)
    const first = await rpcByName<{
      block: { id: string }
      structure_version: number
    }>(
      owner,
      `insert_block(
        '${recordId}'::uuid, 'checklist',
        '{"items":[]}'::jsonb, 1, NULL, 1)`,
    )
    const second = await rpcByName<{
      block: { id: string }
      structure_version: number
    }>(
      owner,
      `insert_block(
        '${recordId}'::uuid, 'checklist',
        '{"items":[]}'::jsonb, 1, '${first.block.id}'::uuid, ${first.structure_version})`,
    )
    const mid = await rpcByName<{
      block: { id: string; order: number }
      order: Array<{ id: string; order: number }>
    }>(
      owner,
      `insert_block(
        '${recordId}'::uuid, 'rich_text',
        '{"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"mid"}]}]}}'::jsonb, 1, '${first.block.id}'::uuid, ${second.structure_version}, '${second.block.id}'::uuid)`,
    )
    expect(mid.order.map((b) => b.id)).toEqual([
      first.block.id,
      mid.block.id,
      second.block.id,
    ])

    // Inverted anchors are rejected like move_block.
    await expect(
      owner.query(
        `SELECT * FROM api.insert_block(
          '${recordId}'::uuid, 'rich_text',
          '{"doc":{"type":"doc","content":[]}}'::jsonb, 1, '${second.block.id}'::uuid, 4, '${first.block.id}'::uuid)`,
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })
})

describe('delete_block', () => {
  async function seedTwo(
    client: Client,
  ): Promise<{ recordId: string; a: string; b: string; sv: number }> {
    const created = await rpcByName<{
      record: { id: string }
      blocks: Array<{ id: string }>
    }>(
      client,
      `create_record_with_blocks(
        '${PROJ}'::uuid, 'experiment', 'Delete Target',
        'draft', ARRAY[]::text[],
        '[{"type":"checklist","payload":{"items":[]},"order":1},
            {"type":"checklist","payload":{"items":[]},"order":2}]'::jsonb)`,
    )
    return {
      recordId: created.record.id,
      a: created.blocks[0].id,
      b: created.blocks[1].id,
      sv: 1,
    }
  }

  it('deletes a block and bumps structure_version, returning surviving order', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    const { a, b, sv } = await seedTwo(owner)
    const res = await rpcByName<{
      structure_version: number
      order: Array<{ id: string; order: number }>
    }>(owner, `delete_block('${a}'::uuid, ${sv})`)
    expect(res.structure_version).toBe(sv + 1)
    expect(res.order.map((o) => o.id)).toEqual([b])
    const { rows } = await owner.query(
      `SELECT count(*)::int AS n FROM api.blocks WHERE id = '${a}'`,
    )
    expect(rows[0].n).toBe(0)
  })

  it('rejects a stale structure_version with SB001', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    const { a } = await seedTwo(owner)
    await expect(
      owner.query(`SELECT * FROM api.delete_block('${a}'::uuid, 999)`),
    ).rejects.toMatchObject({ code: STALE })
  })

  it('rejects a caller from another workspace', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    const { a } = await seedTwo(owner)
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    await expect(
      ownerB.query(`SELECT * FROM api.delete_block('${a}'::uuid, 1)`),
    ).rejects.toMatchObject({ code: DENIED })
  })
})
