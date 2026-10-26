/**
 * Agent registry (migration 0018).
 *
 * - Workflows, runs and policy revisions are readable by members of the
 *   workspace and written only through the controlled functions.
 * - Pausing a workflow is for its owner or an administrator.
 * - Changing a policy needs a policy manager, a reason and a certified
 *   signature, and each change is the next numbered revision.
 * - A proposal that asks for a signature cannot be approved until it is signed,
 *   and one routed to a named approver is decided by that person or an admin.
 *
 * NOTE: requires a real PostgreSQL database; run via `pnpm test:db`.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase, setActorJwt } from './helpers'

const WS = 'a0180000-0000-4000-8000-000000000001'
const OTHER_WS = 'a0180000-0000-4000-8000-000000000002'
const OWNER = 'agentreg-owner'
const STEWARD = 'agentreg-steward'
const WRITER_A = 'agentreg-writer-a'
const WRITER_B = 'agentreg-writer-b'
const OUTSIDER = 'agentreg-outsider'
const CREDENTIAL = 'a0180000-0000-4000-8000-000000000003'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let definitionId: string

async function actor(userId: string, workspaceId = WS): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await setActorJwt(client, userId, workspaceId)
  return client
}

const policy = (overrides: Record<string, string> = {}) =>
  JSON.stringify({
    read: 'allowed',
    notebook_blocks: 'needs_approval',
    dataset_flags: 'never',
    create_records: 'never',
    messages: 'never',
    ...overrides,
  })

async function pendingProposal(
  key: string,
  extra: { approver?: string; signature?: boolean } = {},
): Promise<{ id: string; revision: string; display_id: string }> {
  const { rows } = await migrator.query(
    `INSERT INTO api.agent_operation_proposals
       (workspace_id, title, summary, operation_kind, operation, preview, impact,
        idempotency_key, request_digest, provenance, proposed_by_credential_id,
        agent_definition_id, approver_user_id, signature_required)
     VALUES ($1, 'Add a block', 'Adds a block', 'dataset_rows.commit', '{}'::jsonb,
        '{}'::jsonb, '{}'::jsonb, $2, repeat('a', 64), '{}'::jsonb, $3, $4, $5, $6)
     RETURNING id, revision::text, display_id`,
    [
      WS,
      key,
      CREDENTIAL,
      definitionId,
      extra.approver ?? null,
      extra.signature ?? false,
    ],
  )
  return rows[0]
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id,name,email,"emailVerified") VALUES
      ($1,'Owner','agentreg-owner@sheetbase.test',true),
      ($2,'Steward','agentreg-steward@sheetbase.test',true),
      ($3,'Writer A','agentreg-writer-a@sheetbase.test',true),
      ($4,'Writer B','agentreg-writer-b@sheetbase.test',true),
      ($5,'Outsider','agentreg-outsider@sheetbase.test',true)`,
    [OWNER, STEWARD, WRITER_A, WRITER_B, OUTSIDER],
  )
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ($1,'agentreg','Agent registry'),($2,'agentreg-other','Other')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
      ($1,$2,'owner'),($1,$3,'steward'),($1,$4,'member'),($1,$5,'member'),($6,$7,'owner')`,
    [WS, OWNER, STEWARD, WRITER_A, WRITER_B, OTHER_WS, OUTSIDER],
  )
  // Only the steward and writer A are certified to sign.
  await migrator.query(
    `INSERT INTO api.user_signature_certifications(workspace_id,user_id,statement_version)
     VALUES ($1,$2,1),($1,$3,1)`,
    [WS, STEWARD, WRITER_A],
  )
  await migrator.query(
    `INSERT INTO internal.api_credentials(id,workspace_id,name,display_prefix,secret_hash,scopes,created_by_user_id)
     VALUES ($1,$2,'Agent registry credential','sb_agentreg','agentreg-hash',ARRAY['agent_operations:read','agent_operations:write'],$3)`,
    [CREDENTIAL, WS, OWNER],
  )
  const { rows } = await migrator.query(
    `INSERT INTO api.agent_definitions (workspace_id, name, trigger_label, owner_user_id)
     VALUES ($1, 'Step yield figure', 'New DS-0311 snapshot', $2),
            ($1, 'Range checker', 'Any new snapshot', $3)
     RETURNING id, display_id`,
    [WS, WRITER_A, WRITER_B],
  )
  definitionId = rows[0].id
  expect(rows.map((r: { display_id: string }) => r.display_id)).toEqual([
    'AG-0001',
    'AG-0002',
  ])
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('agent registry', () => {
  it('is readable by members, hidden from other workspaces and not writable by hand', async () => {
    const writer = await actor(WRITER_A)
    const seen = await writer.query(
      'SELECT display_id FROM api.agent_definitions ORDER BY display_id',
    )
    expect(seen.rows.map((r) => r.display_id)).toEqual(['AG-0001', 'AG-0002'])
    const outsider = await actor(OUTSIDER, OTHER_WS)
    expect(
      (await outsider.query('SELECT 1 FROM api.agent_definitions')).rowCount,
    ).toBe(0)
    await expectDenied(
      writer.query(
        `INSERT INTO api.agent_definitions (workspace_id, name, trigger_label) VALUES ($1, 'x', 'y')`,
        [WS],
      ),
      '42501',
    )
    await expectDenied(
      writer.query(`UPDATE api.agent_definitions SET enabled = false`),
      '42501',
    )
  })

  it('rejects a policy that is not a full matrix of known modes', async () => {
    await expect(
      migrator.query(
        `INSERT INTO api.agent_definitions (workspace_id, name, trigger_label, policy)
         VALUES ($1, 'Bad', 'x', '{"read":"allowed","messages":"always"}'::jsonb)`,
        [WS],
      ),
    ).rejects.toThrow(/chk_agent_definitions_policy/)
  })

  it('lets the owner or an admin pause a workflow, and nobody else', async () => {
    const owner = await actor(WRITER_A)
    const paused = await owner.query(
      'SELECT enabled FROM api.set_agent_definition_enabled($1, false)',
      [definitionId],
    )
    expect(paused.rows[0].enabled).toBe(false)
    const other = await actor(WRITER_B)
    await expectDenied(
      other.query('SELECT api.set_agent_definition_enabled($1, true)', [
        definitionId,
      ]),
      '42501',
    )
    const admin = await actor(OWNER)
    const resumed = await admin.query(
      'SELECT enabled FROM api.set_agent_definition_enabled($1, true)',
      [definitionId],
    )
    expect(resumed.rows[0].enabled).toBe(true)
  })

  it('numbers each signed policy change and applies it to the workflow', async () => {
    const steward = await actor(STEWARD)
    const first = await steward.query(
      'SELECT * FROM api.change_agent_policy($1, $2::jsonb, $3, $4, $5)',
      [
        definitionId,
        policy(),
        'CC-0001',
        'Blocks need approval',
        'I approve this change',
      ],
    )
    expect(first.rows[0]).toMatchObject({
      revision: 1,
      change_ref: 'CC-0001',
      summary: 'Step yield figure notebook blocks → approval',
    })
    const second = await steward.query(
      'SELECT * FROM api.change_agent_policy($1, $2::jsonb, NULL, $3, $4)',
      [
        definitionId,
        policy({ notebook_blocks: 'needs_signature' }),
        'Raise to a signature',
        'I approve this change',
      ],
    )
    expect(second.rows[0].revision).toBe(2)
    expect(second.rows[0].summary).toBe(
      'Step yield figure notebook blocks → e-signature',
    )
    const current = await steward.query(
      'SELECT policy FROM api.agent_definitions WHERE id = $1',
      [definitionId],
    )
    expect(current.rows[0].policy.notebook_blocks).toBe('needs_signature')
    const reader = await actor(WRITER_B)
    const history = await reader.query(
      'SELECT revision FROM api.agent_policy_revisions ORDER BY revision',
    )
    expect(history.rows.map((r) => r.revision)).toEqual([1, 2])
  })

  it('refuses a policy change without the authority, reason, signature or an actual change', async () => {
    const steward = await actor(STEWARD)
    const same = policy({ notebook_blocks: 'needs_signature' })
    await expect(
      steward.query(
        'SELECT api.change_agent_policy($1, $2::jsonb, NULL, $3, $4)',
        [definitionId, same, 'Nothing changed', 'I approve this change'],
      ),
    ).rejects.toThrow(/unchanged/)
    await expect(
      steward.query(
        'SELECT api.change_agent_policy($1, $2::jsonb, NULL, $3, $4)',
        [definitionId, policy({ messages: 'allowed' }), '', 'Meaning'],
      ),
    ).rejects.toThrow(/reason/)
    await expect(
      steward.query(
        'SELECT api.change_agent_policy($1, $2::jsonb, NULL, $3, $4)',
        [definitionId, policy({ messages: 'sometimes' }), 'Why', 'Meaning'],
      ),
    ).rejects.toThrow(/must set/)
    const member = await actor(WRITER_A)
    await expectDenied(
      member.query(
        'SELECT api.change_agent_policy($1, $2::jsonb, NULL, $3, $4)',
        [definitionId, policy({ messages: 'allowed' }), 'Why', 'Meaning'],
      ),
      '42501',
    )
    // The owner may manage policy but has not certified a signature.
    const owner = await actor(OWNER)
    await expect(
      owner.query(
        'SELECT api.change_agent_policy($1, $2::jsonb, NULL, $3, $4)',
        [definitionId, policy({ messages: 'allowed' }), 'Why', 'Meaning'],
      ),
    ).rejects.toThrow(/certification/)
  })

  it('holds a proposal that needs a signature until it is signed', async () => {
    const proposal = await pendingProposal('agentreg-sign', { signature: true })
    expect(proposal.display_id).toMatch(/^PR-\d{4}$/)
    const writer = await actor(WRITER_A)
    await expectDenied(
      writer.query('SELECT api.decide_agent_operation($1, $2, $3)', [
        proposal.id,
        proposal.revision,
        'approve',
      ]),
      '42501',
    )
    // A writer who has not certified a signature cannot sign.
    const uncertified = await actor(WRITER_B)
    await expectDenied(
      uncertified.query('SELECT api.sign_agent_operation($1, $2, $3)', [
        proposal.id,
        proposal.revision,
        'I approve this block',
      ]),
      '42501',
    )
    await writer.query('SELECT api.sign_agent_operation($1, $2, $3)', [
      proposal.id,
      proposal.revision,
      'I approve this block',
    ])
    const approved = await writer.query(
      'SELECT status, approval_meaning FROM api.decide_agent_operation($1, $2, $3)',
      [proposal.id, proposal.revision, 'approve'],
    )
    expect(approved.rows[0]).toEqual({
      status: 'approved',
      approval_meaning: 'I approve this block',
    })
  })

  it('does not sign a proposal that does not ask for it', async () => {
    const proposal = await pendingProposal('agentreg-no-sign')
    const writer = await actor(WRITER_A)
    await expect(
      writer.query('SELECT api.sign_agent_operation($1, $2, $3)', [
        proposal.id,
        proposal.revision,
        'Meaning',
      ]),
    ).rejects.toThrow(/does not need a signature/)
  })

  it('leaves a routed proposal to its approver or an admin', async () => {
    const proposal = await pendingProposal('agentreg-routed', {
      approver: WRITER_A,
    })
    const other = await actor(WRITER_B)
    await expect(
      other.query('SELECT api.decide_agent_operation($1, $2, $3)', [
        proposal.id,
        proposal.revision,
        'approve',
      ]),
    ).rejects.toThrow(/waiting on its approver/)
    const admin = await actor(OWNER)
    const approved = await admin.query(
      'SELECT status FROM api.decide_agent_operation($1, $2, $3)',
      [proposal.id, proposal.revision, 'approve'],
    )
    expect(approved.rows[0].status).toBe('approved')
  })

  it('numbers proposals in order', async () => {
    const { rows } = await migrator.query(
      `SELECT display_id FROM api.agent_operation_proposals WHERE workspace_id = $1 ORDER BY created_at, id`,
      [WS],
    )
    expect(rows.map((r) => r.display_id)).toEqual([
      'PR-0001',
      'PR-0002',
      'PR-0003',
    ])
  })
})
