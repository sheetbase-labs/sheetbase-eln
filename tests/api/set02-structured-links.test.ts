import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { mintPostgrestToken } from '#/lib/postgrest-token'
import { handleProxyRequest } from '#/lib/postgrest-proxy'

const workspaceId = randomUUID()
const otherWorkspaceId = randomUUID()
const userId = `set02-link-${workspaceId}`
const source = z.object({ id: z.uuid() })
const dataset = z.object({ id: z.uuid(), display_id: z.string() })
let admin: Client
let projectId: string
let sourceId: string
let readable: z.infer<typeof dataset>
let denied: z.infer<typeof dataset>
let foreign: z.infer<typeof dataset>
let schemaVersionId: string
let lockedProject: string

function proxy(path: string, body?: unknown, activeWorkspaceId = workspaceId) {
  return handleProxyRequest(
    new Request(
      `http://sheetbase.test/api/db/${path}`,
      body === undefined
        ? {}
        : {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              prefer: 'return=representation',
            },
            body: JSON.stringify(body),
          },
    ),
    path.split('?')[0],
    {
      getSession: async () => ({
        user: { id: userId },
        session: { id: `session-${userId}` },
      }),
      getWorkspaceForUser: async () => ({ id: activeWorkspaceId }),
      mintToken: (input) =>
        mintPostgrestToken(process.env.PGRST_JWT_SECRET ?? '', input),
      upstreamBaseUrl: process.env.POSTGREST_URL ?? 'http://localhost:3001',
    },
  )
}

beforeAll(async () => {
  admin = new Client({
    connectionString:
      process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL,
  })
  await admin.connect()
  await admin.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES($1,'Link owner',$2,true)`,
    [userId, `${userId}@test.invalid`],
  )
  await admin.query(
    `INSERT INTO internal.session(id,token,"userId","expiresAt") VALUES($1,$1,$2,now()+interval '1 hour')`,
    [`session-${userId}`, userId],
  )
  await admin.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES($1,$3,'Link authority'),($2,$4,'Other workspace')`,
    [
      workspaceId,
      otherWorkspaceId,
      `links-${workspaceId}`,
      `links-${otherWorkspaceId}`,
    ],
  )
  await admin.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES($1,$2,'owner'),($3,$2,'owner')`,
    [workspaceId, userId, otherWorkspaceId],
  )
  const projectResponse = await proxy('rpc/create_project', {
    p_title: 'Explicit link project',
  })
  expect(projectResponse.status, await projectResponse.clone().text()).toBe(200)
  projectId = source.parse(await projectResponse.json()).id
  const sourceResponse = await proxy('rpc/create_record', {
    p_project_id: projectId,
    p_kind: 'experiment',
    p_title: 'Link source',
  })
  expect(sourceResponse.status, await sourceResponse.clone().text()).toBe(200)
  sourceId = source.parse(await sourceResponse.json()).id
  const definition = await proxy('rpc/create_dataset_schema_definition', {
    p_workspace_id: workspaceId,
    p_key: 'link_target',
    p_name: 'Link targets',
    p_fields: [
      {
        field_id: randomUUID(),
        key: 'value',
        label: 'Value',
        logical_type: 'decimal',
        nullable: true,
      },
    ],
  })
  expect(definition.status, await definition.clone().text()).toBe(200)
  schemaVersionId = z
    .object({ schema_version_id: z.uuid() })
    .parse(await definition.json()).schema_version_id
  const published = await proxy('rpc/publish_dataset_schema_version', {
    p_schema_version_id: schemaVersionId,
  })
  expect(published.status, await published.clone().text()).toBe(200)
  const foreignDefinition = await proxy(
    'rpc/create_dataset_schema_definition',
    {
      p_workspace_id: otherWorkspaceId,
      p_key: 'foreign_target',
      p_name: 'Foreign target',
      p_fields: [
        {
          field_id: randomUUID(),
          key: 'value',
          label: 'Value',
          logical_type: 'decimal',
          nullable: true,
        },
      ],
    },
    otherWorkspaceId,
  )
  expect(foreignDefinition.status, await foreignDefinition.clone().text()).toBe(
    200,
  )
  const foreignSchemaVersionId = z
    .object({ schema_version_id: z.uuid() })
    .parse(await foreignDefinition.json()).schema_version_id
  const foreignPublished = await proxy(
    'rpc/publish_dataset_schema_version',
    { p_schema_version_id: foreignSchemaVersionId },
    otherWorkspaceId,
  )
  expect(foreignPublished.status, await foreignPublished.clone().text()).toBe(
    200,
  )
  lockedProject = randomUUID()
  const foreignProject = randomUUID()
  await admin.query(
    `INSERT INTO api.projects(id,workspace_id,key,title) VALUES($1,$2,'locked','No explicit grant'),($3,$4,'foreign','Other workspace')`,
    [lockedProject, workspaceId, foreignProject, otherWorkspaceId],
  )
  // Existing targets are fixtures; the tested link writes are native invoker
  // RPCs. Separate tests below exercise native Dataset INSERT RETURNING.
  const rows = await admin.query(
    `INSERT INTO api.datasets(workspace_id,primary_project_id,schema_version_id,name,display_id)
    VALUES($1,$2,$3,'Readable','DS-0101'),($1,$4,$3,'Denied','DS-0102'),($5,$6,$7,'Foreign','DS-9000') RETURNING id,display_id`,
    [
      workspaceId,
      projectId,
      schemaVersionId,
      lockedProject,
      otherWorkspaceId,
      foreignProject,
      foreignSchemaVersionId,
    ],
  )
  ;[readable, denied, foreign] = z.array(dataset).length(3).parse(rows.rows)
})

afterAll(async () => {
  if (!admin) return
  // Delete only this test's random fixtures. Published-schema guards apply
  // to cleanup, so suspend them transactionally, then restore before commit.
  await admin.query('BEGIN')
  try {
    for (const table of [
      'datasets',
      'dataset_schema_versions',
      'dataset_schema_version_fields',
    ])
      await admin.query(`ALTER TABLE api.${table} DISABLE TRIGGER USER`)
    await admin.query(
      'DELETE FROM api.datasets WHERE workspace_id IN ($1,$2)',
      [workspaceId, otherWorkspaceId],
    )
    await admin.query(
      `DELETE FROM api.dataset_schema_version_fields WHERE schema_version_id IN (SELECT v.id FROM api.dataset_schema_versions v JOIN api.dataset_schema_definitions d ON d.id=v.schema_id WHERE d.workspace_id IN ($1,$2))`,
      [workspaceId, otherWorkspaceId],
    )
    await admin.query(
      `DELETE FROM api.dataset_schema_versions WHERE schema_id IN (SELECT id FROM api.dataset_schema_definitions WHERE workspace_id IN ($1,$2))`,
      [workspaceId, otherWorkspaceId],
    )
    await admin.query(
      'DELETE FROM api.dataset_schema_definitions WHERE workspace_id IN ($1,$2)',
      [workspaceId, otherWorkspaceId],
    )
    for (const table of [
      'datasets',
      'dataset_schema_versions',
      'dataset_schema_version_fields',
    ])
      await admin.query(`ALTER TABLE api.${table} ENABLE TRIGGER USER`)
    await admin.query('DELETE FROM api.workspaces WHERE id IN ($1,$2)', [
      workspaceId,
      otherWorkspaceId,
    ])
    await admin.query('DELETE FROM internal."user" WHERE id=$1', [userId])
    await admin.query('COMMIT')
  } catch (error) {
    await admin.query('ROLLBACK')
    throw error
  } finally {
    await admin.end()
  }
})

describe('SET02 native structured link authority', () => {
  it('links an authorized Dataset by display id with no records-only FK', async () => {
    const records = await proxy(`records?id=eq.${sourceId}`)
    expect(records.status).toBe(200)
    expect(z.array(source).parse(await records.json())).toEqual([
      { id: sourceId },
    ])
    const targets = await proxy(`datasets?id=eq.${readable.id}`)
    expect(targets.status).toBe(200)
    expect(z.array(dataset).parse(await targets.json())).toEqual([readable])
    const response = await proxy('rpc/create_record_link', {
      p_source_record_id: sourceId,
      p_target_kind: 'dataset',
      p_target_identifier: readable.display_id,
      p_link_type: 'dataset',
    })
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toMatchObject({
      source_record_id: sourceId,
      target_record_id: null,
      target_kind: 'dataset',
      target_identifier: readable.display_id,
    })
  })

  it('denies Dataset targets without View, foreign targets and unknown identifiers', async () => {
    for (const targetIdentifier of [
      denied.display_id,
      foreign.display_id,
      'DS-99999999',
    ]) {
      const response = await proxy('rpc/create_record_link', {
        p_source_record_id: sourceId,
        p_target_kind: 'dataset',
        p_target_identifier: targetIdentifier,
        p_link_type: 'dataset',
      })
      expect(response.status, await response.clone().text()).toBe(403)
    }
  })

  it('does not let a readable record FK disguise a denied Dataset target', async () => {
    const response = await proxy('rpc/create_record_link', {
      p_source_record_id: sourceId,
      p_target_kind: 'dataset',
      p_target_identifier: denied.display_id,
      p_link_type: 'dataset',
      p_target_record_id: sourceId,
    })
    expect(response.status, await response.clone().text()).toBe(403)
  })

  it('enforces structured target authority on direct table INSERT as well', async () => {
    const response = await proxy('record_links', {
      source_record_id: sourceId,
      target_record_id: sourceId,
      target_kind: 'dataset',
      target_identifier: denied.display_id,
      link_type: 'general',
      created_by_user_id: userId,
    })
    expect(response.status, await response.clone().text()).toBe(403)
  })

  it('denies Dataset INSERT RETURNING into a project without an explicit rule', async () => {
    const response = await proxy('datasets', {
      workspace_id: workspaceId,
      primary_project_id: lockedProject,
      schema_version_id: schemaVersionId,
      name: 'Denied returning proof',
    })
    expect(response.status, await response.clone().text()).toBe(403)
  })

  it('returns a newly inserted Dataset under the existing explicit project rule', async () => {
    const response = await proxy('datasets', {
      workspace_id: workspaceId,
      primary_project_id: projectId,
      schema_version_id: schemaVersionId,
      name: 'Native returning proof',
    })
    expect(response.status, await response.clone().text()).toBe(201)
    expect(z.array(dataset).parse(await response.json())).toHaveLength(1)
  })
})
