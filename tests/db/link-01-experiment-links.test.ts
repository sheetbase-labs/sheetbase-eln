/**
 * LINK-01: consuming or withdrawing a sample for an experiment links the
 * experiment to the sample in `record_links`, which is what the experiment's
 * Samples tab reads. The event rows alone are not enough.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS_A = '00000000-0000-4000-8000-00000003110a'
const PROJ_A = '00000000-0000-4000-8000-00000003210a'
const OWNER_A = 'link01-owner-a'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

function claims(userId: string, workspaceId: string): string {
  return JSON.stringify({
    sub: userId,
    workspace_id: workspaceId,
    role: 'authenticated',
  })
}

async function asAuthenticated(
  userId: string,
  workspaceId: string,
): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    claims(userId, workspaceId),
  ])
  return client
}

async function createRecord(
  client: Client,
  project: string,
  kind: string,
  title: string,
  properties: Record<string, unknown> = {},
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `SELECT * FROM api.create_record($1::uuid, $2, $3, $4, ARRAY[]::text[], $5::jsonb)`,
    [
      project,
      kind,
      title,
      kind === 'experiment' ? 'draft' : 'available',
      JSON.stringify(properties),
    ],
  )
  return rows[0]
}

const createExperiment = (client: Client, project: string, title: string) =>
  createRecord(client, project, 'experiment', title)

const sampleWithVolume = (client: Client, quantity: number) =>
  createRecord(client, PROJ_A, 'sample', 'Link sample', {
    quantity,
    quantityUnit: 'mL',
  })

async function experimentLinks(experimentId: string) {
  const { rows } = await migrator.query(
    `SELECT target_identifier, target_record_id, link_type, link_metadata
       FROM api.record_links
      WHERE source_record_id = $1 AND target_kind = 'sample'`,
    [experimentId],
  )
  return rows
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${OWNER_A}', 'LINK01 Owner', 'link01-owner-a@sheetbase.test', true);
     INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS_A}', 'link01-a', 'LINK01 A');
     INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS_A}', '${OWNER_A}', 'owner');
     INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES
      ('${PROJ_A}', '${WS_A}', 'link01-a', 'LINK01 A', '${OWNER_A}')`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('LINK-01: an experiment links the samples it used', () => {
  it('links the experiment when a direct consume names it', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const experiment = await createRecord(owner, PROJ_A, 'experiment', 'Direct')
    const sample = await sampleWithVolume(owner, 10)
    await owner.query(
      `SELECT * FROM api.consume_sample(p_record_id => $1, p_quantity => 2,
         p_expected_metadata_version => $2, p_experiment_id => $3)`,
      [sample.id, sample.metadata_version, experiment.id],
    )
    const links = await experimentLinks(experiment.id)
    expect(links).toHaveLength(1)
    expect(links[0].target_identifier).toBe(sample.identifier)
    expect(links[0].target_record_id).toBe(sample.id)
    expect(links[0].link_type).toBe('sample')
    expect(links[0].link_metadata.origin).toBe('consume_sample')
  })

  it('links through the purpose record too, and a second consume adds no second link', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const experiment = await createRecord(
      owner,
      PROJ_A,
      'experiment',
      'Purpose',
    )
    let sample = await sampleWithVolume(owner, 10)
    for (let i = 0; i < 2; i++) {
      const { rows } = await owner.query(
        `SELECT * FROM api.consume_sample(p_record_id => $1, p_quantity => 1,
           p_expected_metadata_version => $2, p_purpose_record_id => $3)`,
        [sample.id, sample.metadata_version, experiment.id],
      )
      sample = rows[0]
    }
    expect(await experimentLinks(experiment.id)).toHaveLength(1)
  })

  it('writes no link when a consume names no experiment', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const sample = await sampleWithVolume(owner, 10)
    await owner.query(
      `SELECT * FROM api.consume_sample(p_record_id => $1, p_quantity => 1,
         p_expected_metadata_version => $2)`,
      [sample.id, sample.metadata_version],
    )
    const { rows } = await migrator.query(
      `SELECT 1 FROM api.record_links WHERE target_record_id = $1`,
      [sample.id],
    )
    expect(rows).toHaveLength(0)
  })

  it('links the experiment when a withdrawal is made for it', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const experiment = await createRecord(
      owner,
      PROJ_A,
      'experiment',
      'Withdraw',
    )
    const sample = await sampleWithVolume(owner, 10)
    await owner.query(`SELECT api.withdraw_sample($1, 3, $2, $3)`, [
      sample.id,
      sample.metadata_version,
      experiment.id,
    ])
    const links = await experimentLinks(experiment.id)
    expect(links).toHaveLength(1)
    expect(links[0].target_identifier).toBe(sample.identifier)
  })
})
