/**
 * A personal token (a `credential_id`, no `session_id`) may decide an approval
 * request as its owner, with every existing rule still applying. In a regulated
 * lab the same call needs a signed-in session.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-00000000a190'
const SUBMITTER = 'tok-appr-submitter'
const APPROVER = 'tok-appr-approver'
const CREDENTIAL = '00000000-0000-4000-8000-00000000a191'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
       ($1,'Submitter','tok-appr-submitter@test.invalid',true),
       ($2,'Approver','tok-appr-approver@test.invalid',true)`,
    [SUBMITTER, APPROVER],
  )
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ($1,'tok-appr','Token approvals')`,
    [WS],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
       ($1,$2,'steward'),($1,$3,'reviewer')`,
    [WS, SUBMITTER, APPROVER],
  )
  await migrator.query(
    `INSERT INTO internal.api_credentials(id,workspace_id,display_prefix,secret_hash,name,scopes,created_by_user_id,kind)
     VALUES ($1,$2,'sbtokappr','x','Approver token',ARRAY['reviews:write'],$3,'personal')`,
    [CREDENTIAL, WS, APPROVER],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function actor(
  userId: string,
  extra: Record<string, unknown> = {},
): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await setActorJwt(client, userId, WS, extra)
  return client
}

async function request(key: string): Promise<string> {
  const submitter = await actor(SUBMITTER)
  const { rows } = await submitter.query<{
    result: { schema_version_id: string }
  }>(
    `SELECT api.create_dataset_schema_definition($1,$2,'Token approvals',null,'[]'::jsonb) result`,
    [WS, key],
  )
  const made = await submitter.query<{ id: string }>(
    `SELECT id FROM api.submit_approval_request(
       $1,'dataset_schema_version',$2,ARRAY['reviewer']::text[],'Please approve')`,
    [WS, rows[0]!.result.schema_version_id],
  )
  return made.rows[0]!.id
}

describe('approving as a personal token', () => {
  it('lets a token approve as its owner when the lab is not regulated', async () => {
    const id = await request('tok_appr_open')
    const token = await actor(APPROVER, { credential_id: CREDENTIAL })
    const { rows } = await token.query<{ state: string }>(
      'SELECT state FROM api.approve_approval_request($1,$2)',
      [id, 'looks fine'],
    )
    expect(rows[0]!.state).toBe('approved')
  })

  it('still applies the approver role', async () => {
    const id = await request('tok_appr_role')
    const token = await actor(SUBMITTER, { credential_id: CREDENTIAL })
    await expectDenied(
      token.query('SELECT api.approve_approval_request($1)', [id]),
      '42501',
    )
  })

  it('keeps it in the app in a regulated lab', async () => {
    const id = await request('tok_appr_regulated')
    await migrator.query(
      `INSERT INTO api.workspace_settings(workspace_id,created_by_user_id,regulated_lab)
       VALUES ($1,$2,true)
       ON CONFLICT(workspace_id) DO UPDATE SET regulated_lab=true`,
      [WS, SUBMITTER],
    )
    const token = await actor(APPROVER, { credential_id: CREDENTIAL })
    await expectDenied(
      token.query('SELECT api.approve_approval_request($1)', [id]),
      '42501',
    )
    await expectDenied(
      token.query('SELECT api.return_approval_request($1,$2)', [id, 'no']),
      '42501',
    )
    const inApp = await actor(APPROVER, { session_id: 'tok-appr-session' })
    const { rows } = await inApp.query<{ state: string }>(
      'SELECT state FROM api.approve_approval_request($1)',
      [id],
    )
    expect(rows[0]!.state).toBe('approved')
    await migrator.query(
      'UPDATE api.workspace_settings SET regulated_lab=false WHERE workspace_id=$1',
      [WS],
    )
  })
})
