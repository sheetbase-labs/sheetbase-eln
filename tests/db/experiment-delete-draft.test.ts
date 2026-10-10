/**
 * EXP-03.5 — delete a draft experiment, and never reuse its identifier.
 *
 * A draft has no evidence, so its author may clear it away. Anything with
 * evidentiary weight refuses, and internal.id_sequences only ever advances, so a
 * deleted draft's identifier is not handed out again.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  expectDenied,
  grantProjectAccess,
  prepareTestDatabase,
  setActorJwt,
} from './helpers'

const WS = '00000000-0000-4000-8000-00000000e000'
const PROJECT = '00000000-0000-4000-8000-00000000e001'
const AUTHOR = 'exp035-author'
const MEMBER = 'exp035-member'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [AUTHOR, MEMBER]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'exp035','EXP-03.5')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
     ($1,$2,'owner'),($1,$3,'member')`,
    [WS, AUTHOR, MEMBER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values($1,$2,'E35','Drafts',$3)`,
    [PROJECT, WS, AUTHOR],
  )
  for (const user of [AUTHOR, MEMBER]) {
    await grantProjectAccess(migrator, {
      workspaceId: WS,
      projectId: PROJECT,
      userId: user,
      canView: true,
      canEdit: true,
    })
  }
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

async function createDraft(
  client: Client,
): Promise<{ id: string; identifier: string }> {
  const { rows } = await client.query<{ id: string }>(
    `select (api.create_record($1,'experiment','Draft experiment')).id`,
    [PROJECT],
  )
  const record = await migrator.query<{ identifier: string }>(
    'select identifier from api.records where id=$1',
    [rows[0]!.id],
  )
  return { id: rows[0]!.id, identifier: record.rows[0]!.identifier }
}

async function statusOf(id: string): Promise<string | undefined> {
  const { rows } = await migrator.query<{ status: string }>(
    'select status from api.records where id=$1',
    [id],
  )
  return rows[0]?.status
}

describe('EXP-03.5 delete draft experiment', () => {
  it('lets the author delete a draft and never reuses its identifier', async () => {
    const author = await actor(AUTHOR)

    const first = await createDraft(author)
    expect(first.identifier).toBeTruthy()
    await author.query('select api.delete_experiment_draft($1)', [first.id])
    expect(await statusOf(first.id)).toBeUndefined()

    // The audit trail keeps the deletion.
    const events = await migrator.query<{ operation: string }>(
      `select operation from api.change_events where record_id=$1 and entity_type='record'`,
      [first.id],
    )
    expect(events.rows.map((row) => row.operation)).toContain('delete')

    const second = await createDraft(author)
    expect(second.identifier).not.toBe(first.identifier)

    // Deleting the second one still does not release either identifier.
    await author.query('select api.delete_experiment_draft($1)', [second.id])
    const third = await createDraft(author)
    expect(third.identifier).not.toBe(first.identifier)
    expect(third.identifier).not.toBe(second.identifier)
  })

  it('refuses anything that is not a draft', async () => {
    const author = await actor(AUTHOR)
    const started = await createDraft(author)
    await migrator.query(
      `update api.records set status='in_progress' where id=$1`,
      [started.id],
    )

    await expectDenied(
      author.query('select api.delete_experiment_draft($1)', [started.id]),
      'SB122',
    )
    expect(await statusOf(started.id)).toBe('in_progress')
  })

  it('refuses a draft that already has evidence', async () => {
    const author = await actor(AUTHOR)
    const draft = await createDraft(author)
    await migrator.query(
      `insert into api.revisions(record_id,structure_version,metadata_version,metadata_snapshot,
                                 block_snapshot,reason,created_by_user_id,updated_at)
       values($1,1,1,'{"title":"Draft"}'::jsonb,'[]'::jsonb,'submit',$2,now())`,
      [draft.id, AUTHOR],
    )
    await expectDenied(
      author.query('select api.delete_experiment_draft($1)', [draft.id]),
      'SB122',
    )
    expect(await statusOf(draft.id)).toBe('draft')
  })

  it('refuses a member who is not the author', async () => {
    const author = await actor(AUTHOR)
    const draft = await createDraft(author)

    const member = await actor(MEMBER)
    await expectDenied(
      member.query('select api.delete_experiment_draft($1)', [draft.id]),
      '42501',
    )
    expect(await statusOf(draft.id)).toBe('draft')
  })
})
