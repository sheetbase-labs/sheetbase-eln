/**
 * Search facet counts come from the server. api.search_facets reads the same
 * matches as api.search, so its counts must add up to api.search's total_count
 * and agree with paging through every result, however many pages there are.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '0d050000-0000-4000-8000-00000000000a'
const OWNER = 'search-facets-owner'
const PROJ_1 = '0d050000-0000-4000-8000-0000000001a1'
const PROJ_2 = '0d050000-0000-4000-8000-0000000001a2'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
let actor: Client

interface Facet {
  result_type: string
  kind: string
  project_id: string | null
  in_text: boolean
  match_count: string | number
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(`
    insert into internal."user"(id,name,email,"emailVerified")
    values ('${OWNER}','Owner','search-facets@test.invalid',true);
    insert into api.workspaces(id,slug,name) values ('${WS}','search-facets','Facets');
    insert into api.workspace_memberships(workspace_id,user_id,role)
    values ('${WS}','${OWNER}','owner');
    insert into api.projects(id,workspace_id,key,title,lead_user_id) values
      ('${PROJ_1}','${WS}','alpha','Alpha study','${OWNER}'),
      ('${PROJ_2}','${WS}','beta','Beta study','${OWNER}');
    -- 130 experiments and 40 samples all matching "buffer": more than one
    -- page of 100, so a count taken from the first page would be wrong.
    insert into api.records(workspace_id,project_id,kind,identifier,title,created_by_user_id)
    select '${WS}', case when n % 3 = 0 then '${PROJ_2}'::uuid else '${PROJ_1}'::uuid end,
           'experiment', 'EXP-F-' || lpad(n::text, 4, '0'), 'Buffer exchange run ' || n, '${OWNER}'
      from generate_series(1, 130) n;
    insert into api.records(workspace_id,project_id,kind,identifier,title,created_by_user_id)
    select '${WS}', '${PROJ_1}'::uuid, 'sample', 'SMP-F-' || lpad(n::text, 4, '0'),
           'Buffer lot ' || n, '${OWNER}'
      from generate_series(1, 40) n;
  `)
  actor = await asRole('authenticator')
  await actor.query('SET ROLE authenticated')
  await actor.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: OWNER, workspace_id: WS, role: 'authenticated' }),
  ])
})

afterAll(async () => {
  await actor.end()
  await migrator.end()
})

async function facets(query: string): Promise<Facet[]> {
  const { rows } = await actor.query<Facet>(
    `select * from api.search_facets(p_query := $1::text)`,
    [query],
  )
  return rows
}

describe('api.search_facets', () => {
  it('counts every match, not just the first page', async () => {
    const rows = await facets('buffer')
    const total = rows.reduce((sum, r) => sum + Number(r.match_count), 0)
    expect(total).toBe(170)
    const samples = rows
      .filter((r) => r.kind === 'sample')
      .reduce((sum, r) => sum + Number(r.match_count), 0)
    expect(samples).toBe(40)
  })

  it('adds up to the total api.search reports', async () => {
    const { rows } = await actor.query<{ total_count: string }>(
      `select total_count from api.search(p_query := 'buffer', p_limit := 5) limit 1`,
    )
    const facetTotal = (await facets('buffer')).reduce(
      (sum, r) => sum + Number(r.match_count),
      0,
    )
    expect(facetTotal).toBe(Number(rows[0].total_count))
  })

  it('splits the counts by project', async () => {
    const rows = await facets('buffer')
    const byProject = new Map<string | null, number>()
    for (const r of rows)
      byProject.set(
        r.project_id,
        (byProject.get(r.project_id) ?? 0) + Number(r.match_count),
      )
    // 130 experiments: every third in beta; all 40 samples in alpha.
    expect(byProject.get(PROJ_2)).toBe(43)
    expect(byProject.get(PROJ_1)).toBe(127)
  })

  it('agrees with paging through every result', async () => {
    const paged = new Map<string, number>()
    for (let offset = 0; offset < 170; offset += 100) {
      const { rows } = await actor.query<{
        result_type: string
        kind: string
        project_id: string | null
        matched_field: string
      }>(
        `select result_type, kind, project_id, matched_field
           from api.search(p_query := 'buffer', p_limit := 100, p_offset := $1)`,
        [offset],
      )
      for (const r of rows) {
        const key = `${r.result_type}|${r.kind}|${r.project_id}|${['block_text', 'comment_body'].includes(r.matched_field)}`
        paged.set(key, (paged.get(key) ?? 0) + 1)
      }
    }
    const grouped = new Map<string, number>()
    for (const r of await facets('buffer'))
      grouped.set(
        `${r.result_type}|${r.kind}|${r.project_id}|${r.in_text}`,
        Number(r.match_count),
      )
    expect(grouped).toEqual(paged)
  })

  it('honours the archived scope like the search it counts', async () => {
    await migrator.query(
      `update api.records set archived_at = now() where identifier = 'SMP-F-0001'`,
    )
    const { rows } = await actor.query<{ n: string }>(
      `select sum(match_count) n from api.search_facets(p_query := 'buffer', p_include_archived := false)`,
    )
    expect(Number(rows[0].n)).toBe(169)
  })
})
