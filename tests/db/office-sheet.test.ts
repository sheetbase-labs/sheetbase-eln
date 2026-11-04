/**
 * A worksheet of an attached Excel file becomes a sheet the database accepts
 * and can sit in a notebook as a sheet block.
 */
import { readFileSync } from 'node:fs'
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  buildSheetState,
  readOfficeSheets,
  XLSX_MEDIA_TYPE,
} from '../../src/lib/office-sheet'
import { prepareTestDatabase } from './helpers'

const WS = '22b00000-0000-4000-8000-000000000001'
const OWNER = 'office-sheet-owner'

let migrator: Client
let owner: Client

beforeAll(async () => {
  const database = await prepareTestDatabase()
  migrator = database.migrator
  owner = await database.asRole('authenticator')
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values($1,'Owner','office-sheet@test.invalid',true)`,
    [OWNER],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'office-sheet','Office sheet')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$2,'owner')`,
    [WS, OWNER],
  )
  await owner.query('set role authenticated')
  await owner.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: OWNER, workspace_id: WS, role: 'authenticated' }),
  ])
})

afterAll(async () => {
  await owner?.end()
  await migrator?.end()
})

describe('a sheet made from an Excel worksheet', () => {
  it('is accepted by the database and sits in the notebook as a sheet block', async () => {
    const [sheet] = readOfficeSheets(
      new Uint8Array(readFileSync('tests/fixtures/office/titration.xlsx')),
      XLSX_MEDIA_TYPE,
    )
    const made = buildSheetState(sheet)
    expect(made.formulaColumns.map((c) => c.label)).toEqual([
      'Result',
      'Total check',
    ])
    const { rows: records } = await migrator.query<{ id: string }>(
      `insert into api.records(workspace_id,kind,identifier,title,status,created_by_user_id)
       values($1,'experiment','OS-EXP-1','Titration run','in_progress',$2) returning id`,
      [WS, OWNER],
    )
    const recordId = records[0].id

    const created = (
      await owner.query(
        `select to_jsonb(api.create_sheet_instance($1,'Titration',$2,null,null,$3,$4::jsonb)) result`,
        [
          WS,
          'From titration.xlsx, sheet Titration',
          recordId,
          JSON.stringify(made.state),
        ],
      )
    ).rows[0].result
    expect(Object.keys(created.state.localValues)).toHaveLength(30)
    expect(created.state.localFields).toHaveLength(7)
    const result = created.state.localFields.find(
      (f: { label: string }) => f.label === 'Result',
    )
    const results = (
      Object.values(created.state.localValues) as Array<Record<string, number>>
    )
      .map((row) => row[result.fieldId])
      .sort((x, y) => x - y)
    expect(results[0]).toBe(4.3)
    expect(results).toHaveLength(30)

    const inserted = (
      await owner.query(
        `select api.insert_sheet_instance_block($1,null,null,$2) result`,
        [recordId, created.id],
      )
    ).rows[0].result
    expect(inserted.block.type).toBe('sheet')
    expect(inserted.block.payload.instanceId).toBe(created.id)
  })
})
