/**
 * EXP-05.4 — a cell conflict keeps both sides and how it was settled.
 *
 * The replay (EXP-05.3) raises the conflict; this covers the record of it and the
 * resolution: both values with their authors and times survive, resolving requires a
 * reason, a second decision is refused, and the decision lands in the history attributed
 * to the person who made it.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-000000060000'
const PROJECT = '00000000-0000-4000-8000-000000060001'
const RECORD = '00000000-0000-4000-8000-000000060002'
const FIELD = '00000000-0000-4000-8000-000000060003'
const ROW_KEY = '00000000-0000-4000-8000-000000060004'
const USER = 'exp054-resolver'
const OTHER = 'exp054-other'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [USER, OTHER]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'exp054','EXP-05.4')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$2,'owner')`,
    [WS, USER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values($1,$2,'E54','Conflicts',$3)`,
    [PROJECT, WS, USER],
  )
  await migrator.query(
    `insert into api.records(id,workspace_id,project_id,kind,identifier,title,status,created_by_user_id)
     values($1,$2,$3,'experiment','EXP-054-0001','Conflict notebook','in_progress',$4)`,
    [RECORD, WS, PROJECT, USER],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function actor(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await setActorJwt(client, userId, WS)
  return client
}

/** A conflict as the offline replay would raise it: this device's edit, and theirs. */
async function raiseConflict(instanceId: string): Promise<string> {
  const { rows } = await migrator.query<{ id: string }>(
    `insert into api.sheet_cell_conflicts(
       workspace_id, sheet_instance_id, row_key, field_id,
       local_value, local_author_user_id, local_at,
       remote_value, remote_author_user_id, remote_at)
     values($1,$2,$3,$4,'{"v":"offline"}'::jsonb,$5,now() - interval '5 minutes',
            '{"v":"theirs"}'::jsonb,$6,now() - interval '10 minutes')
     returning id`,
    [WS, instanceId, ROW_KEY, FIELD, USER, OTHER],
  )
  return rows[0]!.id
}

async function createInstance(user: Client): Promise<string> {
  const { rows } = await user.query<{ result: { instance: { id: string } } }>(
    `select api.insert_sheet_instance_block($1,null,null,null) result`,
    [RECORD],
  )
  return rows[0]!.result.instance.id
}

describe('EXP-05.3 raising a conflict', () => {
  it('raises one open conflict per cell, idempotently, attributed to the caller', async () => {
    const user = await actor(USER)
    const instanceId = await createInstance(user)

    const raised = (
      await user.query(
        `select to_jsonb(api.record_cell_conflict($1,$2,$3,
           '{"v":"offline"}'::jsonb,$4,now() - interval '5 minutes',
           '{"v":"theirs"}'::jsonb,$5,now() - interval '10 minutes')) result`,
        [instanceId, ROW_KEY, FIELD, USER, OTHER],
      )
    ).rows[0].result as {
      id: string
      state: string
      local_author_user_id: string
    }

    expect(raised.state).toBe('open')
    expect(raised.local_author_user_id).toBe(USER)

    // A second replay of the same cell finds the conflict it already raised.
    const again = (
      await user.query(
        `select to_jsonb(api.record_cell_conflict($1,$2,$3,
           '{"v":"offline"}'::jsonb,$4,now(),null,null,null)) result`,
        [instanceId, ROW_KEY, FIELD, USER],
      )
    ).rows[0].result as { id: string }
    expect(again.id).toBe(raised.id)
    const count = await migrator.query<{ n: number }>(
      `select count(*)::int as n from api.sheet_cell_conflicts
        where sheet_instance_id=$1 and state='open'`,
      [instanceId],
    )
    expect(count.rows[0]!.n).toBe(1)
  })

  it('refuses to attribute the conflict to somebody else', async () => {
    const user = await actor(USER)
    const instanceId = await createInstance(user)
    await expect(
      user.query(
        `select api.record_cell_conflict($1,$2,$3,'{"v":"x"}'::jsonb,$4,now()) result`,
        [instanceId, ROW_KEY, FIELD, OTHER],
      ),
    ).rejects.toThrow(/whose edit it is/)
  })

  it('keeps the table closed to direct writes', async () => {
    const user = await actor(USER)
    const instanceId = await createInstance(user)
    await expect(
      user.query(
        `insert into api.sheet_cell_conflicts(
           workspace_id, sheet_instance_id, row_key, field_id,
           local_value, local_author_user_id, local_at)
         values($1,$2,$3,$4,'{"v":"x"}'::jsonb,$5,now())`,
        [WS, instanceId, ROW_KEY, FIELD, USER],
      ),
    ).rejects.toThrow()
  })
})

describe('EXP-05.4 cell conflicts', () => {
  it('keeps both sides and records the resolution with its reason', async () => {
    const user = await actor(USER)
    const instanceId = await createInstance(user)
    const conflictId = await raiseConflict(instanceId)

    const resolved = (
      await user.query(
        `select to_jsonb(api.resolve_cell_conflict($1,'{"v":"decided"}'::jsonb,'the offline value was measured later')) result`,
        [conflictId],
      )
    ).rows[0].result as {
      state: string
      resolved_by_user_id: string
      reason: string
      local_value: { v: string }
      remote_value: { v: string }
    }
    expect(resolved.state).toBe('resolved')
    expect(resolved.resolved_by_user_id).toBe(USER)
    expect(resolved.reason).toContain('measured later')
    // Both sides survive the decision — that is the point of recording it.
    expect(resolved.local_value).toEqual({ v: 'offline' })
    expect(resolved.remote_value).toEqual({ v: 'theirs' })

    const { rows: resolvedValue } = await migrator.query<{
      resolved_value: unknown
    }>(`select resolved_value from api.sheet_cell_conflicts where id=$1`, [
      conflictId,
    ])
    expect(resolvedValue[0]!.resolved_value).toEqual({ v: 'decided' })

    // The decision is in the history, under the resolver's name.
    const events = await migrator.query<{ payload: Record<string, unknown> }>(
      `select payload from api.change_events
        where entity_type='scientific_row' and entity_uuid=$1
        order by created_at desc limit 1`,
      [instanceId],
    )
    expect(events.rows[0]!.payload).toMatchObject({
      conflict: 'cell',
      resolvedBy: USER,
    })

    // A second decision is not a second decision.
    await expect(
      user.query(
        `select api.resolve_cell_conflict($1,'{"v":"again"}'::jsonb,'changed my mind') result`,
        [conflictId],
      ),
    ).rejects.toThrow(/already resolved/)
  })

  it('refuses a resolution without a reason', async () => {
    const user = await actor(USER)
    const instanceId = await createInstance(user)
    const conflictId = await raiseConflict(instanceId)
    await expect(
      user.query(
        `select api.resolve_cell_conflict($1,'{"v":"decided"}'::jsonb,'   ') result`,
        [conflictId],
      ),
    ).rejects.toThrow(/reason is required/)
  })

  it('lists an open conflict for the person whose edit conflicted, and drops it once resolved', async () => {
    const user = await actor(USER)
    const instanceId = await createInstance(user)
    const conflictId = await raiseConflict(instanceId)

    const listed = await user.query<{ kind: string; reason: string }>(
      `select kind, reason from api.my_work_items
        where kind='cell_conflict' and source_id=$1`,
      [conflictId],
    )
    expect(listed.rows).toHaveLength(1)
    expect(listed.rows[0]!.reason).toContain('two places')

    // Somebody who did not raise the conflicting edit has no such item.
    const other = await actor(OTHER)
    const hidden = await other.query(
      `select kind from api.my_work_items where kind='cell_conflict'`,
    )
    expect(hidden.rows).toEqual([])

    await user.query(
      `select api.resolve_cell_conflict($1,'{"v":"decided"}'::jsonb,'settled') result`,
      [conflictId],
    )
    const after = await user.query(
      `select kind from api.my_work_items
        where kind='cell_conflict' and source_id=$1`,
      [conflictId],
    )
    expect(after.rows).toEqual([])
  })

  it('shows a conflict only to its own workspace', async () => {
    const user = await actor(USER)
    const instanceId = await createInstance(user)
    await raiseConflict(instanceId)
    const seen = await user.query(
      `select id from api.sheet_cell_conflicts where sheet_instance_id=$1`,
      [instanceId],
    )
    expect(seen.rows).toHaveLength(1)

    const other = await actor(OTHER)
    const hidden = await other.query(
      `select id from api.sheet_cell_conflicts where sheet_instance_id=$1`,
      [instanceId],
    )
    expect(hidden.rows).toEqual([])
  })
})
