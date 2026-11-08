/**
 * A gate that waits on a plugin check (migration plugin_check_gates): the app
 * runs the check and keeps the answer; the gate reads it, and it counts only
 * while the table is unchanged. Nobody can write an answer from the API.
 * Runs against a freshly migrated sheetbase_test database.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000fe01'
const PROJECT = '00000000-0000-4000-8000-00000000fe11'
const OWNER = 'pc-owner'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
let owner: Client

async function setUpExperiment(title: string) {
  const { rows } = await owner.query(
    `select id from api.create_record($1::uuid,'experiment',$2)`,
    [PROJECT, title],
  )
  const recordId = rows[0].id as string
  const table = (
    await owner.query(
      `select api.insert_block($1,'table',$2::jsonb,1,null) as result`,
      [
        recordId,
        JSON.stringify({
          title: 'Readings',
          columns: ['Sample', 'Value'],
          rows: [['A', '1']],
        }),
      ],
    )
  ).rows[0].result.block as { id: string; version: number }
  const condition = {
    kind: 'plugin_check',
    blockId: table.id,
    extensionKey: 'bench-extras',
    checkId: 'range',
    label: 'Range check',
    columns: { value: 'Value' },
  }
  await owner.query(
    `select api.insert_block($1,'gate',$2::jsonb,2,null) as result`,
    [recordId, JSON.stringify({ mode: 'block', conditions: [condition] })],
  )
  return { recordId, table }
}

async function gate(recordId: string) {
  const { rows } = await owner.query(`select * from api.record_gates($1)`, [
    recordId,
  ])
  return rows[0] as { met: boolean; blocking: boolean; missing: string[] }
}

async function record(
  recordId: string,
  blockId: string,
  status: string,
  message = '',
) {
  await migrator.query(
    `select internal.record_gate_check($1,$2,'bench-extras','range',$3,$4,$5)`,
    [recordId, blockId, status, message, OWNER],
  )
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values ($1,$1,$2,true)`,
    [OWNER, `${OWNER}@test.invalid`],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'pc','Plugin checks')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values ($1,$2,'owner')`,
    [WS, OWNER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values ($1,$2,'pc','Checks',$3)`,
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

describe('plugin check gates', () => {
  it('waits for a run, passes on a pass, holds on a fail', async () => {
    const { recordId, table } = await setUpExperiment('Needs a check')
    expect(await gate(recordId)).toMatchObject({
      met: false,
      blocking: true,
      missing: ['Range check has not been run yet'],
    })
    await record(recordId, table.id, 'fail', 'Sample A is out of range')
    expect((await gate(recordId)).missing).toEqual([
      'Range check failed: Sample A is out of range',
    ])
    await record(recordId, table.id, 'pass')
    expect(await gate(recordId)).toMatchObject({ met: true, blocking: false })
    await record(recordId, table.id, 'warn', 'Close to the limit')
    expect((await gate(recordId)).met).toBe(true)
  })

  it('asks for a fresh run once the table has changed', async () => {
    const { recordId, table } = await setUpExperiment('Table edited')
    await record(recordId, table.id, 'pass')
    expect((await gate(recordId)).met).toBe(true)
    await owner.query(`select api.update_block_payload($1,$2::jsonb,$3)`, [
      table.id,
      JSON.stringify({
        title: 'Readings',
        columns: ['Sample', 'Value'],
        rows: [
          ['A', '1'],
          ['B', '99'],
        ],
      }),
      table.version,
    ])
    expect((await gate(recordId)).missing).toEqual([
      'Range check was run before the table changed. Run it again',
    ])
  })

  it('cannot be answered from the API', async () => {
    const { recordId, table } = await setUpExperiment('No typing pass')
    await expect(
      owner.query(
        `select internal.record_gate_check($1,$2,'bench-extras','range','pass','',$3)`,
        [recordId, table.id, OWNER],
      ),
    ).rejects.toBeTruthy()
    await expect(
      owner.query(
        `insert into api.gate_check_results(record_id,block_id,workspace_id,extension_key,check_id,status,table_hash)
         values ($1,$2,$3,'bench-extras','range','pass','x')`,
        [recordId, table.id, WS],
      ),
    ).rejects.toBeTruthy()
  })

  it('refuses a condition that is not shaped right', async () => {
    const { rows } = await owner.query(
      `select id from api.create_record($1::uuid,'experiment','Bad shape')`,
      [PROJECT],
    )
    await expect(
      owner.query(`select api.insert_block($1,'gate',$2::jsonb,1,null)`, [
        rows[0].id,
        JSON.stringify({
          mode: 'block',
          conditions: [{ kind: 'plugin_check', blockId: 'nope' }],
        }),
      ]),
    ).rejects.toBeTruthy()
  })
})
