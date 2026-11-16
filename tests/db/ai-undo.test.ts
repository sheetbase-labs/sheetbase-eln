/**
 * Undo for what the assistant changed: a change set remembers the stretch of the
 * audit trail one card or plan wrote, the preview says what undoing would do and
 * what stops it, and the undo puts everything back as the person, all or
 * nothing.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { grantProjectAccess, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000d701'
const PROJECT = '00000000-0000-4000-8000-00000000d711'
const READER = '00000000-0000-4000-8000-00000000d721'
const OWNER = 'undo-owner'
const OTHER = 'undo-other'
const VIEWER = 'undo-viewer'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let owner: Client
let other: Client
let viewer: Client

async function actor(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: userId, workspace_id: WS, role: 'authenticated' }),
  ])

  return client
}

const plan = (title: string) => ({
  summary: 'x',
  experiment: { title },
  parts: [
    {
      title: 'Prepare',
      dayOffset: 0,
      handsOnMinutes: 30,
      waitAfterMinutes: 0,
      needs: [],
    },
  ],
  plate: {
    name: 'Dose',
    format: '96_well',
    wells: [
      { wellCode: 'A1', role: 'sample', sampleLabel: 'S1', volumeUl: 20 },
    ],
  },
  samples: [],
  schedule: true,
  warnings: [],
})

async function begin(client: Client, title = 'A plan'): Promise<string> {
  const { rows } = await client.query(
    `select id from api.begin_ai_change_set($1, 'plan')`,
    [title],
  )

  return rows[0].id
}

async function finish(client: Client, id: string): Promise<boolean> {
  await client.query(`select api.finish_ai_change_set($1, '[]'::jsonb)`, [id])
  const { rows } = await client.query(
    `select count(*)::int as n from api.ai_change_sets where id = $1`,
    [id],
  )

  return rows[0].n === 1
}

async function preview(client: Client, id: string) {
  const { rows } = await client.query(`select api.preview_ai_undo($1) as p`, [
    id,
  ])

  return rows[0].p as {
    canUndo: boolean
    status: string
    toUndo: number
    blocked: number
    items: Array<{
      kind: string
      state: string
      label: string
      reason: string | null
      changes?: Array<{ field: string; from: string | null; to: string | null }>
    }>
  }
}

async function makeExperiment(client: Client, title: string) {
  const { rows } = await client.query(
    `select api.create_planned_experiment($1, $2::jsonb) as r`,
    [PROJECT, JSON.stringify(plan(title))],
  )

  return rows[0].r.recordId as string
}

async function material(title: string) {
  const { rows } = await migrator.query(
    `insert into api.records(workspace_id,project_id,kind,identifier,title,created_by_user_id)
     values ($1,$2,'sample',$3,$3,$4) returning id, metadata_version`,
    [WS, PROJECT, `UNDO-${title}`, OWNER],
  )

  return rows[0] as { id: string; metadata_version: number }
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())

  for (const user of [OWNER, OTHER, VIEWER]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values ($1,$2,$3,true)`,
      [user, `${user} name`, `${user}@undo.test`],
    )
  }

  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'undo','Undo')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values ($1,$2,'owner'),($1,$3,'member'),($1,$4,'viewer')`,
    [WS, OWNER, OTHER, VIEWER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values ($1,$2,'undo','Undo',$3)`,
    [PROJECT, WS, OWNER],
  )
  await grantProjectAccess(migrator, {
    workspaceId: WS,
    projectId: PROJECT,
    userId: OTHER,
    canView: true,
    canEdit: true,
  })
  await migrator.query(
    `insert into api.instruments(id,workspace_id,name,instrument_type,created_by_user_id) values ($1,$2,'Plate reader','other',$3)`,
    [READER, WS, OWNER],
  )
  await migrator.query(
    `insert into api.instrument_qualifications(workspace_id,instrument_id,user_id,valid_until,granted_by_user_id)
     values ($1,$2,$3,now() + interval '1 year',$3)`,
    [WS, READER, OWNER],
  )
  owner = await actor(OWNER)
  other = await actor(OTHER)
  viewer = await actor(VIEWER)

  const definition = (
    await owner.query(
      `select * from api.create_model_field($1,'sample','lot','Lot','text',true,null,'{}'::jsonb)`,
      [WS],
    )
  ).rows[0]

  await owner.query(`select api.activate_model_field($1)`, [definition.id])
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function booking(client: Client, title: string) {
  const { rows } = await client.query(
    `select (api.create_booking($1,$2,$3, now() + interval '3 day', now() + interval '3 day 1 hour','UTC','tentative',false,null,null,null,$4,null,'[]'::jsonb,'[]'::jsonb)).id as id`,
    [WS, READER, title, PROJECT],
  )

  return rows[0].id as string
}

describe('a plan that made things', () => {
  it('previews what would be undone and then undoes all of it', async () => {
    const set = await begin(owner)
    const experiment = await makeExperiment(owner, 'Undo me')
    const bookingId = await booking(owner, 'Undo booking')

    expect(await finish(owner, set)).toBe(true)

    const seen = await preview(owner, set)

    expect(seen.canUndo).toBe(true)
    expect(seen.blocked).toBe(0)
    expect(seen.items.map((item) => item.kind).sort()).toEqual([
      'booking',
      'record',
    ])
    expect(seen.items.every((item) => item.state === 'ok')).toBe(true)

    const { rows } = await owner.query(
      `select api.undo_ai_change_set($1) as r`,
      [set],
    )

    expect(rows[0].r.done).toBe(true)
    expect(rows[0].r.undone).toBe(2)

    const record = await migrator.query(
      `select archived_at from api.records where id = $1`,
      [experiment],
    )

    expect(record.rows[0].archived_at).not.toBeNull()

    const made = await migrator.query(
      `select status from api.calendar_bookings where id = $1`,
      [bookingId],
    )

    expect(made.rows[0].status).toBe('cancelled')

    // A second undo has nothing to do, and the workspace is told once.
    const again = await preview(owner, set)

    expect(again.status).toBe('undone')
    expect(again.canUndo).toBe(false)

    const events = await migrator.query(
      `select payload from api.change_events where entity_type = 'assistant_change_set' and entity_uuid = $1`,
      [set],
    )

    expect(events.rows).toHaveLength(1)
    expect(events.rows[0].payload).toMatchObject({ effect: 'undone' })
  })

  it('stays with a plan that paused: another window joins the same set', async () => {
    const set = await begin(owner, 'Paused plan')
    const first = await makeExperiment(owner, 'First half')

    await finish(owner, set)
    // Something unrelated happens while the plan waits.
    await material('Unrelated')
    await owner.query(`select api.begin_ai_change_set('x', 'plan', $1)`, [set])
    const second = await makeExperiment(owner, 'Second half')

    await finish(owner, set)

    const seen = await preview(owner, set)

    expect(seen.items.filter((item) => item.kind === 'record')).toHaveLength(2)
    expect(seen.items.some((item) => item.label.includes('Unrelated'))).toBe(
      false,
    )
    expect(seen.canUndo).toBe(true)

    await owner.query(`select api.undo_ai_change_set($1)`, [set])

    const rows = await migrator.query(
      `select archived_at from api.records where id = any($1)`,
      [[first, second]],
    )

    expect(rows.rows.every((row) => row.archived_at !== null)).toBe(true)
  })
})

describe('fields edited on an older record', () => {
  it('puts them back', async () => {
    const lot = await material('Buffer lot')
    const set = await begin(owner, 'Edit a lot')

    await owner.query(
      `select api.update_record_custom_fields($1, $2, '{"lot":"B2"}'::jsonb)`,
      [lot.id, lot.metadata_version],
    )
    await owner.query(`select api.assign_record($1, $2, $3)`, [
      lot.id,
      lot.metadata_version + 1,
      OTHER,
    ])
    expect(await finish(owner, set)).toBe(true)

    const seen = await preview(owner, set)

    expect(seen.canUndo).toBe(true)
    expect(seen.items).toHaveLength(1)
    expect(seen.items[0].kind).toBe('fields')
    expect(seen.items[0].changes?.map((change) => change.field).sort()).toEqual(
      ['Assigned to', 'lot'],
    )

    await owner.query(`select api.undo_ai_change_set($1)`, [set])

    const back = await migrator.query(
      `select custom_fields, assignee_user_id from api.records where id = $1`,
      [lot.id],
    )

    expect(back.rows[0].custom_fields.lot).toBeUndefined()
    expect(back.rows[0].assignee_user_id).toBeNull()
  })
})

describe('what stops an undo', () => {
  it('refuses, naming who, when someone else changed it afterwards, and touches nothing', async () => {
    const set = await begin(owner, 'Plan someone edits')
    const experiment = await makeExperiment(owner, 'Edited later')
    const bookingId = await booking(owner, 'Kept booking')

    await finish(owner, set)

    const row = await migrator.query(
      `select metadata_version from api.records where id = $1`,
      [experiment],
    )

    await other.query(`select api.assign_record($1, $2, $3)`, [
      experiment,
      row.rows[0].metadata_version,
      OTHER,
    ])

    const seen = await preview(owner, set)

    expect(seen.canUndo).toBe(false)

    const blocked = seen.items.find((item) => item.state === 'blocked')

    expect(blocked?.reason).toContain('undo-other name')

    const { rows } = await owner.query(
      `select api.undo_ai_change_set($1) as r`,
      [set],
    )

    expect(rows[0].r.done).toBe(false)

    // All or nothing: the booking is still there.
    const kept = await migrator.query(
      `select status from api.calendar_bookings where id = $1`,
      [bookingId],
    )

    expect(kept.rows[0].status).not.toBe('cancelled')

    const record = await migrator.query(
      `select archived_at from api.records where id = $1`,
      [experiment],
    )

    expect(record.rows[0].archived_at).toBeNull()
  })

  it('refuses a record that has been through review', async () => {
    const set = await begin(owner, 'Plan that goes to review')
    const experiment = await makeExperiment(owner, 'Goes to review')

    await finish(owner, set)
    await migrator.query(
      `update api.records set status = 'in_review' where id = $1`,
      [experiment],
    )

    const seen = await preview(owner, set)

    expect(seen.canUndo).toBe(false)
    expect(seen.items.find((item) => item.state === 'blocked')?.reason).toBe(
      'It has been through review.',
    )
  })

  it('refuses a kind of change that cannot be taken back', async () => {
    const lot = await material('Commented lot')
    const set = await begin(owner, 'Comment plan')

    await owner.query(
      `select api.create_record_comment($1,'record','{}'::jsonb,'hello',ARRAY[]::text[])`,
      [lot.id],
    )
    await finish(owner, set)

    const seen = await preview(owner, set)

    expect(seen.canUndo).toBe(false)
    expect(seen.items[0]).toMatchObject({
      state: 'blocked',
      label: 'A comment was posted',
    })
  })

  it('lists a step the audit trail does not carry as staying', async () => {
    const set = await begin(owner, 'Mixed plan')

    await makeExperiment(owner, 'Mixed')
    await owner.query(
      `select api.finish_ai_change_set($1, '[{"title":"Order buffer"}]'::jsonb)`,
      [set],
    )

    const seen = await preview(owner, set)

    expect(seen.canUndo).toBe(false)
    expect(
      seen.items.find((item) => item.label === 'Order buffer'),
    ).toMatchObject({ state: 'blocked' })
  })
})

describe('who may use a set', () => {
  it('drops a set that changed nothing', async () => {
    const set = await begin(owner, 'Nothing')

    expect(await finish(owner, set)).toBe(false)
  })

  it('belongs to the person who made it', async () => {
    const set = await begin(owner, 'Mine')

    await makeExperiment(owner, 'Mine only')
    await finish(owner, set)

    await expect(preview(other, set)).rejects.toMatchObject({ code: '42501' })
    await expect(
      other.query(`select api.undo_ai_change_set($1)`, [set]),
    ).rejects.toMatchObject({ code: '42501' })

    const visible = await other.query(
      `select count(*)::int as n from api.ai_change_sets where id = $1`,
      [set],
    )

    expect(visible.rows[0].n).toBe(0)
  })

  it('says up front that archiving a project needs an admin', async () => {
    const set = await begin(other, 'A project')

    await other.query(
      `select api.create_project('Made by a member', null, null, null, $1, null, null, null)`,
      [OTHER],
    )
    await finish(other, set)

    const shown = await preview(other, set)
    const item = shown.items.find((row) => row.kind === 'project')

    expect(shown.canUndo).toBe(false)
    expect(item).toMatchObject({ state: 'blocked' })
    expect(item?.reason).toMatch(/needs an admin/)

    const result = await other.query(`select api.undo_ai_change_set($1) as r`, [
      set,
    ])

    expect(result.rows[0].r.done).toBe(false)
  })

  it('is not opened by a viewer', async () => {
    await expect(
      viewer.query(`select api.begin_ai_change_set('No', 'card')`),
    ).rejects.toMatchObject({ code: '42501' })
  })
})
