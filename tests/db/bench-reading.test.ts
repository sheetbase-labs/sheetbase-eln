/**
 * MOB-02 — bench reading fills a canonical planned Dataset row.
 *
 * The phone form writes through `api.commit_dataset_row_batch` with a
 * `plannedKey`; this suite proves the contract that path depends on: the
 * matching planned row is filled (not duplicated), the measurement and the
 * dilution factor land as canonical Dataset values, an out-of-range value is
 * accepted and flagged by the DSET-01 system rule, a value that fails hard
 * validation writes nothing, and another workspace can neither commit nor be
 * hijacked. No behaviour is asserted here that the app adds client-side.
 */
import { randomUUID } from 'node:crypto'

import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS_A = '00000000-0000-4000-8000-000000000e0a'
const WS_B = '00000000-0000-4000-8000-000000000e0b'
const PROJECT_A = '00000000-0000-4000-8000-000000000e0c'
const DATASET_A = '00000000-0000-4000-8000-000000000e0d'
const DATASET_B = '00000000-0000-4000-8000-000000000e0e'
const SCHEMA_DEF_A = '00000000-0000-4000-8000-000000000e0f'
const SCHEMA_VERSION_A = '00000000-0000-4000-8000-000000000e10'
const SCHEMA_DEF_B = '00000000-0000-4000-8000-000000000e11'
const SCHEMA_VERSION_B = '00000000-0000-4000-8000-000000000e12'
const FIELD_SAMPLE = '00000000-0000-4000-8000-000000000e13'
const FIELD_TITRE = '00000000-0000-4000-8000-000000000e14'
const FIELD_DILUTION = '00000000-0000-4000-8000-000000000e15'
const PLANNED_ONE = '00000000-0000-4000-8000-000000000e16'
const PLANNED_TWO = '00000000-0000-4000-8000-000000000e17'
const PLANNED_PASS = '00000000-0000-4000-8000-000000000e18'
const PLANNED_B = '00000000-0000-4000-8000-000000000e19'
const MEMBER_A = 'bench-member'
const OUTSIDER_B = 'bench-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${MEMBER_A}', 'Bench Member', 'bench-member@sheetbase.test', true),
      ('${OUTSIDER_B}', 'Bench Outsider', 'bench-outsider@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS_A}', 'bench-a', 'Bench A'),
      ('${WS_B}', 'bench-b', 'Bench B')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS_A}', '${MEMBER_A}', 'member'),
      ('${WS_B}', '${OUTSIDER_B}', 'member')`,
  )
  await migrator.query(
    `INSERT INTO api.projects (id, workspace_id, key, title) VALUES
      ('${PROJECT_A}', '${WS_A}', 'bnc', 'Bench project')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_schema_definitions (id, workspace_id, key, name, lifecycle) VALUES
      ('${SCHEMA_DEF_A}', '${WS_A}', 'bench_schema', 'Bench schema', 'draft'),
      ('${SCHEMA_DEF_B}', '${WS_B}', 'bench_schema_b', 'Bench schema B', 'draft')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_schema_versions (id, schema_id, version, lifecycle) VALUES
      ('${SCHEMA_VERSION_A}', '${SCHEMA_DEF_A}', 1, 'draft'),
      ('${SCHEMA_VERSION_B}', '${SCHEMA_DEF_B}', 1, 'draft')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_schema_version_fields
       (id, schema_version_id, field_id, key, label, logical_type, nullable, validation, display_order)
     VALUES
       (gen_random_uuid(), '${SCHEMA_VERSION_A}', '${FIELD_SAMPLE}', 'sample', 'Sample', 'text', true, '{}'::jsonb, 1),
       (gen_random_uuid(), '${SCHEMA_VERSION_A}', '${FIELD_TITRE}', 'capsid_titre', 'Capsid titre', 'decimal', true,
        '{"extensions":{"systemFlags":{"out_of_range":{"min":2,"max":4}}}}'::jsonb, 2),
       (gen_random_uuid(), '${SCHEMA_VERSION_A}', '${FIELD_DILUTION}', 'dilution', 'Dilution', 'integer', true, '{}'::jsonb, 3),
       (gen_random_uuid(), '${SCHEMA_VERSION_B}', '${FIELD_SAMPLE}', 'sample', 'Sample', 'text', true, '{}'::jsonb, 1)`,
  )
  await migrator.query(
    `UPDATE api.dataset_schema_versions SET lifecycle = 'active', published_at = now()
      WHERE id IN ('${SCHEMA_VERSION_A}', '${SCHEMA_VERSION_B}')`,
  )
  await migrator.query(
    `INSERT INTO api.datasets (id, workspace_id, schema_version_id, name, primary_project_id) VALUES
      ('${DATASET_A}', '${WS_A}', '${SCHEMA_VERSION_A}', 'Bench dataset A', '${PROJECT_A}'),
      ('${DATASET_B}', '${WS_B}', '${SCHEMA_VERSION_B}', 'Bench dataset B', NULL)`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_rows (id, dataset_id, workspace_id, status, planned_key) VALUES
      ('${PLANNED_ONE}', '${DATASET_A}', '${WS_A}', 'planned', 'SMP-0001'),
      ('${PLANNED_TWO}', '${DATASET_A}', '${WS_A}', 'planned', 'SMP-0002'),
      ('${PLANNED_PASS}', '${DATASET_A}', '${WS_A}', 'planned', 'SMP-0003'),
      ('${PLANNED_B}', '${DATASET_B}', '${WS_B}', 'planned', 'SMP-0001')`,
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

async function commit(
  client: Client,
  input: {
    datasetId: string
    plannedKey: string
    values: Record<string, unknown>
  },
): Promise<{ ok: boolean; idempotent?: boolean; rows?: unknown[]; errors?: unknown[] }> {
  const revision = await client
    .query<{ revision: string }>(`SELECT revision FROM api.datasets WHERE id = $1`, [
      input.datasetId,
    ])
    .then((r) => Number(r.rows[0]?.revision ?? 1))
  const rows = [
    {
      operation: 'create',
      rowId: randomUUID(),
      plannedKey: input.plannedKey,
      values: input.values,
    },
  ]
  const { rows: out } = await client.query<{ result: { ok: boolean } }>(
    `SELECT api.commit_dataset_row_batch($1,$2,$3::jsonb,$4) AS result`,
    [input.datasetId, revision, JSON.stringify(rows), randomUUID()],
  )
  return out[0]!.result
}

async function rowState(
  rowId: string,
): Promise<{ status: string; revision: number }> {
  const { rows } = await migrator.query<{ status: string; revision: string }>(
    `SELECT status, revision FROM api.dataset_rows WHERE id = $1`,
    [rowId],
  )
  return { status: rows[0]!.status, revision: Number(rows[0]!.revision) }
}

async function storedValues(
  rowId: string,
): Promise<
  Array<{
    field_id: string
    text_value: string | null
    integer_value: string | null
    numeric_value: string | null
  }>
> {
  const { rows } = await migrator.query(
    `SELECT field_id, text_value, integer_value, numeric_value
       FROM api.dataset_row_values WHERE row_id = $1 ORDER BY field_id`,
    [rowId],
  )
  return rows
}

async function systemFlags(
  rowId: string,
): Promise<Array<{ kind: string; source: string; reason: string }>> {
  const { rows } = await migrator.query(
    `SELECT kind, source, reason FROM api.dataset_value_flags
      WHERE row_id = $1 AND cleared_at IS NULL ORDER BY source, kind`,
    [rowId],
  )
  return rows
}

describe('bench reading fills a canonical planned row', () => {
  it('fills the matching planned row with the reading and dilution values', async () => {
    const member = await asUser(MEMBER_A, WS_A)
    const result = await commit(member, {
      datasetId: DATASET_A,
      plannedKey: 'SMP-0001',
      values: {
        [FIELD_SAMPLE]: 'SMP-0001',
        [FIELD_TITRE]: 3.2,
        [FIELD_DILUTION]: 10,
      },
    })

    expect(result.ok).toBe(true)
    expect(result.rows).toEqual([
      expect.objectContaining({ rowId: PLANNED_ONE, operation: 'fill' }),
    ])

    const state = await rowState(PLANNED_ONE)
    expect(state.status).toBe('recorded')
    expect(state.revision).toBe(2)

    const values = await storedValues(PLANNED_ONE)
    const byField = new Map(values.map((value) => [value.field_id, value]))
    expect(byField.get(FIELD_SAMPLE)?.text_value).toBe('SMP-0001')
    expect(Number(byField.get(FIELD_TITRE)?.numeric_value)).toBe(3.2)
    expect(Number(byField.get(FIELD_DILUTION)?.integer_value)).toBe(10)

    // The fill did not create a second row for the same key.
    const duplicates = await migrator.query(
      `SELECT count(*)::int AS n FROM api.dataset_rows
        WHERE dataset_id = $1 AND planned_key = 'SMP-0001'`,
      [DATASET_A],
    )
    expect(duplicates.rows[0]!.n).toBe(1)
  })

  it('records an out-of-range value and raises a system flag instead of rejecting it', async () => {
    const member = await asUser(MEMBER_A, WS_A)
    const result = await commit(member, {
      datasetId: DATASET_A,
      plannedKey: 'SMP-0002',
      values: { [FIELD_TITRE]: 9, [FIELD_DILUTION]: 5 },
    })

    expect(result.ok).toBe(true)
    expect((await rowState(PLANNED_TWO)).status).toBe('recorded')

    const flags = await systemFlags(PLANNED_TWO)
    expect(flags).toEqual([
      expect.objectContaining({ kind: 'out_of_range', source: 'system' }),
    ])
    expect(flags[0]!.reason).toContain('above the maximum 4')
  })

  it('writes a passing value with no system flag', async () => {
    const member = await asUser(MEMBER_A, WS_A)
    const result = await commit(member, {
      datasetId: DATASET_A,
      plannedKey: 'SMP-0003',
      values: { [FIELD_TITRE]: 3 },
    })
    expect(result.ok).toBe(true)
    expect(await systemFlags(PLANNED_PASS)).toHaveLength(0)
  })

  it('refuses a value that fails field validation and leaves the planned row unfilled', async () => {
    const benchRow = '00000000-0000-4000-8000-000000000e1a'
    await migrator.query(
      `INSERT INTO api.dataset_rows (id, dataset_id, workspace_id, status, planned_key)
       VALUES ($1, $2, $3, 'planned', 'SMP-0004')`,
      [benchRow, DATASET_A, WS_A],
    )
    const member = await asUser(MEMBER_A, WS_A)
    const result = await commit(member, {
      datasetId: DATASET_A,
      plannedKey: 'SMP-0004',
      // A decimal field given a string fails the value-type rule.
      values: { [FIELD_TITRE]: 'not-a-number' },
    })
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual([
      expect.objectContaining({ fieldId: FIELD_TITRE }),
    ])
    expect((await rowState(benchRow)).status).toBe('planned')
    expect(await storedValues(benchRow)).toHaveLength(0)
  })

  it('denies another workspace and never fills its same-keyed planned row', async () => {
    const outsider = await asUser(OUTSIDER_B, WS_B)
    await expectDenied(
      commit(outsider, {
        datasetId: DATASET_A,
        plannedKey: 'SMP-0001',
        values: { [FIELD_TITRE]: 3 },
      }),
      '42501',
    )

    // A planned key in another workspace is invisible and untouched.
    const state = await rowState(PLANNED_B)
    expect(state.status).toBe('planned')
    expect(await storedValues(PLANNED_B)).toHaveLength(0)
  })
})
