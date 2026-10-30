/**
 * Lists that tell the truth: search lists a dataset once however many of its
 * cells match, the experiment tab counts follow the list's own filters, the
 * next dataset ID reads the highest one issued, and the storage-location
 * picker lists every place once.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-0000000046a0'
const PROJECT = '00000000-0000-4000-8000-0000000046a1'
const ARCHIVED_PROJECT = '00000000-0000-4000-8000-0000000046a2'
const SCHEMA = '00000000-0000-4000-8000-0000000046b1'
const SCHEMA_VERSION = '00000000-0000-4000-8000-0000000046b2'
const FIELD = '00000000-0000-4000-8000-0000000046b3'
const DATASET = '00000000-0000-4000-8000-0000000046b4'
const DATASET_VERSION = '00000000-0000-4000-8000-0000000046b5'
const OWNER = 'tl-owner'
const COLLEAGUE = 'tl-colleague'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: userId, workspace_id: WS, role: 'authenticated' }),
  ])
  return client
}

async function experiment(
  index: number,
  status: string,
  createdBy: string,
  projectId: string | null,
  updatedDaysAgo: number,
  title = `Run ${index}`,
) {
  await migrator.query(
    `INSERT INTO api.records
       (workspace_id, project_id, kind, identifier, title, status, created_by_user_id, updated_at)
     VALUES ($1, $2, 'experiment', $3, $4, $5, $6, now() - make_interval(days => $7))`,
    [WS, projectId, `EXP-46${index}`, title, status, createdBy, updatedDaysAgo],
  )
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(`
    INSERT INTO internal."user" (id, name, email, "emailVerified") VALUES
      ('${OWNER}', 'Owner', 'tl-o@sheetbase.test', true),
      ('${COLLEAGUE}', 'Colleague', 'tl-c@sheetbase.test', true);
    INSERT INTO api.workspaces (id, slug, name) VALUES ('${WS}', 'tl', 'TL');
    INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS}', '${OWNER}', 'owner'), ('${WS}', '${COLLEAGUE}', 'member');
    INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES
      ('${PROJECT}', '${WS}', 'tl-live', 'Live project', '${OWNER}'),
      ('${ARCHIVED_PROJECT}', '${WS}', 'tl-old', 'Retired project', '${OWNER}');
  `)
  await experiment(1, 'approved', OWNER, PROJECT, 2, 'Plate reader C-150')
  await experiment(2, 'approved', COLLEAGUE, PROJECT, 90)
  await experiment(3, 'in_progress', OWNER, ARCHIVED_PROJECT, 5)
  await experiment(4, 'approved', OWNER, null, 400)
  // A project is archived after its work, as in the demo; its experiments stay.
  await migrator.query(
    `UPDATE api.projects SET archived_at = now() WHERE id = $1`,
    [ARCHIVED_PROJECT],
  )

  await migrator.query(`
    INSERT INTO api.dataset_schema_definitions (id, workspace_id, key, name)
      VALUES ('${SCHEMA}', '${WS}', 'tlschema', 'TL schema');
    INSERT INTO api.dataset_schema_versions (id, schema_id, version)
      VALUES ('${SCHEMA_VERSION}', '${SCHEMA}', 1);
    INSERT INTO api.dataset_schema_version_fields
      (schema_version_id, field_id, key, label, logical_type, nullable, display_order)
      VALUES ('${SCHEMA_VERSION}', '${FIELD}', 'reading', 'Reading', 'text', true, 1);
    UPDATE api.dataset_schema_versions SET lifecycle = 'active', published_at = now()
      WHERE id = '${SCHEMA_VERSION}';
    INSERT INTO api.datasets (id, workspace_id, schema_version_id, name)
      VALUES ('${DATASET}', '${WS}', '${SCHEMA_VERSION}', 'Filtrate table');
    INSERT INTO api.dataset_versions
      (id, dataset_id, workspace_id, schema_version_id, source_dataset_revision, label)
      VALUES ('${DATASET_VERSION}', '${DATASET}', '${WS}', '${SCHEMA_VERSION}', 1, 'v1');
  `)
  for (let row = 1; row <= 5; row++) {
    const rowId = `00000000-0000-4000-8000-0000000046c${row}`
    await migrator.query(
      `INSERT INTO api.dataset_version_rows (dataset_version_id, row_id, revision)
         VALUES ($1, $2, 1)`,
      [DATASET_VERSION, rowId],
    )
    await migrator.query(
      `INSERT INTO api.dataset_version_values
         (dataset_version_id, row_id, field_id, ordinal, text_value)
         VALUES ($1, $2, $3, 0, $4)`,
      [DATASET_VERSION, rowId, FIELD, `C-150 filtrate batch ${row}`],
    )
  }
  await migrator.query(
    `INSERT INTO api.records (workspace_id, kind, identifier, title, status, created_by_user_id, properties) VALUES
       ($1, 'sample', 'SMP-4601', 'a', 'available', $2, '{"storageLocation":"Freezer 2"}'),
       ($1, 'sample', 'SMP-4602', 'b', 'available', $2, '{"storageLocation":"freezer 2 "}'),
       ($1, 'sample', 'SMP-4603', 'c', 'available', $2, '{"storageLocation":"Bench"}'),
       ($1, 'sample', 'SMP-4604', 'd', 'available', $2, '{"storageLocation":"  "}'),
       ($1, 'sample', 'SMP-4605', 'e', 'available', $2, '{}')`,
    [WS, OWNER],
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('api.search', () => {
  it('lists a dataset once however many of its cells match', async () => {
    const client = await actor(OWNER)
    const { rows } = await client.query<{
      result_type: string
      record_id: string
      total_count: string
    }>(
      `SELECT * FROM api.search(p_query := 'C-150', p_result_type := 'dataset_row')`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.record_id).toBe(DATASET)
    expect(Number(rows[0]!.total_count)).toBe(1)
  })
})

describe('api.experiment_tab_counts', () => {
  const counts = async (
    userId: string,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, number>> => {
    const client = await actor(userId)
    const { rows } = await client.query<{
      status: string
      archived: boolean
      total: number
    }>(
      `SELECT * FROM api.experiment_tab_counts(
         p_user_id := $1,
         p_project_id := $2,
         p_since := $3,
         p_query := $4,
         p_match_project_ids := $5,
         p_match_owner_ids := $6)`,
      [
        userId,
        args.project ?? null,
        args.since ?? null,
        args.query ?? null,
        args.matchProjects ?? null,
        args.matchOwners ?? null,
      ],
    )
    return Object.fromEntries(rows.map((r) => [r.status, r.total]))
  }

  it('counts every experiment when nothing narrows it', async () => {
    expect(await counts(OWNER)).toEqual({ approved: 3, in_progress: 1 })
  })

  it('follows the date window the list shows', async () => {
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
    expect(await counts(OWNER, { since })).toEqual({
      approved: 1,
      in_progress: 1,
    })
  })

  it('follows the project filter, archived projects included', async () => {
    expect(await counts(OWNER, { project: ARCHIVED_PROJECT })).toEqual({
      in_progress: 1,
    })
    expect(await counts(OWNER, { project: PROJECT })).toEqual({ approved: 2 })
  })

  it('matches the search text against ID, title, project and owner', async () => {
    expect(await counts(OWNER, { query: 'c-150' })).toEqual({ approved: 1 })
    expect(await counts(OWNER, { query: 'EXP-464' })).toEqual({ approved: 1 })
    expect(
      await counts(OWNER, {
        query: 'retired',
        matchProjects: [ARCHIVED_PROJECT],
      }),
    ).toEqual({ in_progress: 1 })
    expect(
      await counts(OWNER, { query: 'colleague', matchOwners: [COLLEAGUE] }),
    ).toEqual({ approved: 1 })
    expect(await counts(OWNER, { query: '50%' })).toEqual({})
  })
})

describe('api.record_id_counters', () => {
  it('reads the next dataset ID from the highest one issued', async () => {
    const client = await actor(OWNER)
    const { rows } = await client.query<{ kind: string; next_number: string }>(
      `SELECT * FROM api.record_id_counters($1)`,
      [WS],
    )
    expect(rows.find((r) => r.kind === 'dataset')?.next_number).toBe('2')
  })
})

describe('api.sample_storage_locations', () => {
  it('lists each place once, ignoring blanks and spacing', async () => {
    const client = await actor(OWNER)
    const { rows } = await client.query<{ location: string }>(
      `SELECT * FROM api.sample_storage_locations()`,
    )
    expect(rows.map((r) => r.location.toLowerCase()).sort()).toEqual([
      'bench',
      'freezer 2',
      'freezer 2',
    ])
  })
})
