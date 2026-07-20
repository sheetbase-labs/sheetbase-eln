import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS = '61000000-0000-4000-8000-000000000001'
const OTHER_WS = '61000000-0000-4000-8000-000000000002'
const PROJECT = '61000000-0000-4000-8000-000000000003'
const RECORD = '61000000-0000-4000-8000-000000000004'
const BLOCK = '61000000-0000-4000-8000-000000000005'
const SCHEMA_BLOCK = '61000000-0000-4000-8000-000000000006'
const ATTRIBUTION_BLOCK = '61000000-0000-4000-8000-000000000008'
const OWNER = 'data-003-owner'
const OTHER_OWNER = 'data-003-other-owner'
const CATEGORY_OPTION = '61000000-0000-4000-8000-000000000007'

const CREDENTIALS = {
  read: '61000000-0000-4000-8000-000000000011',
  write: '61000000-0000-4000-8000-000000000012',
  rows: '61000000-0000-4000-8000-000000000013',
  schema: '61000000-0000-4000-8000-000000000014',
  other: '61000000-0000-4000-8000-000000000015',
} as const

let migrator: Client
let browser: Client
const clients: Client[] = []
let table: { id: string; resource_name: string; schema_version: number }
let columns: Array<{
  id: string
  field_name: string
  logical_type: string
}>

async function asApiClient(
  credentialId: string,
  workspaceId: string,
  scopes: string[],
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
  await client.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      role: 'api_client',
      workspace_id: workspaceId,
      credential_id: credentialId,
      scopes,
    }),
  ])
  return client
}

beforeAll(async () => {
  const prepared = await prepareTestDatabase()
  migrator = prepared.migrator
  await migrator.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
      ($1,'Owner','data-003@test.invalid',true),
      ($2,'Other','data-003-other@test.invalid',true)`,
    [OWNER, OTHER_OWNER],
  )
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES
      ('${WS}','data-003','DATA-003'),
      ('${OTHER_WS}','data-003-other','DATA-003 other')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
      ('${WS}',$1,'owner'),('${OTHER_WS}',$2,'owner')`,
    [OWNER, OTHER_OWNER],
  )
  await migrator.query(
    `INSERT INTO api.projects(id,workspace_id,key,title) VALUES
      ('${PROJECT}','${WS}','D3','DATA-003')`,
  )
  await migrator.query(
    `INSERT INTO api.records(id,workspace_id,project_id,kind,identifier,title,created_by_user_id)
     VALUES ('${RECORD}','${WS}','${PROJECT}','experiment','D3-1','REST',$1)`,
    [OWNER],
  )
  await migrator.query(
    `INSERT INTO api.blocks(id,record_id,type,payload,"order",created_by_user_id) VALUES
      ('${BLOCK}','${RECORD}','sheet','{}',1,$1),
      ('${SCHEMA_BLOCK}','${RECORD}','sheet','{}',2,$1),
      ('${ATTRIBUTION_BLOCK}','${RECORD}','sheet','{}',3,$1)`,
    [OWNER],
  )
  for (const [index, id] of Object.values(CREDENTIALS).entries()) {
    const workspaceId = id === CREDENTIALS.other ? OTHER_WS : WS
    const userId = id === CREDENTIALS.other ? OTHER_OWNER : OWNER
    await migrator.query(
      `INSERT INTO internal.api_credentials
       (id,workspace_id,display_prefix,secret_hash,name,scopes,created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        id,
        workspaceId,
        `d300000${index}`,
        `hash-${index}`,
        `credential-${index}`,
        ['scientific:read', 'scientific:write', 'scientific:schema'],
        userId,
      ],
    )
  }

  browser = await prepared.asRole('authenticator')
  await browser.query('SET ROLE authenticated')
  await browser.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ role: 'authenticated', sub: OWNER, workspace_id: WS }),
  ])
  const result = (
    await browser.query(
      `SELECT api.create_scientific_table($1,'Measurements',$2::jsonb) result`,
      [
        BLOCK,
        JSON.stringify([
          {
            label: 'Sample',
            logical_type: 'text',
            nullable: false,
            validation: { minLength: 1 },
          },
          {
            label: 'Result',
            logical_type: 'integer',
            validation: { min: 0, max: 10 },
            unit: { code: 'count', symbol: '#' },
          },
          {
            label: 'State',
            logical_type: 'category',
            options: [{ id: CATEGORY_OPTION, label: 'Ready' }],
          },
        ]),
      ],
    )
  ).rows[0].result
  table = result.table
  columns = result.columns
})

afterAll(async () => {
  await Promise.all([
    browser?.end(),
    migrator?.end(),
    ...clients.map((client) => client.end()),
  ])
})

describe('DATA-003 scientific REST database boundary', () => {
  it('discovers ordered metadata separately from raw rows', async () => {
    const reader = await asApiClient(CREDENTIALS.read, WS, ['scientific:read'])
    const metadata = (
      await reader.query(`SELECT api.scientific_table_metadata($1) metadata`, [
        table.id,
      ])
    ).rows[0].metadata
    expect(metadata.resource_name).toBe(table.resource_name)
    expect(metadata.relationships).toEqual([])
    expect(
      metadata.columns.map((column: { label: string }) => column.label),
    ).toEqual(['Sample', 'Result', 'State'])
    expect(metadata.columns[1]).toMatchObject({
      logical_type: 'integer',
      unit: { code: 'count', symbol: '#' },
      validation: { min: 0, max: 10 },
    })
    expect(metadata.columns[2].options).toMatchObject([
      { id: CATEGORY_OPTION, label: 'Ready' },
    ])
    expect(metadata).not.toHaveProperty('rows')
  })

  it('enforces independent read/write scopes and reserved-column grants', async () => {
    const reader = await asApiClient(CREDENTIALS.read, WS, ['scientific:read'])
    const writer = await asApiClient(CREDENTIALS.write, WS, [
      'scientific:write',
    ])
    const rows = await asApiClient(CREDENTIALS.rows, WS, [
      'scientific:read',
      'scientific:write',
    ])
    expect(
      (await reader.query(`SELECT * FROM api.${table.resource_name}`)).rows,
    ).toEqual([])
    await expectDenied(
      reader.query(
        `INSERT INTO api.${table.resource_name} (${columns[0].field_name}) VALUES ('denied')`,
      ),
      '42501',
    )
    expect(
      (await writer.query(`SELECT * FROM api.${table.resource_name}`)).rows,
    ).toEqual([])
    await expectDenied(
      rows.query(
        `INSERT INTO api.${table.resource_name} (version,${columns[0].field_name}) VALUES (9,'reserved')`,
      ),
      '42501',
    )
  })

  it('supports direct row CRUD with stable identities and versions', async () => {
    const client = await asApiClient(CREDENTIALS.rows, WS, [
      'scientific:read',
      'scientific:write',
    ])
    const inserted = (
      await client.query(
        `INSERT INTO api.${table.resource_name}
         (${columns[0].field_name},${columns[1].field_name},${columns[2].field_name})
         VALUES ('A',2,'${CATEGORY_OPTION}') RETURNING *`,
      )
    ).rows[0]
    expect(inserted).toMatchObject({ version: '1' })
    const updated = (
      await client.query(
        `UPDATE api.${table.resource_name} SET ${columns[1].field_name}=3
         WHERE id=$1 AND version=1 RETURNING *`,
        [inserted.id],
      )
    ).rows[0]
    expect(updated).toMatchObject({ id: inserted.id, version: '2' })
    expect(
      (
        await client.query(
          `UPDATE api.${table.resource_name} SET ${columns[1].field_name}=4
           WHERE id=$1 AND version=1 RETURNING *`,
          [inserted.id],
        )
      ).rows,
    ).toEqual([])
    expect(
      (
        await client.query(
          `DELETE FROM api.${table.resource_name} WHERE id=$1 AND version=2 RETURNING id`,
          [inserted.id],
        )
      ).rows,
    ).toEqual([{ id: inserted.id }])
  })

  it('applies valid bulk edits once per row and rolls invalid batches back', async () => {
    const client = await asApiClient(CREDENTIALS.rows, WS, [
      'scientific:read',
      'scientific:write',
    ])
    const inserted = await client.query(
      `INSERT INTO api.${table.resource_name} (${columns[0].field_name},${columns[1].field_name})
       VALUES ('B',1),('C',2) RETURNING id,version`,
    )
    inserted.rows.sort((left, right) => left.id.localeCompare(right.id))
    const edits = inserted.rows.map((row, index) => ({
      rowId: row.id,
      expectedVersion: 1,
      values: { [columns[1].id]: index + 5 },
    }))
    const applied = (
      await client.query(
        `SELECT api.apply_scientific_row_edits($1,$2,$3::jsonb) result`,
        [table.id, table.schema_version, JSON.stringify(edits)],
      )
    ).rows[0].result
    expect(applied.ok).toBe(true)
    expect(applied.rows.map((row: { version: number }) => row.version)).toEqual(
      [2, 2],
    )

    const invalid = edits.map((edit) => ({
      ...edit,
      expectedVersion: 2,
      values: { [columns[1].id]: 999 },
    }))
    const rejected = (
      await client.query(
        `SELECT api.apply_scientific_row_edits($1,$2,$3::jsonb) result`,
        [table.id, table.schema_version, JSON.stringify(invalid)],
      )
    ).rows[0].result
    expect(rejected).toMatchObject({ ok: false })
    expect(rejected.errors).toHaveLength(2)
    expect(
      (
        await client.query(
          `SELECT version,${columns[1].field_name} value FROM api.${table.resource_name} ORDER BY id`,
        )
      ).rows,
    ).toMatchObject([{ version: '2' }, { version: '2' }])

    await expect(
      client.query(`SELECT api.apply_scientific_row_edits($1,$2,$3::jsonb)`, [
        table.id,
        table.schema_version,
        JSON.stringify([edits[0], edits[0]]),
      ]),
    ).rejects.toMatchObject({ code: '22023' })
    await expect(
      client.query(`SELECT api.apply_scientific_row_edits($1,$2,$3::jsonb)`, [
        table.id,
        table.schema_version,
        JSON.stringify([{ rowId: edits[0].rowId, values: edits[0].values }]),
      ]),
    ).rejects.toMatchObject({ code: '22023' })
    expect(
      (
        await client.query(
          `SELECT version,${columns[1].field_name} value FROM api.${table.resource_name} WHERE id=$1`,
          [edits[0].rowId],
        )
      ).rows[0],
    ).toMatchObject({ version: '2', value: '5' })
    await expect(
      client.query(`SELECT api.apply_scientific_row_edits($1,$2,$3::jsonb)`, [
        table.id,
        table.schema_version + 1,
        JSON.stringify(edits),
      ]),
    ).rejects.toMatchObject({ code: 'SB001' })
  })

  it('rejects null concurrency and edit arguments', async () => {
    await expect(
      browser.query(
        `SELECT api.add_scientific_column($1,NULL,'null version','text')`,
        [table.id],
      ),
    ).rejects.toMatchObject({ code: '22023' })
    await expect(
      browser.query(
        `SELECT api.update_scientific_column_display($1,NULL,'x',1)`,
        [columns[0].id],
      ),
    ).rejects.toMatchObject({ code: '22023' })
    await expect(
      browser.query(`SELECT api.retire_scientific_column($1,NULL)`, [
        columns[0].id,
      ]),
    ).rejects.toMatchObject({ code: '22023' })
    await expect(
      browser.query(`SELECT api.convert_scientific_column($1,NULL,'decimal')`, [
        columns[1].id,
      ]),
    ).rejects.toMatchObject({ code: '22023' })
    await expect(
      browser.query(`SELECT api.apply_scientific_row_edits($1,NULL,'[]')`, [
        table.id,
      ]),
    ).rejects.toMatchObject({ code: '22023' })
    await expect(
      browser.query(`SELECT api.apply_scientific_row_edits($1,$2,NULL)`, [
        table.id,
        table.schema_version,
      ]),
    ).rejects.toMatchObject({ code: '22023' })
  })

  it('attributes external schema mutations to the credential', async () => {
    const client = await asApiClient(CREDENTIALS.schema, WS, [
      'scientific:schema',
    ])
    const created = (
      await client.query(
        `SELECT api.create_scientific_table($1,'Schema attribution') result`,
        [ATTRIBUTION_BLOCK],
      )
    ).rows[0].result
    await client.query(
      `SELECT api.add_scientific_column($1,$2,'Value','text')`,
      [created.table.id, created.table.schema_version],
    )

    expect(
      (
        await migrator.query(
          `SELECT updated_by_user_id,updated_by_credential_id FROM api.scientific_tables WHERE id=$1`,
          [created.table.id],
        )
      ).rows[0],
    ).toEqual({
      updated_by_user_id: null,
      updated_by_credential_id: CREDENTIALS.schema,
    })
    expect(
      (
        await migrator.query(
          `SELECT actor_credential_id FROM api.change_events
           WHERE entity_type='scientific_table' AND entity_uuid=$1 AND operation='update'
           ORDER BY sequence DESC LIMIT 1`,
          [created.table.id],
        )
      ).rows[0],
    ).toEqual({ actor_credential_id: CREDENTIALS.schema })
  })

  it('protects formula-owned rows from direct delete', async () => {
    const client = await asApiClient(CREDENTIALS.rows, WS, [
      'scientific:read',
      'scientific:write',
    ])
    const row = (
      await client.query(
        `INSERT INTO api.${table.resource_name} (${columns[0].field_name}) VALUES ('formula') RETURNING id`,
      )
    ).rows[0]
    await migrator.query(
      `ALTER TABLE api.${table.resource_name} DISABLE TRIGGER scientific_row_before`,
    )
    try {
      await migrator.query(
        `UPDATE api.${table.resource_name} SET formula_column_ids=ARRAY[$2::uuid] WHERE id=$1`,
        [row.id, columns[1].id],
      )
    } finally {
      await migrator.query(
        `ALTER TABLE api.${table.resource_name} ENABLE TRIGGER scientific_row_before`,
      )
    }
    await expect(
      client.query(
        `DELETE FROM api.${table.resource_name} WHERE id=$1 AND version=1`,
        [row.id],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('allows schema scope only in its claimed workspace', async () => {
    const schemaClient = await asApiClient(CREDENTIALS.schema, WS, [
      'scientific:schema',
    ])
    const created = (
      await schemaClient.query(
        `SELECT api.create_scientific_table($1,'External schema','[]') result`,
        [SCHEMA_BLOCK],
      )
    ).rows[0].result
    expect(created.resourceName).toMatch(/^sheet_[a-z2-7]{26}$/)

    const otherClient = await asApiClient(CREDENTIALS.other, OTHER_WS, [
      'scientific:schema',
    ])
    await expectDenied(
      otherClient.query(
        `SELECT api.add_scientific_column($1,1,'leak','text')`,
        [table.id],
      ),
      '42501',
    )
    const otherReader = await asApiClient(CREDENTIALS.other, OTHER_WS, [
      'scientific:read',
    ])
    expect(
      (
        await otherReader.query(
          `SELECT api.scientific_table_metadata($1) metadata`,
          [table.id],
        )
      ).rows,
    ).toEqual([])
  })

  it('imports mapped CSV rows atomically with duplicate choice and durable provenance', async () => {
    const file = {
      name: 'measurements.csv',
      size: 42,
      sha256: 'a'.repeat(64),
      encoding: 'utf-8',
      delimiter: ',',
      header: true,
    }
    const mappings = [
      { source: 'Sample', columnId: columns[0].id },
      {
        source: 'Imported value',
        newColumn: {
          label: 'Imported value',
          logicalType: 'decimal',
          nullable: true,
          validation: {},
        },
      },
    ]
    const result = (
      await browser.query(
        `SELECT api.import_scientific_rows($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,'skip_file') result`,
        [
          table.id,
          table.schema_version,
          JSON.stringify(file),
          JSON.stringify(mappings),
          JSON.stringify([
            { Sample: 'import-a', 'Imported value': 1.5 },
            { Sample: 'import-a', 'Imported value': 1.5 },
            { Sample: 'import-b', 'Imported value': 2.5 },
          ]),
        ],
      )
    ).rows[0].result
    expect(result).toMatchObject({ importedRows: 2, skippedDuplicates: 1 })
    expect(
      (
        await browser.query(
          `SELECT operation,row_count,duplicate_strategy,actor_user_id,details
             FROM api.scientific_transfers WHERE id=$1`,
          [result.transferId],
        )
      ).rows[0],
    ).toMatchObject({
      operation: 'import',
      row_count: 2,
      duplicate_strategy: 'skip_file',
      actor_user_id: OWNER,
      details: { skippedDuplicates: 1 },
    })
    const columnsBefore = Number(
      (
        await migrator.query(
          `SELECT count(*) count FROM api.scientific_columns WHERE table_id=$1`,
          [table.id],
        )
      ).rows[0].count,
    )
    await expect(
      browser.query(
        `SELECT api.import_scientific_rows($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,'allow')`,
        [
          table.id,
          result.schemaVersion,
          JSON.stringify(file),
          JSON.stringify([
            {
              source: 'Bad',
              newColumn: {
                label: 'Rolled back',
                logicalType: 'integer',
                nullable: true,
                validation: {},
              },
            },
            { source: 'Result', columnId: columns[1].id },
          ]),
          JSON.stringify([{ Bad: 1, Result: 999 }]),
        ],
      ),
    ).rejects.toBeDefined()
    expect(
      Number(
        (
          await migrator.query(
            `SELECT count(*) count FROM api.scientific_columns WHERE table_id=$1`,
            [table.id],
          )
        ).rows[0].count,
      ),
    ).toBe(columnsBefore)
    const exported = (
      await browser.query(
        `SELECT api.record_scientific_export($1,2,'csv+metadata') result`,
        [table.id],
      )
    ).rows[0].result
    expect(
      (
        await browser.query(
          `SELECT operation,row_count,actor_user_id FROM api.scientific_transfers WHERE id=$1`,
          [exported.transferId],
        )
      ).rows[0],
    ).toEqual({ operation: 'export', row_count: 2, actor_user_id: OWNER })
  })
})
