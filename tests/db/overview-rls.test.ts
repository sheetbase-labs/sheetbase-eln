/**
 * SCI-007 integration proof: experiment overview data and its linked records
 * and revision snapshots remain workspace-scoped, and changing overview
 * properties is represented as a metadata change in the durable event log.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-000000000d0a'
const WS_B = '00000000-0000-4000-8000-000000000d0b'
const PROJ = '00000000-0000-4000-8000-000000000d1a'
const OWNER = 'sci-007-db-owner'
const OWNER_B = 'sci-007-db-owner-b'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []
let overviewRecordId: string
let sampleRecordId: string
let propertiesRecordId: string
let revisionRecordId: string

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())

  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${OWNER}', 'SCI-007 Owner', 'sci-007@sheetbase.test', true),
      ('${OWNER_B}', 'SCI-007 Owner B', 'sci-007-b@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS}', 'sci-007-ws', 'SCI-007 Workspace'),
      ('${WS_B}', 'sci-007-ws-b', 'SCI-007 Workspace B')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS}', '${OWNER}', 'owner'),
      ('${WS_B}', '${OWNER_B}', 'owner')`,
  )
  await migrator.query(
    `INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES
      ('${PROJ}', '${WS}', 'sci-007-proj', 'SCI-007 Project', '${OWNER}')`,
  )

  const { rows: records } = await migrator.query<{
    id: string
    identifier: string
  }>(
    `INSERT INTO api.records
       (workspace_id, project_id, kind, identifier, title, properties, created_by_user_id)
     VALUES
       ('${WS}', '${PROJ}', 'experiment', 'EXP-SCI007-01', 'Overview experiment', '{}', '${OWNER}'),
       ('${WS}', '${PROJ}', 'sample', 'SMP-SCI007-01', 'Linked sample', '{}', '${OWNER}'),
       ('${WS}', '${PROJ}', 'experiment', 'EXP-SCI007-02', 'Properties experiment', '{}', '${OWNER}'),
       ('${WS}', '${PROJ}', 'experiment', 'EXP-SCI007-03', 'Revision experiment', '{}', '${OWNER}')
     RETURNING id::text, identifier`,
  )
  overviewRecordId = records.find(
    (row) => row.identifier === 'EXP-SCI007-01',
  )!.id
  sampleRecordId = records.find((row) => row.identifier === 'SMP-SCI007-01')!.id
  propertiesRecordId = records.find(
    (row) => row.identifier === 'EXP-SCI007-02',
  )!.id
  revisionRecordId = records.find(
    (row) => row.identifier === 'EXP-SCI007-03',
  )!.id

  await migrator.query(
    `INSERT INTO api.blocks (record_id, type, payload, "order", created_by_user_id) VALUES
      ('${overviewRecordId}', 'rich_text',
       '{"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Overview result"}]}]}}',
       1, '${OWNER}')`,
  )
  await migrator.query(
    `INSERT INTO api.record_links
       (source_record_id, target_kind, target_identifier, target_record_id, link_type, created_by_user_id)
     VALUES
       ('${overviewRecordId}', 'sample', 'SMP-SCI007-01', '${sampleRecordId}', 'sample', '${OWNER}')`,
  )
  await migrator.query(
    `INSERT INTO api.revisions
       (record_id, structure_version, metadata_version, metadata_snapshot, block_snapshot, reason, created_by_user_id)
     VALUES
       ('${revisionRecordId}', 1, 1, '{"title":"Revision experiment"}', '[]', 'manual', '${OWNER}')`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

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

describe('SCI-007 experiment overview database integration', () => {
  it('overview data is isolated by workspace', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    const { rows: visible } = await owner.query<{ record_id: string }>(
      `SELECT record_id::text FROM api.blocks WHERE record_id = $1`,
      [overviewRecordId],
    )
    expect(visible).toHaveLength(1)
    expect(visible[0]?.record_id).toBe(overviewRecordId)

    const otherOwner = await asAuthenticated(OWNER_B, WS_B)
    const { rows: hidden } = await otherOwner.query(
      `SELECT id FROM api.blocks WHERE record_id = $1`,
      [overviewRecordId],
    )
    expect(hidden).toEqual([])
  })

  it('linked records are visible through RLS to workspace members', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    const { rows: visible } = await owner.query<{ target_record_id: string }>(
      `SELECT target_record_id::text FROM api.record_links WHERE source_record_id = $1`,
      [overviewRecordId],
    )
    expect(visible).toEqual([{ target_record_id: sampleRecordId }])

    const otherOwner = await asAuthenticated(OWNER_B, WS_B)
    const { rows: hidden } = await otherOwner.query(
      `SELECT id FROM api.record_links WHERE source_record_id = $1`,
      [overviewRecordId],
    )
    expect(hidden).toEqual([])
  })

  it('properties update emits change event with changedMetadata', async () => {
    // Change-event emission requires the request identity that PostgREST sets;
    // retain migrator privileges while supplying that request context.
    await migrator.query("SELECT set_config('request.jwt.claims', $1, false)", [
      claims(OWNER, WS),
    ])
    await migrator.query(
      `UPDATE api.records
       SET properties = '{"overview":{"excludedBlockIds":["block-1"]}}'
       WHERE id = $1`,
      [propertiesRecordId],
    )

    const { rows } = await migrator.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM api.change_events
       WHERE entity_type = 'record'
         AND operation = 'update'
         AND entity_uuid = $1
       ORDER BY sequence DESC
       LIMIT 1`,
      [propertiesRecordId],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.payload).toMatchObject({ changedMetadata: true })
  })

  it('revision snapshot is isolated by workspace', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    const { rows: visible } = await owner.query<{ record_id: string }>(
      `SELECT record_id::text FROM api.revisions WHERE record_id = $1`,
      [revisionRecordId],
    )
    expect(visible).toEqual([{ record_id: revisionRecordId }])

    const otherOwner = await asAuthenticated(OWNER_B, WS_B)
    const { rows: hidden } = await otherOwner.query(
      `SELECT id FROM api.revisions WHERE record_id = $1`,
      [revisionRecordId],
    )
    expect(hidden).toEqual([])
  })
})
