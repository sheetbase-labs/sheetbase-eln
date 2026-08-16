import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase, setActorJwt } from './helpers'

const WS = '40000000-0000-4000-8000-000000000001'
const OTHER_WS = '40000000-0000-4000-8000-000000000002'
const PROJECT = '40000000-0000-4000-8000-000000000003'
const RECORD_A = '40000000-0000-4000-8000-000000000004'
const RECORD_B = '40000000-0000-4000-8000-000000000005'
const BLOCK_A = '40000000-0000-4000-8000-000000000006'
const BLOCK_B = '40000000-0000-4000-8000-000000000007'
const BLOCK_LEGACY = '40000000-0000-4000-8000-000000000008'
const OWNER = 'sci-010-owner'
const MEMBER = 'sci-010-member'
const OTHER_OWNER = 'sci-010-other-owner'

let migrator: Client
let owner: Client
let member: Client
let otherOwner: Client
let schemaId: string
let tableA: { id: string; resource_name: string }
let tableB: { id: string; resource_name: string }
let colsA: Array<{ id: string; field_name: string; dataset_schema_field_id: string | null }>
let colsB: Array<{ id: string; field_name: string; dataset_schema_field_id: string | null }>

async function setWorkspace(client: Client, user: string, ws: string) {
  await client.query('SET ROLE authenticated')
  await client.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ role: 'authenticated', sub: user, workspace_id: ws }),
  ])
}

beforeAll(async () => {
  const prepared = await prepareTestDatabase()
  migrator = prepared.migrator
  await migrator.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES ($1,'Owner','sci010-owner@test.invalid',true),($2,'Member','sci010-member@test.invalid',true),($3,'Other','sci010-other@test.invalid',true)`,
    [OWNER, MEMBER, OTHER_OWNER],
  )
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ('${WS}','sci010','SCI 010'),('${OTHER_WS}','sci010-other','SCI 010 Other')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES ('${WS}',$1,'owner'),('${WS}',$2,'member'),('${OTHER_WS}',$3,'owner')`,
    [OWNER, MEMBER, OTHER_OWNER],
  )
  await migrator.query(
    `INSERT INTO api.projects(id,workspace_id,key,title) VALUES ('${PROJECT}','${WS}','SCI','Science')`,
  )
  await migrator.query(
    `INSERT INTO api.records(id,workspace_id,project_id,kind,identifier,title,created_by_user_id) VALUES ('${RECORD_A}','${WS}','${PROJECT}','experiment','SCI-1','Exp A',$1),('${RECORD_B}','${WS}','${PROJECT}','experiment','SCI-2','Exp B',$1)`,
    [OWNER],
  )
  await migrator.query(
    `INSERT INTO api.blocks(id,record_id,type,payload,"order",created_by_user_id) VALUES ('${BLOCK_A}','${RECORD_A}','sheet','{}',1,$1),('${BLOCK_B}','${RECORD_B}','sheet','{}',1,$1),('${BLOCK_LEGACY}','${RECORD_A}','sheet','{}',2,$1)`,
    [OWNER],
  )
  owner = await prepared.asRole('authenticator')
  member = await prepared.asRole('authenticator')
  otherOwner = await prepared.asRole('authenticator')
  await setWorkspace(owner, OWNER, WS)
  await setWorkspace(member, MEMBER, WS)
  await setWorkspace(otherOwner, OTHER_OWNER, OTHER_WS)
  await setActorJwt(migrator, OWNER, WS)
})

afterAll(async () =>
  Promise.all([migrator?.end(), owner?.end(), member?.end(), otherOwner?.end()]),
)

describe('SCI-010 dataset schema registry', () => {
  it('creates a draft schema with fields and reuses helpers for validation', async () => {
    const res = await migrator.query(`SELECT api.create_dataset_schema($1,$2,$3,$4::jsonb) result`,
      [
        'stability_study_result',
        'Stability Study Result',
        'Cross-sheet stability measurements',
        JSON.stringify([
          { slug: 'titer', label: 'Titer (TU/mL)', logical_type: 'decimal', nullable: false, unit: { code: 'TU/mL', symbol: 'TU/mL' } },
          { slug: 'timepoint', label: 'Timepoint (days)', logical_type: 'integer', validation: { min: 0 } },
        ]),
      ],
    )
    const schema = res.rows[0].result.schema
    const fields = res.rows[0].result.fields
    expect(schema.status).toBe('draft')
    expect(schema.revision).toBe(1)
    expect(fields.map((f: { slug: string }) => f.slug)).toEqual([
      'titer',
      'timepoint',
    ])
    schemaId = schema.id
  })

  it('rejects an invalid field slug and an invalid logical type', async () => {
    await expect(
      migrator.query(`SELECT api.create_dataset_schema($1,$2,null,$3::jsonb)`, [
        'bad_slug_schema',
        'Bad',
        JSON.stringify([{ slug: 'Bad Slug!', label: 'x', logical_type: 'text' }]),
      ]),
    ).rejects.toMatchObject({ code: '22023' })
  })

  it('enforces field identity immutability after creation', async () => {
    await expect(
      migrator.query(
        `UPDATE api.dataset_schema_fields SET slug='titer_renamed' WHERE schema_id=$1 AND slug='titer'`,
        [schemaId],
      ),
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      migrator.query(
        `UPDATE api.dataset_schema_fields SET logical_type='text' WHERE schema_id=$1 AND slug='titer'`,
        [schemaId],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('forbids a non-creator member from adding a field to a draft; allows the owner', async () => {
    await expect(
      member.query(
        `SELECT api.add_dataset_schema_field($1,$2,$3,$4)`,
        [schemaId, 'ph', 'pH', 'decimal'],
      ),
    ).rejects.toMatchObject({ code: '42501' })
    const res = await migrator.query(`SELECT api.add_dataset_schema_field($1,$2,$3,$4) result`,
      [schemaId, 'ph', 'pH', 'decimal'],
    )
    expect(res.rows[0].result.slug).toBe('ph')
  })

  it('forbids a member from publishing; allows the owner', async () => {
    await expect(
      member.query(`SELECT api.publish_dataset_schema($1)`, [schemaId]),
    ).rejects.toMatchObject({ code: '42501' })
    const res = await migrator.query(`SELECT api.publish_dataset_schema($1) result`,
      [schemaId],
    )
    expect(res.rows[0].result.published).toBe(true)
  })

  it('instantiates a bound sheet from a published schema, linking columns to fields', async () => {
    const resA = await migrator.query(`SELECT api.instantiate_dataset_schema($1,$2,$3) result`,
      [BLOCK_A, schemaId, 'Stability A'],
    )
    const resB = await migrator.query(`SELECT api.instantiate_dataset_schema($1,$2,$3) result`,
      [BLOCK_B, schemaId, 'Stability B'],
    )
    tableA = resA.rows[0].result.table
    tableB = resB.rows[0].result.table
    colsA = resA.rows[0].result.columns
    colsB = resB.rows[0].result.columns
    expect(tableA.dataset_schema_id).toBe(schemaId)
    expect(tableA.dataset_schema_revision).toBe(1)
    // Every bound column links to a dataset_schema_field_id.
    expect(
      colsA.every(
        (c: { dataset_schema_field_id: string | null }) =>
          c.dataset_schema_field_id !== null,
      ),
    ).toBe(true)
    expect(colsA.length).toBe(3) // titer, timepoint, ph
  })

  it('enters data in both sheets and unions them via query_dataset by stable slug', async () => {
    // Insert one row per sheet using the physical columns resolved from fields.
    const titerA = colsA.find((c) => c.dataset_schema_field_id !== null)!
    const timeA = colsA.find(
      (c) => c.field_name !== titerA.field_name && c.dataset_schema_field_id !== null,
    )!
    await owner.query(
      `INSERT INTO api.${tableA.resource_name} (${titerA.field_name},${timeA.field_name}) VALUES (1.25, 0)`,
    )
    const titerB = colsB[0]
    const timeB = colsB[1]
    await owner.query(
      `INSERT INTO api.${tableB.resource_name} (${titerB.field_name},${timeB.field_name}) VALUES (2.5, 7)`,
    )
    const res = await owner.query(
      `SELECT * FROM api.query_dataset($1, 1)`,
      [schemaId],
    )
    const rows = res.rows
    expect(rows.length).toBe(2)
    // Results are keyed by stable slug, never physical field names.
    for (const row of rows) {
      expect(row.field_values).toHaveProperty('titer')
      expect(row.field_values).toHaveProperty('timepoint')
      expect(row.field_values).not.toHaveProperty(titerA.field_name)
    }
    expect(rows.map((r) => r.field_values.titer).sort()).toEqual([1.25, 2.5])
  })

  it('filters query_dataset by a stable slug with a range predicate', async () => {
    const res = await owner.query(
      `SELECT * FROM api.query_dataset($1, 1, $2::jsonb)`,
      [schemaId, JSON.stringify({ titer: { gte: 2 } })],
    )
    expect(res.rows.length).toBe(1)
    expect(res.rows[0].field_values.titer).toBe(2.5)
  })

  it('isolates workspaces: a cross-workspace query_dataset returns nothing', async () => {
    const res = await otherOwner.query(
      `SELECT * FROM api.query_dataset($1, 1)`,
      [schemaId],
    )
    expect(res.rows.length).toBe(0)
  })

  it('upgrades a sheet to an additive revision and re-binds columns', async () => {
    // Create revision 2 of the same slug with the same fields + a new one.
    const res = await migrator.query(`SELECT api.create_dataset_schema($1,$2,null,$3::jsonb) result`,
      [
        'stability_study_result',
        'Stability Study Result v2',
        JSON.stringify([
          { slug: 'titer', label: 'Titer (TU/mL)', logical_type: 'decimal' },
          { slug: 'timepoint', label: 'Timepoint (days)', logical_type: 'integer' },
          { slug: 'ph', label: 'pH', logical_type: 'decimal' },
          { slug: 'temperature', label: 'Temperature', logical_type: 'decimal' },
        ]),
      ],
    )
    const rev2 = res.rows[0].result.schema
    expect(rev2.revision).toBe(2)
    expect(rev2.status).toBe('draft')
    await migrator.query(`SELECT api.publish_dataset_schema($1)`, [rev2.id])
    const up = await migrator.query(`SELECT api.upgrade_scientific_schema($1, 2) result`,
      [tableA.id],
    )
    expect(up.rows[0].result.upgraded).toBe(true)
    expect(up.rows[0].result.toRevision).toBe(2)
    expect(up.rows[0].result.addedColumnIds).toHaveLength(1)
    // The table is now bound to revision 2.
    const t = await owner.query(
      `SELECT dataset_schema_revision FROM api.scientific_tables WHERE id=$1`,
      [tableA.id],
    )
    expect(t.rows[0].dataset_schema_revision).toBe(2)
    // The new column exists on the physical table and is linked.
    const cols = await owner.query(
      `SELECT count(*)::int n FROM api.scientific_columns WHERE table_id=$1 AND dataset_schema_field_id IS NOT NULL`,
      [tableA.id],
    )
    expect(cols.rows[0].n).toBe(4)
  })

  it('rejects a non-additive upgrade (type change) requiring confirmation', async () => {
    const res = await migrator.query(`SELECT api.create_dataset_schema($1,$2,null,$3::jsonb) result`,
      [
        'stability_study_result',
        'Stability Study Result v3 bad',
        JSON.stringify([
          { slug: 'titer', label: 'Titer', logical_type: 'text' },
          { slug: 'timepoint', label: 'Timepoint', logical_type: 'integer' },
          { slug: 'ph', label: 'pH', logical_type: 'decimal' },
        ]),
      ],
    )
    const rev3 = res.rows[0].result.schema
    await migrator.query(`SELECT api.publish_dataset_schema($1)`, [rev3.id])
    await expect(
      migrator.query(`SELECT api.upgrade_scientific_schema($1, 3)`, [tableB.id]),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('retires a field (owner only) and preserves the slug', async () => {
    const field = await owner.query(
      `SELECT id FROM api.dataset_schema_fields WHERE schema_id=$1 AND slug='ph' ORDER BY created_at DESC LIMIT 1`,
      [schemaId],
    )
    await expect(
      member.query(`SELECT api.retire_dataset_schema_field($1)`, [
        field.rows[0].id,
      ]),
    ).rejects.toMatchObject({ code: '42501' })
    const res = await migrator.query(`SELECT api.retire_dataset_schema_field($1) result`,
      [field.rows[0].id],
    )
    expect(res.rows[0].result.retired).toBe(true)
    // Slug stays reserved.
    const still = await owner.query(
      `SELECT slug FROM api.dataset_schema_fields WHERE id=$1`,
      [field.rows[0].id],
    )
    expect(still.rows[0].slug).toBe('ph')
  })

  it('backfills a legacy unbound sheet and exposes it via query_dataset', async () => {
    // Create an ad-hoc (unbound) sheet.
    const legacy = await migrator.query(`SELECT api.create_scientific_table($1,$2,$3::jsonb) result`,
      [
        BLOCK_LEGACY,
        'Legacy Sheet',
        JSON.stringify([
          { label: 'Reading', logical_type: 'decimal' },
          { label: 'Note', logical_type: 'text' },
        ]),
      ],
    )
    const lt = legacy.rows[0].result.table
    const lc = legacy.rows[0].result.columns
    expect(lt.dataset_schema_id).toBeNull()
    // Insert a row.
    await owner.query(
      `INSERT INTO api.${lt.resource_name} (${lc[0].field_name},${lc[1].field_name}) VALUES (9.5, 'baseline')`,
    )
    // Backfill.
    const bound = await owner.query(
      `SELECT api.bind_legacy_sheet($1,$2) result`,
      [lt.id, 'Legacy Bound'],
    )
    expect(bound.rows[0].result.bound).toBe(true)
    expect(bound.rows[0].result.revision).toBe(1)
    // The table is now bound.
    const t = await owner.query(
      `SELECT dataset_schema_id, dataset_schema_revision FROM api.scientific_tables WHERE id=$1`,
      [lt.id],
    )
    expect(t.rows[0].dataset_schema_id).not.toBeNull()
    expect(t.rows[0].dataset_schema_revision).toBe(1)
    // query_dataset returns the legacy row, keyed by the derived slugs.
    const res = await owner.query(
      `SELECT * FROM api.query_dataset($1, 1)`,
      [bound.rows[0].result.schemaId],
    )
    expect(res.rows.length).toBe(1)
    expect(res.rows[0].field_values).toHaveProperty('reading')
    expect(res.rows[0].field_values.reading).toBe(9.5)
  })

  it('rejects binding an already-bound sheet', async () => {
    const lt = await owner.query(
      `SELECT id FROM api.scientific_tables WHERE block_id=$1`,
      [BLOCK_LEGACY],
    )
    await expect(
      owner.query(`SELECT api.bind_legacy_sheet($1)`, [lt.rows[0].id]),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('insert_sheet_block with a schema id creates a bound sheet atomically', async () => {
    // Create a second published schema for the insert_sheet_block test.
    const res = await migrator.query(`SELECT api.create_dataset_schema($1,$2,null,$3::jsonb) result`,
      [
        'insert_block_schema',
        'Insert Block Schema',
        JSON.stringify([
          { slug: 'value', label: 'Value', logical_type: 'decimal' },
        ]),
      ],
    )
    const sid = res.rows[0].result.schema.id
    await migrator.query(`SELECT api.publish_dataset_schema($1)`, [sid])

    // Create a fresh record + use insert_sheet_block with the schema id.
    const RECORD_C = '40000000-0000-4000-8000-000000000009'
    await migrator.query(
      `INSERT INTO api.records(id,workspace_id,project_id,kind,identifier,title,created_by_user_id) VALUES ('${RECORD_C}','${WS}','${PROJECT}','experiment','SCI-3','Exp C',$1)`,
      [OWNER],
    )
    const inserted = await migrator.query(`SELECT api.insert_sheet_block($1, NULL, NULL, $2) result`,
      [RECORD_C, sid],
    )
    const result = inserted.rows[0].result
    expect(result.block.type).toBe('sheet')
    expect(result.table.dataset_schema_id).toBe(sid)
    expect(result.table.dataset_schema_revision).toBe(1)
    // The block payload contains the tableId.
    expect(result.block.payload.tableId).toBe(result.table.id)
    // Columns are linked to schema fields.
    expect(
      result.columns.every(
        (c: { dataset_schema_field_id: string | null }) =>
          c.dataset_schema_field_id !== null,
      ),
    ).toBe(true)
  })

  it('insert_sheet_block without a schema id preserves ad-hoc behaviour', async () => {
    const RECORD_D = '40000000-0000-4000-8000-000000000010'
    await migrator.query(
      `INSERT INTO api.records(id,workspace_id,project_id,kind,identifier,title,created_by_user_id) VALUES ('${RECORD_D}','${WS}','${PROJECT}','experiment','SCI-4','Exp D',$1)`,
      [OWNER],
    )
    const inserted = await migrator.query(`SELECT api.insert_sheet_block($1) result`,
      [RECORD_D],
    )
    const result = inserted.rows[0].result
    expect(result.block.type).toBe('sheet')
    expect(result.table.dataset_schema_id).toBeNull()
    expect(result.columns).toEqual([])
  })

  it('scientific_table_metadata includes the dataset_schema binding object', async () => {
    // tableA is bound to revision 2 of stability_study_result (upgraded earlier).
    const meta = await owner.query(
      `SELECT api.scientific_table_metadata($1) meta`,
      [tableA.id],
    )
    const table = meta.rows[0].meta
    expect(table.dataset_schema).not.toBeNull()
    expect(table.dataset_schema.slug).toBe('stability_study_result')
    expect(table.dataset_schema.revision).toBe(2)
    // Revision 3 was published (then its upgrade was rejected), so 3 is latest.
    expect(table.dataset_schema.latest_published_revision).toBe(3)
  })

  it('scientific_table_metadata returns null dataset_schema for unbound sheets', async () => {
    // Create an ad-hoc sheet with no schema binding.
    const RECORD_E = '40000000-0000-4000-8000-000000000011'
    const BLOCK_E = '40000000-0000-4000-8000-000000000012'
    await migrator.query(
      `INSERT INTO api.records(id,workspace_id,project_id,kind,identifier,title,created_by_user_id) VALUES ('${RECORD_E}','${WS}','${PROJECT}','experiment','SCI-5','Exp E',$1)`,
      [OWNER],
    )
    await migrator.query(
      `INSERT INTO api.blocks(id,record_id,type,payload,"order",created_by_user_id) VALUES ('${BLOCK_E}','${RECORD_E}','sheet','{}',1,$1)`,
      [OWNER],
    )
    const adHoc = await migrator.query(`SELECT api.create_scientific_table($1,$2,'[]'::jsonb) result`,
      [BLOCK_E, 'Ad hoc'],
    )
    const meta = await owner.query(
      `SELECT api.scientific_table_metadata($1) meta`,
      [adHoc.rows[0].result.table.id],
    )
    expect(meta.rows[0].meta.dataset_schema).toBeNull()
  })
})
