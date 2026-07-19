import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '10000000-0000-4000-8000-000000000001'
const OTHER_WS = '10000000-0000-4000-8000-000000000002'
const PROJECT = '10000000-0000-4000-8000-000000000003'
const RECORD = '10000000-0000-4000-8000-000000000004'
const BLOCK = '10000000-0000-4000-8000-000000000005'
const USER = 'scientific-owner'
let migrator: Client
let auth: Client
let apiClient: Client
let table: { id: string; resource_name: string }
let columns: Array<{ id: string; field_name: string; logical_type: string }>

beforeAll(async () => {
  const prepared = await prepareTestDatabase()
  migrator = prepared.migrator
  await migrator.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES ($1,'Owner','science@test.invalid',true)`,
    [USER],
  )
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ('${WS}','science','Science'),('${OTHER_WS}','other-science','Other')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES ('${WS}',$1,'owner')`,
    [USER],
  )
  await migrator.query(
    `INSERT INTO api.projects(id,workspace_id,key,title) VALUES ('${PROJECT}','${WS}','SCI','Science')`,
  )
  await migrator.query(
    `INSERT INTO api.records(id,workspace_id,project_id,kind,identifier,title,created_by_user_id) VALUES ('${RECORD}','${WS}','${PROJECT}','experiment','SCI-1','Sheet',$1)`,
    [USER],
  )
  await migrator.query(
    `INSERT INTO api.blocks(id,record_id,type,payload,"order",created_by_user_id) VALUES ('${BLOCK}','${RECORD}','sheet','{}',1,$1)`,
    [USER],
  )
  auth = await prepared.asRole('authenticator')
  await auth.query('SET ROLE authenticated')
  await auth.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ role: 'authenticated', sub: USER, workspace_id: WS }),
  ])
  apiClient = await prepared.asRole('authenticator')
  await apiClient.query('SET ROLE api_client')
  await apiClient.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      role: 'api_client',
      workspace_id: WS,
      credential_id: '10000000-0000-4000-8000-000000000099',
    }),
  ])
})

afterAll(async () =>
  Promise.all([migrator?.end(), auth?.end(), apiClient?.end()]),
)

describe('DATA-002 scientific tables', () => {
  it('creates every logical type with immutable generated names, constraints, defaults and ordered category options', async () => {
    const specs = [
      {
        label: `Text "; DROP TABLE api.workspaces; — µ`,
        logical_type: 'text',
        nullable: false,
        default: 'ABC',
        validation: { minLength: 2, maxLength: 5, regex: '^[A-Z]+$' },
      },
      {
        label: 'Integer',
        logical_type: 'integer',
        validation: { min: 1, max: 9 },
      },
      {
        label: 'Decimal',
        logical_type: 'decimal',
        unit: { code: 'uL', symbol: 'µL' },
        validation: { precision: 6, scale: 2, exclusiveMin: 0 },
      },
      { label: 'Boolean', logical_type: 'boolean', default: true },
      {
        label: 'Date',
        logical_type: 'date',
        validation: { earliest: '2020-01-01', latest: '2030-01-01' },
      },
      {
        label: 'Timestamp',
        logical_type: 'timestamp',
        default: 'now',
        validation: { earliest: '2020-01-01T00:00:00Z' },
      },
      {
        label: 'Category',
        logical_type: 'category',
        options: [{ label: 'One' }, { label: 'Two' }],
      },
    ]
    const result = await auth.query(
      `SELECT api.create_scientific_table($1,$2,$3::jsonb) result`,
      [BLOCK, 'Unsafe "; -- name', JSON.stringify(specs)],
    )
    table = result.rows[0].result.table
    columns = result.rows[0].result.columns
    expect(table.resource_name).toMatch(/^sheet_[a-z2-7]{26}$/)
    expect(columns.map((c) => c.logical_type)).toEqual(
      specs.map((s) => s.logical_type),
    )
    expect(columns.every((c) => /^col_[a-z2-7]{26}$/.test(c.field_name))).toBe(
      true,
    )
    const category = columns[6]
    const options = await auth.query(
      `SELECT * FROM api.scientific_category_options WHERE column_id=$1 ORDER BY display_order`,
      [category.id],
    )
    expect(options.rows.map((x) => x.label)).toEqual(['One', 'Two'])
    const f = Object.fromEntries(
      columns.map((c) => [c.logical_type, c.field_name]),
    )
    await expect(
      auth.query(
        `INSERT INTO api.${table.resource_name} (${f.text}) VALUES ('x')`,
      ),
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      auth.query(
        `INSERT INTO api.${table.resource_name} (${f.decimal}) VALUES ('NaN')`,
      ),
    ).rejects.toMatchObject({ code: '23514' })
    await auth.query(
      `INSERT INTO api.${table.resource_name} (${f.integer},${f.decimal}) VALUES (2,1.25)`,
    )
  })

  it('rolls back invalid declarative specifications and required adds without a backfill', async () => {
    const block2 = '10000000-0000-4000-8000-000000000006'
    await migrator.query(
      `INSERT INTO api.blocks(id,record_id,type,payload,"order",created_by_user_id) VALUES ($1,'${RECORD}','sheet','{}',2,$2)`,
      [block2, USER],
    )
    await expect(
      auth.query(`SELECT api.create_scientific_table($1,'bad',$2::jsonb)`, [
        block2,
        JSON.stringify([
          {
            label: 'bad',
            logical_type: 'text',
            validation: { regex: 'unanchored' },
          },
        ]),
      ]),
    ).rejects.toMatchObject({ code: '22023' })
    expect(
      (
        await migrator.query(
          `SELECT count(*)::int n FROM api.scientific_tables WHERE block_id=$1`,
          [block2],
        )
      ).rows[0].n,
    ).toBe(0)
    await expect(
      auth.query(
        `SELECT api.add_scientific_column($1,1,'required','integer',false)`,
        [table.id],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('strictly rejects the invalid compiler matrix without metadata, relation, or event residue', async () => {
    const invalid = [
      { label: 'x', logical_type: 'text', nullable: 'no' },
      { label: 'x', logical_type: 'text', validation: null },
      { label: 'x', logical_type: 'text', validation: { mystery: 1 } },
      { label: 'x', logical_type: 'decimal', validation: { precision: 0 } },
      {
        label: 'x',
        logical_type: 'decimal',
        validation: { precision: 2, scale: 3 },
      },
      { label: 'x', logical_type: 'integer', validation: { min: 4, max: 3 } },
      {
        label: 'x',
        logical_type: 'date',
        validation: { earliest: '2030-01-01', latest: '2020-01-01' },
      },
      {
        label: 'x',
        logical_type: 'text',
        default: 'x',
        validation: { minLength: 2 },
      },
      {
        label: 'x',
        logical_type: 'integer',
        default: 9,
        validation: { max: 2 },
      },
      {
        label: 'x',
        logical_type: 'date',
        default: '2010-01-01',
        validation: { earliest: '2020-01-01' },
      },
    ]
    for (const [index, spec] of invalid.entries()) {
      const block = `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
      await migrator.query(
        `INSERT INTO api.blocks(id,record_id,type,payload,"order",created_by_user_id) VALUES ($1,$2,'sheet','{}',$3,$4)`,
        [block, RECORD, 20 + index, USER],
      )
      const before = await migrator.query(
        `SELECT (SELECT count(*) FROM api.scientific_tables) tables,(SELECT count(*) FROM api.change_events) events,(SELECT count(*) FROM pg_class WHERE relnamespace='api'::regnamespace) classes`,
      )
      await expect(
        auth.query(`SELECT api.create_scientific_table($1,'invalid',$2)`, [
          block,
          JSON.stringify([spec]),
        ]),
      ).rejects.toBeTruthy()
      const after = await migrator.query(
        `SELECT (SELECT count(*) FROM api.scientific_tables) tables,(SELECT count(*) FROM api.change_events) events,(SELECT count(*) FROM pg_class WHERE relnamespace='api'::regnamespace) classes`,
      )
      expect(after.rows[0]).toEqual(before.rows[0])
    }
  })

  it('quotes percent, percent-I, and percent-L regex text exactly once and enforces it literally', async () => {
    const block = '20000000-0000-4000-8000-000000000099'
    await migrator.query(
      `INSERT INTO api.blocks(id,record_id,type,payload,"order",created_by_user_id) VALUES ($1,$2,'sheet','{}',99,$3)`,
      [block, RECORD, USER],
    )
    const result = (
      await auth.query(
        `SELECT api.create_scientific_table($1,'percent',$2) result`,
        [
          block,
          JSON.stringify([
            {
              label: 'pattern',
              logical_type: 'text',
              validation: { regex: '^%I%L%$' },
            },
          ]),
        ],
      )
    ).rows[0].result
    await auth.query(
      `INSERT INTO api.${result.table.resource_name} (${result.columns[0].field_name}) VALUES ('%I%L%')`,
    )
    await expect(
      auth.query(
        `INSERT INTO api.${result.table.resource_name} (${result.columns[0].field_name}) VALUES ('anything')`,
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('backfills a required added column and preserves its typed physical default', async () => {
    const version = (
      await auth.query(
        `SELECT schema_version FROM api.scientific_tables WHERE id=$1`,
        [table.id],
      )
    ).rows[0].schema_version
    const beforeEvents = Number(
      (await migrator.query(`SELECT count(*) n FROM api.change_events`)).rows[0]
        .n,
    )
    await expect(
      auth.query(
        `SELECT api.add_scientific_column($1,$2,'null default','integer',false,'null'::jsonb)`,
        [table.id, version],
      ),
    ).rejects.toBeTruthy()
    expect(
      Number(
        (await migrator.query(`SELECT count(*) n FROM api.change_events`))
          .rows[0].n,
      ),
    ).toBe(beforeEvents)
    const added = (
      await auth.query(
        `SELECT api.add_scientific_column($1,$2,'required default','integer',false,'7'::jsonb) result`,
        [table.id, version],
      )
    ).rows[0].result
    expect(
      (
        await auth.query(
          `SELECT ${added.field_name} value FROM api.${table.resource_name}`,
        )
      ).rows.every((row) => row.value === '7'),
    ).toBe(true)
    const inserted = (
      await auth.query(
        `INSERT INTO api.${table.resource_name} DEFAULT VALUES RETURNING ${added.field_name} value`,
      )
    ).rows[0]
    expect(inserted.value).toBe('7')
  })

  it('enforces exact category column and emits private attributable row events', async () => {
    const category = columns[6]
    const option = (
      await migrator.query(
        `SELECT id FROM api.scientific_category_options WHERE column_id=$1 LIMIT 1`,
        [category.id],
      )
    ).rows[0].id
    await auth.query(
      `INSERT INTO api.${table.resource_name} (${category.field_name}) VALUES ($1)`,
      [option],
    )
    const event = (
      await migrator.query(
        `SELECT * FROM api.change_events WHERE entity_type='scientific_row' ORDER BY sequence DESC LIMIT 1`,
      )
    ).rows[0]
    expect(event.actor_user_id).toBe(USER)
    expect(JSON.stringify(event.payload)).not.toContain('One')
    expect(event.payload.changedColumnIds).toContain(category.id)
    await expect(
      auth.query(
        `INSERT INTO api.${table.resource_name} (${category.field_name}) VALUES (gen_random_uuid())`,
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('increments row versions on direct updates and emits only precise stable column ids', async () => {
    const integer = columns.find((column) => column.logical_type === 'integer')!
    const row = (
      await auth.query(
        `INSERT INTO api.${table.resource_name} (${integer.field_name}) VALUES (3) RETURNING id,version`,
      )
    ).rows[0]
    const updated = (
      await auth.query(
        `UPDATE api.${table.resource_name} SET ${integer.field_name}=4 WHERE id=$1 RETURNING version`,
        [row.id],
      )
    ).rows[0]
    expect(Number(updated.version)).toBe(Number(row.version) + 1)
    const event = (
      await migrator.query(
        `SELECT payload FROM api.change_events WHERE entity_type='scientific_row' AND entity_uuid=$1 ORDER BY sequence DESC LIMIT 1`,
        [row.id],
      )
    ).rows[0].payload
    expect(event.changedColumnIds).toEqual([integer.id])
    expect(Object.keys(event).sort()).toEqual([
      'changedColumnIds',
      'rowId',
      'tableId',
      'version',
    ])
    await expect(
      auth.query(
        `UPDATE api.${table.resource_name} SET workspace_id=$2 WHERE id=$1`,
        [row.id, OTHER_WS],
      ),
    ).rejects.toBeTruthy()
    await auth.query(
      `SELECT set_config('app.scientific_internal','true',false)`,
    )
    await expect(
      auth.query(
        `UPDATE api.${table.resource_name} SET version=999 WHERE id=$1`,
        [row.id],
      ),
    ).rejects.toBeTruthy()
  })

  it('supports both reorder directions, immutable identities, and restricts parent deletion', async () => {
    const first = columns[0]
    const version = Number(
      (
        await auth.query(
          `SELECT schema_version FROM api.scientific_tables WHERE id=$1`,
          [table.id],
        )
      ).rows[0].schema_version,
    )
    await auth.query(
      `SELECT api.update_scientific_column_display($1,$2,NULL,8)`,
      [first.id, version],
    )
    await auth.query(
      `SELECT api.update_scientific_column_display($1,$2,NULL,1)`,
      [first.id, version + 1],
    )
    expect(
      (
        await auth.query(
          `SELECT display_order FROM api.scientific_columns WHERE id=$1`,
          [first.id],
        )
      ).rows[0].display_order,
    ).toBe(1)
    await expect(
      migrator.query(
        `UPDATE api.scientific_columns SET field_name='col_aaaaaaaaaaaaaaaaaaaaaaaaaa' WHERE id=$1`,
        [first.id],
      ),
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      migrator.query(`DELETE FROM api.blocks WHERE id='${BLOCK}'`),
    ).rejects.toMatchObject({ code: '23001' })
    expect(
      (
        await migrator.query(`SELECT to_regclass($1) relation`, [
          `api.${table.resource_name}`,
        ])
      ).rows[0].relation,
    ).not.toBeNull()
  })

  it('denies metadata, rows and management RPCs without scientific scopes', async () => {
    await expect(
      apiClient.query(`SELECT * FROM api.scientific_tables`),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      apiClient.query(`SELECT * FROM api.${table.resource_name}`),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      apiClient.query(`SELECT api.add_scientific_column($1,3,'x','text')`, [
        table.id,
      ]),
    ).rejects.toMatchObject({ code: '42501' })
  })
})
