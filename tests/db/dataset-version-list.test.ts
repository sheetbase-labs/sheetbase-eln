/**
 * DSET-03.1 — the snapshot list read model. Proves that
 * `api.dataset_version_list` reports the real creator, producer (source),
 * content hash and cited-by (signed revisions are implemented in SQL; this
 * suite exercises pipeline-run and analysis citations) and that each row's
 * retention state matches the snapshot (kept vs prunable). Also proves the
 * workspace scoping is unchanged.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-000000000b0a'
const OTHER_WS = '00000000-0000-4000-8000-000000000b0b'
const PROJECT = '00000000-0000-4000-8000-000000000b0c'
const SCHEMA_DEF = '00000000-0000-4000-8000-000000000b0d'
const SCHEMA_VERSION = '00000000-0000-4000-8000-000000000b0e'
const FIELD_VALUE = '00000000-0000-4000-8000-000000000b0f'
const FIELD_OTHER = '00000000-0000-4000-8000-000000000b10'
const DATASET = '00000000-0000-4000-8000-000000000b11'
const V_PLAIN = '00000000-0000-4000-8000-000000000b12'
const V_RUN = '00000000-0000-4000-8000-000000000b13'
const V_CITED = '00000000-0000-4000-8000-000000000b14'
const V_KEPT = '00000000-0000-4000-8000-000000000b15'
const ROW_1 = '00000000-0000-4000-8000-000000000b16'
const ROW_2 = '00000000-0000-4000-8000-000000000b17'
const ROW_3 = '00000000-0000-4000-8000-000000000b18'
const ROW_4 = '00000000-0000-4000-8000-000000000b19'
const DEF = '00000000-0000-4000-8000-000000000b1a'
const DEFV = '00000000-0000-4000-8000-000000000b1b'
const RUN_OUT = '00000000-0000-4000-8000-000000000b1c'
const RUN_IN = '00000000-0000-4000-8000-000000000b1d'
const RECORD = '00000000-0000-4000-8000-000000000b1e'
const BLOCK = '00000000-0000-4000-8000-000000000b1f'
const ANALYSIS_DEF = '00000000-0000-4000-8000-000000000b20'
const V_IMPORT = '00000000-0000-4000-8000-000000000b21'
const IMPORT_FILE = '00000000-0000-4000-8000-000000000b22'
const IMPORT = '00000000-0000-4000-8000-000000000b23'
const USER = 'list-user'
const OTHER_USER = 'list-other-user'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

interface VersionRow {
  id: string
  createdByUserId: string | null
  createdByCredentialId: string | null
  createdByName: string | null
  contentHash: string
  rowsRemovedAt: string | null
  retention: {
    reason: string
    keptUntil: string | null
    policy?: { citedYears: number; uncitedYears: number }
  }
  source: {
    kind: string
    runId: string | null
    definitionName: string | null
    status: string | null
    label?: string | null
  } | null
  citedBy: {
    signedRevisions: unknown[]
    pipelineRuns: Array<{ runId: string }>
    analyses: Array<{ blockId: string }>
  }
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${USER}', 'List User', 'list-user@sheetbase.test', true),
      ('${OTHER_USER}', 'Other User', 'list-other@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS}', 'list-ws', 'List WS'),
      ('${OTHER_WS}', 'list-other-ws', 'List other WS')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS}', '${USER}', 'member'),
      ('${OTHER_WS}', '${OTHER_USER}', 'member')`,
  )
  await migrator.query(
    `INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES ('${PROJECT}', '${WS}', 'list', 'List project', '${USER}')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_schema_definitions (id, workspace_id, key, name, lifecycle)
     VALUES ('${SCHEMA_DEF}', '${WS}', 'list_schema', 'List schema', 'active')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_schema_versions (id, schema_id, version, lifecycle)
     VALUES ('${SCHEMA_VERSION}', '${SCHEMA_DEF}', 1, 'draft')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_schema_version_fields
       (id, schema_version_id, field_id, key, label, logical_type, nullable, display_order) VALUES
      (gen_random_uuid(), '${SCHEMA_VERSION}', '${FIELD_VALUE}', 'value', 'Value', 'decimal', true, 1),
      (gen_random_uuid(), '${SCHEMA_VERSION}', '${FIELD_OTHER}', 'other', 'Other', 'text', true, 2)`,
  )
  await migrator.query(
    `UPDATE api.dataset_schema_versions SET lifecycle = 'active', published_at = now() WHERE id = '${SCHEMA_VERSION}'`,
  )
  await migrator.query(
    `INSERT INTO api.datasets (id, workspace_id, schema_version_id, name, primary_project_id)
     VALUES ('${DATASET}', '${WS}', '${SCHEMA_VERSION}', 'List dataset', '${PROJECT}')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_versions
       (id, dataset_id, workspace_id, schema_version_id, source_dataset_revision, label, created_by_user_id) VALUES
      ('${V_PLAIN}', '${DATASET}', '${WS}', '${SCHEMA_VERSION}', 1, 'Plain', '${USER}'),
      ('${V_RUN}', '${DATASET}', '${WS}', '${SCHEMA_VERSION}', 2, 'From run', '${USER}'),
      ('${V_CITED}', '${DATASET}', '${WS}', '${SCHEMA_VERSION}', 3, 'Cited', '${USER}'),
      ('${V_KEPT}', '${DATASET}', '${WS}', '${SCHEMA_VERSION}', 4, 'Kept', '${USER}'),
      ('${V_IMPORT}', '${DATASET}', '${WS}', '${SCHEMA_VERSION}', 5, 'Import qa3-append.csv', '${USER}')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_version_rows (dataset_version_id, row_id, revision) VALUES
      ('${V_PLAIN}', '${ROW_1}', 1),
      ('${V_RUN}', '${ROW_2}', 1),
      ('${V_CITED}', '${ROW_3}', 1),
      ('${V_KEPT}', '${ROW_4}', 1)`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_version_values
       (dataset_version_id, row_id, field_id, ordinal, numeric_value, text_value) VALUES
      ('${V_PLAIN}', '${ROW_1}', '${FIELD_VALUE}', 0, 1.0, NULL),
      ('${V_RUN}', '${ROW_2}', '${FIELD_VALUE}', 0, 2.0, NULL),
      ('${V_CITED}', '${ROW_3}', '${FIELD_VALUE}', 0, 3.0, NULL),
      ('${V_KEPT}', '${ROW_4}', '${FIELD_VALUE}', 0, 4.0, NULL)`,
  )

  // Pipeline chain: RUN_OUT produced V_RUN; RUN_IN consumed V_CITED.
  await migrator.query(
    `INSERT INTO api.pipeline_definitions (id, workspace_id, key, name, created_by_user_id)
     VALUES ('${DEF}', '${WS}', 'list_pipeline', 'List pipeline', '${USER}')`,
  )
  await migrator.query(
    `INSERT INTO api.pipeline_definition_versions (id, definition_id, workspace_id, version, configuration)
     VALUES ('${DEFV}', '${DEF}', '${WS}', 1, '{}'::jsonb)`,
  )
  await migrator.query(
    `INSERT INTO api.pipeline_runs
       (id, workspace_id, definition_version_id, status, input_versions, actor_user_id) VALUES
      ('${RUN_OUT}', '${WS}', '${DEFV}', 'succeeded', '{}'::jsonb, '${USER}'),
      ('${RUN_IN}', '${WS}', '${DEFV}', 'succeeded', jsonb_build_object('input', '${V_CITED}'), '${USER}')`,
  )
  await migrator.query(
    `INSERT INTO api.pipeline_run_outputs
       (workspace_id, run_id, dataset_id, dataset_version_id, label)
     VALUES ('${WS}', '${RUN_OUT}', '${DATASET}', '${V_RUN}', 'Output A')`,
  )

  // The import receipt behind V_IMPORT: the wizard's commit snapshots the
  // dataset and records the receipt, which is what names the snapshot's source.
  await migrator.query(
    `INSERT INTO api.dataset_import_files
       (id, workspace_id, dataset_id, filename, byte_size, checksum, storage_key, format, status, created_by_user_id)
     VALUES ('${IMPORT_FILE}', '${WS}', '${DATASET}', 'qa3-append.csv', 128,
             repeat('a', 64), 'imports/qa3-append.csv', 'csv', 'parsed', '${USER}')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_imports
       (id, workspace_id, dataset_id, file_id, snapshot_version_id, status, idempotency_key, created_by_user_id)
     VALUES ('${IMPORT}', '${WS}', '${DATASET}', '${IMPORT_FILE}', '${V_IMPORT}',
             'committed', 'list-import-key', '${USER}')`,
  )

  // Analysis block citing V_CITED via its frozen provenance.
  await migrator.query(
    `INSERT INTO api.records (id, workspace_id, project_id, kind, identifier, title, created_by_user_id)
     VALUES ('${RECORD}', '${WS}', '${PROJECT}', 'experiment', 'EXP-L1', 'Cited record', '${USER}')`,
  )
  await migrator.query(
    `INSERT INTO api.analysis_definitions (id, workspace_id, owner_user_id, name, definition)
     VALUES ('${ANALYSIS_DEF}', '${WS}', '${USER}', 'List analysis', '{}'::jsonb)`,
  )
  await migrator.query(
    `INSERT INTO api.blocks (id, record_id, type, payload, payload_schema_version, "order", created_by_user_id)
     VALUES ('${BLOCK}', '${RECORD}', 'analysis', jsonb_build_object(
       'title', 'List analysis',
       'definitionId', '${ANALYSIS_DEF}',
       'frozen', jsonb_build_object(
         'frozenAt', now(),
         'datasetProvenance', jsonb_build_array(jsonb_build_object(
           'datasetId', '${DATASET}',
           'datasetVersionId', '${V_CITED}',
           'rowCount', 1,
           'checksum', 'md5'
         ))
       )
     ), 1, 1, '${USER}')`,
  )

  // A manual keep on V_KEPT, then archive the dataset with an expired
  // uncited window so V_PLAIN is prunable while V_KEPT is not.
  await migrator.query('RESET ROLE')
  const keeper = await asAuthenticated()
  await keeper.query(
    `SELECT api.keep_dataset_version($1, 'Retain for the study')`,
    [V_KEPT],
  )
  await migrator.query(
    `UPDATE api.datasets SET archived_at = '2023-01-01T00:00:00Z', lifecycle = 'archived' WHERE id = $1`,
    [DATASET],
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

async function asAuthenticated(
  userId = USER,
  workspaceId = WS,
): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({
      sub: userId,
      workspace_id: workspaceId,
      role: 'authenticated',
    }),
  ])
  return client
}

async function listVersions(client: Client): Promise<VersionRow[]> {
  const { rows } = await client.query<{ result: VersionRow[] }>(
    `SELECT api.dataset_version_list($1) AS result`,
    [DATASET],
  )
  return rows[0]!.result
}

function byId(list: VersionRow[], id: string): VersionRow {
  const found = list.find((version) => version.id === id)
  if (!found) throw new Error(`snapshot ${id} not in list`)
  return found
}

describe('api.dataset_version_list read model', () => {
  it('reports the creator and a truthful producer', async () => {
    const client = await asAuthenticated()
    const list = await listVersions(client)

    const plain = byId(list, V_PLAIN)
    expect(plain.createdByUserId).toBe(USER)
    expect(plain.createdByCredentialId).toBeNull()
    expect(plain.createdByName).toBe('List User')
    expect(plain.source?.kind).toBe('manual')

    const fromRun = byId(list, V_RUN)
    expect(fromRun.source?.kind).toBe('pipeline_run')
    expect(fromRun.source?.runId).toBe(RUN_OUT)
    expect(fromRun.source?.definitionName).toBe('List pipeline')
    expect(fromRun.source?.status).toBe('succeeded')
  })

  it('names the import that froze a snapshot, not the person who ran it', async () => {
    const client = await asAuthenticated()
    const imported = byId(await listVersions(client), V_IMPORT)

    // The person is still reported as the maker; the source is the import.
    expect(imported.createdByName).toBe('List User')
    expect(imported.source).toEqual({
      kind: 'import',
      runId: null,
      definitionName: null,
      triggerKind: null,
      status: null,
      label: 'qa3-append.csv',
      startedAt: null,
    })
  })

  it('computes a deterministic content hash that distinguishes content', async () => {
    const client = await asAuthenticated()
    const first = await listVersions(client)
    const plain = byId(first, V_PLAIN)
    const fromRun = byId(first, V_RUN)
    expect(plain.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(fromRun.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    // Different frozen rows/values must not collide.
    expect(plain.contentHash).not.toBe(fromRun.contentHash)

    const second = await listVersions(client)
    expect(byId(second, V_PLAIN).contentHash).toBe(plain.contentHash)
  })

  it('reports pipeline runs and analyses that cite the snapshot', async () => {
    const client = await asAuthenticated()
    const list = await listVersions(client)

    const cited = byId(list, V_CITED)
    expect(cited.citedBy.pipelineRuns.map((run) => run.runId)).toContain(RUN_IN)
    expect(cited.citedBy.analyses.map((item) => item.blockId)).toContain(BLOCK)
    // The run that produced V_RUN is not a citation of V_RUN unless it also
    // consumed it; only RUN_IN cites V_CITED.
    expect(byId(list, V_PLAIN).citedBy.pipelineRuns).toEqual([])
    expect(byId(list, V_PLAIN).citedBy.analyses).toEqual([])
  })

  it('reports retention that matches the row: kept vs prunable', async () => {
    const client = await asAuthenticated()
    const list = await listVersions(client)

    const kept = byId(list, V_KEPT)
    expect(kept.retention.reason).toBe('kept')
    expect(kept.retention.keptUntil).not.toBeNull()

    const prunable = byId(list, V_PLAIN)
    expect(prunable.retention.reason).toBe('uncited_after_archive')
    expect(prunable.retention.keptUntil).toBe('2025-01-01T00:00:00+00:00')
    expect(prunable.retention.policy).toEqual({
      citedYears: 15,
      uncitedYears: 2,
    })
    expect(prunable.rowsRemovedAt).toBeNull()
  })

  it('does not leak another workspace’s Dataset', async () => {
    const other = await asAuthenticated(OTHER_USER, OTHER_WS)
    await expect(
      other.query(`SELECT api.dataset_version_list($1)`, [DATASET]),
    ).rejects.toMatchObject({ code: '42501' })
  })
})
