/**
 * DATA-04 global search contract proof. The canonical api.search RPC covers
 * records, files, Datasets, Sheet Instances and Notebook Templates in one
 * permission-filtered surface. Runs against a freshly migrated
 * sheetbase_test database.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS_A = '0d040000-0000-4000-8000-00000000000a'
const WS_B = '0d040000-0000-4000-8000-00000000000b'
const PROJ_A = '0d040000-0000-4000-8000-0000000001a1'
const PROJ_B = '0d040000-0000-4000-8000-0000000001b1'
const OWNER_A = 'data-04-owner-a'
const OWNER_B = 'data-04-owner-b'

const DATASET_A = '0d040000-0000-4000-8000-0000000002a1'
const DATASET_ARCHIVED_A = '0d040000-0000-4000-8000-0000000002a2'
const SHEET_A = '0d040000-0000-4000-8000-0000000003a1'
const TEMPLATE_A = '0d040000-0000-4000-8000-0000000004a1'
const RECORD_A = '0d040000-0000-4000-8000-0000000005a1'
const DATASET_B = '0d040000-0000-4000-8000-0000000002b1'
const SHEET_B = '0d040000-0000-4000-8000-0000000003b1'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(userId: string, workspaceId: string) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: userId, workspace_id: workspaceId }),
  ])
  return client
}

interface Hit {
  result_type: string
  record_id: string
  kind: string
  identifier: string
  title: string
  status: string
  deep_link: string
  archived: boolean
  total_count: string | number
}

/**
 * Minimal state that satisfies the controlled Sheet Instance guard triggers.
 */
const MINIMAL_INSTANCE_STATE =
  '{"bindings":[],"localFields":[],"localValues":{},"calculationOverrides":{},' +
  '"presentation":{"columnOrder":[],"hiddenColumnIds":[],"columnWidths":{},' +
  '"frozenColumnCount":0,"density":"standard"},"provenance":{"createdFrom":"ad_hoc"}}'

interface SearchArgs {
  query?: string
  projectId?: string
  kind?: string
  status?: string
  resultType?: string
  limit?: number
}

/** Call api.search with named arguments so omitted options keep defaults. */
async function search(
  userId: string,
  workspaceId: string,
  args: SearchArgs = {},
): Promise<Hit[]> {
  const client = await actor(userId, workspaceId)
  const { rows } = await client.query<Hit>(
    `select * from api.search(
       p_query := $1::text,
       p_project_id := $2::uuid,
       p_kind := $3::text,
       p_status := $4::text,
       p_result_type := $5::text,
       p_limit := $6::int)`,
    [
      args.query ?? null,
      args.projectId ?? null,
      args.kind ?? null,
      args.status ?? null,
      args.resultType ?? null,
      args.limit ?? null,
    ],
  )
  return rows
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  // Fixture inserts bypass the controlled sheet-instance RPCs, so the guard
  // GUC is set locally for the migrator session only.
  await migrator.query(
    `select set_config('sheetbase.sheet_instance_write','rpc-v1',false)`,
  )

  await migrator.query(`
    insert into internal."user"(id,name,email,"emailVerified") values
      ('${OWNER_A}','Owner A','data-04-a@test.invalid',true),
      ('${OWNER_B}','Owner B','data-04-b@test.invalid',true);
    insert into api.workspaces(id,slug,name) values
      ('${WS_A}','data-04-a','DATA-04 A'),
      ('${WS_B}','data-04-b','DATA-04 B');
    insert into api.workspace_memberships(workspace_id,user_id,role) values
      ('${WS_A}','${OWNER_A}','owner'),
      ('${WS_B}','${OWNER_B}','owner');
    insert into api.projects(id,workspace_id,key,title,lead_user_id) values
      ('${PROJ_A}','${WS_A}','dot-study','Dot study','${OWNER_A}'),
      ('${PROJ_B}','${WS_B}','other','Other','${OWNER_B}');

    -- Workspace A fixtures sharing the token "quantum".
    insert into api.records(id,workspace_id,project_id,kind,identifier,title,tags,created_by_user_id)
    values ('${RECORD_A}','${WS_A}','${PROJ_A}','experiment','EXP-2026-0001',
            'Quantum dot stability assay',array['quantum'],'${OWNER_A}');
    insert into api.records(id,workspace_id,project_id,kind,identifier,title,created_by_user_id)
    values ('0d040000-0000-4000-8000-0000000005a2','${WS_A}','${PROJ_A}','file','FILE-2026-0002',
            'Quantum run data csv','${OWNER_A}');

    insert into api.dataset_schema_definitions(id,workspace_id,key,name)
    values ('0d040000-0000-4000-8000-0000000009a1','${WS_A}','dotschema','Dot schema');
    insert into api.dataset_schema_versions(id,schema_id,version,lifecycle,published_at)
    values ('0d040000-0000-4000-8000-0000000009a2','0d040000-0000-4000-8000-0000000009a1',1,'active',now());
    insert into api.datasets(id,workspace_id,primary_project_id,schema_version_id,name,description)
    values ('${DATASET_A}','${WS_A}','${PROJ_A}','0d040000-0000-4000-8000-0000000009a2',
            'Quantum yields','raw quantum yield readings');
    insert into api.datasets(id,workspace_id,primary_project_id,schema_version_id,name,lifecycle)
    values ('${DATASET_ARCHIVED_A}','${WS_A}','${PROJ_A}','0d040000-0000-4000-8000-0000000009a2',
            'Archived quantum set','archived');

    insert into api.sheet_instances(id,workspace_id,project_id,name,state) values
      ('${SHEET_A}','${WS_A}','${PROJ_A}','Quantum screening sheet',
       '${MINIMAL_INSTANCE_STATE}'::jsonb);

    insert into api.notebook_templates(id,workspace_id,key,name,description)
    values ('${TEMPLATE_A}','${WS_A}','quantum_dot_assay','Quantum dot assay template',
            'standard quantum protocol');

    -- Workspace B fixtures that must stay invisible to workspace A.
    insert into api.dataset_schema_definitions(id,workspace_id,key,name)
    values ('0d040000-0000-4000-8000-0000000009b1','${WS_B}','bschema','B schema');
    insert into api.dataset_schema_versions(id,schema_id,version,lifecycle,published_at)
    values ('0d040000-0000-4000-8000-0000000009b2','0d040000-0000-4000-8000-0000000009b1',1,'active',now());
    insert into api.datasets(id,workspace_id,schema_version_id,name)
    values ('${DATASET_B}','${WS_B}','0d040000-0000-4000-8000-0000000009b2',
            'Quantum B private');
    insert into api.sheet_instances(id,workspace_id,project_id,name,state) values
      ('${SHEET_B}','${WS_B}','${PROJ_B}','Quantum B sheet',
       '${MINIMAL_INSTANCE_STATE}'::jsonb);
  `)
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('DATA-04 global search coverage', () => {
  it('finds records, datasets, sheets and templates in one query', async () => {
    const hits = await search(OWNER_A, WS_A, { query: 'quantum', limit: 50 })
    const types = new Set(hits.map((h) => h.result_type))
    expect(types).toContain('record')
    expect(types).toContain('dataset')
    expect(types).toContain('sheet')
    expect(types).toContain('template')
  })

  it('returns every object class in browse mode', async () => {
    const hits = await search(OWNER_A, WS_A, { limit: 100 })
    const types = new Set(hits.map((h) => h.result_type))
    expect(types).toContain('record')
    expect(types).toContain('dataset')
    expect(types).toContain('sheet')
    expect(types).toContain('template')
  })

  it('narrows to a single class via p_result_type', async () => {
    const expectedTitles: Record<string, string> = {
      record: 'Quantum dot stability assay',
      dataset: 'Quantum yields',
      sheet: 'Quantum screening sheet',
      template: 'Quantum dot assay template',
    }
    for (const resultType of [
      'record',
      'dataset',
      'sheet',
      'template',
    ] as const) {
      const hits = await search(OWNER_A, WS_A, {
        query: 'quantum',
        resultType,
      })
      expect(hits.length).toBeGreaterThan(0)
      for (const hit of hits) {
        expect(hit.result_type).toBe(resultType)
      }
      expect(hits.map((h) => h.title)).toContain(expectedTitles[resultType])
    }
  })

  it('treats Records and Files as independent facets', async () => {
    // type=record excludes kind=file rows even though both live in records.
    const records = await search(OWNER_A, WS_A, {
      query: 'quantum',
      resultType: 'record',
    })
    expect(records.length).toBeGreaterThan(0)
    for (const hit of records) {
      expect(hit.result_type).toBe('record')
      expect(hit.kind).not.toBe('file')
    }
    // type=file returns only file rows.
    const files = await search(OWNER_A, WS_A, {
      query: 'quantum',
      resultType: 'file',
    })
    for (const hit of files) {
      expect(hit.result_type).toBe('file')
      expect(hit.kind).toBe('file')
    }
    expect(files.length).toBeGreaterThan(0)
  })

  it('rejects an invalid p_result_type', async () => {
    await expect(
      search(OWNER_A, WS_A, { resultType: 'widgets' }),
    ).rejects.toMatchObject({ code: '22023' })
  })

  it('never leaks another workspace objects through rows or counts', async () => {
    const hits = await search(OWNER_A, WS_A, { query: 'quantum', limit: 100 })
    expect(hits.some((h) => h.record_id === DATASET_B)).toBe(false)
    expect(hits.some((h) => h.record_id === SHEET_B)).toBe(false)
    for (const hit of hits) {
      expect(Number(hit.total_count)).toBe(hits.length)
    }
  })

  it('builds stable deep links per object class', async () => {
    const hits = await search(OWNER_A, WS_A, { query: 'quantum', limit: 100 })
    const byId = new Map(hits.map((h) => [h.record_id, h]))
    expect(byId.get(RECORD_A)?.deep_link).toBe(`/records/${RECORD_A}`)
    expect(byId.get(DATASET_A)?.deep_link).toBe(
      `/datasets?dataset=${DATASET_A}`,
    )
    expect(byId.get(SHEET_A)?.deep_link).toBe(`/sheets/${SHEET_A}`)
    expect(byId.get(TEMPLATE_A)?.deep_link).toBe(
      `/templates?template=${TEMPLATE_A}`,
    )
  })

  it('includes archived datasets with archived=true', async () => {
    const hits = await search(OWNER_A, WS_A, {
      query: 'archived quantum',
      resultType: 'dataset',
    })
    const archived = hits.find((h) => h.record_id === DATASET_ARCHIVED_A)
    expect(archived).toBeTruthy()
    expect(archived?.archived).toBe(true)
  })

  it('keeps p_kind scoped to records only', async () => {
    const hits = await search(OWNER_A, WS_A, { kind: 'dataset', limit: 100 })
    expect(hits).toHaveLength(0)
    const samples = await search(OWNER_A, WS_A, {
      kind: 'experiment',
      limit: 100,
    })
    expect(samples.every((h) => h.kind === 'experiment')).toBe(true)
  })

  it('denies a claimed workspace the caller does not belong to', async () => {
    await expect(
      search(OWNER_B, WS_A, { query: 'quantum' }),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('ranks an exact identifier/title match above incidental text', async () => {
    const hits = await search(OWNER_A, WS_A, { query: 'yields', limit: 10 })
    expect(hits[0]?.result_type).toBe('dataset')
    expect(hits[0]?.title).toBe('Quantum yields')
  })
})
