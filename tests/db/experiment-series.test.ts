/**
 * Series of experiments (migration 0104): members keep their own page, review
 * and lock; the series orders them, plans their days and adds them up; the
 * change feed hears about members joining and leaving.
 * Runs against a freshly migrated sheetbase_test database.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { mapEventType } from '../../src/lib/webhook-events'
import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000fb01'
const OTHER_WS = '00000000-0000-4000-8000-00000000fb02'
const PROJECT = '00000000-0000-4000-8000-00000000fb11'
const OWNER = 'se-owner'
const PRIYA = 'se-priya'
const VIEWER = 'se-viewer'
const OUTSIDER = 'se-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let owner: Client
let priya: Client
let viewer: Client

async function actor(userId: string, workspace: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      sub: userId,
      workspace_id: workspace,
      role: 'authenticated',
    }),
  ])
  return client
}

async function experiment(who: Client, title: string): Promise<string> {
  const { rows } = await who.query(
    `select id from api.create_record($1::uuid,'experiment',$2)`,
    [PROJECT, title],
  )
  return rows[0].id as string
}

async function members(who: Client, series: string) {
  const { rows } = await who.query(`select * from api.series_members($1)`, [
    series,
  ])
  return rows as Array<{
    member_record_id: string
    member_number: number
    identifier: string
    status: string
    planned_on: string | null
    day_offset: number | null
    steps_total: number
    steps_done: number
    sample_count: number
  }>
}

async function addSteps(recordId: string, texts: string[], done: number) {
  // The steps are copied into the experiment when its protocol is pinned.
  const protocol = crypto.randomUUID()
  await migrator.query(
    `insert into api.records(id,workspace_id,kind,identifier,title,status,created_by_user_id)
     values($1,$2,'protocol_template',$3,$4,'active',$5)`,
    [protocol, WS, `PRT-${protocol}`, 'Series protocol', OWNER],
  )
  for (const [index, text] of texts.entries()) {
    await migrator.query(
      `insert into api.blocks(record_id,type,payload,"order",created_by_user_id)
       values($1,'procedure_step',$2::jsonb,$3,$4)`,
      [
        protocol,
        JSON.stringify({ text, stepNumber: index + 1 }),
        index + 1,
        OWNER,
      ],
    )
  }
  const pin = (
    await owner.query(
      `select api.insert_block($1,'protocol_reference','{}'::jsonb) as result`,
      [recordId],
    )
  ).rows[0].result.block as { id: string; version: number }
  const structure = (
    await migrator.query(
      `select structure_version from api.records where id=$1`,
      [recordId],
    )
  ).rows[0].structure_version as number
  const copied = (
    await owner.query(
      `select api.pin_protocol_reference($1,$2,$3,$4) as result`,
      [pin.id, protocol, pin.version, structure],
    )
  ).rows[0].result.copied_steps as Array<{ id: string }>
  for (const step of copied.slice(0, done)) {
    await owner.query(`select api.set_step_done($1, true)`, [step.id])
  }
}

async function mark(): Promise<string> {
  const { rows } = await migrator.query(
    `select coalesce(max(last_seq),0) as last_seq from api.workspace_change_seq where workspace_id = $1`,
    [WS],
  )
  return String(rows[0].last_seq)
}

async function feed(since: string) {
  const { rows } = await migrator.query(
    `select entity_type, operation, record_id, payload from api.change_events
      where workspace_id = $1 and entity_type = 'experiment_series_member' and sequence > $2
      order by sequence`,
    [WS, since],
  )
  return rows.map((row) => ({
    wire: mapEventType(row.entity_type, row.operation, row.payload),
    recordId: row.record_id as string,
    payload: row.payload as Record<string, unknown>,
  }))
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [OWNER, PRIYA, VIEWER, OUTSIDER]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values ($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'se','Series'),($2,'se2','Other lab')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role)
     values ($1,$2,'owner'),($1,$3,'member'),($1,$4,'viewer'),($5,$6,'owner')`,
    [WS, OWNER, PRIYA, VIEWER, OTHER_WS, OUTSIDER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values ($1,$2,'se','Series',$3)`,
    [PROJECT, WS, OWNER],
  )
  await migrator.query(
    `insert into api.project_access(workspace_id,project_id,user_id,access_level,granted_by_user_id,can_view,can_edit)
     values ($1,$2,$3,'editor',$4,true,true),($1,$2,$5,'viewer',$4,true,false)`,
    [WS, PROJECT, PRIYA, OWNER, VIEWER],
  )
  owner = await actor(OWNER, WS)
  priya = await actor(PRIYA, WS)
  viewer = await actor(VIEWER, WS)
  await migrator.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: OWNER, workspace_id: WS, role: 'authenticated' }),
  ])
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('members of a series', () => {
  it('adds members in order, makes the series on the way, and numbers them', async () => {
    const series = await experiment(owner, 'Cell viability assay')
    const seed = await experiment(owner, 'Seed cells')
    const dose = await experiment(owner, 'Dose')
    const start = await mark()

    await owner.query(`select api.add_series_member($1,$2)`, [series, seed])
    await owner.query(`select api.add_series_member($1,$2)`, [series, dose])

    const rows = await members(owner, series)
    expect(rows.map((row) => row.member_record_id)).toEqual([seed, dose])
    expect(rows.map((row) => row.member_number)).toEqual([1, 2])
    expect(
      (
        await owner.query(
          `select 1 from api.experiment_series where record_id=$1`,
          [series],
        )
      ).rowCount,
    ).toBe(1)

    const events = await feed(start)
    expect(events.map((event) => event.wire)).toEqual([
      'experiment.series_member_added',
      'experiment.series_member_added',
    ])
    expect(events[0].recordId).toBe(series)
    expect(events[0].payload).toMatchObject({
      memberRecordId: seed,
      seriesRecordId: series,
      position: 1,
    })
  })

  it('lets a member be in one series only, and a series not nest', async () => {
    const a = await experiment(owner, 'Series A')
    const b = await experiment(owner, 'Series B')
    const run = await experiment(owner, 'A run')
    await owner.query(`select api.add_series_member($1,$2)`, [a, run])

    await expect(
      owner.query(`select api.add_series_member($1,$2)`, [b, run]),
    ).rejects.toThrow(/already in a series/)
    await expect(
      owner.query(`select api.add_series_member($1,$2)`, [b, a]),
    ).rejects.toThrow(/series of its own/)
    await expect(
      owner.query(`select api.add_series_member($1,$2)`, [run, b]),
    ).rejects.toThrow(/already part of a series/)
    await expect(
      owner.query(`select api.add_series_member($1,$1)`, [b]),
    ).rejects.toThrow(/own series/)
  })

  it('reorders members, plans their days and counts days from the first', async () => {
    const series = await experiment(owner, 'Ordering')
    const one = await experiment(owner, 'One')
    const two = await experiment(owner, 'Two')
    const three = await experiment(owner, 'Three')
    for (const id of [one, two, three]) {
      await owner.query(`select api.add_series_member($1,$2)`, [series, id])
    }
    await owner.query(`select api.move_series_member($1, 0.5)`, [three])
    expect(
      (await members(owner, series)).map((row) => row.member_record_id),
    ).toEqual([three, one, two])

    await owner.query(`select api.set_series_member_day($1,'2026-11-02')`, [
      three,
    ])
    await owner.query(`select api.set_series_member_day($1,'2026-11-09')`, [
      two,
    ])
    const rows = await members(owner, series)
    expect(rows.map((row) => row.day_offset)).toEqual([0, null, 7])
  })

  it('counts steps and samples from each member, and rolls the series up', async () => {
    const series = await experiment(owner, 'Roll-up')
    const first = await experiment(owner, 'First')
    const second = await experiment(owner, 'Second')
    await owner.query(`select api.add_series_member($1,$2,null,'2026-11-02')`, [
      series,
      first,
    ])
    await owner.query(`select api.add_series_member($1,$2,null,'2026-11-09')`, [
      series,
      second,
    ])
    await addSteps(second, ['Seed', 'Count'], 1)
    const sampleIds = new Map<string, string>()
    for (const name of ['SMP-1', 'SMP-2', 'SMP-3']) {
      const { rows } = await migrator.query(
        `insert into api.records(workspace_id,kind,identifier,title,status,created_by_user_id)
         values($1,'sample',$2,$2,'active',$3) returning id`,
        [WS, `${name}-${series.slice(0, 8)}`, OWNER],
      )
      sampleIds.set(name, rows[0].id as string)
    }
    for (const [member, sample] of [
      [first, 'SMP-1'],
      [first, 'SMP-2'],
      [second, 'SMP-2'],
      [second, 'SMP-3'],
    ] as const) {
      await migrator.query(
        `insert into api.record_links(source_record_id,target_kind,target_identifier,target_record_id,link_type,created_by_user_id)
         values($1,'sample',$2,$3,'sample',$4)`,
        [
          member,
          `${sample}-${series.slice(0, 8)}`,
          sampleIds.get(sample),
          OWNER,
        ],
      )
    }
    await migrator.query(
      `update api.records set status='approved' where id=$1`,
      [first],
    )

    const rows = await members(owner, series)
    expect(rows[1]).toMatchObject({
      steps_total: 2,
      steps_done: 1,
      sample_count: 2,
    })
    const { rows: roll } = await owner.query(
      `select api.series_rollup($1) as r`,
      [series],
    )
    expect(roll[0].r).toMatchObject({
      total: 2,
      approved: 1,
      samples: 3,
      first_day: '2026-11-02',
      next: { record_id: second, due_on: '2026-11-09' },
    })

    // A member already in review is waiting on someone else, so it is not next.
    await migrator.query(
      `update api.records set status='in_review' where id=$1`,
      [second],
    )
    const { rows: later } = await owner.query(
      `select api.series_rollup($1) as r`,
      [series],
    )
    expect(later[0].r.next).toBeNull()
  })

  it('says where a member sits and who is either side of it', async () => {
    const series = await experiment(owner, 'Neighbours')
    const ids = [
      await experiment(owner, 'Seed'),
      await experiment(owner, 'Starve'),
      await experiment(owner, 'Dose'),
    ]
    for (const id of ids) {
      await owner.query(`select api.add_series_member($1,$2)`, [series, id])
    }
    const { rows } = await owner.query(`select * from api.record_series($1)`, [
      ids[1],
    ])
    expect(rows[0]).toMatchObject({
      series_record_id: series,
      member_number: 2,
      member_total: 3,
      previous_record_id: ids[0],
      next_record_id: ids[2],
    })
    const end = await owner.query(`select * from api.record_series($1)`, [
      ids[2],
    ])
    expect(end.rows[0].next_record_id).toBeNull()
    const none = await owner.query(`select * from api.record_series($1)`, [
      series,
    ])
    expect(none.rowCount).toBe(0)
  })

  it('leaves out a member the caller cannot read', async () => {
    // A draft experiment is private to its author and the workspace admins.
    const series = await experiment(priya, 'Privacy')
    const mine = await experiment(priya, 'Mine')
    const theirs = await experiment(owner, 'Owner draft')
    await migrator.query(
      `update api.records set status='in_progress' where id=$1`,
      [theirs],
    )
    await priya.query(`select api.add_series_member($1,$2)`, [series, mine])
    await priya.query(`select api.add_series_member($1,$2)`, [series, theirs])
    await migrator.query(`update api.records set status='draft' where id=$1`, [
      theirs,
    ])
    expect(
      (await members(priya, series)).map((row) => row.member_record_id),
    ).toEqual([mine])
    expect((await members(owner, series)).length).toBe(2)
  })
})

describe('who may change a series', () => {
  it('refuses a viewer, an outsider and a locked or archived series', async () => {
    const series = await experiment(owner, 'Guarded')
    const member = await experiment(owner, 'Member')
    await expect(
      viewer.query(`select api.add_series_member($1,$2)`, [series, member]),
    ).rejects.toThrow()
    const outsider = await actor(OUTSIDER, OTHER_WS)
    await expect(
      outsider.query(`select api.add_series_member($1,$2)`, [series, member]),
    ).rejects.toThrow(/not found/)

    await owner.query(`select api.add_series_member($1,$2)`, [series, member])
    await expect(
      viewer.query(`select api.remove_series_member($1)`, [member]),
    ).rejects.toThrow()

    await migrator.query(
      `update api.records set archived_at=now() where id=$1`,
      [series],
    )
    await expect(
      owner.query(`select api.remove_series_member($1)`, [member]),
    ).rejects.toThrow(/archived or approved/)
    await migrator.query(
      `update api.records set archived_at=null where id=$1`,
      [series],
    )
  })

  it('adds an approved member without touching it', async () => {
    const series = await experiment(owner, 'Approved members')
    const done = await experiment(owner, 'Done')
    await migrator.query(
      `update api.records set status='approved' where id=$1`,
      [done],
    )
    const before = (
      await migrator.query(
        `select updated_at, metadata_version from api.records where id=$1`,
        [done],
      )
    ).rows[0]
    await owner.query(`select api.add_series_member($1,$2)`, [series, done])
    const after = (
      await migrator.query(
        `select updated_at, metadata_version from api.records where id=$1`,
        [done],
      )
    ).rows[0]
    expect(after).toEqual(before)
    expect((await members(owner, series))[0].status).toBe('approved')
  })

  it('removes a member and tells the feed, and dissolving frees them all', async () => {
    const series = await experiment(owner, 'Leaving')
    const one = await experiment(owner, 'One')
    const two = await experiment(owner, 'Two')
    await owner.query(`select api.add_series_member($1,$2)`, [series, one])
    await owner.query(`select api.add_series_member($1,$2)`, [series, two])
    const start = await mark()
    await owner.query(`select api.remove_series_member($1)`, [one])
    expect((await members(owner, series)).length).toBe(1)
    expect((await feed(start)).map((event) => event.wire)).toEqual([
      'experiment.series_member_removed',
    ])

    const { rows } = await owner.query(
      `select api.dissolve_experiment_series($1) as r`,
      [series],
    )
    expect(rows[0].r.members_released).toBe(1)
    expect(
      (await owner.query(`select 1 from api.record_series($1)`, [two]))
        .rowCount,
    ).toBe(0)
    // Free to join another series now.
    const other = await experiment(owner, 'Other series')
    await owner.query(`select api.add_series_member($1,$2)`, [other, two])
  })
})
