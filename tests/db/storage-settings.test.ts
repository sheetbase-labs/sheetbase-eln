/**
 * Storage and labels settings: who may change locations and label templates,
 * archiving instead of deleting, and the guard that keeps a location holding a
 * sample from being archived or deleted. Runs against a freshly migrated
 * sheetbase_test database.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  expectDenied,
  grantProjectAccess,
  prepareTestDatabase,
} from './helpers'

const WS = '00000000-0000-4000-8000-00000000d501'
const PROJECT = '00000000-0000-4000-8000-00000000d511'
const OWNER = 'stor-set-owner'
const ADMIN = 'stor-set-admin'
const STEWARD = 'stor-set-steward'
const MEMBER = 'stor-set-member'
const VIEWER = 'stor-set-viewer'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: userId, workspace_id: WS, role: 'authenticated' }),
  ])
  return client
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(`
    insert into internal."user"(id,name,email,"emailVerified") values
      ('${OWNER}','Owner','stor-owner@test.invalid',true),
      ('${ADMIN}','Admin','stor-admin@test.invalid',true),
      ('${STEWARD}','Steward','stor-steward@test.invalid',true),
      ('${MEMBER}','Member','stor-member@test.invalid',true),
      ('${VIEWER}','Viewer','stor-viewer@test.invalid',true);
    insert into api.workspaces(id,slug,name) values ('${WS}','storage-settings','Storage settings');
    insert into api.workspace_memberships(workspace_id,user_id,role) values
      ('${WS}','${OWNER}','owner'),
      ('${WS}','${ADMIN}','admin'),
      ('${WS}','${STEWARD}','steward'),
      ('${WS}','${MEMBER}','member'),
      ('${WS}','${VIEWER}','viewer');
    insert into api.projects(id,workspace_id,key,title,lead_user_id)
      values ('${PROJECT}','${WS}','stset','Storage settings','${OWNER}')`)
  await grantProjectAccess(migrator, {
    workspaceId: WS,
    projectId: PROJECT,
    userId: STEWARD,
    canView: true,
    canEdit: true,
  })
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function buildBox(client: Client, suffix: string) {
  const site = await client.query(
    `insert into api.storage_sites(workspace_id,name,code) values($1,$2,$3) returning id`,
    [WS, `Site ${suffix}`, `S-${suffix}`],
  )
  const room = await client.query(
    `insert into api.storage_rooms(workspace_id,site_id,name,code) values($1,$2,'Room','R') returning id`,
    [WS, site.rows[0].id],
  )
  const unit = await client.query(
    `insert into api.storage_units(workspace_id,room_id,name,code,unit_type) values($1,$2,'Freezer','F','freezer') returning id`,
    [WS, room.rows[0].id],
  )
  const shelf = await client.query(
    `insert into api.storage_shelves(workspace_id,unit_id,name,position) values($1,$2,'Shelf 1',1) returning id`,
    [WS, unit.rows[0].id],
  )
  const rack = await client.query(
    `insert into api.storage_racks(workspace_id,shelf_id,name,position) values($1,$2,'Rack A',1) returning id`,
    [WS, shelf.rows[0].id],
  )
  const box = await client.query(
    `select id from api.create_storage_box($1,$2,'Box 1','B1',3,4)`,
    [WS, rack.rows[0].id],
  )
  return {
    site: site.rows[0].id as string,
    room: room.rows[0].id as string,
    unit: unit.rows[0].id as string,
    shelf: shelf.rows[0].id as string,
    rack: rack.rows[0].id as string,
    box: box.rows[0].id as string,
  }
}

async function sample(client: Client, title: string) {
  const { rows } = await client.query(
    `select id, metadata_version from api.create_record($1::uuid,'sample',$2,'available',ARRAY[]::text[],'{}'::jsonb)`,
    [PROJECT, title],
  )
  return rows[0] as { id: string; metadata_version: number }
}

describe('who manages storage', () => {
  it('lets the owner, admin and steward add locations and refuses a member or viewer', async () => {
    for (const [user, suffix] of [
      [OWNER, 'own'],
      [ADMIN, 'adm'],
      [STEWARD, 'stw'],
    ] as const) {
      const client = await actor(user)
      await buildBox(client, suffix)
    }
    for (const user of [MEMBER, VIEWER]) {
      const client = await actor(user)
      await expectDenied(
        client.query(
          `insert into api.storage_sites(workspace_id,name,code) values($1,'No','NO')`,
          [WS],
        ),
        '42501',
      )
      await expectDenied(
        client.query(`select api.create_storage_box($1,$2,'X','X',1,1)`, [
          WS,
          '00000000-0000-4000-8000-00000000d5ff',
        ]),
        '42501',
      )
    }
  })

  it('follows the access the workspace configures', async () => {
    const owner = await actor(OWNER)
    await owner.query(
      `select api.set_settings_access($1,'storage','member','manage')`,
      [WS],
    )
    const member = await actor(MEMBER)
    await member.query(
      `insert into api.storage_sites(workspace_id,name,code) values($1,'Member site','MEM')`,
      [WS],
    )
    await owner.query(
      `select api.set_settings_access($1,'storage','steward','none')`,
      [WS],
    )
    const steward = await actor(STEWARD)
    await expectDenied(
      steward.query(
        `insert into api.storage_sites(workspace_id,name,code) values($1,'Steward site','STW2')`,
        [WS],
      ),
      '42501',
    )
    await migrator.query(
      `delete from api.settings_access where workspace_id = $1`,
      [WS],
    )
  })
})

describe('archiving', () => {
  it('archives and restores an empty location', async () => {
    const steward = await actor(STEWARD)
    const ids = await buildBox(steward, 'arc')
    await steward.query(
      `update api.storage_boxes set archived_at = now() where id = $1`,
      [ids.box],
    )
    const archived = await steward.query(
      `select archived_at from api.storage_boxes where id = $1`,
      [ids.box],
    )
    expect(archived.rows[0].archived_at).not.toBeNull()
    await steward.query(
      `update api.storage_boxes set archived_at = null where id = $1`,
      [ids.box],
    )
  })

  it('refuses to archive or delete anything above a stored sample', async () => {
    const steward = await actor(STEWARD)
    const ids = await buildBox(steward, 'held')
    const s = await sample(steward, 'Held sample')
    const [position] = (
      await migrator.query(
        `select id from api.storage_positions where box_id = $1 and label = 'A1'`,
        [ids.box],
      )
    ).rows
    await steward.query(`select api.move_sample_to_position($1,$2,$3)`, [
      s.id,
      position.id,
      s.metadata_version,
    ])
    for (const [table, id] of [
      ['storage_boxes', ids.box],
      ['storage_racks', ids.rack],
      ['storage_shelves', ids.shelf],
      ['storage_units', ids.unit],
      ['storage_rooms', ids.room],
      ['storage_sites', ids.site],
    ] as const) {
      await expectDenied(
        steward.query(
          `update api.${table} set archived_at = now() where id = $1`,
          [id],
        ),
        'SB015',
      )
      await expectDenied(
        steward.query(`delete from api.${table} where id = $1`, [id]),
        'SB015',
      )
    }
    // Once the sample leaves, the same box can be archived.
    await steward.query(`select api.remove_sample_from_position($1,$2)`, [
      s.id,
      s.metadata_version + 1,
    ])
    await steward.query(
      `update api.storage_boxes set archived_at = now() where id = $1`,
      [ids.box],
    )
  })

  it('does not accept a sample into an archived box', async () => {
    const steward = await actor(STEWARD)
    const ids = await buildBox(steward, 'full')
    await steward.query(
      `update api.storage_boxes set archived_at = now() where id = $1`,
      [ids.box],
    )
    const s = await sample(steward, 'Archived target')
    const [position] = (
      await migrator.query(
        `select id from api.storage_positions where box_id = $1 and label = 'A1'`,
        [ids.box],
      )
    ).rows
    await expectDenied(
      steward.query(`select api.move_sample_to_position($1,$2,$3)`, [
        s.id,
        position.id,
        s.metadata_version,
      ]),
      'SB013',
    )
  })
})

describe('label templates', () => {
  const save = (
    client: Client,
    id: string | null,
    name: string,
    isDefault: boolean,
  ) =>
    client.query(
      `select * from api.save_label_template($1,$2,$3,'sample',50,25,'qr',true,false,true,true,$4)`,
      [WS, id, name, isDefault],
    )

  it('lets a manager add, edit and archive a template, and keeps one default', async () => {
    const steward = await actor(STEWARD)
    const first = (await save(steward, null, 'Tube', true)).rows[0]
    expect(first.is_default).toBe(true)
    expect(first.created_by_user_id).toBe(STEWARD)
    const second = (await save(steward, null, 'Retain', true)).rows[0]
    const defaults = await steward.query(
      `select name from api.label_templates where workspace_id = $1 and is_default order by name`,
      [WS],
    )
    expect(defaults.rows.map((r) => r.name)).toEqual(['Retain'])
    const renamed = (await save(steward, first.id, 'Tube (small)', false))
      .rows[0]
    expect(renamed.name).toBe('Tube (small)')
    const archived = await steward.query(
      `select * from api.set_label_template_archived($1,true)`,
      [second.id],
    )
    expect(archived.rows[0].archived_at).not.toBeNull()
    expect(archived.rows[0].is_default).toBe(false)
  })

  it('refuses a member and a viewer, but lets them read', async () => {
    for (const user of [MEMBER, VIEWER]) {
      const client = await actor(user)
      await expectDenied(save(client, null, 'Nope', false), '42501')
      const read = await client.query(
        `select count(*)::int n from api.label_templates`,
      )
      expect(read.rows[0].n).toBeGreaterThan(0)
    }
  })

  it('rejects a code type or size the printer cannot do', async () => {
    const steward = await actor(STEWARD)
    await expect(
      steward.query(
        `select api.save_label_template($1,null,'Bad','sample',50,25,'ean13',true,true,true,true,false)`,
        [WS],
      ),
    ).rejects.toThrow()
    await expect(
      steward.query(
        `select api.save_label_template($1,null,'Huge','sample',500,25,'qr',true,true,true,true,false)`,
        [WS],
      ),
    ).rejects.toThrow()
  })
})
