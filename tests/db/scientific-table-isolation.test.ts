import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const A = {
  workspace: '42000000-0000-4000-8000-000000000001',
  project: '42000000-0000-4000-8000-000000000002',
  record: '42000000-0000-4000-8000-000000000003',
  block: '42000000-0000-4000-8000-000000000004',
  user: 'scientific-isolation-a',
}
const B = {
  workspace: '42000000-0000-4000-8000-000000000011',
  project: '42000000-0000-4000-8000-000000000012',
  record: '42000000-0000-4000-8000-000000000013',
  block: '42000000-0000-4000-8000-000000000014',
  user: 'scientific-isolation-b',
}
const NON_SHEET = '42000000-0000-4000-8000-000000000020'
const A_OPTION = '42000000-0000-4000-8000-000000000101'
const A_OTHER_OPTION = '42000000-0000-4000-8000-000000000102'
const B_OPTION = '42000000-0000-4000-8000-000000000111'
const B_OTHER_OPTION = '42000000-0000-4000-8000-000000000112'

type Sheet = {
  table: {
    id: string
    workspace_id: string
    resource_name: string
    schema_version: number
  }
  columns: Array<{ id: string; field_name: string; logical_type: string }>
}

let migrator: Client
let clientA: Client
let clientB: Client
let apiClient: Client
let sheetA: Sheet
let sheetB: Sheet

async function authenticated(
  prepared: Awaited<ReturnType<typeof prepareTestDatabase>>,
  user: string,
  workspace: string,
) {
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
      ($1,'Isolation A','isolation-a@test.invalid',true),
      ($2,'Isolation B','isolation-b@test.invalid',true)`,
    [A.user, B.user],
  )
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES
      ($1,'scientific-isolation-a','Isolation A'),($2,'scientific-isolation-b','Isolation B')`,
    [A.workspace, B.workspace],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
      ($1,$2,'owner'),($3,$4,'owner')`,
    [A.workspace, A.user, B.workspace, B.user],
  )
  await migrator.query(
    `INSERT INTO api.projects(id,workspace_id,key,title) VALUES
      ($1,$2,'ISA','Isolation A'),($3,$4,'ISB','Isolation B')`,
    [A.project, A.workspace, B.project, B.workspace],
  )
  await migrator.query(
    `INSERT INTO api.records(id,workspace_id,project_id,kind,identifier,title,created_by_user_id) VALUES
      ($1,$2,$3,'experiment','ISA-1','Isolation A',$4),
      ($5,$6,$7,'experiment','ISB-1','Isolation B',$8)`,
    [
      A.record,
      A.workspace,
      A.project,
      A.user,
      B.record,
      B.workspace,
      B.project,
      B.user,
    ],
  )
  await migrator.query(
    `INSERT INTO api.blocks(id,record_id,type,payload,"order",created_by_user_id) VALUES
      ($1,$2,'sheet','{}',1,$3),($4,$5,'sheet','{}',1,$6),
      ($7,$2,'rich_text','{}',2,$3)`,
    [A.block, A.record, A.user, B.block, B.record, B.user, NON_SHEET],
  )
  clientA = await authenticated(prepared, A.user, A.workspace)
  clientB = await authenticated(prepared, B.user, B.workspace)
  const specsA = [
    {
      label: 'Status',
      logical_type: 'category',
      options: [{ id: A_OPTION, label: 'A exact' }],
    },
    {
      label: 'Other status',
      logical_type: 'category',
      options: [{ id: A_OTHER_OPTION, label: 'A other' }],
    },
    { label: 'Amount', logical_type: 'integer' },
  ]
  const specsB = [
    {
      label: 'Status',
      logical_type: 'category',
      options: [{ id: B_OPTION, label: 'B exact' }],
    },
    {
      label: 'Other status',
      logical_type: 'category',
      options: [{ id: B_OTHER_OPTION, label: 'B other' }],
    },
    { label: 'Amount', logical_type: 'integer' },
  ]
  sheetA = (
    await clientA.query(
      `SELECT api.create_scientific_table($1,'A',$2::jsonb) result`,
      [A.block, JSON.stringify(specsA)],
    )
  ).rows[0].result
  sheetB = (
    await clientB.query(
      `SELECT api.create_scientific_table($1,'B',$2::jsonb) result`,
      [B.block, JSON.stringify(specsB)],
    )
  ).rows[0].result
  apiClient = await prepared.asRole('authenticator')
  await apiClient.query('SET ROLE api_client')
  await apiClient.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      role: 'api_client',
      workspace_id: A.workspace,
      credential_id: '42000000-0000-4000-8000-000000000099',
    }),
  ])
})

afterAll(async () =>
  Promise.all([
    migrator?.end(),
    clientA?.end(),
    clientB?.end(),
    apiClient?.end(),
  ]),
)

describe('DATA-002 scientific table workspace isolation', () => {
  it('isolates scientific table, column, and category option metadata under RLS', async () => {
    for (const [client, own, other] of [
      [clientA, A, B],
      [clientB, B, A],
    ] as const) {
      for (const table of [
        'scientific_tables',
        'scientific_columns',
        'scientific_category_options',
      ]) {
        const rows = await client.query(
          `SELECT DISTINCT workspace_id FROM api.${table}`,
        )
        expect(rows.rows).toEqual([{ workspace_id: own.workspace }])
        expect(
          rows.rows.some((row) => row.workspace_id === other.workspace),
        ).toBe(false)
      }
    }
  })

  it('isolates known generated relations and protects workspace and reserved row fields', async () => {
    const ownField = sheetA.columns[2].field_name
    const otherField = sheetB.columns[2].field_name
    const own = await clientA.query(
      `INSERT INTO api.${sheetA.table.resource_name} (${ownField}) VALUES (1) RETURNING id,workspace_id`,
    )
    expect(own.rows[0].workspace_id).toBe(A.workspace)
    expect(
      (await clientA.query(`SELECT * FROM api.${sheetA.table.resource_name}`))
        .rowCount,
    ).toBe(1)
    await clientA.query(
      `UPDATE api.${sheetA.table.resource_name} SET ${ownField}=2 WHERE id=$1`,
      [own.rows[0].id],
    )
    expect(
      (
        await clientA.query(
          `SELECT ${otherField} FROM api.${sheetB.table.resource_name}`,
        )
      ).rows,
    ).toEqual([])
    expect(
      (
        await clientA.query(
          `UPDATE api.${sheetB.table.resource_name} SET ${otherField}=9`,
        )
      ).rowCount,
    ).toBe(0)
    await expect(
      clientA.query(
        `INSERT INTO api.${sheetB.table.resource_name} (${otherField}) VALUES (9)`,
      ),
    ).rejects.toMatchObject({ code: expect.stringMatching(/^(23514|42501)$/) })
    await expect(
      clientA.query(
        `INSERT INTO api.${sheetA.table.resource_name} (workspace_id,${ownField}) VALUES ($1,3)`,
        [B.workspace],
      ),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      clientA.query(
        `UPDATE api.${sheetA.table.resource_name} SET workspace_id=$1 WHERE id=$2`,
        [B.workspace, own.rows[0].id],
      ),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      clientA.query(
        `UPDATE api.${sheetA.table.resource_name} SET id=gen_random_uuid() WHERE id=$1`,
        [own.rows[0].id],
      ),
    ).rejects.toMatchObject({ code: '42501' })
    const check = await migrator.query(
      `SELECT pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid=$1::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%workspace_id%'`,
      [`api.${sheetB.table.resource_name}`],
    )
    expect(check.rows.map((row) => row.definition).join(' ')).toContain(
      B.workspace,
    )
  })

  it('rejects cross-workspace create and all management RPCs with known IDs and versions', async () => {
    await expect(
      clientA.query(`SELECT api.create_scientific_table($1,'stolen','[]')`, [
        B.block,
      ]),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      clientA.query(`SELECT api.add_scientific_column($1,$2,'stolen','text')`, [
        sheetB.table.id,
        sheetB.table.schema_version,
      ]),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      clientA.query(
        `SELECT api.update_scientific_column_display($1,$2,'stolen',1)`,
        [sheetB.columns[0].id, sheetB.table.schema_version],
      ),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      clientA.query(`SELECT api.retire_scientific_column($1,$2)`, [
        sheetB.columns[0].id,
        sheetB.table.schema_version,
      ]),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      clientA.query(`SELECT api.convert_scientific_column($1,$2,'decimal')`, [
        sheetB.columns[2].id,
        sheetB.table.schema_version,
      ]),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('accepts only an active category option from the exact workspace and column', async () => {
    const field = sheetB.columns[0].field_name
    for (const option of [A_OPTION, B_OTHER_OPTION]) {
      await expect(
        clientB.query(
          `INSERT INTO api.${sheetB.table.resource_name} (${field}) VALUES ($1)`,
          [option],
        ),
      ).rejects.toMatchObject({ code: '23514' })
    }
    expect(
      (
        await clientB.query(
          `INSERT INTO api.${sheetB.table.resource_name} (${field}) VALUES ($1) RETURNING ${field} value`,
          [B_OPTION],
        )
      ).rows[0].value,
    ).toBe(B_OPTION)
  })

  it('rejects non-sheet blocks and treats malicious labels and options only as data', async () => {
    await migrator.query(
      `CREATE TABLE api.scientific_isolation_sentinel(value text); INSERT INTO api.scientific_isolation_sentinel VALUES ('safe')`,
    )
    const malicious = `x'); DELETE FROM api.scientific_isolation_sentinel; --`
    await expect(
      clientA.query(`SELECT api.create_scientific_table($1,$2,$3::jsonb)`, [
        NON_SHEET,
        malicious,
        JSON.stringify([
          {
            label: malicious,
            logical_type: 'category',
            options: [{ label: malicious }],
          },
        ]),
      ]),
    ).rejects.toMatchObject({ code: '23514' })
    expect(
      (
        await migrator.query(
          `SELECT value FROM api.scientific_isolation_sentinel`,
        )
      ).rows,
    ).toEqual([{ value: 'safe' }])
    expect(
      (
        await migrator.query(
          `SELECT to_regclass('api.scientific_isolation_sentinel') relation`,
        )
      ).rows[0].relation,
    ).not.toBeNull()
  })

  it('denies api_client metadata, rows, and management RPCs without scientific scopes', async () => {
    for (const table of [
      'scientific_tables',
      'scientific_columns',
      'scientific_category_options',
    ])
      await expect(
        apiClient.query(`SELECT * FROM api.${table}`),
      ).rejects.toMatchObject({ code: '42501' })
    await expect(
      apiClient.query(`SELECT * FROM api.${sheetA.table.resource_name}`),
    ).rejects.toMatchObject({ code: '42501' })
    const calls: Array<[string, unknown[]]> = [
      [`SELECT api.create_scientific_table($1,'x','[]')`, [A.block]],
      [`SELECT api.add_scientific_column($1,1,'x','text')`, [sheetA.table.id]],
      [
        `SELECT api.update_scientific_column_display($1,1,'x',1)`,
        [sheetA.columns[0].id],
      ],
      [`SELECT api.retire_scientific_column($1,1)`, [sheetA.columns[0].id]],
      [
        `SELECT api.convert_scientific_column($1,1,'decimal')`,
        [sheetA.columns[2].id],
      ],
    ]
    for (const [sql, values] of calls)
      await expect(apiClient.query(sql, values)).rejects.toMatchObject({
        code: '42501',
      })
  })

  it('denies authenticated roles direct metadata INSERT, UPDATE, and DELETE', async () => {
    for (const table of [
      'scientific_tables',
      'scientific_columns',
      'scientific_category_options',
    ]) {
      await expect(
        clientA.query(`INSERT INTO api.${table} DEFAULT VALUES`),
      ).rejects.toMatchObject({ code: '42501' })
      await expect(
        clientA.query(`UPDATE api.${table} SET workspace_id=workspace_id`),
      ).rejects.toMatchObject({ code: '42501' })
      await expect(
        clientA.query(`DELETE FROM api.${table}`),
      ).rejects.toMatchObject({ code: '42501' })
    }
  })
})
