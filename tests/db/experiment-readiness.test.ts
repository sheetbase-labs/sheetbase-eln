/**
 * EXP-02.1 — readiness on the server.
 *
 * api.experiment_readiness reports validation errors, open comment threads and
 * empty required Sheet parameters; the submit RPC reads the same function, so the
 * list the author reads and the block that stops them cannot disagree.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { validSheetDefinitionConfiguration } from '../fixtures/sheet-definition'
import {
  ensureSessions,
  expectDenied,
  grantProjectAccess,
  prepareTestDatabase,
  setActorJwt,
} from './helpers'

const WS = '00000000-0000-4000-8000-00000000f000'
const PROJECT = '00000000-0000-4000-8000-00000000f001'
const RECORD = '00000000-0000-4000-8000-00000000f002'
const REVISION = '00000000-0000-4000-8000-00000000f003'
const COMMENT = '00000000-0000-4000-8000-00000000f004'
const AUTHOR = 'exp021-author'
const REVIEWER = 'exp021-reviewer'

type Readiness = {
  ready: boolean
  validationErrors: Array<{ checkDefinitionKey: string; overallStatus: string }>
  openCommentThreads: Array<{ commentId: string }>
  emptyRequiredFields: Array<{ parameterKey: string; instanceId: string }>
}

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [AUTHOR, REVIEWER]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'exp021','EXP-02.1')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
     ($1,$2,'owner'),($1,$3,'member')`,
    [WS, AUTHOR, REVIEWER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values($1,$2,'E21','Readiness',$3)`,
    [PROJECT, WS, AUTHOR],
  )
  for (const user of [AUTHOR, REVIEWER]) {
    await grantProjectAccess(migrator, {
      workspaceId: WS,
      projectId: PROJECT,
      userId: user,
      canView: true,
      canEdit: true,
    })
  }
  await ensureSessions(migrator, [AUTHOR, REVIEWER])
  await migrator.query(
    `insert into api.records(id,workspace_id,project_id,kind,identifier,title,status,created_by_user_id)
     values($1,$2,$3,'experiment','EXP-READY','Readiness record','draft',$4)`,
    [RECORD, WS, PROJECT, AUTHOR],
  )
  await migrator.query(
    `insert into api.revisions(id,record_id,workspace_id,structure_version,metadata_version,
       metadata_snapshot,block_snapshot,integrity_digest,reason,created_by_user_id)
     values($1,$2,$3,1,1,'{}'::jsonb,'[]'::jsonb,repeat('a',64),'submit',$4)`,
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
  await setActorJwt(client, userId, WS, { session_id: `session-${userId}` })
  return client
}

async function readiness(client: Client): Promise<Readiness> {
  return (
    await client.query<{ result: Readiness }>(
      'select api.experiment_readiness($1) as result',
      [RECORD],
    )
  ).rows[0]!.result
}

async function openComment(id: string, body: string) {
  await migrator.query(
    `insert into api.comments(id,root_id,workspace_id,record_id,revision_id,target_kind,target,body,author_user_id)
     values($1,$1,$2,$3,$4,'revision','{}'::jsonb,$5,$6)`,
    [id, WS, RECORD, REVISION, body, REVIEWER],
  )
}

describe('EXP-02.1 experiment readiness', () => {
  it('reports a clean record as ready', async () => {
    const author = await actor(AUTHOR)
    const result = await readiness(author)
    expect(result.ready).toBe(true)
    expect(result.validationErrors).toEqual([])
    expect(result.openCommentThreads).toEqual([])
    expect(result.emptyRequiredFields).toEqual([])
  })

  it('reports an open comment thread and clears when it is resolved', async () => {
    const author = await actor(AUTHOR)
    await openComment(COMMENT, 'Please check this')

    const open = await readiness(author)
    expect(open.ready).toBe(false)
    expect(open.openCommentThreads.map((row) => row.commentId)).toEqual([
      COMMENT,
    ])

    await migrator.query(
      `update api.comments set state='resolved', resolved_at=now(), resolved_by_user_id=$2 where id=$1`,
      [COMMENT, AUTHOR],
    )
    expect((await readiness(author)).ready).toBe(true)
  })

  it('reports a check that did not pass on the latest revision', async () => {
    const author = await actor(AUTHOR)
    await migrator.query(
      `insert into api.review_check_results(workspace_id,record_id,revision_id,check_definition_key,
         check_definition_version,revision_integrity_digest,check_definition_digest,input_digest,
         overall_status,pass_count,blocking_failure_count,warning_failure_count,info_failure_count,
         results,run_by_user_id,run_session_id,run_role,run_at,idempotency_key)
       values($1,$2,$3,'default-scientific-checks',1,repeat('a',64),repeat('b',64),repeat('c',64),
              'fail',0,1,0,0,'[{"location":{"sheet":"Results","cell":"C4"}}]'::jsonb,$4,'sess','author',now(),'readiness-check')`,
      [WS, RECORD, REVISION, AUTHOR],
    )

    const result = await readiness(author)
    expect(result.ready).toBe(false)
    expect(result.validationErrors).toHaveLength(1)
    expect(result.validationErrors[0]).toMatchObject({
      checkDefinitionKey: 'default-scientific-checks',
      overallStatus: 'fail',
    })

    await migrator.query(
      `delete from api.review_check_results where record_id=$1`,
      [RECORD],
    )
    expect((await readiness(author)).ready).toBe(true)
  })

  it('reports a required Sheet parameter that has no value and no binding', async () => {
    const author = await actor(AUTHOR)
    const created = (
      await author.query<{ result: { version: { id: string } } }>(
        `select api.create_sheet_definition($1,$2,$3,$4,$5::jsonb) result`,
        [
          WS,
          'readiness_definition',
          'Readiness sheet',
          'Readiness',
          JSON.stringify(validSheetDefinitionConfiguration()),
        ],
      )
    ).rows[0]!.result
    const versionId = created.version.id
    await author.query(`select api.publish_sheet_definition_version($1,$2)`, [
      versionId,
      1,
    ])

    // The resolver refuses a missing required parameter at creation, so this is an
    // instance whose definition later required something its state does not carry
    // (an upgrade or an imported instance). The state is still valid shape, which
    // is all the state validator requires.
    await migrator.query(
      `select set_config('sheetbase.sheet_instance_write','rpc-v1',false)`,
    )
    await migrator.query(
      `insert into api.sheet_instances(workspace_id,name,source_definition_version_id,project_id,
         notebook_record_id,state,created_by_user_id,updated_by_user_id)
       values($1,'Readiness sheet instance',$2,$3,$4,$5::jsonb,$6,$6)`,
      [
        WS,
        versionId,
        PROJECT,
        RECORD,
        JSON.stringify({
          bindings: [],
          localFields: [],
          localValues: {},
          calculationOverrides: {},
          presentation: {
            columnOrder: [],
            hiddenColumnIds: [],
            columnWidths: {},
            frozenColumnCount: 0,
            density: 'standard',
          },
          provenance: { createdFrom: 'definition_version' },
        }),
        AUTHOR,
      ],
    )

    const result = await readiness(author)
    expect(result.ready).toBe(false)
    const keys = result.emptyRequiredFields.map((row) => row.parameterKey)
    expect(keys).toContain('results')
    expect(keys).toContain('comparison')
  })

  it('stops the submit RPC for the same reason the list shows', async () => {
    const author = await actor(AUTHOR)
    await openComment('00000000-0000-4000-8000-00000000f005', 'Still open')

    const digest = (
      await author.query<{ result: { sourceDigest: string } }>(
        'select api.preview_submission_digest($1) as result',
        [RECORD],
      )
    ).rows[0]!.result.sourceDigest

    await expectDenied(
      author.query(
        `select api.submit_record_revision($1,$2,'default-scientific-review',1,$3,true,$4)`,
        [RECORD, digest, [REVIEWER], 'readiness-submit-blocked'],
      ),
      'SB123',
    )

    // Clear everything the list reports; the same submit then goes through.
    await migrator.query(
      `update api.comments set state='resolved', resolved_at=now(), resolved_by_user_id=$2
        where record_id=$1 and state='open'`,
      [RECORD, AUTHOR],
    )
    // Sheet instances cannot be deleted; archiving takes one out of readiness.
    await migrator.query(
      `select set_config('sheetbase.sheet_instance_write','rpc-v1',false)`,
    )
    await migrator.query(
      `update api.sheet_instances set lifecycle='archived' where notebook_record_id=$1`,
      [RECORD],
    )
    expect((await readiness(author)).ready).toBe(true)

    const submitted = await author.query<{
      result: { submission: { state: string } }
    }>(
      `select api.submit_record_revision($1,$2,'default-scientific-review',1,$3,true,$4) as result`,
      [RECORD, digest, [REVIEWER], 'readiness-submit-allowed'],
    )
    expect(submitted.rows[0]!.result.submission.state).toBe('submitted')
  })
})
