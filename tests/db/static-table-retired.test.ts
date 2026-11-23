/**
 * The static table block is retired (migration retire_static_table_block):
 * a table is an ad hoc sheet. Asking for a table block is refused, a grid
 * becomes a sheet with the same columns and rows, and the sheet of an approved or
 * finished notebook cannot be edited.
 * Runs against a freshly migrated sheetbase_test database.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000fd01'
const PROJECT = '00000000-0000-4000-8000-00000000fd11'
const OWNER = 'st-owner'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
let owner: Client

async function experiment(title: string): Promise<string> {
  const { rows } = await owner.query(
    `select id from api.create_record($1::uuid,'experiment',$2)`,
    [PROJECT, title],
  )

  return rows[0].id as string
}

async function sheetFor(recordId: string, grid: unknown) {
  const { rows } = await migrator.query(
    `select internal.grid_to_sheet_instance($1,$2::jsonb,$3,$4) as id`,
    [recordId, JSON.stringify(grid), crypto.randomUUID(), OWNER],
  )

  const instanceId = rows[0].id as string

  await owner.query(`select api.insert_block($1,'sheet',$2::jsonb,1,null)`, [
    recordId,
    JSON.stringify({ instanceId }),
  ])

  return instanceId
}

async function stateOf(instanceId: string) {
  const { rows } = await migrator.query(
    `select revision, state from api.sheet_instances where id=$1`,
    [instanceId],
  )

  return rows[0] as {
    revision: string
    state: {
      localFields: Array<{
        fieldId: string
        label: string
        logicalType: string
      }>
      localValues: Record<string, Record<string, unknown>>
    }
  }
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values ($1,$1,$2,true)`,
    [OWNER, `${OWNER}@test.invalid`],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'st','Static tables')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values ($1,$2,'owner')`,
    [WS, OWNER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values ($1,$2,'st','Tables',$3)`,
    [PROJECT, WS, OWNER],
  )
  owner = await asRole('authenticator')
  await owner.query('SET ROLE authenticated')
  await owner.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: OWNER, workspace_id: WS, role: 'authenticated' }),
  ])
})

afterAll(async () => {
  await owner?.end()
  await migrator?.end()
})

describe('the retired static table block', () => {
  it('is refused when a person, token or agent asks for one', async () => {
    const recordId = await experiment('No tables')

    await expect(
      owner.query(`select api.insert_block($1,'table',$2::jsonb,1,null)`, [
        recordId,
        JSON.stringify({ columns: ['A'], rows: [['1']] }),
      ]),
    ).rejects.toMatchObject({ code: '22023' })
  })

  it('becomes a sheet with the same columns and rows', async () => {
    const recordId = await experiment('A grid')

    const instanceId = await sheetFor(recordId, {
      columns: ['Day', 'Titre (e9)', 'Note', 'Batch'],
      rows: [
        [0, '2.80', 'ok', '007'],
        [7, '2.5', '', '010'],
        ['14', '', 'late', 'x'],
      ],
    })

    const { state } = await stateOf(instanceId)

    // Whole numbers and exact decimals become numbers; anything that would
    // not read back as written (leading zeros, text) stays text.
    expect(state.localFields.map((f) => [f.label, f.logicalType])).toEqual([
      ['Day', 'integer'],
      ['Titre (e9)', 'decimal'],
      ['Note', 'text'],
      ['Batch', 'text'],
    ])

    const [day, titre, note, batch] = state.localFields.map((f) => f.fieldId)

    const rows = Object.entries(state.localValues)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, row]) => row)

    expect(rows).toEqual([
      { [day]: 0, [titre]: 2.8, [note]: 'ok', [batch]: '007' },
      { [day]: 7, [titre]: 2.5, [batch]: '010' },
      { [day]: 14, [note]: 'late', [batch]: 'x' },
    ])
  })
})
