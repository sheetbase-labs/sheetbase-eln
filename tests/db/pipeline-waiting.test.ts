/**
 * PIPE-02.1 — a run can wait for a person.
 *
 * The migration adds `waiting` to the run status and the prompt table that records
 * what was asked and who answered. The prompt is readable by the workspace that
 * owns the run; writes stay with the executor.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-000000050000'
const OTHER_WS = '00000000-0000-4000-8000-000000050010'
const DEF = '00000000-0000-4000-8000-000000050001'
const VERSION = '00000000-0000-4000-8000-000000050002'
const RUN = '00000000-0000-4000-8000-000000050003'
const MEMBER = 'pipe021-member'
const OUTSIDER = 'pipe021-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [MEMBER, OUTSIDER]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(`insert into api.workspaces(id,slug,name) values($1,'pipe021','PIPE-02.1')`, [
    WS,
  ])
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'pipe021b','PIPE-02.1 other')`,
    [OTHER_WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$2,'owner')`,
    [WS, MEMBER],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$2,'owner')`,
    [OTHER_WS, OUTSIDER],
  )
  await migrator.query(
    `insert into api.pipeline_definitions(id,workspace_id,key,name) values($1,$2,'pipe021','PIPE-02.1')`,
    [DEF, WS],
  )
  await migrator.query(
    `insert into api.pipeline_definition_versions(id,definition_id,workspace_id,version,lifecycle,configuration)
     values($1,$2,$3,1,'published','{}'::jsonb)`,
    [VERSION, DEF, WS],
  )
  await migrator.query(
    `insert into api.pipeline_runs(id,workspace_id,definition_version_id,trigger_kind,status,parameters,input_versions,actor_user_id)
     values($1,$2,$3,'manual','running','{}'::jsonb,'{}'::jsonb,$4)`,
    [RUN, WS, VERSION, MEMBER],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function actor(userId: string, workspaceId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await setActorJwt(client, userId, workspaceId)
  return client
}

describe('PIPE-02.1 waiting runs', () => {
  it('accepts waiting as a run status and still refuses an unknown one', async () => {
    await migrator.query(`update api.pipeline_runs set status='waiting' where id=$1`, [RUN])
    const { rows } = await migrator.query<{ status: string }>(
      `select status from api.pipeline_runs where id=$1`,
      [RUN],
    )
    expect(rows[0]!.status).toBe('waiting')

    await expectDenied(
      migrator.query(`update api.pipeline_runs set status='paused' where id=$1`, [RUN]),
      '23514',
    )
  })

  it('records what was asked, and requires an author with the answer', async () => {
    await migrator.query(
      `insert into api.pipeline_run_prompts(run_id,workspace_id,step_id,form_schema,asked_user_ids,expires_at)
       values($1,$2,'confirm-units','{"fields":["unitsPerColumn"]}'::jsonb,'{"${MEMBER}"}'::text[],now() + interval '2 days')`,
      [RUN, WS],
    )
    const { rows } = await migrator.query<{
      step_id: string
      asked_user_ids: string[]
      answer: unknown
    }>(
      `select step_id, asked_user_ids, answer from api.pipeline_run_prompts where run_id=$1`,
      [RUN],
    )
    expect(rows[0]!.step_id).toBe('confirm-units')
    expect(rows[0]!.asked_user_ids).toEqual([MEMBER])
    expect(rows[0]!.answer).toBeNull()

    // An answer without its author (or time) is not an answer.
    await expectDenied(
      migrator.query(
        `insert into api.pipeline_run_prompts(run_id,workspace_id,step_id,answer)
         values($1,$2,'confirm-units','{"unitsPerColumn":4}'::jsonb)`,
        [RUN, WS],
      ),
      '23514',
    )

    await migrator.query(
      `update api.pipeline_run_prompts
          set answer='{"unitsPerColumn":4}'::jsonb, answered_by_user_id=$2, answered_at=now()
        where run_id=$1`,
      [RUN, MEMBER],
    )
    const answered = await migrator.query<{ answered_by_user_id: string }>(
      `select answered_by_user_id from api.pipeline_run_prompts where run_id=$1`,
      [RUN],
    )
    expect(answered.rows[0]!.answered_by_user_id).toBe(MEMBER)
  })

  it('shows the prompt to its own workspace and nothing to another', async () => {
    const member = await actor(MEMBER, WS)
    const seen = await member.query(`select id from api.pipeline_run_prompts`)
    expect(seen.rows).toHaveLength(1)

    const outsider = await actor(OUTSIDER, OTHER_WS)
    const hidden = await outsider.query(`select id from api.pipeline_run_prompts`)
    expect(hidden.rows).toEqual([])
  })
})
