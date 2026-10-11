/**
 * R5-CONFIG-04: the In-use screen's records-by-version matrix must match the
 * records that are actually pinned to each Notebook Template Version. This
 * reads the same rows the screen reads (`records.source_notebook_template_version_id`)
 * and checks `buildInUseMatrix` against the database's own grouped counts,
 * including the project-visibility (hidden-record) case.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { NotebookTemplateVersion } from '#/lib/notebook-template-data'
import {
  buildInUseMatrix,
  countTemplateUse,
} from '#/lib/notebook-template-usage'
import type { TemplateUsageRecord } from '#/lib/notebook-template-usage'
import { prepareTestDatabase, grantProjectAccess } from './helpers'

const WS = '06400000-0000-4000-8000-000000000001'
const PROJECT_A = '06400000-0000-4000-8000-000000000003'
const PROJECT_B = '06400000-0000-4000-8000-000000000004'
const OWNER = 'config-064-owner'
const MEMBER = 'config-064-member'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(userId: string) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: userId, workspace_id: WS, role: 'authenticated' }),
  ])
  return client
}

function narrativeConfig() {
  return {
    formatVersion: 1,
    parameters: [],
    placements: [
      {
        id: '06400000-0000-4000-8000-000000000010',
        kind: 'narrative',
        order: 1,
        blockType: 'rich_text',
        payload: { doc: { type: 'doc', content: [{ type: 'paragraph' }] } },
      },
    ],
  }
}

const RECORD_COLUMNS =
  'id,identifier,title,source_notebook_template_version_id,status,locked_at,project_id,created_by_user_id,created_at,updated_at'

async function inUseRows(
  client: Client,
  versionIds: string[],
): Promise<TemplateUsageRecord[]> {
  const result = await client.query(
    `select ${RECORD_COLUMNS} from api.records
      where source_notebook_template_version_id = any($1::uuid[])
      order by updated_at desc`,
    [versionIds],
  )
  return result.rows as TemplateUsageRecord[]
}

async function pinnedCounts(
  client: Client,
  versionIds: string[],
): Promise<
  Map<
    string,
    { total: number; inProgress: number; inReview: number; signed: number }
  >
> {
  const result = await client.query(
    `select source_notebook_template_version_id as id,
            count(*)::int as total,
            count(*) filter (where locked_at is not null)::int as signed,
            count(*) filter (
              where locked_at is null and lower(status) like '%review%'
            )::int as in_review,
            count(*) filter (
              where locked_at is null and lower(status) not like '%review%'
            )::int as in_progress
       from api.records
      where source_notebook_template_version_id = any($1::uuid[])
      group by 1`,
    [versionIds],
  )
  return new Map(
    result.rows.map((row) => [
      row.id as string,
      {
        total: row.total,
        inProgress: row.in_progress,
        inReview: row.in_review,
        signed: row.signed,
      },
    ]),
  )
}

async function instantiate(
  client: Client,
  versionId: string,
  projectId: string,
  title: string,
  key: string,
) {
  const result = await client.query(
    `select api.instantiate_notebook_template_version($1,$2,$3,'[]'::jsonb,$4) result`,
    [versionId, projectId, title, key],
  )
  return result.rows[0].result.record
}

let version1: string
let version2: string
let templateId: string

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values
      ($1,'Owner','config-064-owner@test.invalid',true),
      ($2,'Member','config-064-member@test.invalid',true)`,
    [OWNER, MEMBER],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'config-064','R5-CONFIG-04')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
      ($1,$2,'owner'),($1,$3,'member')`,
    [WS, OWNER, MEMBER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values
      ($1,$3,'C64A','Project A',$4),
      ($2,$3,'C64B','Project B',$4)`,
    [PROJECT_A, PROJECT_B, WS, OWNER],
  )
  await grantProjectAccess(migrator, {
    workspaceId: WS,
    projectId: PROJECT_A,
    userId: MEMBER,
    canView: true,
    canEdit: true,
    canReview: true,
  })
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('R5-CONFIG-04 in-use matrix over pinned records', () => {
  it('matches the records pinned to each version and their status split', async () => {
    const owner = await actor(OWNER)
    const member = await actor(MEMBER)

    const created = (
      await owner.query(
        `select api.create_notebook_template($1,'in_use_matrix','In-use matrix',null,$2::jsonb) result`,
        [WS, JSON.stringify(narrativeConfig())],
      )
    ).rows[0].result
    templateId = created.template.id
    version1 = (
      await owner.query(
        `select to_jsonb(api.publish_notebook_template_version($1,$2,'v1')) result`,
        [created.version.id, created.version.revision],
      )
    ).rows[0].result.id
    const draft2 = (
      await owner.query(
        `select to_jsonb(api.create_notebook_template_version($1,$2,$3::jsonb)) result`,
        [templateId, 1, JSON.stringify(narrativeConfig())],
      )
    ).rows[0].result
    version2 = (
      await owner.query(
        `select to_jsonb(api.publish_notebook_template_version($1,$2,'v2')) result`,
        [draft2.id, draft2.revision],
      )
    ).rows[0].result.id

    const a1 = await instantiate(member, version1, PROJECT_A, 'A1', 'iu-a1')
    const a2 = await instantiate(member, version1, PROJECT_A, 'A2', 'iu-a2')
    await instantiate(member, version1, PROJECT_A, 'A3', 'iu-a3')
    await instantiate(member, version2, PROJECT_A, 'B1', 'iu-b1')

    await member.query(`select api.start_experiment($1,$2,null,null)`, [
      a1.id,
      a1.metadata_version,
    ])
    const startedA2 = (
      await member.query(
        `select to_jsonb(api.start_experiment($1,$2,null,null)) result`,
        [a2.id, a2.metadata_version],
      )
    ).rows[0].result
    await member.query(
      `select api.set_experiment_status($1,$2,'in_review','ready for review')`,
      [a2.id, startedA2.metadata_version],
    )

    const versionRows = (
      await member.query(
        `select id, version, lifecycle from api.notebook_template_versions
          where template_id = $1 order by version`,
        [templateId],
      )
    ).rows
    const versions = versionRows.map(
      (row) =>
        ({ id: row.id, version: row.version }) as NotebookTemplateVersion,
    )
    const versionIds = versions.map((version) => version.id)

    const rows = await inUseRows(member, versionIds)
    const expected = await pinnedCounts(member, versionIds)
    const matrix = buildInUseMatrix(rows, versions)

    expect(matrix).toHaveLength(2)
    for (const row of matrix) {
      const counts = expected.get(row.version.id)
      expect(counts).toBeDefined()
      expect({
        total: row.total,
        inProgress: row.inProgress,
        inReview: row.inReview,
        signed: row.signed,
      }).toEqual(counts)
    }

    // v1: A1 in progress, A2 in review, A3 in progress. v2: B1 in progress.
    expect(matrix.find((row) => row.version.version === 1)).toMatchObject({
      total: 3,
      inProgress: 2,
      inReview: 1,
      signed: 0,
    })
    expect(matrix.find((row) => row.version.version === 2)).toMatchObject({
      total: 1,
      inProgress: 1,
      inReview: 0,
      signed: 0,
    })
    expect(countTemplateUse(rows).total).toBe(4)
  })

  it('excludes records in projects the viewer cannot see', async () => {
    const owner = await actor(OWNER)
    const member = await actor(MEMBER)
    const hidden = await instantiate(
      owner,
      version1,
      PROJECT_B,
      'Hidden',
      'iu-b2',
    )

    const versions = [
      { id: version1, version: 1 } as NotebookTemplateVersion,
      { id: version2, version: 2 } as NotebookTemplateVersion,
    ]
    const memberRows = await inUseRows(member, [version1, version2])
    const ownerRows = await inUseRows(owner, [version1, version2])

    expect(memberRows.some((row) => row.id === hidden.id)).toBe(false)
    expect(ownerRows.some((row) => row.id === hidden.id)).toBe(true)

    const memberMatrix = buildInUseMatrix(memberRows, versions)
    const ownerMatrix = buildInUseMatrix(ownerRows, versions)
    expect(memberMatrix[1].total).toBe(3)
    expect(ownerMatrix[1].total).toBe(4)
  })
})
