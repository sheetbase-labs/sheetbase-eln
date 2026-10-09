/**
 * DSYS-05.4 — working sheets and saved analyses get stable per-workspace
 * SHT-nnnn / AN-nnnn display ids, assigned on insert and immutable afterwards.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000120a'
const OWNER = 'sa-display-owner'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

const state = () => ({
  bindings: [],
  localFields: [],
  localValues: {},
  calculationOverrides: {},
  presentation: {
    columnOrder: [],
    hiddenColumnIds: [],
    columnWidths: {},
    frozenColumnCount: 0,
    density: 'standard',
  },
  provenance: { createdFrom: 'blank' },
})

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values ($1,'Owner','sa-display@test.invalid',true)`,
    [OWNER],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'sad-ws','SA display WS')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values ($1,$2,'owner')`,
    [WS, OWNER],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function actor() {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      sub: OWNER,
      workspace_id: WS,
      role: 'authenticated',
    }),
  ])
  return client
}

async function insertSheet(client: Client, name: string) {
  const { rows } = await client.query<{ display_id: string }>(
    `select (api.create_sheet_instance($1,$2,null,null,null,null,$3::jsonb)).display_id`,
    [WS, name, JSON.stringify(state())],
  )
  return rows[0]!.display_id
}

async function insertAnalysis(name: string, displayId: string | null) {
  const { rows } = await migrator.query<{ display_id: string }>(
    `INSERT INTO api.analysis_views (workspace_id, owner_user_id, name, spec, display_id)
     VALUES ($1, $2, $3, '{}'::jsonb, $4) RETURNING display_id`,
    [WS, OWNER, name, displayId],
  )
  return rows[0]!.display_id
}

describe('sheet display id', () => {
  it('assigns sequential SHT-nnnn ids on insert', async () => {
    const client = await actor()
    expect(await insertSheet(client, 'First sheet')).toBe('SHT-0001')
    expect(await insertSheet(client, 'Second sheet')).toBe('SHT-0002')
  })

  it('is immutable', async () => {
    const client = await actor()
    const id = await insertSheet(client, 'Immutable sheet')
    // Direct updates are already blocked by the controlled-RPC guard; the
    // prevent-change trigger keeps the id stable for RPC-driven updates too.
    await expect(
      migrator.query(
        `UPDATE api.sheet_instances SET display_id = 'SHT-9999' WHERE display_id = $1`,
        [id],
      ),
    ).rejects.toThrow()
  })
})

describe('analysis display id', () => {
  it('assigns sequential AN-nnnn ids on insert', async () => {
    expect(await insertAnalysis('First analysis', null)).toBe('AN-0001')
    expect(await insertAnalysis('Second analysis', null)).toBe('AN-0002')
  })

  it('is immutable', async () => {
    const id = await insertAnalysis('Immutable analysis', null)
    await expect(
      migrator.query(
        `UPDATE api.analysis_views SET display_id = 'AN-9999' WHERE display_id = $1`,
        [id],
      ),
    ).rejects.toMatchObject({ code: 'SB072' })
  })
})
