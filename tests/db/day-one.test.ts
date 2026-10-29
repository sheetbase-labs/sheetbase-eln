/**
 * Day one: joining a lab by email domain, the first admin's setup, starter
 * tables, and making a table from the columns of a file.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-0000000d0e01'
const WS_OTHER = '00000000-0000-4000-8000-0000000d0e02'
const OWNER = 'day-one-owner'
const SCIENTIST = 'day-one-scientist'
const NEWCOMER = 'day-one-newcomer'
const UNVERIFIED = 'day-one-unverified'
const OTHER_OWNER = 'day-one-other-owner'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(userId: string, workspaceId: string) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      sub: userId,
      workspace_id: workspaceId,
      role: 'authenticated',
    }),
  ])
  return client
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(`
    insert into internal."user"(id,name,email,"emailVerified") values
      ('${OWNER}','Owner','owner@dayone-lab.test',true),
      ('${SCIENTIST}','Scientist','sci@dayone-lab.test',true),
      ('${NEWCOMER}','Newcomer','new@dayone-lab.test',true),
      ('${UNVERIFIED}','Unverified','unv@dayone-lab.test',false),
      ('${OTHER_OWNER}','Other','other@elsewhere.test',true);
    insert into api.workspaces(id,slug,name) values
      ('${WS}','day-one-a','Day one lab'),
      ('${WS_OTHER}','day-one-b','Elsewhere');
    insert into api.workspace_memberships(workspace_id,user_id,role) values
      ('${WS}','${OWNER}','owner'),
      ('${WS}','${SCIENTIST}','scientist'),
      ('${WS_OTHER}','${OTHER_OWNER}','owner')`)
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('join by email domain', () => {
  it('lets an owner list their own domain and offers the lab to a colleague', async () => {
    const owner = await actor(OWNER, WS)
    await owner.query(`select api.set_join_domains($1,$2,'analyst')`, [
      WS,
      ['dayone-lab.test'],
    ])
    const newcomer = await actor(NEWCOMER, WS_OTHER)
    const offer = await newcomer.query('select * from api.my_join_offer()')
    expect(offer.rows[0]).toMatchObject({
      workspace_id: WS,
      domain: 'dayone-lab.test',
      role: 'analyst',
    })
  })

  it('joins the colleague with the chosen role', async () => {
    const newcomer = await actor(NEWCOMER, WS_OTHER)
    await newcomer.query('select api.join_my_domain_workspace()')
    const { rows } = await migrator.query(
      `select role from api.workspace_memberships where workspace_id=$1 and user_id=$2`,
      [WS, NEWCOMER],
    )
    expect(rows[0]?.role).toBe('analyst')
  })

  it('refuses a public mail domain, a taken domain and a domain that is not yours', async () => {
    const owner = await actor(OWNER, WS)
    await expectDenied(
      owner.query(`select api.set_join_domains($1,$2,'viewer')`, [
        WS,
        ['gmail.com'],
      ]),
      'SB210',
    )
    await expectDenied(
      owner.query(`select api.set_join_domains($1,$2,'viewer')`, [
        WS,
        ['dayone-lab.test', 'someone-else.test'],
      ]),
      'SB212',
    )
    const other = await actor(OTHER_OWNER, WS_OTHER)
    await expectDenied(
      other.query(`select api.set_join_domains($1,$2,'viewer')`, [
        WS_OTHER,
        ['dayone-lab.test'],
      ]),
      'SB211',
    )
  })

  it('does not let a scientist change the domains', async () => {
    const scientist = await actor(SCIENTIST, WS)
    await expectDenied(
      scientist.query(`select api.set_join_domains($1,$2,'viewer')`, [WS, []]),
      '42501',
    )
  })

  it('does not add someone whose address is not verified', async () => {
    const { rows } = await migrator.query(
      `select internal.join_workspace_by_email_domain($1) as ws`,
      [UNVERIFIED],
    )
    expect(rows[0]?.ws).toBeNull()
  })
})

describe('first-admin setup and starter tables', () => {
  it('renames the lab, installs the chosen starter tables and marks it set up', async () => {
    const owner = await actor(OWNER, WS)
    const result = await owner.query(
      `select api.complete_workspace_setup($1,'Dayone Labs','Europe/London',array['plate_reader','qpcr']) as r`,
      [WS],
    )
    expect(result.rows[0]?.r.installed).toHaveLength(2)
    const { rows } = await migrator.query(
      `select w.name, s.setup_completed_at from api.workspaces w join api.workspace_settings s on s.workspace_id = w.id where w.id=$1`,
      [WS],
    )
    expect(rows[0]?.name).toBe('Dayone Labs')
    expect(rows[0]?.setup_completed_at).not.toBeNull()
  })

  it('refuses setup to someone who is not an owner', async () => {
    const scientist = await actor(SCIENTIST, WS)
    await expectDenied(
      scientist.query(
        `select api.complete_workspace_setup($1,'Nope','UTC',array[]::text[])`,
        [WS],
      ),
      'SB056',
    )
  })

  it('adds only the starter tables that are missing', async () => {
    const owner = await actor(OWNER, WS)
    const { rows } = await owner.query(
      `select api.install_starter_structures($1, null) as r`,
      [WS],
    )
    expect(rows[0]?.r).toHaveLength(3)
  })
})

describe('a table made from a file', () => {
  it('lets a scientist make a table from the file’s columns', async () => {
    const scientist = await actor(SCIENTIST, WS)
    const fields = [
      {
        field_id: '00000000-0000-4000-8000-0000000d0f01',
        key: 'well',
        label: 'Well',
        logical_type: 'text',
        nullable: true,
        quantity: null,
        display_order: 1,
      },
      {
        field_id: '00000000-0000-4000-8000-0000000d0f02',
        key: 'signal',
        label: 'Signal',
        logical_type: 'decimal',
        nullable: true,
        quantity: null,
        display_order: 2,
      },
    ]
    const { rows } = await scientist.query(
      `select api.create_dataset_structure_from_file($1,'Plate 3 readout',$2::jsonb) as r`,
      [WS, JSON.stringify(fields)],
    )
    expect(rows[0]?.r).toBeTruthy()
  })

  it('refuses a column type it does not know and an empty column list', async () => {
    const scientist = await actor(SCIENTIST, WS)
    await expectDenied(
      scientist.query(
        `select api.create_dataset_structure_from_file($1,'Bad',$2::jsonb)`,
        [WS, JSON.stringify([{ label: 'X', logical_type: 'blob' }])],
      ),
      '22023',
    )
    await expectDenied(
      scientist.query(
        `select api.create_dataset_structure_from_file($1,'Empty','[]'::jsonb)`,
        [WS],
      ),
      '22023',
    )
  })
})
