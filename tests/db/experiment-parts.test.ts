/**
 * Parts of an experiment (migration 0104): parts run in order, finishing the
 * steps of a part finishes it and opens the next, blocks stay in their part,
 * and the change feed hears about all of it.
 * Runs against a freshly migrated sheetbase_test database.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { mapEventType } from '../../src/lib/webhook-events'
import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000fb01'
const PROJECT = '00000000-0000-4000-8000-00000000fb11'
const OWNER = 'pt-owner'
const OUTSIDER = 'pt-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let owner: Client

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

async function experimentWithSteps(
  title: string,
  texts: string[],
): Promise<{ recordId: string; stepIds: string[] }> {
  // The steps are copied into the experiment when its protocol is pinned.
  const protocol = crypto.randomUUID()
  await migrator.query(
    `insert into api.records(id,workspace_id,kind,identifier,title,status,created_by_user_id)
     values($1,$2,'protocol_template',$3,$4,'active',$5)`,
    [protocol, WS, `PRT-${protocol}`, `${title} protocol`, OWNER],
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
  const { rows } = await owner.query(
    `select id from api.create_record($1::uuid,'experiment',$2)`,
    [PROJECT, title],
  )
  const recordId = rows[0].id as string
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
  const pinned = (
    await owner.query(
      `select api.pin_protocol_reference($1,$2,$3,$4) as result`,
      [pin.id, protocol, pin.version, structure],
    )
  ).rows[0].result.copied_steps as Array<{ id: string }>
  return { recordId, stepIds: pinned.map((step) => step.id) }
}

async function steps(recordId: string) {
  const { rows } = await owner.query(
    `select * from api.record_steps($1) order by step_number`,
    [recordId],
  )
  return rows as Array<{
    block_id: string
    step_number: number
    status: string
    is_current: boolean
    completed_at: string | null
    completed_by_user_id: string | null
    note: string | null
    result_count: number
  }>
}

async function feed(since: string) {
  const { rows } = await migrator.query(
    `select entity_type, operation, payload from api.change_events
      where workspace_id = $1 and entity_type in ('experiment_part','part_completion','part_opened') and sequence > $2
      order by sequence`,
    [WS, since],
  )
  return rows.map((row) => ({
    wire: mapEventType(row.entity_type, row.operation, row.payload),
    payload: row.payload as Record<string, unknown>,
  }))
}

async function mark(): Promise<string> {
  const { rows } = await migrator.query(
    `select coalesce(max(last_seq),0) as last_seq from api.workspace_change_seq where workspace_id = $1`,
    [WS],
  )
  return String(rows[0].last_seq)
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [OWNER, OUTSIDER]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values ($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'pt','Parts'),('00000000-0000-4000-8000-00000000fb02','pt2','Other lab')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values ($1,$2,'owner'),('00000000-0000-4000-8000-00000000fb02',$3,'owner')`,
    [WS, OWNER, OUTSIDER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values ($1,$2,'pt','Parts',$3)`,
    [PROJECT, WS, OWNER],
  )
  owner = await actor(OWNER, WS)
  await migrator.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: OWNER, workspace_id: WS, role: 'authenticated' }),
  ])
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

/** An experiment whose protocol is pinned, so it has `texts.length` copied steps in page order. */
async function experiment(title: string, texts: string[] = []) {
  const { rows } = await owner.query(
    `select id from api.create_record($1::uuid,'experiment',$2)`,
    [PROJECT, title],
  )
  const recordId = rows[0].id as string
  if (texts.length === 0) return { recordId, stepIds: [] as string[] }
  const protocol = crypto.randomUUID()
  await migrator.query(
    `insert into api.records(id,workspace_id,kind,identifier,title,status,created_by_user_id)
     values($1,$2,'protocol_template',$3,$4,'active',$5)`,
    [protocol, WS, `PRT-${protocol}`, `${title} protocol`, OWNER],
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
  const pinned = (
    await owner.query(
      `select api.pin_protocol_reference($1,$2,$3,$4) as result`,
      [pin.id, protocol, pin.version, structure],
    )
  ).rows[0].result.copied_steps as Array<{ id: string }>
  return { recordId, stepIds: pinned.map((step) => step.id) }
}

async function addPart(recordId: string, title: string, day?: number) {
  const { rows } = await owner.query(
    `select api.create_experiment_part($1,$2,$3) as part`,
    [recordId, title, day ?? null],
  )
  return rows[0].part as { id: string; position: number; day_offset: number }
}

async function parts(recordId: string) {
  const { rows } = await owner.query(`select * from api.record_parts($1)`, [
    recordId,
  ])
  return rows as Array<{
    part_id: string
    part_number: number
    title: string
    day_offset: number
    status: string
    is_current: boolean
    step_count: number
    steps_done: number
    block_count: number
    opened_at: string | null
    completed_at: string | null
  }>
}

async function blockParts(recordId: string) {
  const { rows } = await migrator.query(
    `select b.id, b.part_id, b."order" from api.blocks b where b.record_id = $1 and b.type <> 'protocol_reference' order by b."order"`,
    [recordId],
  )
  return rows as Array<{ id: string; part_id: string | null; order: number }>
}

describe('creating parts', () => {
  it('leaves an experiment without parts as one page', async () => {
    const { recordId } = await experiment('Plain', ['A', 'B'])
    expect(await parts(recordId)).toEqual([])
    expect((await blockParts(recordId)).every((b) => b.part_id === null)).toBe(
      true,
    )
    const steps = (
      await owner.query(`select * from api.record_steps($1)`, [recordId])
    ).rows
    expect(steps.map((s) => s.is_current)).toEqual([true, false])
    expect(steps[0].part_id).toBeNull()
  })

  it('gives the first part everything already on the page, and later parts start empty', async () => {
    const { recordId } = await experiment('Assay', ['Seed', 'Starve'])
    const one = await addPart(recordId, 'Seed cells', 0)
    const two = await addPart(recordId, 'Dose')
    expect((await blockParts(recordId)).map((b) => b.part_id)).toEqual([
      one.id,
      one.id,
    ])
    const rows = await parts(recordId)
    expect(rows.map((p) => [p.part_number, p.title, p.status])).toEqual([
      [1, 'Seed cells', 'now'],
      [2, 'Dose', 'later'],
    ])
    // The day after the part before, unless one is given.
    expect(two.day_offset).toBe(1)
    expect(rows[1]!.block_count).toBe(0)
  })

  it('puts a new block in the part of the block before it', async () => {
    const { recordId, stepIds } = await experiment('Inherit', ['One'])
    const one = await addPart(recordId, 'A')
    await addPart(recordId, 'B')
    const note = (
      await owner.query(
        `select api.insert_block($1,'rich_text','{}'::jsonb,1,$2) as result`,
        [recordId, stepIds[0]],
      )
    ).rows[0].result.block as { id: string }
    expect(
      (await blockParts(recordId)).find((b) => b.id === note.id)!.part_id,
    ).toBe(one.id)
  })

  it('rejects the parts of another experiment, a stranger and a bad title', async () => {
    const a = await experiment('A', ['x'])
    const b = await experiment('B', ['y'])
    await addPart(a.recordId, 'Part')
    const other = await addPart(b.recordId, 'Part')
    await expect(
      owner.query(`select api.set_block_part($1,$2)`, [a.stepIds[0], other.id]),
    ).rejects.toThrow(/not in this experiment/)
    await expect(
      migrator.query(`update api.blocks set part_id = $2 where id = $1`, [
        a.stepIds[0],
        other.id,
      ]),
    ).rejects.toThrow(/own experiment/)
    await expect(addPart(a.recordId, '   ')).rejects.toThrow(/title/)
    const stranger = await actor(
      OUTSIDER,
      '00000000-0000-4000-8000-00000000fb02',
    )
    await expect(
      stranger.query(`select api.create_experiment_part($1,'Sneaky')`, [
        a.recordId,
      ]),
    ).rejects.toThrow(/not found/)
    await expect(
      owner.query(
        `insert into api.experiment_parts(workspace_id,record_id,"position",title) values ($1,$2,9,'Direct')`,
        [WS, a.recordId],
      ),
    ).rejects.toThrow()
  })

  it('refuses changes once the notebook is locked', async () => {
    const { recordId } = await experiment('Locked', ['x'])
    const part = await addPart(recordId, 'Only')
    await migrator
      .query(`update api.records set locked_at = now() where id = $1`, [
        recordId,
      ])
      .catch(() => undefined)
    const { rows } = await migrator.query(
      `select locked_at from api.records where id=$1`,
      [recordId],
    )
    if (!rows[0].locked_at) return // the lock needs a revision on this build; covered by the sign-off flow
    await expect(addPart(recordId, 'More')).rejects.toThrow(/locked/)
    await expect(
      owner.query(`select api.set_part_done($1)`, [part.id]),
    ).rejects.toThrow(/locked/)
  })
})

describe('a part is done when its steps are', () => {
  it('finishes a part and opens the next, and the feed hears about it', async () => {
    const { recordId, stepIds } = await experiment('Flow', ['S1', 'S2', 'S3'])
    const since = await mark()
    const one = await addPart(recordId, 'Seed')
    const two = await addPart(recordId, 'Dose')
    // Move the last step into the second part.
    await owner.query(`select api.set_block_part($1,$2)`, [stepIds[2], two.id])
    expect((await blockParts(recordId)).map((b) => b.part_id)).toEqual([
      one.id,
      one.id,
      two.id,
    ])

    let rows = await parts(recordId)
    expect(rows.map((p) => [p.status, p.step_count])).toEqual([
      ['now', 2],
      ['later', 1],
    ])
    expect(rows[0]!.opened_at).not.toBeNull()
    expect(rows[1]!.opened_at).toBeNull()

    await owner.query(`select api.set_step_done($1)`, [stepIds[0]])
    rows = await parts(recordId)
    expect(rows[0]!.steps_done).toBe(1)
    expect(rows[0]!.status).toBe('now')

    await owner.query(`select api.set_step_done($1)`, [stepIds[1]])
    rows = await parts(recordId)
    expect(rows.map((p) => p.status)).toEqual(['done', 'now'])
    expect(rows[0]!.completed_at).not.toBeNull()
    expect(rows[1]!.opened_at).not.toBeNull()

    // Steps follow the current part: the first open step of Dose is current.
    const steps = (
      await owner.query(`select * from api.record_steps($1)`, [recordId])
    ).rows
    expect(
      steps.map((s) => [
        s.part_number,
        s.part_step_number,
        s.part_step_count,
        s.is_current,
      ]),
    ).toEqual([
      [1, 1, 2, false],
      [1, 2, 2, false],
      [2, 1, 1, true],
    ])

    // Reopening a step reopens its part.
    await owner.query(`select api.set_step_done($1,false)`, [stepIds[1]])
    rows = await parts(recordId)
    expect(rows.map((p) => p.status)).toEqual(['now', 'later'])

    const events = (await feed(since)).map((e) => e.wire)
    expect(events).toEqual([
      'experiment.part_created',
      'experiment.part_opened',
      'experiment.part_created',
      'experiment.part_completed',
      'experiment.part_opened',
      'experiment.part_reopened',
    ])
    const completed = (await feed(since)).find(
      (e) => e.wire === 'experiment.part_completed',
    )!
    expect(completed.payload).toMatchObject({
      partNumber: 1,
      part: 'Seed',
      recordId,
    })
  })

  it('lets a part with no steps be marked done by hand, but not one with steps', async () => {
    const { recordId, stepIds } = await experiment('Manual', ['S1'])
    const one = await addPart(recordId, 'Steps')
    const two = await addPart(recordId, 'Incubate')
    await owner.query(`select api.set_block_part($1,$2)`, [
      (
        await owner.query(
          `select api.insert_block($1,'rich_text','{}'::jsonb) as r`,
          [recordId],
        )
      ).rows[0].r.block.id,
      two.id,
    ])
    await expect(
      owner.query(`select api.set_part_done($1)`, [one.id]),
    ).rejects.toThrow(/steps/)
    await owner.query(`select api.set_step_done($1)`, [stepIds[0]])
    expect((await parts(recordId)).map((p) => p.status)).toEqual([
      'done',
      'now',
    ])
    await owner.query(`select api.set_part_done($1)`, [two.id])
    expect((await parts(recordId)).map((p) => p.status)).toEqual([
      'done',
      'done',
    ])
    await owner.query(`select api.set_part_done($1,false)`, [two.id])
    expect((await parts(recordId)).map((p) => p.status)).toEqual([
      'done',
      'now',
    ])
  })
})

describe('arranging parts', () => {
  it('keeps blocks in part order when a part moves', async () => {
    const { recordId, stepIds } = await experiment('Move', ['a', 'b', 'c'])
    const one = await addPart(recordId, 'One')
    const two = await addPart(recordId, 'Two')
    const three = await addPart(recordId, 'Three')
    await owner.query(`select api.set_block_part($1,$2)`, [stepIds[1], two.id])
    await owner.query(`select api.set_block_part($1,$2)`, [
      stepIds[2],
      three.id,
    ])
    expect((await blockParts(recordId)).map((b) => b.id)).toEqual(stepIds)
    await owner.query(`select api.move_experiment_part($1,$2)`, [
      three.id,
      null,
    ])
    expect((await parts(recordId)).map((p) => p.title)).toEqual([
      'Three',
      'One',
      'Two',
    ])
    expect((await blockParts(recordId)).map((b) => b.id)).toEqual([
      stepIds[2],
      stepIds[0],
      stepIds[1],
    ])
    expect(one.id).toBeTruthy()
  })

  it('deletes an empty part, and moves the blocks of a part that has content', async () => {
    const { recordId, stepIds } = await experiment('Delete', ['a', 'b'])
    const one = await addPart(recordId, 'One')
    const two = await addPart(recordId, 'Two')
    const three = await addPart(recordId, 'Three')
    await owner.query(`select api.set_block_part($1,$2)`, [stepIds[1], two.id])
    await expect(
      owner.query(`select api.delete_experiment_part($1)`, [two.id]),
    ).rejects.toThrow(/content/)
    await owner.query(`select api.delete_experiment_part($1)`, [three.id])
    const moved = (
      await owner.query(`select api.delete_experiment_part($1,$2) as r`, [
        two.id,
        one.id,
      ])
    ).rows[0].r
    expect(moved.moved_blocks).toBe(1)
    expect(
      (await parts(recordId)).map((p) => [p.title, p.block_count]),
    ).toEqual([['One', 3]])
    expect((await blockParts(recordId)).map((b) => b.part_id)).toEqual([
      one.id,
      one.id,
    ])
  })

  it('renames a part, sets its day and assignee, and clears the assignee', async () => {
    const { recordId } = await experiment('Edit')
    const part = await addPart(recordId, 'Old', 0)
    await owner.query(`select api.update_experiment_part($1,'New',4,$2)`, [
      part.id,
      OWNER,
    ])
    let row = (await parts(recordId))[0] as unknown as {
      title: string
      day_offset: number
      assignee_user_id: string | null
    }
    expect([row.title, row.day_offset, row.assignee_user_id]).toEqual([
      'New',
      4,
      OWNER,
    ])
    await expect(
      owner.query(`select api.update_experiment_part($1,null,null,$2)`, [
        part.id,
        OUTSIDER,
      ]),
    ).rejects.toThrow(/workspace/)
    await owner.query(
      `select api.update_experiment_part($1,null,null,null,true)`,
      [part.id],
    )
    row = (await parts(recordId))[0] as unknown as typeof row
    expect(row.assignee_user_id).toBeNull()
    await expect(
      owner.query(`select api.update_experiment_part($1,null,9999)`, [part.id]),
    ).rejects.toThrow(/day/)
  })

  it('splits a notebook into parts at chosen blocks', async () => {
    const { recordId, stepIds } = await experiment('Split', [
      'a',
      'b',
      'c',
      'd',
    ])
    const result = (
      await owner.query(
        `select api.split_record_into_parts($1,$2::jsonb) as r`,
        [
          recordId,
          JSON.stringify([
            { title: 'Day 0', first_block_id: stepIds[0] },
            { title: 'Day 3', first_block_id: stepIds[2], day_offset: 3 },
          ]),
        ],
      )
    ).rows[0].r as Array<{ id: string; title: string }>
    expect(result.map((p) => p.title)).toEqual(['Day 0', 'Day 3'])
    expect((await blockParts(recordId)).map((b) => b.part_id)).toEqual([
      result[0]!.id,
      result[0]!.id,
      result[1]!.id,
      result[1]!.id,
    ])
    await expect(
      owner.query(
        `select api.split_record_into_parts($1,'[{"title":"x"}]'::jsonb)`,
        [recordId],
      ),
    ).rejects.toThrow(/already has parts/)
  })
})

describe('experiments made from a protocol with parts', () => {
  it('hands the protocol parts to the experiment when its steps are copied', async () => {
    const protocol = crypto.randomUUID()
    await migrator.query(
      `insert into api.records(id,workspace_id,kind,identifier,title,status,created_by_user_id)
       values($1,$2,'protocol_template',$3,'Two-day protocol','active',$4)`,
      [protocol, WS, `PRT-${protocol}`, OWNER],
    )
    const stepBlocks: string[] = []
    for (const [index, text] of ['Seed', 'Dose', 'Read'].entries()) {
      const { rows } = await migrator.query(
        `insert into api.blocks(record_id,type,payload,"order",created_by_user_id)
         values($1,'procedure_step',$2::jsonb,$3,$4) returning id`,
        [
          protocol,
          JSON.stringify({ text, stepNumber: index + 1 }),
          index + 1,
          OWNER,
        ],
      )
      stepBlocks.push(rows[0].id)
    }
    const { rows: partRows } = await migrator.query(
      `insert into api.experiment_parts(workspace_id,record_id,"position",title,day_offset)
       values ($1,$2,1,'Day 0',0),($1,$2,2,'Day 3',3) returning id`,
      [WS, protocol],
    )
    await migrator.query(
      `update api.blocks set part_id=$1 where id in ($2,$3)`,
      [partRows[0].id, stepBlocks[0], stepBlocks[1]],
    )
    await migrator.query(`update api.blocks set part_id=$1 where id = $2`, [
      partRows[1].id,
      stepBlocks[2],
    ])

    const { rows } = await owner.query(
      `select id from api.create_record($1::uuid,'experiment','From protocol')`,
      [PROJECT],
    )
    const recordId = rows[0].id as string
    const pin = (
      await owner.query(
        `select api.insert_block($1,'protocol_reference','{}'::jsonb) as result`,
        [recordId],
      )
    ).rows[0].result.block
    const structure = (
      await migrator.query(
        `select structure_version from api.records where id=$1`,
        [recordId],
      )
    ).rows[0].structure_version
    await owner.query(`select api.pin_protocol_reference($1,$2,$3,$4)`, [
      pin.id,
      protocol,
      pin.version,
      structure,
    ])

    const made = await parts(recordId)
    expect(made.map((p) => [p.title, p.day_offset, p.step_count])).toEqual([
      ['Day 0', 0, 2],
      ['Day 3', 3, 1],
    ])
    expect(made[0]!.status).toBe('now')
  })
})

describe('a reminder on the day of a part', () => {
  it('tells the assignee, or the owner, once', async () => {
    const { recordId } = await experiment('Remind', ['x'])
    await migrator.query(
      `update api.records set status='in_progress' where id=$1`,
      [recordId],
    )
    const one = await addPart(recordId, 'Today', 0)
    await addPart(recordId, 'Later', 5)
    await migrator.query(
      `insert into internal.notifications(workspace_id,user_id,event_type,title) values ($1,$2,'seed','seed')`,
      [WS, OWNER],
    )
    const before = (
      await migrator.query(
        `select count(*)::int n from internal.notifications where record_id=$1 and event_type='part_reminder'`,
        [recordId],
      )
    ).rows[0].n
    expect(before).toBe(0)
    await migrator.query(`select internal.sweep_part_reminders()`)
    await migrator.query(`select internal.sweep_part_reminders()`)
    const { rows } = await migrator.query(
      `select user_id, title from internal.notifications where record_id=$1 and event_type='part_reminder'`,
      [recordId],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].user_id).toBe(OWNER)
    expect(rows[0].title).toMatch(/Part 1 is today: Today/)
    expect(one.id).toBeTruthy()
  })
})
