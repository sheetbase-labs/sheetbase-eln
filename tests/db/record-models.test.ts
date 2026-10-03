/**
 * MDL-01 step 1 (ADR-0051) — workspace-owned record model identity.
 *
 * Proves: a workspace model can be created and read; another workspace cannot
 * see it; a non-authorised member cannot create; the identifier prefix is
 * unique per workspace; and the identifier sequence increments atomically and
 * is scoped per workspace and per prefix.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS_A = '00000000-0000-4000-8000-00000000300a'
const WS_B = '00000000-0000-4000-8000-00000000300b'
const OWNER_A = 'record-models-owner-a'
const VIEWER_A = 'record-models-viewer-a'
const OWNER_B = 'record-models-owner-b'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function asAuthenticated(
  userId: string,
  workspaceId: string,
): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({
      sub: userId,
      workspace_id: workspaceId,
      role: 'authenticated',
    }),
  ])
  return client
}

async function createModel(
  client: Client,
  workspaceId: string,
  key: string,
  prefix: string,
  name = key,
  description: string | null = null,
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `SELECT * FROM api.create_workspace_model($1, $2, $3, $4, $5)`,
    [workspaceId, key, name, prefix, description],
  )
  return rows[0]
}

async function nextIdentifier(client: Client, modelId: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT api.next_record_model_identifier($1) AS id`,
    [modelId],
  )
  return rows[0]!.id
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${OWNER_A}', 'RM Owner A', 'rm-owner-a@sheetbase.test', true),
      ('${VIEWER_A}', 'RM Viewer A', 'rm-viewer-a@sheetbase.test', true),
      ('${OWNER_B}', 'RM Owner B', 'rm-owner-b@sheetbase.test', true);
     INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS_A}', 'record-models-a', 'Record Models A'),
      ('${WS_B}', 'record-models-b', 'Record Models B');
     INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS_A}', '${OWNER_A}', 'owner'),
      ('${WS_A}', '${VIEWER_A}', 'viewer'),
      ('${WS_B}', '${OWNER_B}', 'owner')`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('api.create_workspace_model', () => {
  it('creates a workspace model and reads it back in the same workspace', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const model = await createModel(
      owner,
      WS_A,
      'cell_bank',
      'CB',
      'Cell bank',
      'Banked cell lines',
    )
    expect(model).toMatchObject({
      key: 'cell_bank',
      name: 'Cell bank',
      identifier_prefix: 'CB',
      lifecycle: 'draft',
      current_version: 1,
    })
    expect(model.created_by_user_id).toBe(OWNER_A)

    const read = await owner.query(
      `SELECT key, identifier_prefix FROM api.record_models WHERE workspace_id = $1`,
      [WS_A],
    )
    expect(read.rows).toEqual([
      { key: 'cell_bank', identifier_prefix: 'CB' },
    ])
  })

  it('keeps another workspace invisible', async () => {
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    const seenByB = await ownerB.query(
      `SELECT key FROM api.record_models WHERE workspace_id = $1`,
      [WS_A],
    )
    expect(seenByB.rows).toEqual([])

    const ownerA = await asAuthenticated(OWNER_A, WS_A)
    const seenByA = await ownerA.query(
      `SELECT key FROM api.record_models WHERE workspace_id = $1`,
      [WS_B],
    )
    expect(seenByA.rows).toEqual([])
  })

  it('refuses a non-authorised member', async () => {
    const viewer = await asAuthenticated(VIEWER_A, WS_A)
    await expectDenied(
      createModel(viewer, WS_A, 'viewer_model', 'VM'),
      '42501',
    )
    const stillThere = await migrator.query(
      `SELECT 1 FROM api.record_models WHERE workspace_id = $1 AND key = 'viewer_model'`,
      [WS_A],
    )
    expect(stillThere.rows).toEqual([])
  })

  it('refuses a key that shadows a built-in kind', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    await expect(
      createModel(owner, WS_A, 'sample', 'SPL'),
    ).rejects.toMatchObject({ code: 'SB071' })
  })

  it('enforces identifier prefix uniqueness per workspace', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    await expect(
      createModel(owner, WS_A, 'cell_line', 'CB', 'Cell line'),
    ).rejects.toMatchObject({ code: 'SB082' })

    // The same key and prefix are valid in a different workspace.
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    const modelB = await createModel(ownerB, WS_B, 'cell_bank', 'CB', 'Cell bank')
    expect(modelB.key).toBe('cell_bank')
    expect(modelB.identifier_prefix).toBe('CB')
  })
})

describe('api.next_record_model_identifier', () => {
  it('increments per workspace and per prefix', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const modelA = await createModel(owner, WS_A, 'cell_line', 'XB', 'Cell line')

    const cb = await owner.query<{ id: string }>(
      `SELECT api.next_record_model_identifier($1) AS id`,
      [modelA.id],
    )
    expect(cb.rows[0]!.id).toBe('XB-0001')

    const bank = await owner.query<{ key: string; id: string }>(
      `SELECT key, id FROM api.record_models WHERE workspace_id = $1 AND key = 'cell_bank'`,
      [WS_A],
    )
    const bankId = bank.rows[0]!.id
    const ids: string[] = []
    for (let i = 0; i < 3; i += 1) ids.push(await nextIdentifier(owner, bankId))
    expect(ids).toEqual(['CB-0001', 'CB-0002', 'CB-0003'])

    // A second workspace with the same prefix starts its own counter.
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    const modelB = await ownerB.query<{ id: string }>(
      `SELECT id FROM api.record_models WHERE workspace_id = $1 AND key = 'cell_bank'`,
      [WS_B],
    )
    expect(await nextIdentifier(ownerB, modelB.rows[0]!.id)).toBe('CB-0001')
  })

  it('allocates distinct identifiers under concurrency', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const bank = await owner.query<{ id: string }>(
      `SELECT id FROM api.record_models WHERE workspace_id = $1 AND key = 'cell_bank'`,
      [WS_A],
    )
    const modelId = bank.rows[0]!.id

    const first = await asAuthenticated(OWNER_A, WS_A)
    const second = await asAuthenticated(OWNER_A, WS_A)
    const [a, b] = await Promise.all([
      nextIdentifier(first, modelId),
      nextIdentifier(second, modelId),
    ])
    expect([a, b].sort()).toEqual(['CB-0004', 'CB-0005'])
  })

  it('refuses another workspace', async () => {
    const ownerA = await asAuthenticated(OWNER_A, WS_A)
    const modelB = await migrator.query<{ id: string }>(
      `SELECT id FROM api.record_models WHERE workspace_id = $1 AND key = 'cell_bank'`,
      [WS_B],
    )
    await expectDenied(
      ownerA.query(`SELECT api.next_record_model_identifier($1)`, [
        modelB.rows[0]!.id,
      ]),
      'SB033',
    )
  })
})
