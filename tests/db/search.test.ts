/**
 * SCI-008 database integration proof: the api.search RPC enforces workspace
 * isolation, finds updated block text immediately (real-time), returns mixed
 * result types, includes archived records with an archived flag, searches
 * file metadata and record-relationship context, and applies structured
 * filters and pagination. PostgreSQL and RLS remain authoritative.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS_A = '00000000-0000-4000-8000-000000aa0001'
const WS_B = '00000000-0000-4000-8000-000000aa0002'
const PROJ_A = '00000000-0000-4000-8000-000000aa0101'
const PROJ_B = '00000000-0000-4000-8000-000000aa0102'
const OWNER_A = 'sci008-owner-a'
const OWNER_B = 'sci008-owner-b'

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
  await client.query(
    "SELECT set_config('request.jwt.claims', $1, false)",
    [claims(userId, workspaceId)],
  )
  return client
}

async function createRecord(
  client: Client,
  project: string,
  kind: string,
  title: string,
  status = 'draft',
  properties: Record<string, unknown> = {},
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `SELECT * FROM api.create_record($1::uuid, $2, $3, $4, ARRAY[]::text[], $5::jsonb)`,
    [project, kind, title, status, JSON.stringify(properties)],
  )
  return rows[0]
}

/** Insert a record directly as migrator (for kinds not supported by create_record). */
async function insertRecord(
  workspace: string,
  project: string,
  kind: string,
  identifier: string,
  title: string,
  owner: string,
  status = 'draft',
): Promise<Record<string, any>> {
  const { rows } = await migrator.query(
    `INSERT INTO api.records (workspace_id, project_id, kind, identifier, title, status, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [workspace, project, kind, identifier, title, status, owner],
  )
  return rows[0]
}

async function insertBlock(
  client: Client,
  recordId: string,
  type: string,
  payload: Record<string, unknown>,
  owner: string,
): Promise<void> {
  await client.query(
    `INSERT INTO api.blocks (record_id, type, payload, "order", created_by_user_id)
     VALUES ($1, $2, $3::jsonb, 1, $4)`,
    [recordId, type, JSON.stringify(payload), owner],
  )
}

async function insertFileObject(
  recordId: string,
  workspace: string,
  displayName: string,
  mediaType: string,
  owner: string,
): Promise<void> {
  // storage_key must match the chk_file_objects_storage_key format:
  // <uuid>/<uuid>/<32 hex chars>
  const hash = recordId.replace(/-/g, '').padEnd(32, '0').slice(0, 32)
  await migrator.query(
    `INSERT INTO api.file_objects
      (workspace_id, record_id, storage_key, display_name, media_type, byte_size, status, storage_backend, created_by_user_id, updated_by_user_id)
     VALUES ($1, $2, $3, $4, $5, 256, 'active', 'local', $6, $6)`,
    [workspace, recordId, `${workspace}/${recordId}/${hash}`, displayName, mediaType, owner],
  )
}

async function search(
  client: Client,
  query: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, any>[]> {
  const args: Record<string, unknown> = { p_query: query }
  Object.assign(args, params)
  const { rows } = await client.query(
    `SELECT * FROM api.search($1::text, $2::uuid, $3::text, $4::text, $5::text, $6::timestamptz, $7::timestamptz, $8::int, $9::int)`,
    [
      args.p_query ?? '',
      args.p_project_id ?? null,
      args.p_kind ?? null,
      args.p_status ?? null,
      args.p_owner_id ?? null,
      args.p_date_from ?? null,
      args.p_date_to ?? null,
      args.p_limit ?? 20,
      args.p_offset ?? 0,
    ],
  )
  return rows
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${OWNER_A}', 'SCI008 Owner A', 'sci008-a@sheetbase.test', true),
      ('${OWNER_B}', 'SCI008 Owner B', 'sci008-b@sheetbase.test', true);
     INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS_A}', 'sci008-a', 'SCI008 A'),
      ('${WS_B}', 'sci008-b', 'SCI008 B');
     INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS_A}', '${OWNER_A}', 'owner'),
      ('${WS_B}', '${OWNER_B}', 'owner');
     INSERT INTO api.projects (id, workspace_id, key, title) VALUES
      ('${PROJ_A}', '${WS_A}', 'sci008a', 'SCI008 A Project'),
      ('${PROJ_B}', '${WS_B}', 'sci008b', 'SCI008 B Project')`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('SCI-008 search — workspace isolation', () => {
  it('returns only records from the caller workspace', async () => {
    const ownerA = await asAuthenticated(OWNER_A, WS_A)
    const ownerB = await asAuthenticated(OWNER_B, WS_B)

    await createRecord(ownerA, PROJ_A, 'experiment', 'Alpha experiment')
    await createRecord(ownerB, PROJ_B, 'experiment', 'Beta experiment')

    const resultsA = await search(ownerA, 'experiment')
    const titlesA = resultsA.map((r) => r.title)
    expect(titlesA).toContain('Alpha experiment')
    expect(titlesA).not.toContain('Beta experiment')

    const resultsB = await search(ownerB, 'experiment')
    const titlesB = resultsB.map((r) => r.title)
    expect(titlesB).toContain('Beta experiment')
    expect(titlesB).not.toContain('Alpha experiment')
  })

  it('returns nothing for a query that only matches cross-workspace records', async () => {
    const ownerA = await asAuthenticated(OWNER_A, WS_A)
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    await createRecord(ownerB, PROJ_B, 'experiment', 'Cross-workspace unique term zyxwv')
    const results = await search(ownerA, 'zyxwv')
    expect(results).toHaveLength(0)
  })
})

describe('SCI-008 search — archived records', () => {
  it('includes archived records with archived = true', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const record = await createRecord(owner, PROJ_A, 'sample', 'Archived searchable sample', 'available')
    await owner.query(`UPDATE api.records SET archived_at = now() WHERE id = $1`, [record.id])
    const results = await search(owner, 'searchable sample')
    const hit = results.find((r) => r.record_id === record.id)
    expect(hit).toBeDefined()
    expect(hit.archived).toBe(true)
  })

  it('excludes soft-deleted records', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const record = await createRecord(owner, PROJ_A, 'sample', 'Soft-deleted invisible sample', 'available')
    await owner.query(`UPDATE api.records SET deleted_at = now() WHERE id = $1`, [record.id])
    const results = await search(owner, 'invisible sample')
    expect(results.find((r) => r.record_id === record.id)).toBeUndefined()
  })
})

describe('SCI-008 search — updated block text is immediately searchable', () => {
  it('finds text after a block is inserted (real-time, no indexing delay)', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const record = await createRecord(owner, PROJ_A, 'experiment', 'Real-time text experiment')
    // No blocks yet — search by block text should not match.
    const before = await search(owner, 'freshly indexed content')
    expect(before.find((r) => r.record_id === record.id)).toBeUndefined()
    // Insert a block with distinct text.
    await insertBlock(owner, record.id, 'rich_text', {
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'This is freshly indexed content for search.' }],
          },
        ],
      },
    }, OWNER_A)
    const after = await search(owner, 'freshly indexed content')
    const hit = after.find((r) => r.record_id === record.id)
    expect(hit).toBeDefined()
    expect(hit.matched_field).toBe('block_text')
  })
})

describe('SCI-008 search — mixed result types', () => {
  it('finds experiments, samples, reagents, protocols, templates and files', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    await createRecord(owner, PROJ_A, 'experiment', 'Mixed type experiment')
    await createRecord(owner, PROJ_A, 'sample', 'Mixed type sample', 'available')
    await createRecord(owner, PROJ_A, 'reagent', 'Mixed type reagent', 'available')
    await createRecord(owner, PROJ_A, 'protocol_template', 'Mixed type protocol', 'validated')
    const template = await insertRecord(WS_A, PROJ_A, 'notebook_template', 'NBK-MIXED-0001', 'Mixed type template', OWNER_A, 'validated')
    const fileRec = await insertRecord(WS_A, PROJ_A, 'file', 'FILE-MIXED-0001', 'Mixed type file', OWNER_A, 'active')
    await insertFileObject(fileRec.id, WS_A, 'mixed-type-report.pdf', 'application/pdf', OWNER_A)

    const results = await search(owner, 'mixed type')
    const kinds = new Set(results.map((r) => r.kind))
    expect(kinds.has('experiment')).toBe(true)
    expect(kinds.has('sample')).toBe(true)
    expect(kinds.has('reagent')).toBe(true)
    expect(kinds.has('protocol_template')).toBe(true)
    expect(kinds.has('notebook_template')).toBe(true)
    expect(kinds.has('file')).toBe(true)
  })
})

describe('SCI-008 search — file metadata', () => {
  it('finds records by file display name and media type', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const fileRec = await insertRecord(WS_A, PROJ_A, 'file', 'FILE-QPCR-0001', 'qPCR raw data file', OWNER_A, 'active')
    // Use a display name with spaces; PostgreSQL FTS treats dot/hyphen-delimited
    // filenames as single host tokens, so words within them are not individually
    // searchable. Display names with spaces tokenize correctly.
    await insertFileObject(fileRec.id, WS_A, 'amplification plot results', 'text/csv', OWNER_A)
    const results = await search(owner, 'amplification')
    const hit = results.find((r) => r.record_id === fileRec.id)
    expect(hit).toBeDefined()
    expect(hit.result_type).toBe('file')
    expect(hit.matched_field).toBe('file_metadata')
  })
})

describe('SCI-008 search — record relationship context', () => {
  it('finds a source record by searching for a linked target identifier', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const sample = await createRecord(owner, PROJ_A, 'sample', 'Linked target sample', 'available')
    const experiment = await createRecord(owner, PROJ_A, 'experiment', 'Experiment with linked sample')
    await owner.query(
      `SELECT * FROM api.create_record_link($1, 'sample', $2, 'sample', $3, NULL)`,
      [experiment.id, sample.identifier, sample.id],
    )
    const results = await search(owner, sample.identifier)
    const hit = results.find((r) => r.record_id === experiment.id)
    expect(hit).toBeDefined()
    expect(hit.matched_field).toBe('relationship')
  })
})

describe('SCI-008 search — structured filters', () => {
  it('filters by kind', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const results = await search(owner, '', { p_kind: 'experiment' })
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((r) => r.kind === 'experiment')).toBe(true)
  })

  it('filters by status', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const results = await search(owner, '', { p_status: 'available' })
    expect(results.every((r) => r.status === 'available')).toBe(true)
  })

  it('filters by project', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const results = await search(owner, '', { p_project_id: PROJ_A })
    expect(results.every((r) => r.project_id === PROJ_A)).toBe(true)
  })

  it('filters by owner', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const results = await search(owner, '', { p_owner_id: OWNER_A })
    expect(results.every((r) => r.created_by_user_id === OWNER_A)).toBe(true)
  })

  it('filters by date range', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const future = '2099-01-01T00:00:00Z'
    const results = await search(owner, '', { p_date_from: future })
    // No records created after 2099.
    expect(results).toHaveLength(0)
  })

  it('combines multiple filters', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const results = await search(owner, '', {
      p_kind: 'sample',
      p_status: 'available',
      p_project_id: PROJ_A,
    })
    expect(
      results.every(
        (r) => r.kind === 'sample' && r.status === 'available' && r.project_id === PROJ_A,
      ),
    ).toBe(true)
  })
})

describe('SCI-008 search — pagination', () => {
  it('respects limit and offset and reports total_count', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    // Create enough records to exercise pagination.
    for (let i = 0; i < 5; i++) {
      await createRecord(owner, PROJ_A, 'experiment', `Pagination experiment ${i}`)
    }
    const page1 = await search(owner, 'pagination experiment', { p_limit: 2, p_offset: 0 })
    const page2 = await search(owner, 'pagination experiment', { p_limit: 2, p_offset: 2 })
    expect(page1).toHaveLength(2)
    expect(page2).toHaveLength(2)
    // total_count is the same on every row (bigint → Number).
    const total = Number(page1[0].total_count)
    expect(total).toBeGreaterThanOrEqual(5)
    expect(Number(page2[0].total_count)).toBe(total)
    // No overlap between pages.
    const ids1 = new Set(page1.map((r) => r.record_id))
    expect(page2.every((r) => !ids1.has(r.record_id))).toBe(true)
  })
})

describe('SCI-008 search — empty query browse mode', () => {
  it('returns all non-deleted records ordered by updated_at without a query', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const results = await search(owner, '', { p_limit: 100 })
    expect(results.length).toBeGreaterThan(0)
    // Browse mode: matched_field is 'title' and rank is 0.
    expect(results.every((r) => r.matched_field === 'title')).toBe(true)
    expect(results.every((r) => r.rank === 0)).toBe(true)
  })
})

describe('SCI-008 search — deep links', () => {
  it('links notebook templates to /templates', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const results = await search(owner, '', { p_kind: 'notebook_template' })
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((r) => r.deep_link === '/templates')).toBe(true)
  })

  it('links non-template records through the notebook route', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const results = await search(owner, '', { p_kind: 'experiment', p_limit: 1 })
    expect(results[0].deep_link).toMatch(/\/projects\/.*\/experiments\//)
  })
})
