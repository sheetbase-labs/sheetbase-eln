import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase, setActorJwt } from './helpers'

const WS = '72000000-0000-4000-8000-000000000001'
const OTHER_WS = '72000000-0000-4000-8000-000000000002'
const PROJECT = '72000000-0000-4000-8000-000000000003'
const OTHER_PROJECT = '72000000-0000-4000-8000-000000000004'
const RECORD = '72000000-0000-4000-8000-000000000005'
const OWNER = 'sheet-002-owner'
const OTHER = 'sheet-002-other'

let migrator: Client
let auth: Client
let otherAuth: Client
let apiClient: Client
let table: { id: string; resource_name: string; schema_version: number }
let blockId: string
let textColumn: { id: string; field_name: string }

async function authenticated(
  prepared: Awaited<ReturnType<typeof prepareTestDatabase>>,
  user: string,
  workspace: string,
): Promise<Client> {
  const client = await prepared.asRole('authenticator')
  await client.query('SET ROLE authenticated')
  await client.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      role: 'authenticated',
      sub: user,
      workspace_id: workspace,
    }),
  ])
  return client
}

beforeAll(async () => {
  const prepared = await prepareTestDatabase()
  migrator = prepared.migrator
  await migrator.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
      ($1,'Sheet owner','sheet-002-owner@test.invalid',true),
      ($2,'Other owner','sheet-002-other@test.invalid',true)`,
    [OWNER, OTHER],
  )
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES
      ('${WS}','sheet-002','SHEET-002'),
      ('${OTHER_WS}','sheet-002-other','SHEET-002 other')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
      ('${WS}',$1,'owner'),('${OTHER_WS}',$2,'owner')`,
    [OWNER, OTHER],
  )
  await migrator.query(
    `INSERT INTO api.projects(id,workspace_id,key,title) VALUES
      ('${PROJECT}','${WS}','S2','SHEET-002'),
      ('${OTHER_PROJECT}','${OTHER_WS}','S2O','SHEET-002 other')`,
  )
  await migrator.query(
    `INSERT INTO api.records(id,workspace_id,project_id,kind,identifier,title,created_by_user_id)
     VALUES ('${RECORD}','${WS}','${PROJECT}','experiment','S2-1','Sheet block',$1)`,
    [OWNER],
  )

  auth = await authenticated(prepared, OWNER, WS)
  await setActorJwt(migrator, OWNER, WS)
  otherAuth = await authenticated(prepared, OTHER, OTHER_WS)
  apiClient = await prepared.asRole('authenticator')
  await apiClient.query('SET ROLE api_client')
  await apiClient.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      role: 'api_client',
      workspace_id: WS,
      credential_id: '72000000-0000-4000-8000-000000000099',
      scopes: ['scientific:read', 'scientific:write', 'scientific:schema'],
    }),
  ])
})

afterAll(async () => {
  await Promise.all([
    migrator?.end(),
    auth?.end(),
    otherAuth?.end(),
    apiClient?.end(),
  ])
})

describe('SHEET-002 sheet block database boundary', () => {
  it('atomically creates one canonical block, owning table and generated relation with one structure bump', async () => {
    const result = (
      await migrator.query(`SELECT api.insert_sheet_block($1,NULL,$2) result`, [
        RECORD,
        1,
      ])
    ).rows[0].result
    blockId = result.block.id
    table = result.table

    expect(result.structure_version).toBe(2)
    expect(result.resourceName).toBe(table.resource_name)
    expect(result.block).toMatchObject({
      id: blockId,
      record_id: RECORD,
      type: 'sheet',
      payload: { tableId: table.id },
      order: 1,
    })
    expect(
      (
        await migrator.query(
          `SELECT b.payload,b.record_id,t.id table_id,t.record_id table_record_id,
                  t.workspace_id,to_regclass('api.'||t.resource_name)::text relation,
                  r.structure_version
           FROM api.blocks b
           JOIN api.scientific_tables t ON t.block_id=b.id
           JOIN api.records r ON r.id=b.record_id
           WHERE b.id=$1`,
          [blockId],
        )
      ).rows,
    ).toEqual([
      {
        payload: { tableId: table.id },
        record_id: RECORD,
        table_id: table.id,
        table_record_id: RECORD,
        workspace_id: WS,
        relation: `api.${table.resource_name}`,
        structure_version: 2,
      },
    ])
  })

  it('rejects a stale structure version without changing blocks, tables, events or the record', async () => {
    const before = (
      await migrator.query(
        `SELECT (SELECT count(*)::int FROM api.blocks) blocks,
                (SELECT count(*)::int FROM api.scientific_tables) tables,
                (SELECT count(*)::int FROM api.change_events) events,
                (SELECT structure_version FROM api.records WHERE id=$1) structure_version`,
        [RECORD],
      )
    ).rows[0]
    await expect(
      migrator.query(`SELECT api.insert_sheet_block($1,NULL,$2)`, [RECORD, 1]),
    ).rejects.toMatchObject({ code: 'SB001' })
    const after = (
      await migrator.query(
        `SELECT (SELECT count(*)::int FROM api.blocks) blocks,
                (SELECT count(*)::int FROM api.scientific_tables) tables,
                (SELECT count(*)::int FROM api.change_events) events,
                (SELECT structure_version FROM api.records WHERE id=$1) structure_version`,
        [RECORD],
      )
    ).rows[0]
    expect(after).toEqual(before)
  })

  it('denies api clients and authenticated cross-workspace nonmembers', async () => {
    await expectDenied(
      apiClient.query(`SELECT api.insert_sheet_block($1,NULL,$2)`, [RECORD, 2]),
      '42501',
    )
    await expectDenied(
      otherAuth.query(`SELECT api.insert_sheet_block($1,NULL,$2)`, [RECORD, 2]),
      '42501',
    )
  })

  it('rolls the block, metadata, structure bump and events back when table creation fails', async () => {
    const before = (
      await migrator.query(
        `SELECT (SELECT count(*)::int FROM api.blocks) blocks,
                (SELECT count(*)::int FROM api.scientific_tables) tables,
                (SELECT count(*)::int FROM api.change_events) events,
                (SELECT structure_version FROM api.records WHERE id=$1) structure_version`,
        [RECORD],
      )
    ).rows[0]
    await migrator.query(`
      CREATE FUNCTION internal.sheet_002_test_failure() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced table failure' USING ERRCODE='23514'; END $$;
      CREATE TRIGGER sheet_002_test_failure BEFORE INSERT ON api.scientific_tables
      FOR EACH ROW EXECUTE FUNCTION internal.sheet_002_test_failure()`)
    try {
      await expect(
        migrator.query(`SELECT api.insert_sheet_block($1,NULL,$2)`, [RECORD, 2]),
      ).rejects.toMatchObject({ code: '23514' })
    } finally {
      await migrator.query(
        `DROP TRIGGER sheet_002_test_failure ON api.scientific_tables;
         DROP FUNCTION internal.sheet_002_test_failure()`,
      )
    }
    const after = (
      await migrator.query(
        `SELECT (SELECT count(*)::int FROM api.blocks) blocks,
                (SELECT count(*)::int FROM api.scientific_tables) tables,
                (SELECT count(*)::int FROM api.change_events) events,
                (SELECT structure_version FROM api.records WHERE id=$1) structure_version`,
        [RECORD],
      )
    ).rows[0]
    expect(after).toEqual(before)
  })

  it('applies one existing-row edit and one insert and returns both canonical rows', async () => {
    const added = (
      await migrator.query(`SELECT api.add_scientific_column($1,$2,'Value','integer',true,NULL,NULL,$3::jsonb) result`,
        [table.id, table.schema_version, JSON.stringify({ min: 0, max: 10 })],
      )
    ).rows[0].result
    table.schema_version += 1
    textColumn = added
    const existing = (
      await auth.query(
        `INSERT INTO api.${table.resource_name} (${textColumn.field_name}) VALUES (1) RETURNING id,version`,
      )
    ).rows[0]
    const result = (
      await auth.query(
        `SELECT api.apply_scientific_row_changes($1,$2,$3::jsonb,$4::jsonb) result`,
        [
          table.id,
          table.schema_version,
          JSON.stringify([
            {
              rowId: existing.id,
              expectedVersion: 1,
              values: { [textColumn.id]: 2 },
            },
          ]),
          JSON.stringify([{ [textColumn.id]: 3 }]),
        ],
      )
    ).rows[0].result
    expect(result).toMatchObject({
      ok: true,
      schemaVersion: table.schema_version,
    })
    expect(result.rows).toHaveLength(2)
    expect(
      result.rows.map(
        (row: Record<string, unknown>) => row[textColumn.field_name],
      ),
    ).toEqual([2, 3])
    expect(result.rows.map((row: { version: number }) => row.version)).toEqual([
      2, 1,
    ])
  })

  it('rolls both groups back for an invalid insert and for a stale existing version', async () => {
    const original = (
      await auth.query(
        `SELECT id,version,${textColumn.field_name} value FROM api.${table.resource_name}
         WHERE ${textColumn.field_name}=2`,
      )
    ).rows[0]
    const count = Number(
      (await auth.query(`SELECT count(*) n FROM api.${table.resource_name}`))
        .rows[0].n,
    )
    const edit = {
      rowId: original.id,
      expectedVersion: 2,
      values: { [textColumn.id]: 4 },
    }
    await expect(
      auth.query(
        `SELECT api.apply_scientific_row_changes($1,$2,$3::jsonb,$4::jsonb)`,
        [
          table.id,
          table.schema_version,
          JSON.stringify([edit]),
          JSON.stringify([{ [textColumn.id]: 99 }]),
        ],
      ),
    ).rejects.toMatchObject({ code: '23514' })
    expect(
      (
        await auth.query(
          `SELECT version,${textColumn.field_name} value FROM api.${table.resource_name} WHERE id=$1`,
          [original.id],
        )
      ).rows[0],
    ).toEqual({ version: '2', value: '2' })
    expect(
      Number(
        (await auth.query(`SELECT count(*) n FROM api.${table.resource_name}`))
          .rows[0].n,
      ),
    ).toBe(count)

    await expect(
      auth.query(
        `SELECT api.apply_scientific_row_changes($1,$2,$3::jsonb,$4::jsonb) result`,
        [
          table.id,
          table.schema_version,
          JSON.stringify([{ ...edit, expectedVersion: 1 }]),
          JSON.stringify([{ [textColumn.id]: 5 }]),
        ],
      ),
    ).rejects.toMatchObject({ code: 'SB001' })
    expect(
      (
        await auth.query(
          `SELECT version,${textColumn.field_name} value FROM api.${table.resource_name} WHERE id=$1`,
          [original.id],
        )
      ).rows[0],
    ).toEqual({ version: '2', value: '2' })
    expect(
      Number(
        (await auth.query(`SELECT count(*) n FROM api.${table.resource_name}`))
          .rows[0].n,
      ),
    ).toBe(count)
  })

  it('rejects every direct and RPC row write after the owning record is archived', async () => {
    const rowsBefore = (
      await migrator.query(
        `SELECT id,version,${textColumn.field_name} value FROM api.${table.resource_name} ORDER BY id`,
      )
    ).rows
    await migrator.query(
      `UPDATE api.records SET archived_at=now() WHERE id=$1`,
      [RECORD],
    )
    const row = rowsBefore[0]
    await expectDenied(
      auth.query(
        `INSERT INTO api.${table.resource_name} (${textColumn.field_name}) VALUES (6)`,
      ),
      '42501',
    )
    await expectDenied(
      auth.query(
        `UPDATE api.${table.resource_name} SET ${textColumn.field_name}=6 WHERE id=$1`,
        [row.id],
      ),
      '42501',
    )
    await expectDenied(
      auth.query(`DELETE FROM api.${table.resource_name} WHERE id=$1`, [
        row.id,
      ]),
      '42501',
    )
    const edit = JSON.stringify([
      {
        rowId: row.id,
        expectedVersion: Number(row.version),
        values: { [textColumn.id]: 6 },
      },
    ])
    await expectDenied(
      auth.query(`SELECT api.apply_scientific_row_edits($1,$2,$3::jsonb)`, [
        table.id,
        table.schema_version,
        edit,
      ]),
      '42501',
    )
    await expectDenied(
      auth.query(
        `SELECT api.apply_scientific_row_changes($1,$2,$3::jsonb,$4::jsonb)`,
        [
          table.id,
          table.schema_version,
          edit,
          JSON.stringify([{ [textColumn.id]: 7 }]),
        ],
      ),
      '42501',
    )
    expect(
      (
        await migrator.query(
          `SELECT id,version,${textColumn.field_name} value FROM api.${table.resource_name} ORDER BY id`,
        )
      ).rows,
    ).toEqual(rowsBefore)
  })
})
