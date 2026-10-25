/**
 * Content-write proposal kinds added for MCP coverage.
 *
 * These are not new write engines: each proposal delegates to the existing
 * canonical RPC and stays human-required. The test proves the contract,
 * approval, canonical execution and workspace target checks.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase, setActorJwt } from './helpers'

const WS = 'a0060000-0000-4000-8000-000000000001'
const OTHER_WS = 'a0060000-0000-4000-8000-000000000002'
const PROJECT = 'a0060000-0000-4000-8000-000000000003'
const OTHER_PROJECT = 'a0060000-0000-4000-8000-000000000004'
const OWNER = 'a006-owner'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await setActorJwt(client, OWNER, WS)
  return client
}

async function propose(
  client: Client,
  operation: Record<string, unknown>,
  idempotencyKey: string,
) {
  const { rows } = await client.query(
    `SELECT * FROM api.propose_agent_operation(
      $1::uuid,$2::text,$3::text,$4::jsonb,$5::jsonb,$6::text
    )`,
    [
      WS,
      'Content write',
      'A content write proposed for human approval.',
      JSON.stringify(operation),
      JSON.stringify({
        agentId: 'content-helper',
        tool: { name: 'sheetbase.content', version: '1' },
        model: { provider: 'local', name: 'scripted' },
        invocationId: `invocation-${idempotencyKey}`,
      }),
      idempotencyKey,
    ],
  )
  return rows[0] as {
    id: string
    status: string
    revision: string
    approval_policy: string
    risk_class: string
    result: Record<string, unknown> | null
  }
}

async function decideAndExecute(
  client: Client,
  proposal: {
    id: string
    revision: string
  },
) {
  const approved = await client.query(
    `SELECT to_jsonb(api.decide_agent_operation($1,$2,'approve','Reviewed')) result`,
    [proposal.id, proposal.revision],
  )
  const decided = approved.rows[0].result as {
    revision: string
    status: string
  }
  expect(decided.status).toBe('approved')
  const executed = await client.query(
    `SELECT to_jsonb(api.execute_agent_operation($1,$2)) result`,
    [proposal.id, decided.revision],
  )
  const result = executed.rows[0].result as {
    status: string
    result: Record<string, unknown>
    error_code?: string
    error_message?: string
  }
  if (result.status !== 'succeeded') console.log('execution failed', result)
  return result
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id,name,email,"emailVerified")
     VALUES ($1,'Content Owner','content-owner@sheetbase.test',true)`,
    [OWNER],
  )
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES
      ($1,'content','Content'),($2,'content-other','Content Other')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role)
     VALUES ($1,$2,'owner')`,
    [WS, OWNER],
  )
  await migrator.query(
    `INSERT INTO api.projects(id,workspace_id,key,title,lead_user_id)
     VALUES ($1,$2,'C01','Content project',$3)`,
    [PROJECT, WS, OWNER],
  )
  await migrator.query(
    `INSERT INTO api.projects(id,workspace_id,key,title)
     VALUES ($1,$2,'C02','Other project')`,
    [OTHER_PROJECT, OTHER_WS],
  )
  await migrator.query(
    `INSERT INTO api.record_field_definitions(
       workspace_id,kind,field_name,label,display_order,logical_type,
       lifecycle,created_by_user_id
     ) VALUES ($1,'experiment','batch','Batch',1,'text','active',$2)`,
    [WS, OWNER],
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('agent content writes', () => {
  it('creates a record only after human approval and canonical execution', async () => {
    const owner = await actor()
    const proposed = await propose(
      owner,
      {
        kind: 'record.create',
        workspaceId: WS,
        projectId: PROJECT,
        recordKind: 'experiment',
        title: 'Agent-created experiment',
        tags: ['agent'],
      },
      'content-record-1',
    )

    expect(proposed.status).toBe('pending')
    expect(proposed.approval_policy).toBe('human_required')
    expect(proposed.risk_class).toBe('consequential_write')

    const executed = await decideAndExecute(owner, proposed)
    expect(executed.status).toBe('succeeded')
    expect(executed.result).toMatchObject({
      kind: 'experiment',
      title: 'Agent-created experiment',
      project_id: PROJECT,
    })
  })

  it('rejects a record target outside the active workspace', async () => {
    const owner = await actor()
    await expect(
      propose(
        owner,
        {
          kind: 'record.create',
          workspaceId: WS,
          projectId: OTHER_PROJECT,
          recordKind: 'experiment',
          title: 'Wrong workspace',
        },
        'content-record-2',
      ),
    ).rejects.toThrow(/invalid record create operation/)
  })

  it('updates custom fields at the expected metadata revision', async () => {
    const owner = await actor()
    const created = await owner.query<{ id: string; metadata_version: number }>(
      `SELECT id, metadata_version FROM api.create_record($1,'experiment','Fields target')`,
      [PROJECT],
    )
    const record = created.rows[0]

    const proposed = await propose(
      owner,
      {
        kind: 'record.custom_fields.update',
        recordId: record.id,
        expectedMetadataVersion: record.metadata_version,
        values: { batch: 'B-42' },
      },
      'content-fields-1',
    )
    expect(proposed.approval_policy).toBe('human_required')
    const executed = await decideAndExecute(owner, proposed)
    expect(executed.status).toBe('succeeded')
    expect(executed.result).toMatchObject({
      id: record.id,
      custom_fields: { batch: 'B-42' },
    })
  })

  it('refuses a Sheet Instance whose source is not a published workspace version', async () => {
    const owner = await actor()
    await expect(
      propose(
        owner,
        {
          kind: 'sheet_instance.create',
          workspaceId: WS,
          name: 'Agent sheet',
          sourceDefinitionVersionId: 'a0060000-0000-4000-8000-000000000099',
          projectId: PROJECT,
          state: {},
        },
        'content-sheet-1',
      ),
    ).rejects.toThrow(/invalid Sheet Instance create operation/)
  })

  it('instantiates an active protocol template through the canonical RPC', async () => {
    const owner = await actor()
    const template = await owner.query<{ id: string }>(
      `SELECT id FROM api.create_record(NULL,'protocol_template','Protocol template','active')`,
    )
    const proposed = await propose(
      owner,
      {
        kind: 'template.instantiate',
        templateRecordId: template.rows[0].id,
        targetProjectId: PROJECT,
        targetKind: 'experiment',
        title: 'Instantiated experiment',
      },
      'content-template-1',
    )
    expect(proposed.approval_policy).toBe('human_required')
    const executed = await decideAndExecute(owner, proposed)
    expect(executed.status).toBe('succeeded')
    expect(executed.result).toMatchObject({
      record: { kind: 'experiment', title: 'Instantiated experiment' },
    })
  })
})
