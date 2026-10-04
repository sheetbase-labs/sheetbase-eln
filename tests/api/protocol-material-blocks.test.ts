/**
 * SCI-002 API contract proof. All application operations travel through the
 * same-origin proxy to a running PostgREST instance; the admin connection is
 * used only for fixture setup, cleanup, and durable-event verification.
 */
import { config } from 'dotenv'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { mintPostgrestToken } from '#/lib/postgrest-token'
import { handleProxyRequest } from '#/lib/postgrest-proxy'

config({ path: ['.env.local', '.env'] })

const WS_A = '6b000000-0000-4000-8000-000000000001'
const WS_B = '6b000000-0000-4000-8000-000000000002'
const PROJECT_A = '6b000000-0000-4000-8000-000000000003'
const PROJECT_B = '6b000000-0000-4000-8000-000000000004'
const USER_A = 'sci-002-api-owner-a'
const USER_B = 'sci-002-api-owner-b'
const SECRET = process.env.PGRST_JWT_SECRET ?? ''

let admin: Client

async function clean(): Promise<void> {
  // A revision snapshot contains block ids, while pinned/copy blocks contain
  // revision ids. Remove the live graph in dependency order before records.
  await admin.query(
    `DELETE FROM api.record_links WHERE source_record_id IN
      (SELECT id FROM api.records WHERE workspace_id IN ($1,$2))`,
    [WS_A, WS_B],
  )
  await admin.query(
    `DELETE FROM api.blocks WHERE record_id IN
      (SELECT id FROM api.records WHERE workspace_id IN ($1,$2))`,
    [WS_A, WS_B],
  )
  await admin.query(
    `DELETE FROM api.revisions WHERE record_id IN
      (SELECT id FROM api.records WHERE workspace_id IN ($1,$2))`,
    [WS_A, WS_B],
  )
  await admin.query(`DELETE FROM api.records WHERE workspace_id IN ($1,$2)`, [
    WS_A,
    WS_B,
  ])
  await admin.query(`DELETE FROM api.projects WHERE workspace_id IN ($1,$2)`, [
    WS_A,
    WS_B,
  ])
  await admin.query(
    `DELETE FROM api.workspace_memberships WHERE workspace_id IN ($1,$2)`,
    [WS_A, WS_B],
  )
  await admin.query(`DELETE FROM api.workspaces WHERE id IN ($1,$2)`, [
    WS_A,
    WS_B,
  ])
  await admin.query(`DELETE FROM internal."user" WHERE id IN ($1,$2)`, [
    USER_A,
    USER_B,
  ])
  await admin.query(`SELECT pg_notify('pgrst','reload schema')`)
}

function proxy(
  path: string,
  userId: string,
  workspaceId: string,
  init: RequestInit = {},
) {
  const headers = new Headers(init.headers)
  return handleProxyRequest(
    new Request(`http://sheetbase.test/api/db/${path}`, { ...init, headers }),
    path.split('?')[0],
    {
      getSession: async () => ({
        user: { id: userId },
        session: { id: 'sci-002-api-session' },
      }),
      getWorkspaceForUser: async () => ({ id: workspaceId }),
      mintToken: (input) => mintPostgrestToken(SECRET, input),
      resolveExternalToken: () => Promise.resolve(null),
      upstreamBaseUrl: process.env.POSTGREST_URL ?? 'http://localhost:3001',
    },
  )
}

async function rpc(
  path: string,
  user: string,
  workspace: string,
  body: unknown,
): Promise<Response> {
  return proxy(`rpc/${path}`, user, workspace, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function createRecord(
  user: string,
  workspace: string,
  project: string,
  kind: string,
  title: string,
  status = 'draft',
  properties = {},
) {
  const response = await rpc('create_record', user, workspace, {
    p_project_id: project,
    p_kind: kind,
    p_title: title,
    p_status: status,
    p_properties: properties,
  })
  expect(response.status).toBe(200)
  return response.json()
}

async function insertBlock(record: any, type: string, payload: unknown) {
  const response = await rpc('insert_block', USER_A, WS_A, {
    p_record_id: record.id,
    p_type: type,
    p_payload: payload,
    p_payload_schema_version: 1,
    p_expected_structure_version: record.structure_version,
  })
  expect(response.status).toBe(200)
  return response.json()
}

beforeAll(async () => {
  if (!SECRET) throw new Error('PGRST_JWT_SECRET is required for API tests.')
  admin = new Client({
    connectionString:
      process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL,
  })
  await admin.connect()
  await clean()
  await admin.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
      ($1,'SCI 002 API A','sci-002-api-a@test.invalid',true),
      ($2,'SCI 002 API B','sci-002-api-b@test.invalid',true)`,
    [USER_A, USER_B],
  )
  await admin.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES
      ($1,'sci-002-api-a','SCI 002 API A'),($2,'sci-002-api-b','SCI 002 API B')`,
    [WS_A, WS_B],
  )
  await admin.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
      ($1,$3,'owner'),($2,$4,'owner')`,
    [WS_A, WS_B, USER_A, USER_B],
  )
  await admin.query(
    `INSERT INTO api.projects(id,workspace_id,key,title) VALUES
      ($1,$2,'sci002api','SCI 002 API A'),($3,$4,'sci002b','SCI 002 API B')`,
    [PROJECT_A, WS_A, PROJECT_B, WS_B],
  )
})

afterAll(async () => {
  if (admin) {
    await clean()
    await admin.end()
  }
})

describe('SCI-002 protocol and material blocks REST contract', () => {
  it('pins protocols and completes copied steps with canonical server provenance', async () => {
    const protocol = await createRecord(
      USER_A,
      WS_A,
      PROJECT_A,
      'protocol_template',
      'API protocol',
      'approved',
      { version: '4.2' },
    )
    const definition = await insertBlock(protocol, 'procedure_step', {
      text: 'Mix gently',
      stepNumber: 1,
    })
    const experiment = await createRecord(
      USER_A,
      WS_A,
      PROJECT_A,
      'experiment',
      'API run',
    )
    const empty = await insertBlock(experiment, 'protocol_reference', {})

    const read = await proxy(
      `blocks?id=eq.${empty.block.id}&payload=eq.%7B%7D`,
      USER_A,
      WS_A,
    )
    expect(read.status).toBe(200)
    expect(await read.json()).toMatchObject([
      { id: empty.block.id, type: 'protocol_reference', payload: {} },
    ])

    const pinnedResponse = await rpc('pin_protocol_reference', USER_A, WS_A, {
      p_block_id: empty.block.id,
      p_protocol_record_id: protocol.id,
      p_expected_block_version: empty.block.version,
      p_expected_structure_version: empty.structure_version,
    })
    expect(pinnedResponse.status).toBe(200)
    const pinned = await pinnedResponse.json()
    expect(pinned.revision).toMatchObject({
      record_id: protocol.id,
      created_by_user_id: USER_A,
    })
    expect(pinned.revision.block_snapshot).toMatchObject([
      {
        id: definition.block.id,
        payload: { text: 'Mix gently', stepNumber: 1 },
      },
    ])
    expect(pinned.block.payload).toMatchObject({
      protocolRecordId: protocol.id,
      protocolIdentifier: protocol.identifier,
      protocolTitle: 'API protocol',
      protocolRevisionId: pinned.revision.id,
      version: '4.2',
      approvalStatus: 'approved',
      pinnedByUserId: USER_A,
    })
    expect(pinned.block.payload.pinnedAt).toBe(pinned.revision.created_at)
    expect(pinned.copied_steps).toHaveLength(1)
    expect(pinned.copied_steps[0]).toMatchObject({
      created_by_user_id: USER_A,
      payload: {
        text: 'Mix gently',
        sourceStepBlockId: definition.block.id,
        completed: false,
      },
    })

    const completedResponse = await rpc('update_block_payload', USER_A, WS_A, {
      p_block_id: pinned.copied_steps[0].id,
      p_payload: {
        ...pinned.copied_steps[0].payload,
        completed: true,
        note: 'Done',
        completedAt: '2000-01-01T00:00:00Z',
        completedByUserId: USER_B,
      },
      p_expected_version: pinned.copied_steps[0].version,
      p_payload_schema_version: 1,
    })
    expect(completedResponse.status).toBe(200)
    const completed = await completedResponse.json()
    expect(completed.payload).toMatchObject({
      completed: true,
      note: 'Done',
      completedByUserId: USER_A,
    })
    expect(completed.updated_by_user_id).toBe(USER_A)
    expect(new Date(completed.payload.completedAt).getTime()).toBeGreaterThan(
      Date.now() - 10_000,
    )

    const events = await admin.query(
      `SELECT entity_type,operation,actor_user_id FROM api.change_events
       WHERE record_id=$1 AND entity_type IN ('block','record_link') ORDER BY sequence`,
      [experiment.id],
    )
    expect(
      events.rows.some(
        (event) =>
          event.entity_type === 'record_link' && event.operation === 'link',
      ),
    ).toBe(true)
    expect(
      events.rows.some(
        (event) =>
          event.entity_type === 'block' && event.operation === 'update',
      ),
    ).toBe(true)
    expect(events.rows.every((event) => event.actor_user_id === USER_A)).toBe(
      true,
    )
  })

  it('maintains material links, validates payloads, and keeps archived targets represented', async () => {
    const experiment = await createRecord(
      USER_A,
      WS_A,
      PROJECT_A,
      'experiment',
      'Materials API run',
    )
    const sample = await createRecord(
      USER_A,
      WS_A,
      PROJECT_A,
      'sample',
      'API sample',
      'available',
    )
    const reagent = await createRecord(
      USER_A,
      WS_A,
      PROJECT_A,
      'reagent',
      'API reagent',
      'available',
    )
    const observedAt = '2026-07-21T12:00:00.000Z'
    const item = (target: any, id: string, quantity: number) => ({
      id,
      materialRecordId: target.id,
      kind: target.kind,
      identifier: target.identifier,
      title: target.title,
      quantity,
      unit: { code: 'mL', symbol: 'mL' },
      observedAt,
    })
    const empty = await insertBlock(experiment, 'materials', { items: [] })
    const filtered = await proxy(
      `blocks?record_id=eq.${experiment.id}&type=eq.materials`,
      USER_A,
      WS_A,
    )
    expect(filtered.status).toBe(200)
    expect(await filtered.json()).toMatchObject([
      { id: empty.block.id, payload: { items: [] } },
    ])

    const payload = {
      items: [item(sample, 'sample-item', 1), item(reagent, 'reagent-item', 2)],
    }
    const updatedResponse = await rpc('update_block_payload', USER_A, WS_A, {
      p_block_id: empty.block.id,
      p_payload: payload,
      p_expected_version: empty.block.version,
      p_payload_schema_version: 1,
    })
    expect(updatedResponse.status).toBe(200)
    const updated = await updatedResponse.json()
    const linksBefore = await proxy(
      `record_links?source_record_id=eq.${experiment.id}&order=target_identifier.asc`,
      USER_A,
      WS_A,
    )
    const links = await linksBefore.json()
    expect(links).toHaveLength(2)
    expect(links.every((link: any) => link.created_by_user_id === USER_A)).toBe(
      true,
    )

    await proxy(`records?id=eq.${sample.id}`, USER_A, WS_A, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        prefer: 'return=representation',
      },
      body: JSON.stringify({ archived_at: new Date().toISOString() }),
    })
    const quantityResponse = await rpc('update_block_payload', USER_A, WS_A, {
      p_block_id: updated.id,
      p_payload: {
        items: [
          item(sample, 'sample-item', 5),
          item(reagent, 'reagent-item', 2),
        ],
      },
      p_expected_version: updated.version,
      p_payload_schema_version: 1,
    })
    expect(quantityResponse.status).toBe(200)
    const quantityUpdate = await quantityResponse.json()
    expect(quantityUpdate.payload.items[0]).toEqual(
      item(sample, 'sample-item', 5),
    )
    const linksAfter = await (
      await proxy(
        `record_links?source_record_id=eq.${experiment.id}&order=target_identifier.asc`,
        USER_A,
        WS_A,
      )
    ).json()
    expect(linksAfter.map((link: any) => link.id)).toEqual(
      links.map((link: any) => link.id),
    )
    const archivedRead = await (
      await proxy(`records?id=eq.${sample.id}`, USER_A, WS_A)
    ).json()
    expect(archivedRead).toHaveLength(1)
    expect(archivedRead[0].archived_at).not.toBeNull()
    expect(
      linksAfter.some((link: any) => link.target_record_id === sample.id),
    ).toBe(true)

    const invalid = await rpc('update_block_payload', USER_A, WS_A, {
      p_block_id: quantityUpdate.id,
      p_payload: { items: [item(sample, 'sample-item', 0)] },
      p_expected_version: quantityUpdate.version,
      p_payload_schema_version: 1,
    })
    expect(invalid.status).toBe(400)
    expect((await invalid.json()).error.category).toBe('validation_error')
  })

  it('denies cross-workspace protocol/material references without leaking rows', async () => {
    const foreignProtocol = await createRecord(
      USER_B,
      WS_B,
      PROJECT_B,
      'protocol_template',
      'Foreign protocol',
    )
    const foreignSample = await createRecord(
      USER_B,
      WS_B,
      PROJECT_B,
      'sample',
      'Foreign sample',
      'available',
    )
    const experiment = await createRecord(
      USER_A,
      WS_A,
      PROJECT_A,
      'experiment',
      'Isolation run',
    )
    const pin = await insertBlock(experiment, 'protocol_reference', {})
    const deniedPin = await rpc('pin_protocol_reference', USER_A, WS_A, {
      p_block_id: pin.block.id,
      p_protocol_record_id: foreignProtocol.id,
      p_expected_block_version: pin.block.version,
      p_expected_structure_version: pin.structure_version,
    })
    expect(deniedPin.status).toBe(403)
    expect((await deniedPin.json()).error.category).toBe('permission_denied')

    const foreignItem = {
      id: 'foreign',
      materialRecordId: foreignSample.id,
      kind: 'sample',
      identifier: foreignSample.identifier,
      title: foreignSample.title,
      quantity: 1,
      unit: { code: 'mL', symbol: 'mL' },
      observedAt: new Date().toISOString(),
    }
    const deniedMaterial = await rpc('insert_block', USER_A, WS_A, {
      p_record_id: experiment.id,
      p_type: 'materials',
      p_payload: { items: [foreignItem] },
      p_payload_schema_version: 1,
      p_expected_structure_version: pin.structure_version,
    })
    expect(deniedMaterial.status).toBe(400)
    expect((await deniedMaterial.json()).error.category).toBe(
      'validation_error',
    )
    expect(
      await (
        await proxy(`records?id=eq.${foreignSample.id}`, USER_A, WS_A)
      ).json(),
    ).toEqual([])
  })

  it('rejects an unauthenticated REST request at the proxy boundary', async () => {
    const response = await handleProxyRequest(
      new Request('http://sheetbase.test/api/db/blocks'),
      'blocks',
      {
        getSession: async () => null,
        getWorkspaceForUser: async () => null,
        mintToken: (input) => mintPostgrestToken(SECRET, input),
        upstreamBaseUrl: process.env.POSTGREST_URL ?? 'http://localhost:3001',
      },
    )
    expect(response.status).toBe(401)
    expect((await response.json()).error.category).toBe('unauthenticated')
  })
})
