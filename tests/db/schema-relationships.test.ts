import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase, setActorJwt } from './helpers'

const WS = '41000000-0000-4000-8000-000000000001'
const OTHER_WS = '41000000-0000-4000-8000-000000000002'
const PROJECT = '41000000-0000-4000-8000-000000000003'
const RECORD_A = '41000000-0000-4000-8000-000000000004'
const RECORD_B = '41000000-0000-4000-8000-000000000005'
const BLOCK_SAMPLE = '41000000-0000-4000-8000-000000000006'
const BLOCK_ASSAY = '41000000-0000-4000-8000-000000000007'
const OWNER = 'sci-011-owner'
const MEMBER = 'sci-011-member'
const OTHER_OWNER = 'sci-011-other-owner'

let migrator: Client
let owner: Client
let member: Client
let otherOwner: Client

let sampleSchemaId: string
let sampleFieldId: string
let sampleTable: { id: string; resource_name: string }
let sampleCols: Array<{ id: string; field_name: string }>
let sampleRowId: string

let assaySchemaId: string
let assayRefFieldId: string
let assayTable: { id: string; resource_name: string }
let assayCols: Array<{ id: string; field_name: string }>

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
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES ($1,'Owner','sci011-owner@test.invalid',true),($2,'Member','sci011-member@test.invalid',true),($3,'Other','sci011-other@test.invalid',true)`,
    [OWNER, MEMBER, OTHER_OWNER],
  )
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ('${WS}','sci011','SCI 011'),('${OTHER_WS}','sci011-other','SCI 011 Other')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES ('${WS}',$1,'owner'),('${WS}',$2,'member'),('${OTHER_WS}',$3,'owner')`,
    [OWNER, MEMBER, OTHER_OWNER],
  )
  await migrator.query(
    `INSERT INTO api.projects(id,workspace_id,key,title) VALUES ('${PROJECT}','${WS}','SCI','Science')`,
  )
  await migrator.query(
    `INSERT INTO api.records(id,workspace_id,project_id,kind,identifier,title,created_by_user_id) VALUES ('${RECORD_A}','${WS}','${PROJECT}','experiment','SCI-1','Samples',$1),('${RECORD_B}','${WS}','${PROJECT}','experiment','SCI-2','Assays',$1)`,
    [OWNER],
  )
  await migrator.query(
    `INSERT INTO api.blocks(id,record_id,type,payload,"order",created_by_user_id) VALUES ('${BLOCK_SAMPLE}','${RECORD_A}','sheet','{}',1,$1),('${BLOCK_ASSAY}','${RECORD_B}','sheet','{}',1,$1)`,
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
  Promise.all([
    migrator?.end(),
    owner?.end(),
    member?.end(),
    otherOwner?.end(),
  ]),
)

describe('SCI-011 dataset schema relationships', () => {
  it('creates a published sample schema with a text field', async () => {
    const res = await migrator.query(`SELECT api.create_dataset_schema($1,$2,null,$3::jsonb) result`,
      [
        'sample',
        'Sample',
        JSON.stringify([
          { slug: 'name', label: 'Sample name', logical_type: 'text' },
        ]),
      ],
    )
    sampleSchemaId = res.rows[0].result.schema.id
    sampleFieldId = res.rows[0].result.fields[0].id
    expect(res.rows[0].result.schema.status).toBe('draft')
    await migrator.query(`SELECT api.publish_dataset_schema($1)`, [sampleSchemaId])
  })

  it('creates a published assay schema with a decimal + reference field', async () => {
    const res = await migrator.query(`SELECT api.create_dataset_schema($1,$2,null,$3::jsonb) result`,
      [
        'assay',
        'Assay',
        JSON.stringify([
          { slug: 'value', label: 'Value', logical_type: 'decimal' },
          { slug: 'sample_ref', label: 'Sample', logical_type: 'reference' },
        ]),
      ],
    )
    assaySchemaId = res.rows[0].result.schema.id
    assayRefFieldId = res.rows[0].result.fields.find(
      (f: { slug: string }) => f.slug === 'sample_ref',
    ).id
    await migrator.query(`SELECT api.publish_dataset_schema($1)`, [assaySchemaId])
  })

  it('instantiates bound sheets for both schemas and inserts a referenced row', async () => {
    const sa = await migrator.query(`SELECT api.instantiate_dataset_schema($1,$2,$3) result`,
      [BLOCK_SAMPLE, sampleSchemaId, 'Samples sheet'],
    )
    sampleTable = sa.rows[0].result.table
    sampleCols = sa.rows[0].result.columns
    const sb = await migrator.query(`SELECT api.instantiate_dataset_schema($1,$2,$3) result`,
      [BLOCK_ASSAY, assaySchemaId, 'Assays sheet'],
    )
    assayTable = sb.rows[0].result.table
    assayCols = sb.rows[0].result.columns
    // The reference field is backed by a uuid physical column.
    const refCol = assayCols.find(
      (c: { field_name: string; dataset_schema_field_id: string | null }) =>
        c.dataset_schema_field_id === assayRefFieldId,
    )!
    const colType = await migrator.query(
      `SELECT format_type(a.atttypid, a.atttypmod) AS data_type
       FROM pg_attribute a
       WHERE a.attrelid = $1::regclass AND a.attname = $2 AND a.attnum > 0`,
      [`api.${assayTable.resource_name}`, refCol.field_name],
    )
    expect(colType.rows[0].data_type).toBe('uuid')
    // Insert a sample row and capture its id.
    const nameCol = sampleCols.find((c) => c.field_name !== 'id')!
    const ins = await owner.query(
      `INSERT INTO api.${sampleTable.resource_name} (${nameCol.field_name}) VALUES ('S1') RETURNING id`,
    )
    sampleRowId = ins.rows[0].id
  })

  it('allows a workspace member to create a references relationship', async () => {
    const res = await member.query(
      `SELECT api.create_schema_relationship($1,$2,$3,$4,$5,$6) result`,
      [
        assaySchemaId,
        sampleSchemaId,
        'references',
        'measured on',
        'one_to_many',
        assayRefFieldId,
      ],
    )
    const rel = res.rows[0].result
    expect(rel.relationship_type).toBe('references')
    expect(rel.label).toBe('measured on')
    expect(rel.cardinality).toBe('one_to_many')
    expect(rel.source_field_id).toBe(assayRefFieldId)
    expect(rel.lifecycle).toBe('active')
  })

  it('rejects a cross-workspace relationship', async () => {
    // Other owner has no schemas in WS; create one in OTHER_WS first.
    await setActorJwt(migrator, OTHER_OWNER, OTHER_WS)
    const res = await migrator.query(
      `SELECT api.create_dataset_schema($1,$2,null,$3::jsonb) result`,
      [
        'other_schema',
        'Other',
        JSON.stringify([{ slug: 'x', label: 'X', logical_type: 'text' }]),
      ],
    )
    const otherId = res.rows[0].result.schema.id
    await setActorJwt(migrator, OWNER, WS)
    await expect(
      owner.query(
        `SELECT api.create_schema_relationship($1,$2,'references')`,
        [assaySchemaId, otherId],
      ),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('rejects a self-referential relationship', async () => {
    await expect(
      owner.query(
        `SELECT api.create_schema_relationship($1,$1,'derives_from')`,
        [assaySchemaId],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('rejects a duplicate active relationship of the same type', async () => {
    await expect(
      owner.query(
        `SELECT api.create_schema_relationship($1,$2,'references')`,
        [assaySchemaId, sampleSchemaId],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('rejects a source_field_id that does not belong to the source schema', async () => {
    await expect(
      owner.query(
        `SELECT api.create_schema_relationship($1,$2,'composed_of',null,'one_to_one',$3)`,
        [assaySchemaId, sampleSchemaId, sampleFieldId],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('forbids a member from deleting a relationship; allows the owner (soft delete)', async () => {
    // Create a derives_from relationship to delete.
    const res = await owner.query(
      `SELECT api.create_schema_relationship($1,$2,'derives_from') result`,
      [assaySchemaId, sampleSchemaId],
    )
    const relId = res.rows[0].result.id
    await expect(
      member.query(`SELECT api.delete_schema_relationship($1)`, [relId]),
    ).rejects.toMatchObject({ code: '42501' })
    const del = await owner.query(
      `SELECT api.delete_schema_relationship($1) result`,
      [relId],
    )
    expect(del.rows[0].result.deleted).toBe(true)
    // Soft delete: row remains but inactive.
    const row = await migrator.query(
      `SELECT lifecycle FROM api.dataset_schema_relationships WHERE id=$1`,
      [relId],
    )
    expect(row.rows[0].lifecycle).toBe('inactive')
  })

  it('allows recreating a relationship after soft delete (partial unique index)', async () => {
    const res = await owner.query(
      `SELECT api.create_schema_relationship($1,$2,'derives_from') result`,
      [assaySchemaId, sampleSchemaId],
    )
    expect(res.rows[0].result.lifecycle).toBe('active')
  })

  it('isolates relationships by workspace via RLS', async () => {
    const res = await otherOwner.query(
      `SELECT count(*)::int n FROM api.dataset_schema_relationships`,
    )
    expect(res.rows[0].n).toBe(0)
  })

  it('query_dataset returns a bare UUID for the reference field without expansion', async () => {
    // Insert an assay row pointing at the sample row.
    const valueCol = assayCols.find(
      (c) => c.field_name !== 'id',
    )!
    const refCol = assayCols.find(
      (c) => c !== valueCol && c.field_name !== 'id',
    )!
    await owner.query(
      `INSERT INTO api.${assayTable.resource_name} (${valueCol.field_name},${refCol.field_name}) VALUES (1.5, $1)`,
      [sampleRowId],
    )
    const res = await owner.query(
      `SELECT * FROM api.query_dataset($1, 1)`,
      [assaySchemaId],
    )
    expect(res.rows.length).toBe(1)
    expect(res.rows[0].field_values.sample_ref).toBe(sampleRowId)
  })

  it('query_dataset expands the reference field to nested fields at depth 1', async () => {
    const res = await owner.query(
      `SELECT * FROM api.query_dataset($1, 1, '{}'::jsonb, 200, 0, $2::jsonb)`,
      [assaySchemaId, JSON.stringify({ sample_ref: { depth: 1 } })],
    )
    expect(res.rows.length).toBe(1)
    const expanded = res.rows[0].field_values.sample_ref
    expect(expanded).toHaveProperty('referenced_fields')
    expect(expanded.referenced_fields).toHaveProperty('name')
    expect(expanded.referenced_fields.name).toBe('S1')
  })

  it('query_dataset clamps expansion depth > 2 to 2', async () => {
    // Depth 5 should not error; it is clamped to 2 internally.
    const res = await owner.query(
      `SELECT * FROM api.query_dataset($1, 1, '{}'::jsonb, 200, 0, $2::jsonb)`,
      [assaySchemaId, JSON.stringify({ sample_ref: { depth: 5 } })],
    )
    expect(res.rows.length).toBe(1)
    expect(res.rows[0].field_values.sample_ref).toHaveProperty(
      'referenced_fields',
    )
  })

  it('query_dataset ignores expansion of a non-reference field', async () => {
    const res = await owner.query(
      `SELECT * FROM api.query_dataset($1, 1, '{}'::jsonb, 200, 0, $2::jsonb)`,
      [assaySchemaId, JSON.stringify({ value: { depth: 1 } })],
    )
    // value is a decimal, not reference — left untouched.
    expect(res.rows.length).toBe(1)
    expect(res.rows[0].field_values.value).toBe(1.5)
  })

  it('repoints relationships to the latest published revision on publish', async () => {
    // Create revision 2 of the sample schema and publish it.
    const res = await migrator.query(`SELECT api.create_dataset_schema($1,$2,null,$3::jsonb) result`,
      [
        'sample',
        'Sample v2',
        JSON.stringify([
          { slug: 'name', label: 'Sample name', logical_type: 'text' },
        ]),
      ],
    )
    const rev2Id = res.rows[0].result.schema.id
    await migrator.query(`SELECT api.publish_dataset_schema($1)`, [rev2Id])
    // The references relationship target should now point to rev2.
    const rel = await owner.query(
      `SELECT target_schema_id FROM api.dataset_schema_relationships
       WHERE source_schema_id=$1 AND relationship_type='references' AND lifecycle='active'`,
      [assaySchemaId],
    )
    expect(rel.rows[0].target_schema_id).toBe(rev2Id)
    // The old revision is retired.
    const old = await owner.query(
      `SELECT status FROM api.dataset_schemas WHERE id=$1`,
      [sampleSchemaId],
    )
    expect(old.rows[0].status).toBe('retired')
  })
})
