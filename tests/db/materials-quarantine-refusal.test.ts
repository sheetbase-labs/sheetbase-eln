/**
 * LAB-04 — a quarantined material cannot be referenced as used.
 *
 * Quarantine is the QC gate that stops a lot being used, so a materials block
 * refuses a quarantined sample or reagent while an available one is accepted.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000ce00'
const PROJECT = '00000000-0000-4000-8000-00000000ce01'
const USER = 'lab04-owner'

let migrator: Client
let actor: Client
const clients: Client[] = []

beforeAll(async () => {
  const prepared = await prepareTestDatabase()
  migrator = prepared.migrator
  actor = await prepared.asRole('authenticator')
  clients.push(actor)
  await actor.query('set role authenticated')
  await actor.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ role: 'authenticated', sub: USER, workspace_id: WS }),
  ])

  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
    [USER, `${USER}@test.invalid`],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'lab04','LAB-04')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$2,'owner')`,
    [WS, USER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values($1,$2,'L04','Materials',$3)`,
    [PROJECT, WS, USER],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function record(kind: string, identifier: string, status: string) {
  const { rows } = await migrator.query<{ id: string }>(
    `insert into api.records(workspace_id,project_id,kind,identifier,title,status,created_by_user_id)
     values($1,$2,$3,$4,$4,$5,$6) returning id`,
    [WS, PROJECT, kind, identifier, status, USER],
  )
  return rows[0]!.id
}

async function experiment() {
  return record('experiment', `EXP-${crypto.randomUUID().slice(0, 8)}`, 'draft')
}

async function materialBlock(
  recordId: string,
  target: { id: string; kind: string; identifier: string },
) {
  return actor.query(
    `insert into api.blocks(record_id,type,payload,"order",created_by_user_id)
     values($1,'materials',$2::jsonb,1,$3)`,
    [
      recordId,
      JSON.stringify({
        items: [
          {
            id: crypto.randomUUID(),
            materialRecordId: target.id,
            kind: target.kind,
            identifier: target.identifier,
            title: target.identifier,
            quantity: 1,
            unit: { code: 'mL', symbol: 'mL' },
            observedAt: new Date().toISOString(),
          },
        ],
      }),
      USER,
    ],
  )
}

describe('LAB-04 quarantined material refusal', () => {
  it('accepts an available material and refuses a quarantined one', async () => {
    const sample = await record('sample', 'SMP-L04-A', 'available')
    const run = await experiment()
    await expect(
      materialBlock(run, {
        id: sample,
        kind: 'sample',
        identifier: 'SMP-L04-A',
      }),
    ).resolves.toBeDefined()

    await actor.query(
      `update api.records set status='quarantined' where id=$1`,
      [sample],
    )
    const other = await experiment()
    await expectDenied(
      materialBlock(other, {
        id: sample,
        kind: 'sample',
        identifier: 'SMP-L04-A',
      }),
      'SB120',
    )
  })

  it('accepts the material again once it is released from quarantine', async () => {
    const reagent = await record('reagent', 'RGT-L04-B', 'quarantined')
    const blocked = await experiment()
    await expectDenied(
      materialBlock(blocked, {
        id: reagent,
        kind: 'reagent',
        identifier: 'RGT-L04-B',
      }),
      'SB120',
    )
    await actor.query(`update api.records set status='available' where id=$1`, [
      reagent,
    ])
    const allowed = await experiment()
    await expect(
      materialBlock(allowed, {
        id: reagent,
        kind: 'reagent',
        identifier: 'RGT-L04-B',
      }),
    ).resolves.toBeDefined()
  })
})
