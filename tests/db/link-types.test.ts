/**
 * EXP-02.3 — `follows` and `upstream` link types.
 *
 * The overview links an experiment to the one it follows and to its upstream work.
 * Those are record links, so the vocabulary the table enforces is what makes them
 * expressible; anything outside it is still refused.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  expectDenied,
  grantProjectAccess,
  prepareTestDatabase,
  setActorJwt,
} from './helpers'

const WS = '00000000-0000-4000-8000-000000040000'
const PROJECT = '00000000-0000-4000-8000-000000040001'
const SUBJECT = '00000000-0000-4000-8000-000000040002'
const UPSTREAM = '00000000-0000-4000-8000-000000040003'
const FOLLOWED = '00000000-0000-4000-8000-000000040004'
const USER = 'exp023-links'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
    [USER, `${USER}@test.invalid`],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'exp023l','EXP-02.3')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$2,'owner')`,
    [WS, USER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values($1,$2,'E23L','Links',$3)`,
    [PROJECT, WS, USER],
  )
  await grantProjectAccess(migrator, {
    workspaceId: WS,
    projectId: PROJECT,
    userId: USER,
    canView: true,
    canEdit: true,
  })
  for (const [id, identifier, title] of [
    [SUBJECT, 'EXP-023-0001', 'Subject experiment'],
    [UPSTREAM, 'EXP-023-0002', 'Upstream experiment'],
    [FOLLOWED, 'EXP-023-0003', 'Followed experiment'],
  ]) {
    await migrator.query(
      `insert into api.records(id,workspace_id,project_id,kind,identifier,title,status,created_by_user_id)
       values($1,$2,$3,'experiment',$4,$5,'in_progress',$6)`,
      [id, WS, PROJECT, identifier, title, USER],
    )
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

describe('EXP-02.3 link types', () => {
  it('accepts a follows link and an upstream link between experiments', async () => {
    const owner = await actor(USER)

    await owner.query(
      `select api.create_record_link($1,'experiment','EXP-023-0003','follows')`,
      [SUBJECT],
    )
    await owner.query(
      `select api.create_record_link($1,'experiment','EXP-023-0002','upstream')`,
      [SUBJECT],
    )

    const { rows } = await migrator.query<{
      link_type: string
      target_identifier: string
    }>(
      `select link_type, target_identifier from api.record_links where source_record_id=$1 order by link_type`,
      [SUBJECT],
    )
    expect(rows).toEqual([
      { link_type: 'follows', target_identifier: 'EXP-023-0003' },
      { link_type: 'upstream', target_identifier: 'EXP-023-0002' },
    ])
  })

  it('still refuses a link type outside the vocabulary', async () => {
    const owner = await actor(USER)
    await expectDenied(
      owner.query(
        `select api.create_record_link($1,'experiment','EXP-023-0002','sideways')`,
        [SUBJECT],
      ),
      '23514',
    )
  })
})
