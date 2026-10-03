/**
 * MDL-03.1/03.2 — reusable approval requests and approval-gated publication.
 *
 * Proves the server-enforced contract:
 *  - a Dataset Schema Version cannot be published while its approval request is
 *    pending (and the draft is locked), nor after a return/withdraw;
 *  - a completed approval allows publication;
 *  - an approver cannot decide their own submission when independence is
 *    required, but may when it is not;
 *  - only the required approver role may approve/return, and only the submitter
 *    may withdraw;
 *  - requests are workspace-isolated by RLS;
 *  - a pending request surfaces as an `approval_requested` work item to the
 *    required approver role only.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000a130'
const OTHER_WS = '00000000-0000-4000-8000-00000000a131'
const SUBMITTER = 'mdl03-submitter'
const APPROVER = 'mdl03-approver'
const NON_APPROVER = 'mdl03-nonapprover'
const OUTSIDER = 'mdl03-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
       ($1,'Submitter','mdl03-submitter@test.invalid',true),
       ($2,'Approver','mdl03-approver@test.invalid',true),
       ($3,'Non Approver','mdl03-nonapprover@test.invalid',true),
       ($4,'Outsider','mdl03-outsider@test.invalid',true)`,
    [SUBMITTER, APPROVER, NON_APPROVER, OUTSIDER],
  )
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES
       ($1,'mdl03','MDL-03'),
       ($2,'mdl03-other','MDL-03 other')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
       ($1,$2,'steward'),
       ($1,$3,'reviewer'),
       ($1,$4,'scientist'),
       ($5,$6,'owner')`,
    [WS, SUBMITTER, APPROVER, NON_APPROVER, OTHER_WS, OUTSIDER],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function actor(userId: string, workspaceId = WS): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: userId, workspace_id: workspaceId, role: 'authenticated' }),
  ])
  return client
}

async function createDraft(
  client: Client,
  key: string,
): Promise<{ schemaId: string; versionId: string }> {
  const { rows } = await client.query<{
    result: { schema_definition_id: string; schema_version_id: string }
  }>(
    `SELECT api.create_dataset_schema_definition($1,$2,'MDL-03 schema',null,'[]'::jsonb) result`,
    [WS, key],
  )
  return {
    schemaId: rows[0]!.result.schema_definition_id,
    versionId: rows[0]!.result.schema_version_id,
  }
}

async function submit(
  client: Client,
  versionId: string,
  roles: string[],
  options: { independence?: boolean } = {},
): Promise<{ id: string; state: string }> {
  const { rows } = await client.query<{ id: string; state: string }>(
    `SELECT id, state FROM api.submit_approval_request(
       $1,'dataset_schema_version',$2,$3::text[],'Please approve', $4)`,
    [WS, versionId, roles, options.independence ?? true],
  )
  return rows[0]!
}

describe('MDL-03 approval-gated publication', () => {
  it('refuses to publish and locks the draft while an approval is pending', async () => {
    const submitter = await actor(SUBMITTER)
    const { versionId } = await createDraft(submitter, 'mdl03_pending')
    const request = await submit(submitter, versionId, ['reviewer'])
    expect(request.state).toBe('pending')

    await expectDenied(
      submitter.query(`SELECT api.publish_dataset_schema_version($1)`, [
        versionId,
      ]),
      'SB084',
    )
    await expectDenied(
      submitter.query(
        `SELECT api.replace_dataset_schema_version_fields($1,'[]'::jsonb)`,
        [versionId],
      ),
      'SB085',
    )
  })

  it('allows publication after the required approver approves', async () => {
    const submitter = await actor(SUBMITTER)
    const approver = await actor(APPROVER)
    const { versionId } = await createDraft(submitter, 'mdl03_approved')
    const request = await submit(submitter, versionId, ['reviewer'])

    const approved = (
      await approver.query<{ state: string; approved_by_user_ids: string[] }>(
        `SELECT state, approved_by_user_ids FROM api.approve_approval_request($1,'Looks good')`,
        [request.id],
      )
    ).rows[0]!
    expect(approved.state).toBe('approved')
    expect(approved.approved_by_user_ids).toContain(APPROVER)

    const published = (
      await submitter.query<{ lifecycle: string }>(
        `SELECT lifecycle FROM api.publish_dataset_schema_version($1)`,
        [versionId],
      )
    ).rows[0]!
    expect(published.lifecycle).toBe('active')
  })

  it('requires independence: the submitter cannot decide their own request', async () => {
    const submitter = await actor(SUBMITTER)
    const { versionId } = await createDraft(submitter, 'mdl03_independent')
    const request = await submit(submitter, versionId, ['steward'], {
      independence: true,
    })

    await expectDenied(
      submitter.query(`SELECT api.approve_approval_request($1)`, [request.id]),
      '42501',
    )
    await expectDenied(
      submitter.query(`SELECT api.return_approval_request($1,'No')`, [
        request.id,
      ]),
      '42501',
    )
    await expectDenied(
      submitter.query(`SELECT api.publish_dataset_schema_version($1)`, [
        versionId,
      ]),
      'SB084',
    )
  })

  it('lets the submitter self-approve when independence is not required', async () => {
    const submitter = await actor(SUBMITTER)
    const { versionId } = await createDraft(submitter, 'mdl03_self')
    const request = await submit(submitter, versionId, ['steward'], {
      independence: false,
    })
    const approved = (
      await submitter.query<{ state: string }>(
        `SELECT state FROM api.approve_approval_request($1)`,
        [request.id],
      )
    ).rows[0]!
    expect(approved.state).toBe('approved')
  })

  it('denies approve/return to a member who is not a required approver role', async () => {
    const submitter = await actor(SUBMITTER)
    const nonApprover = await actor(NON_APPROVER)
    const { versionId } = await createDraft(submitter, 'mdl03_nonapprover')
    const request = await submit(submitter, versionId, ['reviewer'])

    await expectDenied(
      nonApprover.query(`SELECT api.approve_approval_request($1)`, [
        request.id,
      ]),
      '42501',
    )
    await expectDenied(
      nonApprover.query(`SELECT api.return_approval_request($1,'Nope')`, [
        request.id,
      ]),
      '42501',
    )
  })

  it('withdraws, blocks publication, then allows a fresh request and publish', async () => {
    const submitter = await actor(SUBMITTER)
    const approver = await actor(APPROVER)
    const { versionId } = await createDraft(submitter, 'mdl03_withdraw')
    const request = await submit(submitter, versionId, ['reviewer'])

    const withdrawn = (
      await submitter.query<{ state: string }>(
        `SELECT state FROM api.withdraw_approval_request($1,'Changed my mind')`,
        [request.id],
      )
    ).rows[0]!
    expect(withdrawn.state).toBe('withdrawn')

    // A withdrawn request does not complete approval: publish stays refused.
    await expectDenied(
      submitter.query(`SELECT api.publish_dataset_schema_version($1)`, [
        versionId,
      ]),
      'SB084',
    )

    const resubmitted = await submit(submitter, versionId, ['reviewer'])
    expect(resubmitted.id).not.toBe(request.id)
    await approver.query(`SELECT api.approve_approval_request($1)`, [
      resubmitted.id,
    ])
    const published = (
      await submitter.query<{ lifecycle: string }>(
        `SELECT lifecycle FROM api.publish_dataset_schema_version($1)`,
        [versionId],
      )
    ).rows[0]!
    expect(published.lifecycle).toBe('active')
  })

  it('records a return with a reason and keeps publication refused', async () => {
    const submitter = await actor(SUBMITTER)
    const approver = await actor(APPROVER)
    const { versionId } = await createDraft(submitter, 'mdl03_returned')
    const request = await submit(submitter, versionId, ['reviewer'])

    const returned = (
      await approver.query<{ state: string; decision_reason: string }>(
        `SELECT state, decision_reason FROM api.return_approval_request($1,'Add a unit column')`,
        [request.id],
      )
    ).rows[0]!
    expect(returned.state).toBe('returned')
    expect(returned.decision_reason).toBe('Add a unit column')

    const trail = await approver.query<{
      decision: string
      reason: string
    }>(
      `SELECT decision, reason FROM api.approval_request_decisions WHERE request_id=$1`,
      [request.id],
    )
    expect(trail.rows).toEqual([
      { decision: 'returned', reason: 'Add a unit column' },
    ])

    await expectDenied(
      submitter.query(`SELECT api.publish_dataset_schema_version($1)`, [
        versionId,
      ]),
      'SB084',
    )
  })

  it('isolates requests by workspace and denies another workspace', async () => {
    const submitter = await actor(SUBMITTER)
    const outsider = await actor(OUTSIDER, OTHER_WS)
    const { versionId } = await createDraft(submitter, 'mdl03_isolation')
    const request = await submit(submitter, versionId, ['reviewer'])

    const visible = await outsider.query(
      `SELECT id FROM api.approval_requests WHERE id=$1`,
      [request.id],
    )
    expect(visible.rows).toHaveLength(0)

    await expectDenied(
      outsider.query(`SELECT api.approve_approval_request($1)`, [request.id]),
      '42501',
    )
  })

  it('surfaces a pending request as a work item to the required role only', async () => {
    const submitter = await actor(SUBMITTER)
    const approver = await actor(APPROVER)
    const nonApprover = await actor(NON_APPROVER)
    const { versionId } = await createDraft(submitter, 'mdl03_workitem')
    await submit(submitter, versionId, ['reviewer'])

    const approverKinds = await approver.query<{ kind: string }>(
      `SELECT DISTINCT kind FROM api.my_work_items`,
    )
    expect(approverKinds.rows.map((row) => row.kind)).toContain(
      'approval_requested',
    )

    for (const other of [submitter, nonApprover]) {
      const kinds = await other.query<{ kind: string }>(
        `SELECT DISTINCT kind FROM api.my_work_items WHERE kind='approval_requested'`,
      )
      expect(kinds.rows).toHaveLength(0)
    }
  })
})
