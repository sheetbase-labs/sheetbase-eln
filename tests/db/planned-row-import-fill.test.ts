/**
 * DSET-01.3 (remaining) — planned rows filled by import.
 *
 * A planned row carries a `planned_key` (sample/well). A later Dataset import
 * whose create row carries the same key, scoped to the same Dataset, fills the
 * active planned row: it becomes `recorded`, receives the values and no
 * duplicate row is created. A key that matches nothing still creates, and a
 * key aimed at a non-planned row, another Dataset or another workspace is never
 * hijacked. The planned-row value guard stays in force until the transition.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { DataClient } from '#/lib/data-client'
import { validateAndCommitImport } from '#/lib/import-commit'
import type { MappedImport } from '#/lib/import-mapping'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS_A = '00000000-0000-4000-8000-00000000f0a0'
const WS_B = '00000000-0000-4000-8000-00000000f0a1'
const PROJECT_A = '00000000-0000-4000-8000-00000000f0a2'
const PROJECT_B = '00000000-0000-4000-8000-00000000f0a3'
const SCHEMA_DEF_A = '00000000-0000-4000-8000-00000000f0a4'
const SCHEMA_VERSION_A = '00000000-0000-4000-8000-00000000f0a5'
const FIELD = '00000000-0000-4000-8000-00000000f0a6'
const SCHEMA_DEF_B = '00000000-0000-4000-8000-00000000f0b4'
const SCHEMA_VERSION_B = '00000000-0000-4000-8000-00000000f0b5'
const MEMBER = 'fill-member'
const VIEWER = 'fill-viewer'
const OUTSIDER_B = 'fill-outsider-b'

const SCHEDULED = '2026-10-07T09:00:00+01:00'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${MEMBER}', 'Fill Member', 'fill-member@sheetbase.test', true),
      ('${VIEWER}', 'Fill Viewer', 'fill-viewer@sheetbase.test', true),
      ('${OUTSIDER_B}', 'Fill Outsider', 'fill-outsider@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS_A}', 'fill-a', 'Fill A'),
      ('${WS_B}', 'fill-b', 'Fill B')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS_A}', '${MEMBER}', 'member'),
      ('${WS_A}', '${VIEWER}', 'viewer'),
      ('${WS_B}', '${OUTSIDER_B}', 'member')`,
  )
  await migrator.query(
    `INSERT INTO api.projects (id, workspace_id, key, title) VALUES
      ('${PROJECT_A}', '${WS_A}', 'fil', 'Fill A'),
      ('${PROJECT_B}', '${WS_B}', 'filb', 'Fill B')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_schema_definitions (id, workspace_id, key, name, lifecycle) VALUES ('${SCHEMA_DEF_A}', '${WS_A}', 'fill_schema', 'Fill schema', 'draft')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_schema_versions (id, schema_id, version, lifecycle) VALUES ('${SCHEMA_VERSION_A}', '${SCHEMA_DEF_A}', 1, 'draft')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_schema_version_fields (id, schema_version_id, field_id, key, label, logical_type, nullable, display_order) VALUES
      (gen_random_uuid(), '${SCHEMA_VERSION_A}', '${FIELD}', 'titre', 'Titre', 'decimal', true, 1)`,
  )
  await migrator.query(
    `UPDATE api.dataset_schema_versions SET lifecycle = 'active', published_at = now() WHERE id = '${SCHEMA_VERSION_A}'`,
  )
  // Minimal schema in WS_B so a same-key planned row exists in another workspace.
  await migrator.query(
    `INSERT INTO api.dataset_schema_definitions (id, workspace_id, key, name, lifecycle) VALUES ('${SCHEMA_DEF_B}', '${WS_B}', 'fill_schema_b', 'Fill schema B', 'draft')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_schema_versions (id, schema_id, version, lifecycle) VALUES ('${SCHEMA_VERSION_B}', '${SCHEMA_DEF_B}', 1, 'draft')`,
  )
  await migrator.query(
    `UPDATE api.dataset_schema_versions SET lifecycle = 'active', published_at = now() WHERE id = '${SCHEMA_VERSION_B}'`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

async function asUser(userId: string, workspaceId: string): Promise<Client> {
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

async function createDataset(
  id: string,
  workspaceId: string,
  schemaVersionId: string,
  projectId: string | null,
): Promise<void> {
  await migrator.query(
    `INSERT INTO api.datasets (id, workspace_id, schema_version_id, name, primary_project_id)
     VALUES ($1, $2, $3, 'Fill dataset', $4)`,
    [id, workspaceId, schemaVersionId, projectId],
  )
}

async function planRow(
  client: Client,
  datasetId: string,
  scheduled: string | null,
  plannedKey: string | null,
): Promise<{ id: string; status: string; scheduled_at: string | null }> {
  const { rows } = await client.query<{
    id: string
    status: string
    scheduled_at: string | null
  }>(`SELECT * FROM api.plan_dataset_row($1, $2::timestamptz, $3)`, [
    datasetId,
    scheduled,
    plannedKey,
  ])
  return rows[0]!
}

async function datasetRevision(client: Client, datasetId: string): Promise<number> {
  const { rows } = await client.query<{ revision: string }>(
    `SELECT revision FROM api.datasets WHERE id = $1`,
    [datasetId],
  )
  return Number(rows[0]!.revision)
}

interface CommitResult {
  ok: boolean
  rows?: Array<{ rowId: string; revision: number; operation: string }>
  errors?: Array<{ code: string }>
}

async function commit(
  client: Client,
  datasetId: string,
  revision: number,
  rows: Array<Record<string, unknown>>,
  idempotencyKey: string,
): Promise<CommitResult> {
  const { rows: out } = await client.query<{ result: CommitResult }>(
    `SELECT api.commit_dataset_row_batch($1, $2, $3::jsonb, $4) AS result`,
    [datasetId, revision, JSON.stringify(rows), idempotencyKey],
  )
  return out[0]!.result
}

function pgDataClient(owner: Client): DataClient {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === 'validate_dataset_row_batch') {
        const result = await owner.query(
          `select api.validate_dataset_row_batch($1,$2,$3::jsonb) result`,
          [
            args.p_dataset_id,
            args.p_expected_dataset_revision,
            JSON.stringify(args.p_rows),
          ],
        )
        return result.rows[0].result
      }
      if (name === 'commit_dataset_row_batch') {
        const result = await owner.query(
          `select api.commit_dataset_row_batch($1,$2,$3::jsonb,$4) result`,
          [
            args.p_dataset_id,
            args.p_expected_dataset_revision,
            JSON.stringify(args.p_rows),
            args.p_idempotency_key,
          ],
        )
        return result.rows[0].result
      }
      throw new Error(`unexpected RPC ${name}`)
    },
  } as unknown as DataClient
}

describe('planned rows filled by import', () => {
  it('fills a matching active planned row and creates no duplicate', async () => {
    const member = await asUser(MEMBER, WS_A)
    const datasetId = crypto.randomUUID()
    await createDataset(datasetId, WS_A, SCHEMA_VERSION_A, PROJECT_A)

    const planned = await planRow(member, datasetId, SCHEDULED, 'PLATE1:A1')
    expect(planned.status).toBe('planned')

    const revision = await datasetRevision(member, datasetId)
    const newRowId = crypto.randomUUID()
    const result = await commit(
      member,
      datasetId,
      revision,
      [
        {
          operation: 'create',
          rowId: newRowId,
          values: { [FIELD]: 12.5 },
          plannedKey: 'PLATE1:A1',
        },
      ],
      'fill-match-1',
    )

    expect(result.ok).toBe(true)
    expect(result.rows?.[0]).toMatchObject({
      rowId: planned.id,
      operation: 'fill',
    })

    const { rows: filled } = await member.query<{
      status: string
      scheduled_at: string | null
      revision: string
      planned_key: string | null
    }>(
      `SELECT status, scheduled_at, revision, planned_key FROM api.dataset_rows WHERE id = $1`,
      [planned.id],
    )
    expect(filled[0]!.status).toBe('recorded')
    // Scheduled time is preserved as provenance of the requested repeat.
    expect(filled[0]!.scheduled_at).not.toBeNull()
    expect(Number(filled[0]!.revision)).toBe(2)
    expect(filled[0]!.planned_key).toBe('PLATE1:A1')

    const { rows: values } = await member.query<{ numeric_value: string }>(
      `SELECT numeric_value FROM api.dataset_row_values WHERE row_id = $1 AND field_id = $2`,
      [planned.id, FIELD],
    )
    expect(Number(values[0]!.numeric_value)).toBe(12.5)

    // The caller's provisional row id was never inserted; only the planned row exists.
    const { rows: extra } = await member.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM api.dataset_rows WHERE id = $1`,
      [newRowId],
    )
    expect(extra[0]!.n).toBe(0)
    const { rows: count } = await member.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM api.dataset_rows WHERE dataset_id = $1`,
      [datasetId],
    )
    expect(count[0]!.n).toBe(1)
  })

  it('creates a new row when the key matches no planned row', async () => {
    const member = await asUser(MEMBER, WS_A)
    const datasetId = crypto.randomUUID()
    await createDataset(datasetId, WS_A, SCHEMA_VERSION_A, PROJECT_A)

    const planned = await planRow(member, datasetId, SCHEDULED, 'KEEP-1')
    const revision = await datasetRevision(member, datasetId)
    const newRowId = crypto.randomUUID()
    const result = await commit(
      member,
      datasetId,
      revision,
      [
        {
          operation: 'create',
          rowId: newRowId,
          values: { [FIELD]: 1 },
          plannedKey: 'SOMETHING-ELSE',
        },
      ],
      'fill-nomatch-1',
    )

    expect(result.ok).toBe(true)
    expect(result.rows?.[0]).toMatchObject({
      rowId: newRowId,
      operation: 'create',
    })
    const { rows: plannedAfter } = await member.query<{ status: string }>(
      `SELECT status FROM api.dataset_rows WHERE id = $1`,
      [planned.id],
    )
    expect(plannedAfter[0]!.status).toBe('planned')
    const { rows: count } = await member.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM api.dataset_rows WHERE dataset_id = $1`,
      [datasetId],
    )
    expect(count[0]!.n).toBe(2)
  })

  it('does not hijack a non-planned row that holds the same key', async () => {
    const member = await asUser(MEMBER, WS_A)
    const datasetId = crypto.randomUUID()
    await createDataset(datasetId, WS_A, SCHEMA_VERSION_A, PROJECT_A)
    const recordedId = crypto.randomUUID()
    await migrator.query(
      `INSERT INTO api.dataset_rows (id, dataset_id, workspace_id, status, planned_key)
       VALUES ($1, $2, $3, 'recorded', 'REC-1')`,
      [recordedId, datasetId, WS_A],
    )

    const revision = await datasetRevision(member, datasetId)
    const newRowId = crypto.randomUUID()
    const result = await commit(
      member,
      datasetId,
      revision,
      [
        {
          operation: 'create',
          rowId: newRowId,
          values: { [FIELD]: 2 },
          plannedKey: 'REC-1',
        },
      ],
      'fill-recorded-1',
    )

    expect(result.ok).toBe(true)
    expect(result.rows?.[0]).toMatchObject({
      rowId: newRowId,
      operation: 'create',
    })
    const { rows: recorded } = await member.query<{ revision: string }>(
      `SELECT revision FROM api.dataset_rows WHERE id = $1`,
      [recordedId],
    )
    expect(Number(recorded[0]!.revision)).toBe(1)
    const { rows: count } = await member.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM api.dataset_rows WHERE dataset_id = $1`,
      [datasetId],
    )
    expect(count[0]!.n).toBe(2)
  })

  it('does not match a key for another Dataset or workspace', async () => {
    const member = await asUser(MEMBER, WS_A)
    const targetId = crypto.randomUUID()
    const otherSameWorkspaceId = crypto.randomUUID()
    const otherWorkspaceId = crypto.randomUUID()
    await createDataset(targetId, WS_A, SCHEMA_VERSION_A, PROJECT_A)
    await createDataset(otherSameWorkspaceId, WS_A, SCHEMA_VERSION_A, PROJECT_A)
    await createDataset(otherWorkspaceId, WS_B, SCHEMA_VERSION_B, PROJECT_B)

    const otherSameWorkspace = await planRow(
      member,
      otherSameWorkspaceId,
      SCHEDULED,
      'SHARED-1',
    )
    // Cross-workspace planned row with the identical key, written as migrator.
    const { rows: foreign } = await migrator.query<{ id: string }>(
      `INSERT INTO api.dataset_rows (dataset_id, workspace_id, status, scheduled_at, planned_key)
       VALUES ($1, $2, 'planned', now(), 'SHARED-1') RETURNING id`,
      [otherWorkspaceId, WS_B],
    )

    const revision = await datasetRevision(member, targetId)
    const newRowId = crypto.randomUUID()
    const result = await commit(
      member,
      targetId,
      revision,
      [
        {
          operation: 'create',
          rowId: newRowId,
          values: { [FIELD]: 3 },
          plannedKey: 'SHARED-1',
        },
      ],
      'fill-cross-1',
    )

    expect(result.ok).toBe(true)
    expect(result.rows?.[0]).toMatchObject({
      rowId: newRowId,
      operation: 'create',
    })
    const { rows: sameWorkspace } = await member.query<{ status: string }>(
      `SELECT status FROM api.dataset_rows WHERE id = $1`,
      [otherSameWorkspace.id],
    )
    expect(sameWorkspace[0]!.status).toBe('planned')
    const { rows: foreignAfter } = await migrator.query<{ status: string }>(
      `SELECT status FROM api.dataset_rows WHERE id = $1`,
      [foreign[0]!.id],
    )
    expect(foreignAfter[0]!.status).toBe('planned')
  })

  it('keeps the planned-to-recorded value guard in force before the transition', async () => {
    const member = await asUser(MEMBER, WS_A)
    const datasetId = crypto.randomUUID()
    await createDataset(datasetId, WS_A, SCHEMA_VERSION_A, PROJECT_A)
    const planned = await planRow(member, datasetId, SCHEDULED, 'GUARD-1')

    await expect(
      migrator.query(
        `INSERT INTO api.dataset_row_values (row_id, field_id, ordinal, numeric_value)
         VALUES ($1, $2, 0, 1.0)`,
        [planned.id, FIELD],
      ),
    ).rejects.toMatchObject({ code: 'SB072' })
  })

  it('denies a viewer or non-member commit', async () => {
    const member = await asUser(MEMBER, WS_A)
    const datasetId = crypto.randomUUID()
    await createDataset(datasetId, WS_A, SCHEMA_VERSION_A, PROJECT_A)
    const revision = await datasetRevision(member, datasetId)

    const viewer = await asUser(VIEWER, WS_A)
    await expectDenied(
      commit(
        viewer,
        datasetId,
        revision,
        [
          {
            operation: 'create',
            rowId: crypto.randomUUID(),
            values: { [FIELD]: 4 },
            plannedKey: 'DENY-1',
          },
        ],
        'fill-viewer-1',
      ),
      '42501',
    )

    // Outsider claims WS_A but has no membership there.
    const nonMember = await asUser(OUTSIDER_B, WS_A)
    await expectDenied(
      commit(
        nonMember,
        datasetId,
        revision,
        [
          {
            operation: 'create',
            rowId: crypto.randomUUID(),
            values: { [FIELD]: 4 },
            plannedKey: 'DENY-1',
          },
        ],
        'fill-nonmember-1',
      ),
      '42501',
    )
  })

  it('fills a planned row through the canonical validateAndCommitImport path', async () => {
    const member = await asUser(MEMBER, WS_A)
    const datasetId = crypto.randomUUID()
    await createDataset(datasetId, WS_A, SCHEMA_VERSION_A, PROJECT_A)
    const planned = await planRow(member, datasetId, SCHEDULED, 'TS-1')
    const revision = await datasetRevision(member, datasetId)

    const mapped: MappedImport = {
      schemaVersionId: SCHEMA_VERSION_A,
      errors: [],
      rows: [
        {
          rowId: crypto.randomUUID(),
          values: { [FIELD]: 3.5 },
          plannedKey: 'TS-1',
        },
      ],
    }
    const result = await validateAndCommitImport(
      pgDataClient(member),
      {
        kind: 'dataset',
        datasetId,
        expectedRevision: revision,
        schemaVersionId: SCHEMA_VERSION_A,
      },
      mapped,
      'fill-ts-1',
    )
    expect(result.ok).toBe(true)
    expect(result.committed).toBe(1)

    const { rows: filled } = await member.query<{
      status: string
    }>(`SELECT status FROM api.dataset_rows WHERE id = $1`, [planned.id])
    expect(filled[0]!.status).toBe('recorded')
    const { rows: count } = await member.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM api.dataset_rows WHERE dataset_id = $1`,
      [datasetId],
    )
    expect(count[0]!.n).toBe(1)
  })
})
