/**
 * PIPE-03.1 — a pipeline proposes a notebook block instead of inserting it.
 *
 * The owner's decision is that one proposal system serves both: a proposal may be proposed
 * by an AI agent or by a pipeline run, and its record says which. This covers the pipeline
 * side end to end — proposing changes nothing, accepting applies the block through the
 * canonical RPC as the person who accepted, and the proposal's provenance stays a pipeline
 * rather than being written into agent fields.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-000000070000'
const PROJECT = '00000000-0000-4000-8000-000000070001'
const RECORD = '00000000-0000-4000-8000-000000070002'
const RUN = '00000000-0000-4000-8000-000000070003'
const OWNER = 'pipe031-owner'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
    [OWNER, `${OWNER}@test.invalid`],
  )
  await migrator.query(`insert into api.workspaces(id,slug,name) values($1,'pipe031','PIPE-03.1')`, [
    WS,
  ])
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$2,'owner')`,
    [WS, OWNER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values($1,$2,'P31','Proposals',$3)`,
    [PROJECT, WS, OWNER],
  )
  await migrator.query(
    `insert into api.records(id,workspace_id,project_id,kind,identifier,title,status,created_by_user_id)
     values($1,$2,$3,'experiment','EXP-031-0001','Proposal notebook','in_progress',$4)`,
    [RECORD, WS, PROJECT, OWNER],
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

const PIPELINE_PROVENANCE = JSON.stringify({
  kind: 'pipeline',
  pipelineId: 'pd-pv-stability',
  pipelineName: 'PV stability',
  definitionVersionId: 'pdv-7',
  runId: RUN,
  invocationId: RUN,
})

function operation(expectedRevision: number) {
  return JSON.stringify({
    kind: 'notebook_block.insert',
    recordId: RECORD,
    afterBlockId: null,
    block: {
      type: 'rich_text',
      payload: { doc: { type: 'doc', content: [] } },
    },
    expectedRevision,
  })
}

async function structureVersion(): Promise<number> {
  const { rows } = await migrator.query<{ structure_version: number }>(
    `select structure_version from api.records where id=$1`,
    [RECORD],
  )
  return rows[0]!.structure_version
}

describe('PIPE-03.1 a pipeline proposes a notebook block', () => {
  it('records the proposal as pipeline-authored, and changes nothing yet', async () => {
    const owner = await actor(OWNER)
    const before = await structureVersion()

    const proposed = (
      await owner.query(
        `select to_jsonb(api.propose_agent_operation($1,$2,$3,$4::jsonb,$5::jsonb,$6)) result`,
        [
          WS,
          'Add a summary block',
          'The PV stability pipeline proposes a summary block after the run.',
          operation(before),
          PIPELINE_PROVENANCE,
          'pipe031-1',
        ],
      )
    ).rows[0].result as {
      id: string
      operation_kind: string
      status: string
      approval_policy: string
      revision: number
      provenance: Record<string, unknown>
    }

    expect(proposed.operation_kind).toBe('notebook_block.insert')
    // Inserting content is a consequential write, so it waits for a person.
    expect(proposed.status).toBe('pending')
    expect(proposed.approval_policy).toBe('human_required')
    // The provenance is the pipeline itself, not an agent.
    expect(proposed.provenance.kind).toBe('pipeline')
    expect(proposed.provenance.runId).toBe(RUN)
    expect(proposed.provenance).not.toHaveProperty('agentId')

    // Nothing has changed in the notebook.
    expect(await structureVersion()).toBe(before)
    const blocks = await migrator.query(
      `select id from api.blocks where record_id=$1`,
      [RECORD],
    )
    expect(blocks.rows).toEqual([])
  })

  it('applies the block through the canonical RPC when the person accepts', async () => {
    const owner = await actor(OWNER)
    const before = await structureVersion()

    const proposed = (
      await owner.query(
        `select to_jsonb(api.propose_agent_operation($1,$2,$3,$4::jsonb,$5::jsonb,$6)) result`,
        [
          WS,
          'Add a summary block',
          'The PV stability pipeline proposes a summary block after the run.',
          operation(before),
          PIPELINE_PROVENANCE,
          'pipe031-2',
        ],
      )
    ).rows[0].result as { id: string; revision: number }

    const decided = (
      await owner.query(
        `select to_jsonb(api.decide_agent_operation($1,$2,'approve','looks right')) result`,
        [proposed.id, proposed.revision],
      )
    ).rows[0].result as { status: string; revision: number }
    expect(decided.status).toBe('approved')

    const executed = (
      await owner.query(
        `select to_jsonb(api.execute_agent_operation($1,$2)) result`,
        [proposed.id, decided.revision],
      )
    ).rows[0].result as {
      status: string
      executed_by_user_id: string
      result: Record<string, unknown>
    }
    expect(executed.status).toBe('succeeded')
    expect(executed.executed_by_user_id).toBe(OWNER)

    // The block exists, on the record, and the record's structure moved.
    const blocks = await migrator.query<{ type: string }>(
      `select type from api.blocks where record_id=$1`,
      [RECORD],
    )
    expect(blocks.rows.map((row) => row.type)).toEqual(['rich_text'])
    expect(await structureVersion()).toBeGreaterThan(before)
  })

  it('refuses an agent-shaped provenance that is not actually an agent', async () => {
    const owner = await actor(OWNER)
    const before = await structureVersion()
    await expect(
      owner.query(
        `select api.propose_agent_operation($1,$2,$3,$4::jsonb,$5::jsonb,$6) result`,
        [
          WS,
          'Bad provenance',
          'Missing agent fields.',
          operation(before),
          JSON.stringify({ kind: 'pipeline', pipelineName: 'PV stability' }),
          'pipe031-3',
        ],
      ),
    ).rejects.toThrow(/pipeline provenance is incomplete/)
  })
})
