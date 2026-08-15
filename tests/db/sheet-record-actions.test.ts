import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS_A = '00000000-0000-4000-8000-00000000c04a'
const WS_B = '00000000-0000-4000-8000-00000000c04b'
const PROJ_A = '00000000-0000-4000-8000-00000000c14a'
const PROJ_B = '00000000-0000-4000-8000-00000000c14b'
const OWNER_A = 'core-04-owner-a'
const OWNER_B = 'core-04-owner-b'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

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

async function createRecord(
  client: Client,
  project: string,
  title: string,
  customFields: Record<string, unknown> = {},
) {
  const { rows } = await client.query(
    `SELECT * FROM api.create_model_record(
       $1::uuid, 'sample', $2, 'available', ARRAY[]::text[], '{}'::jsonb, $3::jsonb
     )`,
    [project, title, JSON.stringify(customFields)],
  )
  return rows[0]
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${OWNER_A}', 'CORE04 A', 'core04-a@sheetbase.test', true),
      ('${OWNER_B}', 'CORE04 B', 'core04-b@sheetbase.test', true);
     INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS_A}', 'core-04-a', 'CORE-04 A'),
      ('${WS_B}', 'core-04-b', 'CORE-04 B');
     INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS_A}', '${OWNER_A}', 'owner'),
      ('${WS_B}', '${OWNER_B}', 'owner');
     INSERT INTO api.projects (id, workspace_id, key, title) VALUES
      ('${PROJ_A}', '${WS_A}', 'c04a', 'CORE-04 A'),
      ('${PROJ_B}', '${WS_B}', 'c04b', 'CORE-04 B')`,
  )
  const owner = await asAuthenticated(OWNER_A, WS_A)
  await owner.query(
    `SELECT * FROM api.create_and_activate_model_field(
       $1,'sample','note','Note','text',false,null,'{}'::jsonb,'[]'::jsonb
     )`,
    [WS_A],
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('Sheet Record search', () => {
  it('finds exact Record IDs and names, stays Model-scoped, and isolates workspaces', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const outsider = await asAuthenticated(OWNER_B, WS_B)
    const harvest = await createRecord(owner, PROJ_A, 'LV harvest', {
      note: 'cold',
    })
    await createRecord(owner, PROJ_A, 'Buffer blank', { note: 'room' })
    await createRecord(outsider, PROJ_B, 'LV harvest', {})

    const exact = await owner.query(
      `SELECT api.search_sheet_records('sample', $1, 25, false) result`,
      [harvest.identifier],
    )
    expect(exact.rows[0].result).toEqual([
      expect.objectContaining({
        id: harvest.id,
        identifier: harvest.identifier,
        title: 'LV harvest',
        archived: false,
      }),
    ])

    const byName = await owner.query(
      `SELECT api.search_sheet_records('sample', 'harvest', 25, false) result`,
    )
    expect(
      byName.rows[0].result.map((row: { title: string }) => row.title),
    ).toEqual(['LV harvest'])

    const isolated = await outsider.query(
      `SELECT api.search_sheet_records('sample', 'harvest', 25, false) result`,
    )
    expect(isolated.rows[0].result).toEqual([
      expect.objectContaining({ title: 'LV harvest' }),
    ])
    expect(isolated.rows[0].result[0].id).not.toBe(harvest.id)

    await expect(
      outsider.query(
        `SELECT api.search_sheet_records('project', '', 25, false)`,
      ),
    ).rejects.toThrow(/does not support Sheet Record search/)
  })

  it('caps result size so a Sheet picker cannot load the full registry', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    for (let index = 0; index < 12; index += 1) {
      await createRecord(owner, PROJ_A, `Scale ${index}`, { note: `n${index}` })
    }
    const bounded = await owner.query(
      `SELECT jsonb_array_length(api.search_sheet_records('sample', 'Scale', 5, false)) count`,
    )
    expect(bounded.rows[0].count).toBe(5)
    const hardCap = await owner.query(
      `SELECT jsonb_array_length(api.search_sheet_records('sample', '', 200, false)) count`,
    )
    expect(hardCap.rows[0].count).toBeLessThanOrEqual(50)
  })
})

describe('Sheet Record validate-without-commit', () => {
  it('classifies mixed create/link/existing rows, returns field errors, and writes nothing', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const existing = await createRecord(owner, PROJ_A, 'Already registered', {
      note: 'stock',
    })
    const before = await owner.query(
      `SELECT count(*)::int AS n FROM api.records WHERE project_id=$1 AND kind='sample'`,
      [PROJ_A],
    )

    const { rows } = await owner.query(
      `SELECT api.validate_sheet_record_batch($1,'sample',$2::jsonb) result`,
      [
        PROJ_A,
        JSON.stringify([
          {
            rowKey: 'create-ok',
            operation: 'create',
            title: 'New harvest',
            values: { note: 'cold' },
          },
          {
            rowKey: 'create-missing',
            operation: 'create',
            title: 'Missing note',
            values: {},
          },
          {
            rowKey: 'link-ok',
            operation: 'link',
            recordId: existing.id,
          },
          {
            rowKey: 'link-id',
            operation: 'link',
            recordId: existing.identifier,
          },
          {
            rowKey: 'match-existing',
            operation: 'create',
            title: 'Ignored',
            matchIdentifier: existing.identifier,
            values: { note: 'stock' },
          },
          {
            rowKey: 'dup-a',
            operation: 'create',
            title: 'Dup A',
            matchIdentifier: 'SMP-2099-0001',
            values: { note: 'a' },
          },
          {
            rowKey: 'dup-b',
            operation: 'create',
            title: 'Dup B',
            matchIdentifier: 'SMP-2099-0001',
            values: { note: 'b' },
          },
        ]),
      ],
    )
    const result = rows[0].result
    expect(result.ok).toBe(false)
    expect(result.mutated).toBe(false)
    const byKey = Object.fromEntries(
      result.rows.map((row: { rowKey: string }) => [row.rowKey, row]),
    )
    expect(byKey['create-ok'].classification).toBe('create')
    expect(byKey['create-missing'].classification).toBe('invalid')
    expect(byKey['link-ok']).toMatchObject({
      classification: 'link',
      recordId: existing.id,
    })
    expect(byKey['link-id'].errors[0].code).toBe('not-uuid')
    expect(byKey['match-existing']).toMatchObject({
      classification: 'existing',
      recordId: existing.id,
    })
    expect(byKey['dup-a'].errors[0].code).toBe('duplicate_input_row')

    const after = await owner.query(
      `SELECT count(*)::int AS n FROM api.records WHERE project_id=$1 AND kind='sample'`,
      [PROJ_A],
    )
    expect(after.rows[0].n).toBe(before.rows[0].n)
  })

  it('rejects outsiders, oversize batches, and supplied Record IDs', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const outsider = await asAuthenticated(OWNER_B, WS_B)
    await expect(
      outsider.query(
        `SELECT api.validate_sheet_record_batch($1,'sample',$2::jsonb)`,
        [
          PROJ_A,
          JSON.stringify([
            {
              rowKey: 'x',
              operation: 'create',
              title: 'Denied',
              values: { note: 'x' },
            },
          ]),
        ],
      ),
    ).rejects.toThrow(/42501|not found|membership/i)

    await expect(
      owner.query(
        `SELECT api.validate_sheet_record_batch($1,'sample',$2::jsonb)`,
        [PROJ_A, JSON.stringify([])],
      ),
    ).rejects.toThrow(/1 to 1000/)

    const { rows } = await owner.query(
      `SELECT api.validate_sheet_record_batch($1,'sample',$2::jsonb) result`,
      [
        PROJ_A,
        JSON.stringify([
          {
            rowKey: 'supplied-id',
            operation: 'create',
            title: 'Has ID',
            identifier: 'SMP-2026-9999',
            values: { note: 'x' },
          },
        ]),
      ],
    )
    expect(rows[0].result.rows[0].errors[0].code).toBe('record_id_policy')
  })
})
