/**
 * The current step of an experiment (migration 0103): finishing a step stamps
 * who and when, results land beside their step, status comes from the evidence,
 * and the change feed hears about all of it.
 * Runs against a freshly migrated sheetbase_test database.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { mapEventType } from '../../src/lib/webhook-events'
import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000fa01'
const PROJECT = '00000000-0000-4000-8000-00000000fa11'
const OWNER = 'cs-owner'
const OUTSIDER = 'cs-outsider'

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
      where workspace_id = $1 and entity_type in ('step_completion','step_result') and sequence > $2
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
    `insert into api.workspaces(id,slug,name) values ($1,'cs','Current step'),('00000000-0000-4000-8000-00000000fa02','cs2','Other lab')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values ($1,$2,'owner'),('00000000-0000-4000-8000-00000000fa02',$3,'owner')`,
    [WS, OWNER, OUTSIDER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values ($1,$2,'cs','Steps',$3)`,
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

describe('step status from the evidence', () => {
  it('makes the first step that is not done the current one', async () => {
    const { recordId } = await experimentWithSteps('Order', ['A', 'B', 'C'])
    const rows = await steps(recordId)
    expect(rows.map((row) => row.status)).toEqual([
      'not_started',
      'not_started',
      'not_started',
    ])
    expect(rows.map((row) => row.is_current)).toEqual([true, false, false])
  })

  it('moves a step to in progress on a note, a result or a timer, and to done when ticked', async () => {
    const { recordId, stepIds } = await experimentWithSteps('Evidence', [
      'Coat plate',
      'Block plate',
      'Read plate',
    ])
    await owner.query(`select api.set_step_done($1, false, 'plate 1 coated')`, [
      stepIds[0],
    ])
    await owner.query(`select api.add_step_result($1,'OD450','0.82','AU')`, [
      stepIds[1],
    ])
    expect((await steps(recordId)).map((row) => row.status)).toEqual([
      'in_progress',
      'in_progress',
      'not_started',
    ])
    await owner.query(`select api.set_step_done($1)`, [stepIds[0]])
    const rows = await steps(recordId)
    expect(rows.map((row) => row.status)).toEqual([
      'done',
      'in_progress',
      'not_started',
    ])
    expect(rows.map((row) => row.is_current)).toEqual([false, true, false])
    expect(rows[1]!.result_count).toBe(1)
    expect(rows[0]!.note).toBe('plate 1 coated')

    await owner.query(
      `update api.blocks set payload = payload || '{"durationSeconds":600}'::jsonb where id = $1`,
      [stepIds[2]],
    )
    await owner.query(`select api.start_step_timer($1)`, [stepIds[2]])
    expect((await steps(recordId))[2]!.status).toBe('in_progress')
  })
})

describe('finishing a step', () => {
  it('records who and when, and clears them when the step is reopened', async () => {
    const { recordId, stepIds } = await experimentWithSteps('Stamp', ['One'])
    const done = await owner.query(`select api.set_step_done($1) as result`, [
      stepIds[0],
    ])
    expect(done.rows[0].result.done).toBe(true)
    expect(done.rows[0].result.completed_by_user_id).toBe(OWNER)
    expect(done.rows[0].result.completed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    const [row] = await steps(recordId)
    expect(row!.completed_by_user_id).toBe(OWNER)
    expect(row!.completed_at).not.toBeNull()

    await owner.query(`select api.set_step_done($1, false)`, [stepIds[0]])
    const [reopened] = await steps(recordId)
    expect(reopened!.status).toBe('not_started')
    expect(reopened!.completed_at).toBeNull()
    expect(reopened!.completed_by_user_id).toBeNull()
  })

  it('reads a step ticked by editing the block, as the page does', async () => {
    const { recordId, stepIds } = await experimentWithSteps('Page tick', [
      'One',
    ])
    const block = (
      await owner.query(`select payload, version from api.blocks where id=$1`, [
        stepIds[0],
      ])
    ).rows[0]
    await owner.query(`select api.update_block_payload($1,$2::jsonb,$3)`, [
      stepIds[0],
      JSON.stringify({ ...block.payload, completed: true }),
      block.version,
    ])
    const [row] = await steps(recordId)
    expect(row!.status).toBe('done')
    expect(row!.completed_by_user_id).toBe(OWNER)
  })

  it('refuses a block that is not a step, and someone from another workspace', async () => {
    const { recordId, stepIds } = await experimentWithSteps('Refuse', ['One'])
    const note = await owner.query(
      `select api.insert_block($1,'rich_text','{"doc":{"type":"doc","content":[]}}'::jsonb) as result`,
      [recordId],
    )
    await expect(
      owner.query(`select api.set_step_done($1)`, [
        note.rows[0].result.block.id,
      ]),
    ).rejects.toThrow(/not a protocol step/)
    const outsider = await actor(
      OUTSIDER,
      '00000000-0000-4000-8000-00000000fa02',
    )
    await expect(
      outsider.query(`select api.set_step_done($1)`, [stepIds[0]]),
    ).rejects.toThrow(/step not found/)
    await expect(
      outsider.query(`select api.add_step_result($1,'x','1')`, [stepIds[0]]),
    ).rejects.toThrow(/step not found/)
  })
})

describe('results', () => {
  it('lands each result straight after its step, in the order added', async () => {
    const { recordId, stepIds } = await experimentWithSteps('Results', [
      'Titre',
      'Wash',
    ])
    await owner.query(`select api.add_step_result($1,'First','1.5','mg')`, [
      stepIds[0],
    ])
    await owner.query(`select api.add_step_result($1,'Second','abc')`, [
      stepIds[0],
    ])
    const { rows } = await owner.query(
      `select type, payload from api.blocks where record_id = $1 and type in ('procedure_step','metric') order by "order"`,
      [recordId],
    )
    expect(rows.map((row) => row.payload.label ?? row.payload.text)).toEqual([
      'Titre',
      'First',
      'Second',
      'Wash',
    ])
    expect(rows[1].payload.value).toBe(1.5)
    expect(rows[1].payload.unit).toBe('mg')
    expect(rows[2].payload.value).toBe('abc')
    expect(rows[1].payload.stepBlockId).toBe(stepIds[0])
  })

  it('needs a name and a value', async () => {
    const { stepIds } = await experimentWithSteps('Needs', ['One'])
    await expect(
      owner.query(`select api.add_step_result($1,'','1')`, [stepIds[0]]),
    ).rejects.toThrow(/name/)
    await expect(
      owner.query(`select api.add_step_result($1,'x',' ')`, [stepIds[0]]),
    ).rejects.toThrow(/value/)
  })
})

describe('events', () => {
  it('says when a step is finished, reopened and given a result', async () => {
    const { stepIds } = await experimentWithSteps('Events', ['One'])
    const since = await mark()
    await owner.query(`select api.add_step_result($1,'OD','0.4')`, [stepIds[0]])
    await owner.query(`select api.set_step_done($1)`, [stepIds[0]])
    await owner.query(`select api.set_step_done($1, false)`, [stepIds[0]])
    // Saving a note on a finished step is not a new event.
    await owner.query(`select api.set_step_done($1, true, 'noted')`, [
      stepIds[0],
    ])
    await owner.query(`select api.set_step_done($1, true, 'again')`, [
      stepIds[0],
    ])
    const events = await feed(since)
    expect(events.map((event) => event.wire)).toEqual([
      'step.result_added',
      'step.completed',
      'step.reopened',
      'step.completed',
    ])
    expect(events[1]!.payload).toMatchObject({
      blockId: stepIds[0],
      stepNumber: 1,
      step: 'One',
      completedByUserId: OWNER,
    })
    expect(events[0]!.payload).toMatchObject({
      label: 'OD',
      blockId: stepIds[0],
    })
  })

  it('lets a pipeline be triggered by the step events and run the two actions', async () => {
    const { rows } = await migrator.query(
      `select api.normalize_pipeline_event_type('step.completed') as a,
              api.normalize_pipeline_event_type('step.result_added') as b`,
    )
    expect(rows[0]).toEqual({ a: 'step.completed', b: 'step.result_added' })
    const errors = await migrator.query(
      `select internal.pipeline_action_errors($1::jsonb) as errors`,
      [
        JSON.stringify([
          {
            name: 'finish',
            operation: 'set_step_done',
            arguments: { p_block_id: '00000000-0000-4000-8000-000000000001' },
          },
          {
            name: 'result',
            operation: 'add_step_result',
            arguments: { p_block_id: '00000000-0000-4000-8000-000000000001' },
          },
        ]),
      ],
    )
    // The result needs a label and a value, the finish needs only the step.
    expect(errors.rows[0].errors).toHaveLength(2)
  })
})
