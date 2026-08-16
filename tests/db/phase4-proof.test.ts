/** DATA-006 — Phase 4 sheet and formula acceptance proof at the database boundary. */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildPersistedFormulaArtifact, parseFormula } from '#/lib/formula-ir'
import { buildScientificWorkbook } from '#/lib/scientific-workbook'
import { prepareTestDatabase, setActorJwt } from './helpers'

const WS = '74000000-0000-4000-8000-000000000001'
const PROJECT = '74000000-0000-4000-8000-000000000002'
const RECORD = '74000000-0000-4000-8000-000000000003'
const RAW_BLOCK = '74000000-0000-4000-8000-000000000004'
const RESULT_BLOCK = '74000000-0000-4000-8000-000000000005'
const CREDENTIAL = '74000000-0000-4000-8000-000000000006'
const USER = 'phase4-owner'

let migrator: Client
let browser: Client
let external: Client

async function trustedFormula(payload: Record<string, unknown>) {
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
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES ($1,'Phase 4 owner','phase4@test.invalid',true)`,
    [USER],
  )
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ($1,'phase4','Phase 4')`,
    [WS],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES ($1,$2,'owner')`,
    [WS, USER],
  )
  await migrator.query(
    `INSERT INTO api.projects(id,workspace_id,key,title) VALUES ($1,$2,'VS','Virus Stability')`,
    [PROJECT, WS],
  )
  await migrator.query(
    `INSERT INTO api.records(id,workspace_id,project_id,kind,identifier,title,created_by_user_id) VALUES ($1,$2,$3,'experiment','VS-001','Virus Stability',$4)`,
    [RECORD, WS, PROJECT, USER],
  )
  await migrator.query(
    `INSERT INTO api.blocks(id,record_id,type,payload,"order",created_by_user_id) VALUES ($1,$3,'sheet','{}',1,$4),($2,$3,'sheet','{}',2,$4)`,
    [RAW_BLOCK, RESULT_BLOCK, RECORD, USER],
  )
  await migrator.query(
    `INSERT INTO internal.api_credentials(id,workspace_id,display_prefix,secret_hash,name,scopes,created_by_user_id)
       VALUES ($1,$2,'phase4001','unused','Phase 4 external',ARRAY['scientific:read','scientific:write'],$3)`,
    [CREDENTIAL, WS, USER],
  )
  browser = await prepared.asRole('authenticator')
  await browser.query('SET ROLE authenticated')
  await browser.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ role: 'authenticated', sub: USER, workspace_id: WS }),
  ])
  await setActorJwt(migrator, USER, WS)
  external = await prepared.asRole('authenticator')
  await external.query('SET ROLE api_client')
  await external.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      role: 'api_client',
      credential_id: CREDENTIAL,
      workspace_id: WS,
      scopes: ['scientific:read', 'scientific:write'],
    }),
  ])
})

afterAll(async () =>
  Promise.all([migrator?.end(), browser?.end(), external?.end()]),
)

describe('DATA-006 Phase 4 database acceptance proof', () => {
  it('preserves stable scientific and calculation identity through the complete workflow', async () => {
    const raw = (
      await migrator.query(
        `SELECT api.create_scientific_table($1,'Raw stability data',$2::jsonb) result`,
        [
          RAW_BLOCK,
          JSON.stringify([
            {
              label: 'Hours',
              logical_type: 'integer',
              nullable: false,
              validation: { min: 0, max: 168 },
              unit: { code: 'h', symbol: 'h' },
            },
            {
              label: 'Titer',
              logical_type: 'decimal',
              nullable: false,
              validation: { min: 0 },
              unit: { code: 'PFU/mL', symbol: 'PFU/mL' },
            },
            {
              label: 'Projected titer',
              logical_type: 'decimal',
              nullable: true,
              unit: { code: 'PFU/mL', symbol: 'PFU/mL' },
            },
          ]),
        ],
      )
    ).rows[0].result
    const result = (
      await migrator.query(
        `SELECT api.create_scientific_table($1,'Stability summary',$2::jsonb) result`,
        [
          RESULT_BLOCK,
          JSON.stringify([
            {
              label: 'Observed plus projected',
              logical_type: 'decimal',
              nullable: true,
              unit: { code: 'PFU/mL', symbol: 'PFU/mL' },
            },
          ]),
        ],
      )
    ).rows[0].result
    expect(
      (
        await browser.query(
          `SELECT count(*) FROM api.blocks WHERE record_id=$1 AND type='sheet'`,
          [RECORD],
        )
      ).rows[0].count,
    ).toBe('2')

    const imported = (
      await browser.query(
        `SELECT api.import_scientific_rows($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,'reject_file') result`,
        [
          raw.table.id,
          raw.table.schema_version,
          JSON.stringify({
            name: 'virus-stability.csv',
            size: 32,
            sha256: '4'.repeat(64),
            encoding: 'utf-8',
            delimiter: ',',
            header: true,
          }),
          JSON.stringify([
            { source: 'Hours', columnId: raw.columns[0].id },
            { source: 'Titer', columnId: raw.columns[1].id },
          ]),
          JSON.stringify([
            { Hours: 0, Titer: 1000 },
            { Hours: 24, Titer: 800 },
          ]),
        ],
      )
    ).rows[0].result
    expect(imported).toMatchObject({ importedRows: 2 })
    const rawRows = (
      await browser.query(
        `SELECT * FROM api.${raw.table.resource_name} ORDER BY created_at,id`,
      )
    ).rows
    const expectedWithin = Number(rawRows[0][raw.columns[1].field_name]) * 0.8
    const expectedCross =
      Number(rawRows[1][raw.columns[1].field_name]) + expectedWithin
    const resultRow = (
      await browser.query(
        `INSERT INTO api.${result.table.resource_name} DEFAULT VALUES RETURNING *`,
      )
    ).rows[0]
    const maps = [
      {
        tableId: raw.table.id,
        name: raw.table.name,
        rowIds: rawRows.map((row) => row.id),
        columnIds: raw.columns.map((column: { id: string }) => column.id),
      },
      {
        tableId: result.table.id,
        name: result.table.name,
        rowIds: [resultRow.id],
        columnIds: result.columns.map((column: { id: string }) => column.id),
      },
    ]
    const within = buildPersistedFormulaArtifact(
      parseFormula('=B1*0.8', { ...maps[0], tables: maps }),
      raw.table.id,
    )
    const cross = buildPersistedFormulaArtifact(
      parseFormula("='Raw stability data'!B2+'Raw stability data'!C1", {
        ...maps[1],
        tables: maps,
      }),
      result.table.id,
    )
    const withinWrite = await trustedFormula({
      operation: 'create',
      target: {
        tableId: raw.table.id,
        rowId: rawRows[0].id,
        columnId: raw.columns[2].id,
      },
      expectedSchemaVersion: raw.table.schema_version,
      expectedRowVersion: Number(rawRows[0].version),
      artifact: within,
    })
    const crossWrite = await trustedFormula({
      operation: 'create',
      target: {
        tableId: result.table.id,
        rowId: resultRow.id,
        columnId: result.columns[0].id,
      },
      expectedSchemaVersion: result.table.schema_version,
      expectedRowVersion: Number(resultRow.version),
      artifact: cross,
    })
    const workbookTables = [
      {
        id: raw.table.id,
        name: raw.table.name,
        columns: raw.columns.map((column: any) => ({
          id: column.id,
          createdAt: column.created_at,
          logicalType: column.logical_type,
        })),
        rows: rawRows.map((row, index) => ({
          id: row.id,
          createdAt: row.created_at,
          cells: Object.fromEntries(
            raw.columns.map((column: any) => [
              column.id,
              {
                literal: row[column.field_name],
                ...(index === 0 && column.id === raw.columns[2].id
                  ? { formula: within }
                  : {}),
              },
            ]),
          ),
        })),
      },
      {
        id: result.table.id,
        name: result.table.name,
        columns: result.columns.map((column: any) => ({
          id: column.id,
          createdAt: column.created_at,
          logicalType: column.logical_type,
        })),
        rows: [
          {
            id: resultRow.id,
            createdAt: resultRow.created_at,
            cells: { [result.columns[0].id]: { formula: cross } },
          },
        ],
      },
    ]
    const workbook = buildScientificWorkbook(workbookTables)
    expect(
      workbook.get({
        tableId: raw.table.id,
        rowId: rawRows[0].id,
        columnId: raw.columns[2].id,
      }),
    ).toMatchObject({ value: expectedWithin })
    expect(
      workbook.get({
        tableId: result.table.id,
        rowId: resultRow.id,
        columnId: result.columns[0].id,
      }),
    ).toMatchObject({ value: expectedCross })
    workbook.destroy()

    const formulaRows = (
      await migrator.query(
        `SELECT id,version,target_table_id FROM api.formula_definitions ORDER BY target_table_id`,
      )
    ).rows
    const revision = Number(
      (
        await migrator.query(
          `SELECT calculation_input_revision FROM api.records WHERE id=$1`,
          [RECORD],
        )
      ).rows[0].calculation_input_revision,
    )
    await migrator.query('SET ROLE formula_writer')
    await migrator.query(
      `SELECT internal.apply_trusted_calculation($1,$2,$3,'completed',$4::jsonb,$5::jsonb,$6,$7,NULL)`,
      [
        USER,
        RECORD,
        revision,
        JSON.stringify(
          formulaRows.map((formula) => ({
            formulaId: formula.id,
            formulaVersion: Number(formula.version),
            status: 'completed',
            resultKind: 'value',
            value:
              formula.target_table_id === raw.table.id
                ? expectedWithin
                : expectedCross,
          })),
        ),
        JSON.stringify({
          [raw.table.id]: raw.table.schema_version,
          [result.table.id]: result.table.schema_version,
        }),
        'fnv1a32-dcfa915f',
        'fnv1a32-5678abcd',
      ],
    )
    await migrator.query('RESET ROLE')

    const oldField = raw.columns[1].field_name
    await browser.query(
      `SELECT api.update_scientific_column_display($1,$2,'Infectious titer',NULL)`,
      [raw.columns[1].id, raw.table.schema_version],
    )
    expect(
      (
        await browser.query(
          `SELECT field_name FROM api.scientific_columns WHERE id=$1`,
          [raw.columns[1].id],
        )
      ).rows[0].field_name,
    ).toBe(oldField)
    expect(
      (
        await migrator.query(
          `SELECT count(*) FROM api.formula_dependencies WHERE source_column_id=$1`,
          [raw.columns[1].id],
        )
      ).rows[0].count,
    ).toBe('2')

    await expect(
      external.query(
        `UPDATE api.${raw.table.resource_name} SET ${oldField}=700 WHERE id=$1 AND version=$2 RETURNING id`,
        [rawRows[1].id, rawRows[1].version],
      ),
    ).resolves.toMatchObject({ rowCount: 1 })
    expect(
      (
        await browser.query(
          `SELECT calculation_status FROM api.formula_results ORDER BY formula_id`,
        )
      ).rows.every((row) => row.calculation_status === 'stale'),
    ).toBe(true)
    expect(
      (
        await migrator.query(
          `SELECT actor_credential_id FROM api.change_events WHERE entity_uuid=$1 ORDER BY sequence DESC LIMIT 1`,
          [rawRows[1].id],
        )
      ).rows[0].actor_credential_id,
    ).toBe(CREDENTIAL)

    await expect(
      browser.query(
        `UPDATE api.${raw.table.resource_name} SET ${raw.columns[0].field_name}=999 WHERE id=$1`,
        [rawRows[0].id],
      ),
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      browser.query(
        `UPDATE api.${raw.table.resource_name} SET ${oldField}=600 WHERE id=$1 AND version=$2 RETURNING id`,
        [rawRows[1].id, rawRows[1].version],
      ),
    ).resolves.toMatchObject({ rowCount: 0 })

    const cycleRowA = '74000000-0000-4000-8000-000000000101'
    const cycleRowB = '74000000-0000-4000-8000-000000000102'
    const cycleColumnA = '74000000-0000-4000-8000-000000000103'
    const cycleColumnB = '74000000-0000-4000-8000-000000000104'
    const cycleMaps = [
      {
        tableId: raw.table.id,
        name: 'Raw',
        rowIds: [cycleRowA],
        columnIds: [cycleColumnA],
      },
      {
        tableId: result.table.id,
        name: 'Summary',
        rowIds: [cycleRowB],
        columnIds: [cycleColumnB],
      },
    ]
    const cycleA = buildPersistedFormulaArtifact(
      parseFormula('=Summary!A1+1', { ...cycleMaps[0], tables: cycleMaps }),
      raw.table.id,
    )
    const cycleB = buildPersistedFormulaArtifact(
      parseFormula('=Raw!A1+1', { ...cycleMaps[1], tables: cycleMaps }),
      result.table.id,
    )
    const cycle = buildScientificWorkbook([
      {
        id: raw.table.id,
        name: 'Raw',
        columns: [
          {
            id: cycleColumnA,
            createdAt: '2024-01-01',
            logicalType: 'decimal',
          },
        ],
        rows: [
          {
            id: cycleRowA,
            createdAt: '2024-01-01',
            cells: { [cycleColumnA]: { formula: cycleA } },
          },
        ],
      },
      {
        id: result.table.id,
        name: 'Summary',
        columns: [
          {
            id: cycleColumnB,
            createdAt: '2024-01-01',
            logicalType: 'decimal',
          },
        ],
        rows: [
          {
            id: cycleRowB,
            createdAt: '2024-01-01',
            cells: { [cycleColumnB]: { formula: cycleB } },
          },
        ],
      },
    ])
    expect(
      cycle.get({
        tableId: raw.table.id,
        rowId: cycleRowA,
        columnId: cycleColumnA,
      }),
    ).toMatchObject({ status: 'error', error: 'CYCLE' })
    cycle.destroy()
    expect(withinWrite.formulaId).toBeTruthy()
    expect(crossWrite.formulaId).toBeTruthy()
  })
})
