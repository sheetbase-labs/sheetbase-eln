/**
 * SEARCH-02 — projects, pipelines and analyses are indexed by api.search, so
 * they rank, page and count with everything else, match the start of a name,
 * honour the archived scope and stay inside the caller's workspace.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-0000000015a0'
const OTHER_WS = '00000000-0000-4000-8000-0000000015a1'
const PROJECT = '00000000-0000-4000-8000-0000000015a2'
const ARCHIVED_PROJECT = '00000000-0000-4000-8000-0000000015a3'
const OTHER_PROJECT = '00000000-0000-4000-8000-0000000015a4'
const PIPELINE = '00000000-0000-4000-8000-0000000015a5'
const VIEW = '00000000-0000-4000-8000-0000000015a6'
const DEFINITION = '00000000-0000-4000-8000-0000000015a7'
const OTHER_PIPELINE = '00000000-0000-4000-8000-0000000015a8'
const MEMBER = 'swo-member'
const OUTSIDER = 'swo-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(userId: string, workspaceId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      sub: userId,
      workspace_id: workspaceId,
      role: 'authenticated',
    }),
  ])
  return client
}

async function search(
  client: Client,
  query: string,
  extra: Partial<{
    project: string
    resultType: string
    includeArchived: boolean
    kind: string
  }> = {},
) {
  const { rows } = await client.query<{
    result_type: string
    record_id: string
    identifier: string
    title: string
    archived: boolean
    matched_field: string
    deep_link: string
    total_count: string
  }>(
    `select * from api.search(p_query => $1, p_project_id => $2, p_kind => $3,
                              p_result_type => $4, p_include_archived => $5)`,
    [
      query,
      extra.project ?? null,
      extra.kind ?? null,
      extra.resultType ?? null,
      extra.includeArchived ?? true,
    ],
  )
  return rows
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [MEMBER, OUTSIDER]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'swo','SWO'),($2,'swo-other','Other')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role)
     values($1,$2,'owner'),($3,$4,'owner')`,
    [WS, MEMBER, OTHER_WS, OUTSIDER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id,archived_at) values
       ($1,$4,'ZEBRA','Zebrafish toxicity programme',$5,null),
       ($2,$4,'ZOLD','Zebrafish pilot (closed)',$5,now()),
       ($3,$6,'ZOTHER','Zebrafish elsewhere',$7,null)`,
    [PROJECT, ARCHIVED_PROJECT, OTHER_PROJECT, WS, MEMBER, OTHER_WS, OUTSIDER],
  )
  await migrator.query(
    `insert into api.pipeline_definitions(id,workspace_id,key,name,description,created_by_user_id)
     values($1,$3,'zplate','Zebrafish plate reader import','Parses the raw plate export',$4),
           ($2,$5,'zother','Zebrafish elsewhere pipeline',null,$6)`,
    [PIPELINE, OTHER_PIPELINE, WS, MEMBER, OTHER_WS, OUTSIDER],
  )
  await migrator.query(
    `insert into api.analysis_views(id,workspace_id,owner_user_id,name,charts)
     values($1,$2,$3,'Zebrafish dose response','[{}]'::jsonb)`,
    [VIEW, WS, MEMBER],
  )
  await migrator.query(
    `insert into api.analysis_definitions(id,workspace_id,owner_user_id,name,definition)
     values($1,$2,$3,'Zebrafish survival statistics','{}'::jsonb)`,
    [DEFINITION, WS, MEMBER],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('SEARCH-02 projects, pipelines and analyses in api.search', () => {
  it('finds each class by name, with its own result type and destination', async () => {
    const member = await actor(MEMBER, WS)
    const rows = await search(member, 'zebrafish')
    const byType = Object.groupBy(rows, (row) => row.result_type)

    expect(byType.project?.map((r) => r.record_id).sort()).toEqual(
      [PROJECT, ARCHIVED_PROJECT].sort(),
    )
    expect(byType.pipeline?.map((r) => r.record_id)).toEqual([PIPELINE])
    expect(byType.analysis?.map((r) => r.record_id).sort()).toEqual(
      [VIEW, DEFINITION].sort(),
    )
    expect(byType.project?.find((r) => r.record_id === PROJECT)).toMatchObject({
      identifier: 'ZEBRA',
      deep_link: `/projects/${PROJECT}`,
    })
    expect(byType.pipeline?.[0]).toMatchObject({
      deep_link: `/pipelines/${PIPELINE}`,
    })
    expect(byType.analysis?.[0]!.deep_link).toMatch(/^\/analysis\//)
    // They count with the rest: one total for the whole result.
    expect(new Set(rows.map((r) => r.total_count)).size).toBe(1)
    expect(Number(rows[0]!.total_count)).toBe(rows.length)
  })

  it('finds a name by its start and a project by its key', async () => {
    const member = await actor(MEMBER, WS)
    const byStart = await search(member, 'zebraf', { resultType: 'project' })
    expect(byStart.map((r) => r.record_id)).toContain(PROJECT)
    expect(byStart.find((r) => r.record_id === PROJECT)?.matched_field).toBe(
      'title',
    )

    const byKey = await search(member, 'zebr', { resultType: 'project' })
    expect(byKey.map((r) => r.record_id)).toContain(PROJECT)
    // The key is a full-text hit; the other project matches only as a
    // substring of its title, so the key's match ranks first.
    const exactKey = await search(member, 'ZEBRA', { resultType: 'project' })
    expect(exactKey[0]).toMatchObject({
      record_id: PROJECT,
      matched_field: 'identifier',
    })
  })

  it('narrows to one class with p_result_type', async () => {
    const member = await actor(MEMBER, WS)
    for (const resultType of ['project', 'pipeline', 'analysis']) {
      const rows = await search(member, 'zebrafish', { resultType })
      expect(rows.length).toBeGreaterThan(0)
      expect(new Set(rows.map((r) => r.result_type))).toEqual(
        new Set([resultType]),
      )
    }
  })

  it('applies the archived scope, with a query and without one', async () => {
    const member = await actor(MEMBER, WS)
    const live = await search(member, 'zebrafish', {
      resultType: 'project',
      includeArchived: false,
    })
    expect(live.map((r) => r.record_id)).toEqual([PROJECT])

    const browsing = await search(member, '', {
      resultType: 'project',
      includeArchived: false,
    })
    expect(browsing.every((r) => !r.archived)).toBe(true)
    expect(browsing.map((r) => r.record_id)).not.toContain(ARCHIVED_PROJECT)

    const all = await search(member, '', { resultType: 'project' })
    expect(all.map((r) => r.record_id)).toContain(ARCHIVED_PROJECT)
  })

  it('keeps the project filter to the project itself, and a record kind filter to records', async () => {
    const member = await actor(MEMBER, WS)
    const inProject = await search(member, 'zebrafish', { project: PROJECT })
    expect(inProject.filter((r) => r.result_type === 'pipeline')).toEqual([])
    expect(inProject.filter((r) => r.result_type === 'analysis')).toEqual([])
    expect(
      inProject
        .filter((r) => r.result_type === 'project')
        .map((r) => r.record_id),
    ).toEqual([PROJECT])

    const byKind = await search(member, 'zebrafish', { kind: 'experiment' })
    expect(
      byKind.filter((r) =>
        ['project', 'pipeline', 'analysis'].includes(r.result_type),
      ),
    ).toEqual([])
  })

  it('never returns another workspace’s projects or pipelines', async () => {
    const member = await actor(MEMBER, WS)
    const rows = await search(member, 'zebrafish')
    expect(rows.map((r) => r.record_id)).not.toContain(OTHER_PROJECT)
    expect(rows.map((r) => r.record_id)).not.toContain(OTHER_PIPELINE)

    const outsider = await actor(OUTSIDER, OTHER_WS)
    const theirs = await search(outsider, 'zebrafish')
    expect(theirs.map((r) => r.record_id).sort()).toEqual(
      [OTHER_PROJECT, OTHER_PIPELINE].sort(),
    )
  })
})
