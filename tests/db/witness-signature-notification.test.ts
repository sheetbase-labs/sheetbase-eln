/**
 * WORK-03.2 — signature_requested, derived from a witness request.
 *
 * api.request_signature_witness already emits a review_submission update whose payload
 * names the action and the witness, so the notification is derived from that event
 * rather than needing a new producer. This test drives the trigger with that exact
 * payload shape; the producer itself is the existing RPC.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-000000060000'
const WITNESS = 'work032-witness'
const REQUESTER = 'work032-requester'

let migrator: Client

beforeAll(async () => {
  ;({ migrator } = await prepareTestDatabase())
  for (const user of [WITNESS, REQUESTER]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(`insert into api.workspaces(id,slug,name) values($1,'work032w','WORK-03.2')`, [
    WS,
  ])
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
     ($1,$2,'owner'),($1,$3,'member')`,
    [WS, REQUESTER, WITNESS],
  )
})

afterAll(async () => {
  await migrator?.end()
})

async function emitWitnessRequest(actor: string) {
  await migrator.query(
    `insert into api.change_events
       (id, workspace_id, sequence, entity_type, entity_uuid, operation, actor_user_id, payload)
     values (gen_random_uuid(), $1,
             (select coalesce(max(sequence), 0) + 1 from api.change_events where workspace_id = $1),
             'review_submission', gen_random_uuid(), 'update', $2,
             jsonb_build_object('action', 'witness-requested',
                                'witnessUserId', $3::text,
                                'requestId', gen_random_uuid(),
                                'submissionId', gen_random_uuid()))`,
    [WS, actor, WITNESS],
  )
}

describe('WORK-03.2 witness request notification', () => {
  it('notifies the witness and not the requester', async () => {
    await emitWitnessRequest(REQUESTER)

    const notes = await migrator.query<{ user_id: string; event_type: string }>(
      `select user_id, event_type from internal.notifications
        where event_type='signature_requested' order by user_id`,
    )
    expect(notes.rows.map((row) => row.user_id)).toEqual([WITNESS])
  })

  it('does not notify a witness who requested their own signature', async () => {
    await migrator.query(
      `delete from internal.notifications where workspace_id=$1 and event_type='signature_requested'`,
      [WS],
    )
    await emitWitnessRequest(WITNESS)
    const notes = await migrator.query(
      `select user_id from internal.notifications where event_type='signature_requested'`,
    )
    expect(notes.rows).toEqual([])
  })
})
