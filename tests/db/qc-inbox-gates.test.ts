/**
 * Quality control in the Inbox and in gates (migration qc_inbox_and_gates): a
 * series that is out of range with a breach nobody has looked at shows in the
 * Inbox of the person who tracks it and of the instrument's owner, and holds a
 * gate that waits on quality control.
 * Runs against a freshly migrated sheetbase_test database.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000fd01'
const PROJECT = '00000000-0000-4000-8000-00000000fd11'
const INSTRUMENT = '00000000-0000-4000-8000-00000000fd21'
const OWNER = 'qi-owner'
const MAKER = 'qi-maker'
const OTHER = 'qi-other'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let owner: Client
let maker: Client
let other: Client

async function actor(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      sub: userId,
      workspace_id: WS,
      role: 'authenticated',
    }),
  ])
  return client
}

async function newSeries(client: Client, name: string) {
  const { rows } = await client.query(
    `select * from api.create_qc_series($1,$2,'manual',null,null,$3,'RFU',100,2)`,
    [WS, name, INSTRUMENT],
  )
  return rows[0] as { id: string }
}

async function point(client: Client, seriesId: string, value: number) {
  const { rows } = await client.query(
    `select * from api.record_qc_point($1,$2,$3)`,
    [seriesId, value, new Date().toISOString()],
  )
  return rows[0] as { id: string; violations: string[] }
}

async function inbox(client: Client) {
  const { rows } = await client.query(
    `select kind, title, reason, source_type, source_id, inbox_type
       from api.inbox_work_items where kind = 'qc_violation' order by title`,
  )
  return rows as Array<{
    title: string
    reason: string
    source_type: string
    source_id: string
    inbox_type: string
  }>
}

async function experimentWithGate(
  title: string,
  condition: Record<string, unknown>,
) {
  const { rows } = await owner.query(
    `select id from api.create_record($1::uuid,'experiment',$2)`,
    [PROJECT, title],
  )
  const recordId = rows[0].id as string
  await owner.query(
    `select api.insert_block($1,'gate',$2::jsonb,1,null) as result`,
    [recordId, JSON.stringify({ mode: 'block', conditions: [condition] })],
  )
  return recordId
}

async function gate(recordId: string) {
  const { rows } = await owner.query(`select * from api.record_gates($1)`, [
    recordId,
  ])
  return rows[0] as { met: boolean; blocking: boolean; missing: string[] }
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [OWNER, MAKER, OTHER]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values ($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'qi','Quality inbox')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values ($1,$2,'owner'),($1,$3,'owner'),($1,$4,'owner')`,
    [WS, OWNER, MAKER, OTHER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values ($1,$2,'qi','Quality',$3)`,
    [PROJECT, WS, OWNER],
  )
  await migrator.query(
    `insert into api.instruments(id,workspace_id,name,owner_id) values ($1,$2,'Plate reader 9',$3)`,
    [INSTRUMENT, WS, OWNER],
  )
  owner = await actor(OWNER)
  maker = await actor(MAKER)
  other = await actor(OTHER)
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('the Inbox', () => {
  it('shows an out-of-range series to whoever tracks it and the instrument owner, until it is looked at', async () => {
    const a = await newSeries(maker, 'Lamp A')
    const b = await newSeries(maker, 'Lamp B')
    expect(await inbox(owner)).toEqual([])
    const bad = await point(maker, a.id, 108)
    expect(bad.violations).toEqual(['1-3s'])
    await point(maker, b.id, 109)

    const mine = await inbox(maker)
    // One item for the instrument, naming both series and the rule.
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({
      title: 'Plate reader 9',
      source_type: 'instrument',
      source_id: INSTRUMENT,
      inbox_type: 'lab',
    })
    expect(mine[0]!.reason).toBe('Lamp A: 1-3s; Lamp B: 1-3s')
    expect(await inbox(owner)).toHaveLength(1)
    expect(await inbox(other)).toEqual([])

    await maker.query(`select api.acknowledge_qc_point($1,'Lamp changed')`, [
      bad.id,
    ])
    const after = await inbox(maker)
    expect(after[0]!.reason).toBe('Lamp B: 1-3s')
  })

  it('goes once every breach is acknowledged or the series is back in range, and when muted', async () => {
    const s = await newSeries(maker, 'Gain')
    const bad = await point(maker, s.id, 110)
    expect((await inbox(maker)).some((i) => i.reason.includes('Gain'))).toBe(
      true,
    )
    await point(maker, s.id, 100)
    expect((await inbox(maker)).some((i) => i.reason.includes('Gain'))).toBe(
      false,
    )
    // The old breach is still open but the series recovered; acknowledging it is harmless.
    await maker.query(`select api.acknowledge_qc_point($1)`, [bad.id])

    const t = await newSeries(maker, 'Noise')
    await point(maker, t.id, 111)
    expect((await inbox(maker)).length).toBeGreaterThan(0)
    await maker.query(
      `select api.save_notification_preference('qc_violation', false, false, false)`,
    )
    expect(await inbox(maker)).toEqual([])
  })
})

describe('gates', () => {
  it('holds work while a tracked series has a breach nobody has looked at', async () => {
    const s = await newSeries(owner, 'Gate series')
    const recordId = await experimentWithGate('Waits on QC', {
      kind: 'qc_in_control',
      seriesId: s.id,
    })
    expect(await gate(recordId)).toMatchObject({ met: true, blocking: false })
    const bad = await point(owner, s.id, 112)
    expect(await gate(recordId)).toMatchObject({
      met: false,
      blocking: true,
      missing: ['Quality control is out of range: Gate series (1-3s)'],
    })
    await owner.query(`select api.acknowledge_qc_point($1,'Re-run done')`, [
      bad.id,
    ])
    expect(await gate(recordId)).toMatchObject({ met: true, blocking: false })
  })

  it('covers every series when none is named, and ignores a series that is in range', async () => {
    const recordId = await experimentWithGate('Waits on any QC', {
      kind: 'qc_in_control',
    })
    const s = await newSeries(owner, 'Any series')
    await point(owner, s.id, 100)
    const before = await gate(recordId)
    const bad = await point(owner, s.id, 113)
    const held = await gate(recordId)
    expect(held.blocking).toBe(true)
    expect(held.missing[0]).toContain('Any series (1-3s)')
    expect(before.missing.join()).not.toContain('Any series')
    await point(owner, s.id, 100)
    await owner.query(`select api.acknowledge_qc_point($1)`, [bad.id])
    expect((await gate(recordId)).missing.join().includes('Any series')).toBe(
      false,
    )
  })

  it('refuses a series id that is not an id', async () => {
    await expect(
      experimentWithGate('Bad id', {
        kind: 'qc_in_control',
        seriesId: 'not-a-uuid',
      }),
    ).rejects.toBeTruthy()
  })
})
