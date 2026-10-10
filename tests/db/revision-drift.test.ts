/**
 * REV-04.1 — the evidence view compares a signed revision with live data.
 *
 * The frozen revision itself is carried by api.revision_evidence_package; this
 * read model reports what moved since: the record's name as signed versus now,
 * comments added after signing, and cited dataset versions against their latest.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { grantProjectAccess, prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-000000010000'
const PROJECT = '00000000-0000-4000-8000-000000010001'
const RECORD = '00000000-0000-4000-8000-000000010002'
const REVISION = '00000000-0000-4000-8000-000000010003'
const AUTHOR = 'rev041-author'

type Drift = {
  drifted: boolean
  record: { signedTitle: string | null; currentTitle: string; renamed: boolean }
  datasets: Array<{
    changed: boolean
    citedVersionId: string
    latestVersionId: string | null
  }>
  commentsAfterSigning: number
}

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
    [AUTHOR, `${AUTHOR}@test.invalid`],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'rev041','REV-04.1')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$2,'owner')`,
    [WS, AUTHOR],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values($1,$2,'R41','Drift',$3)`,
    [PROJECT, WS, AUTHOR],
  )
  await grantProjectAccess(migrator, {
    workspaceId: WS,
    projectId: PROJECT,
    userId: AUTHOR,
    canView: true,
    canEdit: true,
  })
  await migrator.query(
    `insert into api.records(id,workspace_id,project_id,kind,identifier,title,status,created_by_user_id)
     values($1,$2,$3,'experiment','EXP-DRIFT','Signed name','draft',$4)`,
    [RECORD, WS, PROJECT, AUTHOR],
  )
  await migrator.query(
    `insert into api.revisions(id,record_id,workspace_id,structure_version,metadata_version,
       metadata_snapshot,block_snapshot,integrity_digest,reason,created_by_user_id,created_at,updated_at)
     values($1,$2,$3,1,1,'{"title":"Signed name"}'::jsonb,'[]'::jsonb,repeat('a',64),'submit',$4,
            now() - interval '2 days', now() - interval '2 days')`,
    [REVISION, RECORD, WS, AUTHOR],
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

async function drift(client: Client): Promise<Drift> {
  return (
    await client.query<{ result: Drift }>(
      'select api.revision_drift($1) as result',
      [REVISION],
    )
  ).rows[0]!.result
}

describe('REV-04.1 revision drift', () => {
  it('reports no drift while the record still matches what was signed', async () => {
    const result = await drift(await actor(AUTHOR))
    expect(result.drifted).toBe(false)
    expect(result.record).toMatchObject({
      signedTitle: 'Signed name',
      currentTitle: 'Signed name',
      renamed: false,
    })
    expect(result.commentsAfterSigning).toBe(0)
  })

  it('reports a renamed record with both names', async () => {
    await migrator.query(
      `update api.records set title='Renamed later' where id=$1`,
      [RECORD],
    )

    const result = await drift(await actor(AUTHOR))
    expect(result.drifted).toBe(true)
    expect(result.record).toMatchObject({
      signedTitle: 'Signed name',
      currentTitle: 'Renamed later',
      renamed: true,
    })

    await migrator.query(
      `update api.records set title='Signed name' where id=$1`,
      [RECORD],
    )
    expect((await drift(await actor(AUTHOR))).record.renamed).toBe(false)
  })

  it('counts comments added after the revision was frozen', async () => {
    await migrator.query(
      `insert into api.comments(id,root_id,workspace_id,record_id,revision_id,target_kind,target,body,author_user_id)
       values('00000000-0000-4000-8000-000000010004','00000000-0000-4000-8000-000000010004',
              $1,$2,$3,'revision','{}'::jsonb,'Added after signing',$4)`,
      [WS, RECORD, REVISION, AUTHOR],
    )

    const result = await drift(await actor(AUTHOR))
    expect(result.commentsAfterSigning).toBe(1)
    expect(result.drifted).toBe(true)
  })

  it('refuses a caller who cannot read the record', async () => {
    const outsider = 'rev041-outsider'
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [outsider, `${outsider}@test.invalid`],
    )
    const client = await asRole('authenticator')
    clients.push(client)
    await client.query('set role authenticated')
    await setActorJwt(client, outsider, WS)
    await expect(
      client.query('select api.revision_drift($1)', [REVISION]),
    ).rejects.toMatchObject({ code: '42501' })
  })
})
