import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase, setActorJwt } from './helpers'

const WS = '31000000-0000-4000-8000-000000000001'
const PROJECT = '31000000-0000-4000-8000-000000000002'
const RECORD = '31000000-0000-4000-8000-000000000003'
const USER = 'scientific-evolution-owner'

let migrator: Client
let auth: Client
let nextBlock = 1

type Sheet = {
  table: { id: string; resource_name: string; schema_version: number }
  columns: Array<{
    id: string
    field_name: string
    label: string
    logical_type: string
  }>
}

beforeAll(async () => {
  const prepared = await prepareTestDatabase()
  migrator = prepared.migrator
  await migrator.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES ($1,'Owner','evolution@test.invalid',true)`,
    [USER],
  )
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ($1,'scientific-evolution','Scientific evolution')`,
    [WS],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES ($1,$2,'owner')`,
    [WS, USER],
  )
  await migrator.query(
    `INSERT INTO api.projects(id,workspace_id,key,title) VALUES ($1,$2,'EV','Evolution')`,
    [PROJECT, WS],
  )
  await migrator.query(
    `INSERT INTO api.records(id,workspace_id,project_id,kind,identifier,title,created_by_user_id) VALUES ($1,$2,$3,'experiment','EV-1','Evolution',$4)`,
    [RECORD, WS, PROJECT, USER],
  )
  auth = await prepared.asRole('authenticator')
  await auth.query('SET ROLE authenticated')
  await auth.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ role: 'authenticated', sub: USER, workspace_id: WS }),
  ])
  await setActorJwt(migrator, USER, WS)
})

afterAll(async () => Promise.all([migrator?.end(), auth?.end()]))

async function createSheet(columns: unknown[]): Promise<Sheet> {
  const block = `31000000-0000-4000-8000-${String(nextBlock++).padStart(12, '0')}`
  await migrator.query(
    `INSERT INTO api.blocks(id,record_id,type,payload,"order",created_by_user_id) VALUES ($1,$2,'sheet','{}',$3,$4)`,
    [block, RECORD, nextBlock, USER],
  )
  return (
    await migrator.query(`SELECT api.create_scientific_table($1,'Evolution fixture',$2::jsonb) result`,
      [block, JSON.stringify(columns)],
    )
  ).rows[0].result
}

async function schemaVersion(tableId: string): Promise<number> {
  return Number(
    (
      await migrator.query(
        `SELECT schema_version FROM api.scientific_tables WHERE id=$1`,
        [tableId],
      )
    ).rows[0].schema_version,
  )
}

async function tableEvents(tableId: string): Promise<any[]> {
  return (
    await migrator.query(
      `SELECT payload FROM api.change_events WHERE entity_type='scientific_table' AND entity_uuid=$1 ORDER BY sequence`,
      [tableId],
    )
  ).rows
}

describe('scientific table migration evolution', () => {
  it('renames only table display metadata with versioning and attribution', async () => {
    const sheet = await createSheet([{ label: 'Stable', logical_type: 'text' }])
    const beforeResource = sheet.table.resource_name
    const result = (
      await auth.query(
        `SELECT api.update_scientific_table_display($1,1,'Renamed fixture') result`,
        [sheet.table.id],
      )
    ).rows[0].result
    expect(result).toMatchObject({
      name: 'Renamed fixture',
      resourceName: beforeResource,
      schemaVersion: 2,
    })
    const stored = (
      await migrator.query(
        `SELECT name,resource_name,schema_version,updated_by_user_id
           FROM api.scientific_tables WHERE id=$1`,
        [sheet.table.id],
      )
    ).rows[0]
    expect(stored).toMatchObject({
      name: 'Renamed fixture',
      resource_name: beforeResource,
      schema_version: 2,
      updated_by_user_id: USER,
    })
    await expect(
      auth.query(`SELECT api.update_scientific_table_display($1,1,'Stale')`, [
        sheet.table.id,
      ]),
    ).rejects.toMatchObject({ code: 'SB001' })
    expect((await tableEvents(sheet.table.id)).at(-1).payload).toMatchObject({
      operation: 'display',
      schemaVersion: 2,
    })
  })

  it('adds a required category with exact-column options and backfills its default', async () => {
    const sheet = await createSheet([{ label: 'Seed', logical_type: 'text' }])
    await auth.query(
      `INSERT INTO api.${sheet.table.resource_name} DEFAULT VALUES`,
    )
    const first = '31000000-0000-4000-8000-000000000101'
    const second = '31000000-0000-4000-8000-000000000102'
    const added = (
      await migrator.query(`SELECT api.add_scientific_column($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb) result`,
        [
          sheet.table.id,
          1,
          'Status',
          'category',
          false,
          JSON.stringify(first),
          null,
          {},
          [
            { id: first, label: 'Ready' },
            { id: second, label: 'Done' },
          ],
        ].map((value) =>
          typeof value === 'object' && value !== null
            ? JSON.stringify(value)
            : value,
        ),
      )
    ).rows[0].result
    expect(
      (
        await auth.query(
          `SELECT ${added.field_name} value FROM api.${sheet.table.resource_name}`,
        )
      ).rows.map((row) => row.value),
    ).toEqual([first])
    expect(
      (
        await auth.query(
          `INSERT INTO api.${sheet.table.resource_name} DEFAULT VALUES RETURNING ${added.field_name} value`,
        )
      ).rows[0].value,
    ).toBe(first)
    const options = await migrator.query(
      `SELECT id,label,display_order FROM api.scientific_category_options WHERE column_id=$1 ORDER BY display_order`,
      [added.id],
    )
    expect(options.rows).toEqual([
      { id: first, label: 'Ready', display_order: 1 },
      { id: second, label: 'Done', display_order: 2 },
    ])
    await expect(
      auth.query(
        `INSERT INTO api.${sheet.table.resource_name} (${added.field_name}) VALUES (gen_random_uuid())`,
      ),
    ).rejects.toMatchObject({ code: '23514' })

    const other = await createSheet([
      {
        label: 'Other category',
        logical_type: 'category',
        options: [
          { id: '31000000-0000-4000-8000-000000000103', label: 'Other' },
        ],
      },
    ])
    const otherOption = (
      await migrator.query(
        `SELECT id FROM api.scientific_category_options WHERE column_id=$1`,
        [other.columns[0].id],
      )
    ).rows[0].id
    await expect(
      auth.query(
        `INSERT INTO api.${sheet.table.resource_name} (${added.field_name}) VALUES ($1)`,
        [otherOption],
      ),
    ).rejects.toMatchObject({ code: '23514' })
    const before = {
      version: await schemaVersion(other.table.id),
      columns: Number(
        (
          await migrator.query(
            `SELECT count(*) n FROM api.scientific_columns WHERE table_id=$1`,
            [other.table.id],
          )
        ).rows[0].n,
      ),
      events: (await tableEvents(other.table.id)).length,
    }
    await expect(
      migrator.query(`SELECT api.add_scientific_column($1,$2,'Bad','category',false,$3::jsonb,NULL,'{}',$4::jsonb)`,
        [
          other.table.id,
          1,
          JSON.stringify(first),
          JSON.stringify([{ label: 'Local' }]),
        ],
      ),
    ).rejects.toMatchObject({ code: '23514' })
    expect(await schemaVersion(other.table.id)).toBe(before.version)
    expect(
      Number(
        (
          await migrator.query(
            `SELECT count(*) n FROM api.scientific_columns WHERE table_id=$1`,
            [other.table.id],
          )
        ).rows[0].n,
      ),
    ).toBe(before.columns)
    expect((await tableEvents(other.table.id)).length).toBe(before.events)
  })

  it('reorders both directions as an exact permutation and reports all shifted columns', async () => {
    const sheet = await createSheet(
      ['A', 'B', 'C', 'D'].map((label) => ({ label, logical_type: 'text' })),
    )
    const [a, b, c, d] = sheet.columns
    await auth.query(
      `SELECT api.update_scientific_column_display($1,1,NULL,4)`,
      [a.id],
    )
    let ordered = (
      await migrator.query(
        `SELECT id,label,display_order FROM api.scientific_columns WHERE table_id=$1 AND lifecycle='active' ORDER BY display_order`,
        [sheet.table.id],
      )
    ).rows
    expect(ordered.map((x) => x.label)).toEqual(['B', 'C', 'D', 'A'])
    expect(ordered.map((x) => x.display_order)).toEqual([1, 2, 3, 4])
    expect(
      new Set((await tableEvents(sheet.table.id)).at(-1).payload.columnIds),
    ).toEqual(new Set([a.id, b.id, c.id, d.id]))
    await auth.query(
      `SELECT api.update_scientific_column_display($1,2,NULL,2)`,
      [a.id],
    )
    ordered = (
      await migrator.query(
        `SELECT id,label,display_order FROM api.scientific_columns WHERE table_id=$1 AND lifecycle='active' ORDER BY display_order`,
        [sheet.table.id],
      )
    ).rows
    expect(ordered.map((x) => x.label)).toEqual(['B', 'A', 'C', 'D'])
    expect(ordered.map((x) => x.display_order)).toEqual([1, 2, 3, 4])
    expect(
      new Set((await tableEvents(sheet.table.id)).at(-1).payload.columnIds),
    ).toEqual(new Set([a.id, c.id, d.id]))
    const before = {
      version: await schemaVersion(sheet.table.id),
      events: (await tableEvents(sheet.table.id)).length,
      ordered,
    }
    await expect(
      auth.query(`SELECT api.update_scientific_column_display($1,1,NULL,3)`, [
        a.id,
      ]),
    ).rejects.toMatchObject({ code: 'SB001' })
    await expect(
      auth.query(`SELECT api.update_scientific_column_display($1,3,NULL,5)`, [
        a.id,
      ]),
    ).rejects.toMatchObject({ code: '22023' })
    expect(await schemaVersion(sheet.table.id)).toBe(before.version)
    expect((await tableEvents(sheet.table.id)).length).toBe(before.events)
    expect(
      (
        await migrator.query(
          `SELECT id,label,display_order FROM api.scientific_columns WHERE table_id=$1 AND lifecycle='active' ORDER BY display_order`,
          [sheet.table.id],
        )
      ).rows,
    ).toEqual(before.ordered)
  })

  it('retires only with current evidence and preserves physical data', async () => {
    const sheet = await createSheet([
      { label: 'Literal', logical_type: 'text' },
    ])
    const column = sheet.columns[0]
    const row = (
      await auth.query(
        `INSERT INTO api.${sheet.table.resource_name} (${column.field_name}) VALUES ('one') RETURNING id`,
      )
    ).rows[0]
    const oldEvidence = (
      await auth.query(`SELECT api.retire_scientific_column($1,1) result`, [
        column.id,
      ])
    ).rows[0].result
    expect(oldEvidence).toMatchObject({
      nonNullRows: 1,
      formulaMarkers: 0,
      requiresConfirmation: true,
    })
    await auth.query(
      `UPDATE api.${sheet.table.resource_name} SET ${column.field_name}='two' WHERE id=$1`,
      [row.id],
    )
    await expect(
      auth.query(`SELECT api.retire_scientific_column($1,1,$2)`, [
        column.id,
        oldEvidence.hash,
      ]),
    ).rejects.toMatchObject({ code: '23514' })
    await auth.query(
      `INSERT INTO api.${sheet.table.resource_name} (${column.field_name}) VALUES ('three')`,
    )
    const evidence = (
      await auth.query(`SELECT api.retire_scientific_column($1,1) result`, [
        column.id,
      ])
    ).rows[0].result
    expect(evidence).toMatchObject({ nonNullRows: 2, formulaMarkers: 0 })
    await auth.query(`SELECT api.retire_scientific_column($1,1,$2)`, [
      column.id,
      evidence.hash,
    ])
    expect(
      (
        await migrator.query(
          `SELECT array_agg(${column.field_name} ORDER BY ${column.field_name}) values FROM api.${sheet.table.resource_name}`,
        )
      ).rows[0].values,
    ).toEqual(['three', 'two'])
    expect(
      (
        await migrator.query(
          `SELECT lifecycle FROM api.scientific_columns WHERE id=$1`,
          [column.id],
        )
      ).rows[0].lifecycle,
    ).toBe('retired')
    await expect(
      auth.query(
        `UPDATE api.${sheet.table.resource_name} SET ${column.field_name}='forbidden' WHERE id=$1`,
        [row.id],
      ),
    ).rejects.toMatchObject({ code: '42501' })
    expect(await schemaVersion(sheet.table.id)).toBe(2)
    expect(
      (await tableEvents(sheet.table.id)).filter(
        (x) => x.payload.operation === 'retire_column',
      ),
    ).toHaveLength(1)
  })

  it('converts integer to decimal without row events or metadata loss', async () => {
    const sheet = await createSheet([
      {
        label: 'Amount',
        logical_type: 'integer',
        nullable: false,
        default: 2,
        unit: { code: 'mg', symbol: 'mg' },
        validation: { min: 1, max: 9 },
      },
    ])
    const column = sheet.columns[0]
    await auth.query(
      `INSERT INTO api.${sheet.table.resource_name} (${column.field_name}) VALUES (4)`,
    )
    const beforeRows = (
      await migrator.query(
        `SELECT id,version,created_at,updated_at,created_by_user_id,updated_by_user_id FROM api.${sheet.table.resource_name} ORDER BY id`,
      )
    ).rows
    const beforeRowEvents = Number(
      (
        await migrator.query(
          `SELECT count(*) n FROM api.change_events WHERE entity_type='scientific_row' AND payload->>'tableId'=$1`,
          [sheet.table.id],
        )
      ).rows[0].n,
    )
    const evidence = (
      await auth.query(
        `SELECT api.convert_scientific_column($1,1,'decimal') result`,
        [column.id],
      )
    ).rows[0].result
    await auth.query(
      `SELECT api.convert_scientific_column($1,1,'decimal',$2)`,
      [column.id, evidence.hash],
    )
    expect(
      (
        await migrator.query(
          `SELECT ${column.field_name}::text value FROM api.${sheet.table.resource_name}`,
        )
      ).rows[0].value,
    ).toBe('4')
    expect(
      Number(
        (
          await migrator.query(
            `SELECT count(*) n FROM api.change_events WHERE entity_type='scientific_row' AND payload->>'tableId'=$1`,
            [sheet.table.id],
          )
        ).rows[0].n,
      ),
    ).toBe(beforeRowEvents)
    expect(
      (
        await auth.query(
          `INSERT INTO api.${sheet.table.resource_name} DEFAULT VALUES RETURNING ${column.field_name}::text value`,
        )
      ).rows[0].value,
    ).toBe('2')
    const metadata = (
      await migrator.query(
        `SELECT logical_type,nullable,default_value,unit,validation FROM api.scientific_columns WHERE id=$1`,
        [column.id],
      )
    ).rows[0]
    expect(metadata).toMatchObject({
      logical_type: 'decimal',
      nullable: false,
      default_value: 2,
      unit: { code: 'mg', symbol: 'mg' },
      validation: { min: 1, max: 9 },
    })
    for (const value of ['NaN', 'Infinity', '-Infinity'])
      await expect(
        auth.query(
          `INSERT INTO api.${sheet.table.resource_name} (${column.field_name}) VALUES ($1)`,
          [value],
        ),
      ).rejects.toBeTruthy()
    const afterRows = (
      await migrator.query(
        `SELECT id,version,created_at,updated_at,created_by_user_id,updated_by_user_id FROM api.${sheet.table.resource_name} WHERE id=$1`,
        [beforeRows[0].id],
      )
    ).rows
    expect(afterRows).toEqual(beforeRows)
    expect(
      Number(
        (
          await migrator.query(
            `SELECT count(*) n FROM api.change_events WHERE entity_type='scientific_row' AND payload->>'tableId'=$1`,
            [sheet.table.id],
          )
        ).rows[0].n,
      ),
    ).toBe(beforeRowEvents + 1)
    expect(await schemaVersion(sheet.table.id)).toBe(2)
    expect(
      (await tableEvents(sheet.table.id)).filter(
        (x) => x.payload.operation === 'convert_column',
      ),
    ).toHaveLength(1)
  })

  it('preserves explicit nulls while retaining a converted column default', async () => {
    const sheet = await createSheet([
      {
        label: 'Nullable amount',
        logical_type: 'integer',
        nullable: true,
        default: 2,
      },
    ])
    const column = sheet.columns[0]
    const nullRow = (
      await auth.query(
        `INSERT INTO api.${sheet.table.resource_name} (${column.field_name}) VALUES (NULL) RETURNING id`,
      )
    ).rows[0]
    const evidence = (
      await auth.query(
        `SELECT api.convert_scientific_column($1,1,'decimal') result`,
        [column.id],
      )
    ).rows[0].result
    await auth.query(
      `SELECT api.convert_scientific_column($1,1,'decimal',$2)`,
      [column.id, evidence.hash],
    )
    expect(
      (
        await auth.query(
          `SELECT ${column.field_name} value FROM api.${sheet.table.resource_name} WHERE id=$1`,
          [nullRow.id],
        )
      ).rows[0].value,
    ).toBeNull()
    expect(
      (
        await auth.query(
          `INSERT INTO api.${sheet.table.resource_name} DEFAULT VALUES RETURNING ${column.field_name}::text value`,
        )
      ).rows[0].value,
    ).toBe('2')
  })

  it('rejects incompatible, bad-row, stale-hash and formula-owned conversions', async () => {
    const incompatible = await createSheet([
      { label: 'Number', logical_type: 'integer' },
    ])
    await expect(
      auth.query(`SELECT api.convert_scientific_column($1,1,'text')`, [
        incompatible.columns[0].id,
      ]),
    ).rejects.toMatchObject({ code: '22023' })
    const text = await createSheet([{ label: 'Text', logical_type: 'text' }])
    await auth.query(
      `INSERT INTO api.${text.table.resource_name} (${text.columns[0].field_name}) VALUES ('bad')`,
    )
    const bad = (
      await auth.query(
        `SELECT api.convert_scientific_column($1,1,'integer') result`,
        [text.columns[0].id],
      )
    ).rows[0].result
    expect(bad.invalidRows).toBe(1)
    await expect(
      auth.query(`SELECT api.convert_scientific_column($1,1,'integer',$2)`, [
        text.columns[0].id,
        bad.hash,
      ]),
    ).rejects.toMatchObject({ code: '23514' })
    await auth.query(
      `UPDATE api.${text.table.resource_name} SET ${text.columns[0].field_name}='3'`,
    )
    await expect(
      auth.query(`SELECT api.convert_scientific_column($1,1,'integer',$2)`, [
        text.columns[0].id,
        bad.hash,
      ]),
    ).rejects.toMatchObject({ code: '23514' })
    const current = (
      await auth.query(
        `SELECT api.convert_scientific_column($1,1,'integer') result`,
        [text.columns[0].id],
      )
    ).rows[0].result
    await migrator.query('BEGIN')
    try {
      await migrator.query(
        `ALTER TABLE api.${text.table.resource_name} DISABLE TRIGGER scientific_row_before`,
      )
      await migrator.query(
        `UPDATE api.${text.table.resource_name} SET formula_column_ids=ARRAY[$1::uuid]`,
        [text.columns[0].id],
      )
      await migrator.query(
        `ALTER TABLE api.${text.table.resource_name} ENABLE TRIGGER scientific_row_before`,
      )
      await migrator.query('COMMIT')
    } catch (error) {
      await migrator.query('ROLLBACK')
      throw error
    }
    await expect(
      auth.query(`SELECT api.convert_scientific_column($1,1,'integer',$2)`, [
        text.columns[0].id,
        current.hash,
      ]),
    ).rejects.toMatchObject({ code: '23514' })
    expect(
      (
        await migrator.query(
          `SELECT logical_type FROM api.scientific_columns WHERE id=$1`,
          [text.columns[0].id],
        )
      ).rows[0].logical_type,
    ).toBe('text')
    expect(await schemaVersion(text.table.id)).toBe(1)
    expect(
      (await tableEvents(text.table.id)).filter(
        (x) => x.payload.operation === 'convert_column',
      ),
    ).toHaveLength(0)
    expect(
      (
        await migrator.query(
          `SELECT data_type FROM information_schema.columns WHERE table_schema='api' AND table_name=$1 AND column_name=$2`,
          [text.table.resource_name, text.columns[0].field_name],
        )
      ).rows[0].data_type,
    ).toBe('text')
  })

  it('restricts block record and workspace deletion while preserving relation', async () => {
    const sheet = await createSheet([])
    const block = (
      await migrator.query(
        `SELECT block_id FROM api.scientific_tables WHERE id=$1`,
        [sheet.table.id],
      )
    ).rows[0].block_id
    const otherRecord = '31000000-0000-4000-8000-000000000099'
    await migrator.query(
      `INSERT INTO api.records(id,workspace_id,project_id,kind,identifier,title,created_by_user_id) VALUES ($1,$2,$3,'experiment','EV-2','Other',$4)`,
      [otherRecord, WS, PROJECT, USER],
    )
    await expect(
      auth.query(`UPDATE api.blocks SET type='rich_text' WHERE id=$1`, [block]),
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      auth.query(`UPDATE api.blocks SET record_id=$2 WHERE id=$1`, [
        block,
        otherRecord,
      ]),
    ).rejects.toMatchObject({ code: '23514' })
    for (const [sql, id] of [
      [`DELETE FROM api.blocks WHERE id=$1`, block],
      [`DELETE FROM api.records WHERE id=$1`, RECORD],
      [`DELETE FROM api.workspaces WHERE id=$1`, WS],
    ] as const)
      await expect(migrator.query(sql, [id])).rejects.toBeTruthy()
    expect(
      (
        await migrator.query(`SELECT to_regclass($1) relation`, [
          `api.${sheet.table.resource_name}`,
        ])
      ).rows[0].relation,
    ).not.toBeNull()
    expect(
      (
        await migrator.query(
          `SELECT record_id,block_id FROM api.scientific_tables WHERE id=$1`,
          [sheet.table.id],
        )
      ).rows[0],
    ).toEqual({ record_id: RECORD, block_id: block })
  })

  it('rejects every schema write for an archived owning record without side effects', async () => {
    const sheet = await createSheet([
      { label: 'One', logical_type: 'text' },
      { label: 'Two', logical_type: 'text' },
    ])
    const convertEvidence = (
      await auth.query(
        `SELECT api.convert_scientific_column($1,1,'integer') result`,
        [sheet.columns[0].id],
      )
    ).rows[0].result
    const retireEvidence = (
      await auth.query(`SELECT api.retire_scientific_column($1,1) result`, [
        sheet.columns[1].id,
      ])
    ).rows[0].result
    const unownedBlock = '31000000-0000-4000-8000-000000009999'
    await migrator.query(
      `INSERT INTO api.blocks(id,record_id,type,payload,"order",created_by_user_id) VALUES ($1,$2,'sheet','{}',999,$3)`,
      [unownedBlock, RECORD, USER],
    )
    const before = (
      await migrator.query(
        `SELECT t.schema_version,t.name,
          (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM api.scientific_columns c WHERE c.table_id=t.id) columns,
          (SELECT jsonb_agg(a.attname ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=format('api.%I',t.resource_name)::regclass AND a.attnum>0 AND NOT a.attisdropped) shape,
          (SELECT count(*)::int FROM api.change_events e WHERE e.entity_type='scientific_table' AND e.entity_uuid=t.id) events
         FROM api.scientific_tables t WHERE t.id=$1`,
        [sheet.table.id],
      )
    ).rows[0]
    await migrator.query(
      `UPDATE api.records SET archived_at=now() WHERE id=$1`,
      [RECORD],
    )
    try {
      const writes: Array<[string, unknown[]]> = [
        [
          `SELECT api.update_scientific_table_display($1,1,'No')`,
          [sheet.table.id],
        ],
        [
          `SELECT api.add_scientific_column($1,1,'No','text')`,
          [sheet.table.id],
        ],
        [
          `SELECT api.update_scientific_column_display($1,1,'No',2)`,
          [sheet.columns[0].id],
        ],
        [
          `SELECT api.convert_scientific_column($1,1,'integer',$2)`,
          [sheet.columns[0].id, convertEvidence.hash],
        ],
        [
          `SELECT api.retire_scientific_column($1,1,$2)`,
          [sheet.columns[1].id, retireEvidence.hash],
        ],
        [
          `SELECT api.create_scientific_table($1,'No','[]'::jsonb)`,
          [unownedBlock],
        ],
      ]
      for (const [sql, args] of writes)
        await expect(auth.query(sql, args)).rejects.toMatchObject({
          code: '42501',
        })

      // The same database guard applies to an external API actor, independent
      // of browser membership checks.
      await auth.query('RESET ROLE')
      await auth.query('SET ROLE api_client')
      await auth.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
        JSON.stringify({
          role: 'api_client',
          workspace_id: WS,
          credential_id: '31000000-0000-4000-8000-000000009998',
          scopes: ['scientific:schema'],
        }),
      ])
      await expect(
        auth.query(`SELECT api.add_scientific_column($1,1,'API no','text')`, [
          sheet.table.id,
        ]),
      ).rejects.toMatchObject({ code: '42501' })
    } finally {
      await auth.query('RESET ROLE')
      await auth.query('SET ROLE authenticated')
      await auth.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
        JSON.stringify({ role: 'authenticated', sub: USER, workspace_id: WS }),
      ])
      await migrator.query(
        `UPDATE api.records SET archived_at=NULL WHERE id=$1`,
        [RECORD],
      )
    }
    const after = (
      await migrator.query(
        `SELECT t.schema_version,t.name,
          (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM api.scientific_columns c WHERE c.table_id=t.id) columns,
          (SELECT jsonb_agg(a.attname ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=format('api.%I',t.resource_name)::regclass AND a.attnum>0 AND NOT a.attisdropped) shape,
          (SELECT count(*)::int FROM api.change_events e WHERE e.entity_type='scientific_table' AND e.entity_uuid=t.id) events
         FROM api.scientific_tables t WHERE t.id=$1`,
        [sheet.table.id],
      )
    ).rows[0]
    expect(after).toEqual(before)
    expect(
      (
        await migrator.query(
          `SELECT count(*)::int count FROM api.scientific_tables WHERE block_id=$1`,
          [unownedBlock],
        )
      ).rows[0].count,
    ).toBe(0)
  })
})
