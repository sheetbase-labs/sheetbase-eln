import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '72000000-0000-4000-8000-000000000001'
const PROJECT = '72000000-0000-4000-8000-000000000002'
const RECORD = '72000000-0000-4000-8000-000000000003'
const BLOCK = '72000000-0000-4000-8000-000000000004'
const USER = 'formula-owner'
let migrator: Client
let auth: Client
let table: { id: string; resource_name: string; schema_version: number }
let columns: Array<{ id: string; field_name: string }>
let rows: Array<{ id: string; version: string }>

const artifact = (sourceRow: string, sourceColumn: string) => ({
  version: 1,
  syntaxProfile: 'sheetbase-hf-en-us-v1',
  functionProfile: 'scientific-core-v1',
  literalProfile: 'sheetbase-literal-v1',
  engineVersion: '3.3.0',
  status: 'supported',
  source: '=A1',
  template: { kind: 'reference', slot: 0 },
  bindings: [
    {
      kind: 'range',
      slot: 0,
      members: [[{ rowId: sourceRow, columnId: sourceColumn }]],
      start: { columnAbsolute: false, rowAbsolute: false },
      end: { columnAbsolute: false, rowAbsolute: false },
    },
  ],
  engineExpression: '=A1',
  dependencies: [
    { tableId: table.id, rowId: sourceRow, columnId: sourceColumn },
  ],
})

async function write(payload: Record<string, unknown>) {
  await migrator.query('SET ROLE formula_writer')
  try {
    return (
      await migrator.query(
        `SELECT internal.apply_trusted_formula_write($1,$2::jsonb) result`,
        [USER, JSON.stringify(payload)],
      )
    ).rows[0].result
  } finally {
    await migrator.query('RESET ROLE')
  }
}

beforeAll(async () => {
  const prepared = await prepareTestDatabase()
  migrator = prepared.migrator
  await migrator.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES ($1,'Formula owner','formula@test.invalid',true)`,
    [USER],
  )
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ($1,'formula','Formula')`,
    [WS],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES ($1,$2,'owner')`,
    [WS, USER],
  )
  await migrator.query(
    `INSERT INTO api.projects(id,workspace_id,key,title) VALUES ($1,$2,'CALC','Calc')`,
    [PROJECT, WS],
  )
  await migrator.query(
    `INSERT INTO api.records(id,workspace_id,project_id,kind,identifier,title,created_by_user_id) VALUES ($1,$2,$3,'experiment','CALC-2','Formula',$4)`,
    [RECORD, WS, PROJECT, USER],
  )
  await migrator.query(
    `INSERT INTO api.blocks(id,record_id,type,payload,"order",created_by_user_id) VALUES ($1,$2,'sheet','{}',1,$3)`,
    [BLOCK, RECORD, USER],
  )
  auth = await prepared.asRole('authenticator')
  await auth.query('SET ROLE authenticated')
  await auth.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ role: 'authenticated', sub: USER, workspace_id: WS }),
  ])
  const made = (
    await auth.query(
      `SELECT api.create_scientific_table($1,'Formula table',$2::jsonb) result`,
      [
        BLOCK,
        JSON.stringify([
          {
            label: 'Required source',
            logical_type: 'decimal',
            nullable: false,
            default: 1,
          },
          {
            label: 'Required target',
            logical_type: 'decimal',
            nullable: false,
            default: 0,
          },
        ]),
      ],
    )
  ).rows[0].result
  table = made.table
  columns = made.columns
  rows = (
    await auth.query(
      `INSERT INTO api.${table.resource_name} (${columns[0].field_name}) VALUES (2),(3) RETURNING id,version`,
    )
  ).rows
})

afterAll(async () => Promise.all([migrator?.end(), auth?.end()]))

describe('CALC-002 formula persistence', () => {
  it('derives nested range dependencies exactly and supports required targets', async () => {
    const before = BigInt(
      (
        await migrator.query(
          `SELECT calculation_input_revision FROM api.records WHERE id=$1`,
          [RECORD],
        )
      ).rows[0].calculation_input_revision,
    )
    const payload = {
      operation: 'create',
      target: { tableId: table.id, rowId: rows[1].id, columnId: columns[1].id },
      expectedSchemaVersion: table.schema_version,
      expectedRowVersion: Number(rows[1].version),
      artifact: artifact(rows[0].id, columns[0].id),
    }
    await expect(
      write({
        ...payload,
        artifact: { ...payload.artifact, dependencies: [] },
      }),
    ).rejects.toMatchObject({ code: '23514' })
    const result = await write(payload)
    expect(result).toMatchObject({ version: 1, rowVersion: 2 })
    const persisted = await migrator.query(
      `SELECT (SELECT count(*) FROM api.formula_dependencies) dependencies,(SELECT calculation_input_revision FROM api.records WHERE id=$1) revision,(SELECT count(*) FROM api.change_events WHERE entity_type='formula' AND actor_user_id=$2) formulas,(SELECT count(*) FROM api.change_events WHERE entity_type='scientific_row' AND actor_user_id=$2 AND entity_uuid=$3 AND operation='update') rows`,
      [RECORD, USER, rows[1].id],
    )
    expect(persisted.rows[0]).toMatchObject({
      dependencies: '1',
      revision: (before + 1n).toString(),
      formulas: '1',
      rows: '1',
    })
    rows[1].version = '2'
  })

  it('protects source rows and columns, while ordinary row writes still work', async () => {
    await expect(
      auth.query(`DELETE FROM api.${table.resource_name} WHERE id=$1`, [
        rows[0].id,
      ]),
    ).rejects.toMatchObject({ code: '23514' })
    const sourceEvidence = (
      await auth.query(
        `SELECT api.retire_scientific_column($1,$2,NULL) result`,
        [columns[0].id, table.schema_version],
      )
    ).rows[0].result
    await expect(
      auth.query(`SELECT api.retire_scientific_column($1,$2,$3)`, [
        columns[0].id,
        table.schema_version,
        sourceEvidence.hash,
      ]),
    ).rejects.toMatchObject({ code: '23514' })
    const targetEvidence = (
      await auth.query(
        `SELECT api.retire_scientific_column($1,$2,NULL) result`,
        [columns[1].id, table.schema_version],
      )
    ).rows[0].result
    await expect(
      auth.query(`SELECT api.retire_scientific_column($1,$2,$3)`, [
        columns[1].id,
        table.schema_version,
        targetEvidence.hash,
      ]),
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      auth.query(
        `UPDATE api.${table.resource_name} SET ${columns[0].field_name}=9 WHERE id=$1`,
        [rows[0].id],
      ),
    ).resolves.toBeDefined()
  })

  it('updates and removes once each and does not deadlock against direct REST row writes', async () => {
    const formula = (
      await migrator.query(`SELECT id,version FROM api.formula_definitions`)
    ).rows[0]
    const updated = await write({
      operation: 'update',
      target: { tableId: table.id, rowId: rows[1].id, columnId: columns[1].id },
      expectedSchemaVersion: table.schema_version,
      expectedRowVersion: 2,
      expectedFormulaVersion: Number(formula.version),
      artifact: artifact(rows[0].id, columns[0].id),
    })
    expect(updated).toMatchObject({ version: 2, rowVersion: 3 })

    await auth.query('BEGIN')
    await auth.query(
      `UPDATE api.${table.resource_name} SET ${columns[0].field_name}=10 WHERE id=$1`,
      [rows[0].id],
    )
    const pending = write({
      operation: 'remove',
      target: { tableId: table.id, rowId: rows[1].id, columnId: columns[1].id },
      expectedSchemaVersion: table.schema_version,
      expectedRowVersion: 3,
      expectedFormulaVersion: 2,
      replacement: 7,
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
    await auth.query('COMMIT')
    await expect(pending).resolves.toMatchObject({
      removed: true,
      rowVersion: 4,
    })
    const counts = (
      await migrator.query(
        `SELECT calculation_input_revision revision,(SELECT count(*) FROM api.change_events WHERE entity_type='formula') formulas FROM api.records WHERE id=$1`,
        [RECORD],
      )
    ).rows[0]
    expect(counts.formulas).toBe('3')

    const evidence = (
      await auth.query(
        `SELECT api.retire_scientific_column($1,$2,NULL) result`,
        [columns[1].id, table.schema_version],
      )
    ).rows[0].result
    await expect(
      auth.query(`SELECT api.retire_scientific_column($1,$2,$3)`, [
        columns[1].id,
        table.schema_version,
        evidence.hash,
      ]),
    ).resolves.toBeDefined()
  })
})
