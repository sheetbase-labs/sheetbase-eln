/**
 * DSET-01.1 — system rule-generated flags: missing_unit, high_cv and the
 * clear-reason contract.
 *
 * The existing `dataset-system-flags.test.ts` covers the out_of_range rule that
 * landed first. This file covers the rules added by the DSET-01.1 slice:
 *
 * - `missing_unit` fires for a numeric field that requires a unit and has none.
 * - `high_cv` fires across a replicate group whose coefficient of variation
 *   exceeds the configured limit, and clears when the group is corrected.
 * - every system flag records its rule, evaluated value, threshold and time.
 * - clearing a system flag needs a reason, records the actor and stands while
 *   the value is unchanged; manual flags and their clear path are unchanged.
 * - a denied caller, another workspace, an already-cleared flag and a stale
 *   revision are all refused.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  expectDenied,
  grantProjectAccess,
  prepareTestDatabase,
} from './helpers'

const WS_A = '00000000-0000-4000-8000-00000000d0b0'
const WS_B = '00000000-0000-4000-8000-00000000d0b1'
const PROJECT = '00000000-0000-4000-8000-00000000d0b2'
const DATASET = '00000000-0000-4000-8000-00000000d0b3'
const SCHEMA_DEF = '00000000-0000-4000-8000-00000000d0b4'
const SCHEMA_VERSION = '00000000-0000-4000-8000-00000000d0b5'
const SCHEMA_VERSION_2 = '00000000-0000-4000-8000-00000000d0ca'
const FIELD_UNIT = '00000000-0000-4000-8000-00000000d0b6'
const FIELD_CV = '00000000-0000-4000-8000-00000000d0b7'
const FIELD_GROUP = '00000000-0000-4000-8000-00000000d0b8'
const FIELD_OUT = '00000000-0000-4000-8000-00000000d0b9'
const R1 = '00000000-0000-4000-8000-00000000d0c1'
const R2 = '00000000-0000-4000-8000-00000000d0c2'
const R3 = '00000000-0000-4000-8000-00000000d0c3'
const R4 = '00000000-0000-4000-8000-00000000d0c4'
const MEMBER = 'ruleflag-member'
const VIEWER = 'ruleflag-viewer'
const OUTSIDER = 'ruleflag-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

interface FlagRow {
  id: string
  row_id: string
  field_id: string
  kind: string
  source: string
  system_rule: string | null
  reason: string
  evaluated_value: unknown
  threshold: Record<string, unknown> | null
  evaluated_at: string | null
  cleared_reason: string | null
  cleared_by_user_id: string | null
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${MEMBER}', 'Rule Member', 'ruleflag-member@sheetbase.test', true),
      ('${VIEWER}', 'Rule Viewer', 'ruleflag-viewer@sheetbase.test', true),
      ('${OUTSIDER}', 'Rule Outsider', 'ruleflag-outsider@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS_A}', 'ruleflag-a', 'Rule flag A'),
      ('${WS_B}', 'ruleflag-b', 'Rule flag B')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS_A}', '${MEMBER}', 'member'),
      ('${WS_A}', '${VIEWER}', 'viewer'),
      ('${WS_B}', '${OUTSIDER}', 'member')`,
  )
  await migrator.query(
    `INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES ('${PROJECT}', '${WS_A}', 'rule', 'Rule flag project', '${MEMBER}')`,
  )
  await grantProjectAccess(migrator, {
    workspaceId: WS_A,
    projectId: PROJECT,
    userId: VIEWER,
    canView: true,
    canEdit: false,
    canReview: false,
  })
  await migrator.query(
    `INSERT INTO api.dataset_schema_definitions (id, workspace_id, key, name, lifecycle) VALUES ('${SCHEMA_DEF}', '${WS_A}', 'ruleflag_schema', 'Rule flag schema', 'draft')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_schema_versions (id, schema_id, version, lifecycle) VALUES ('${SCHEMA_VERSION}', '${SCHEMA_DEF}', 1, 'draft')`,
  )
  // FIELD_UNIT is numeric with no quantity metadata and opts into missing_unit.
  // FIELD_CV opts into high_cv, grouping rows by FIELD_GROUP's value.
  await migrator.query(
    `INSERT INTO api.dataset_schema_version_fields (id, schema_version_id, field_id, key, label, logical_type, nullable, validation, quantity, display_order) VALUES
      (gen_random_uuid(), '${SCHEMA_VERSION}', '${FIELD_UNIT}', 'titre_unitless', 'Titre', 'decimal', true, '{"extensions":{"systemFlags":{"missing_unit":{"requiresUnit":true}}}}'::jsonb, NULL, 1),
      (gen_random_uuid(), '${SCHEMA_VERSION}', '${FIELD_CV}', 'cv_value', 'CV value', 'decimal', true, '{"extensions":{"systemFlags":{"high_cv":{"maxCvPercent":20,"groupByFieldId":"${FIELD_GROUP}","minReplicates":3}}}}'::jsonb, NULL, 2),
      (gen_random_uuid(), '${SCHEMA_VERSION}', '${FIELD_GROUP}', 'sample', 'Sample', 'text', true, '{}'::jsonb, NULL, 3),
      (gen_random_uuid(), '${SCHEMA_VERSION}', '${FIELD_OUT}', 'out', 'Out', 'decimal', true, '{"extensions":{"systemFlags":{"out_of_range":{"min":2,"max":4}}}}'::jsonb, NULL, 4)`,
  )
  await migrator.query(
    `UPDATE api.dataset_schema_versions SET lifecycle = 'active', published_at = now() WHERE id = '${SCHEMA_VERSION}'`,
  )
  await migrator.query(
    `INSERT INTO api.datasets (id, workspace_id, schema_version_id, name, primary_project_id) VALUES ('${DATASET}', '${WS_A}', '${SCHEMA_VERSION}', 'Rule flag dataset', '${PROJECT}')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_rows (id, dataset_id, workspace_id) VALUES
      ('${R1}', '${DATASET}', '${WS_A}'),
      ('${R2}', '${DATASET}', '${WS_A}'),
      ('${R3}', '${DATASET}', '${WS_A}'),
      ('${R4}', '${DATASET}', '${WS_A}')`,
  )
  // R1–R3 are replicates of S1 (CV 20.4%); R4 is alone in S2.
  await migrator.query(
    `INSERT INTO api.dataset_row_values (row_id, field_id, ordinal, numeric_value) VALUES
      ('${R1}', '${FIELD_UNIT}', 0, 3), ('${R2}', '${FIELD_UNIT}', 0, 3),
      ('${R3}', '${FIELD_UNIT}', 0, 3), ('${R4}', '${FIELD_UNIT}', 0, 3),
      ('${R1}', '${FIELD_CV}', 0, 10), ('${R2}', '${FIELD_CV}', 0, 12),
      ('${R3}', '${FIELD_CV}', 0, 15), ('${R4}', '${FIELD_CV}', 0, 100)`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_row_values (row_id, field_id, ordinal, text_value) VALUES
      ('${R1}', '${FIELD_GROUP}', 0, 'S1'), ('${R2}', '${FIELD_GROUP}', 0, 'S1'),
      ('${R3}', '${FIELD_GROUP}', 0, 'S1'), ('${R4}', '${FIELD_GROUP}', 0, 'S2')`,
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

async function activeFlags(client: Client, where = 'TRUE'): Promise<FlagRow[]> {
  const { rows } = await client.query<FlagRow>(
    `SELECT id, row_id, field_id, kind, source, system_rule, reason,
            evaluated_value, threshold, evaluated_at, cleared_reason,
            cleared_by_user_id
       FROM api.dataset_value_flags
      WHERE dataset_id = $1 AND cleared_at IS NULL AND ${where}
      ORDER BY row_id, field_id, kind`,
    [DATASET],
  )
  return rows
}

async function recompute(client: Client): Promise<void> {
  await client.query('SELECT api.recompute_dataset_system_flags($1)', [DATASET])
}

async function commitUpdate(
  client: Client,
  key: string,
  rowId: string,
  values: Record<string, unknown>,
): Promise<void> {
  const dataset = await migrator.query<{ revision: string }>(
    'SELECT revision FROM api.datasets WHERE id = $1',
    [DATASET],
  )
  const row = await migrator.query<{ revision: string }>(
    'SELECT revision FROM api.dataset_rows WHERE id = $1',
    [rowId],
  )
  const result = await client.query<{ result: { ok: boolean } }>(
    `SELECT api.commit_dataset_row_batch($1,$2,$3::jsonb,$4) AS result`,
    [
      DATASET,
      dataset.rows[0]!.revision,
      JSON.stringify([
        {
          operation: 'update',
          rowId,
          expectedRevision: Number(row.rows[0]!.revision),
          values,
        },
      ]),
      key,
    ],
  )
  expect(result.rows[0]!.result.ok).toBe(true)
}

describe('missing_unit system rule', () => {
  it('flags every recorded value of a field that requires a unit and records provenance', async () => {
    const member = await asUser(MEMBER, WS_A)
    await recompute(member)

    const flags = await activeFlags(member, `kind = 'missing_unit'`)
    expect(flags).toHaveLength(4)
    for (const flag of flags) {
      expect(flag).toMatchObject({
        field_id: FIELD_UNIT,
        source: 'system',
        system_rule: 'missing_unit',
      })
      expect(flag.threshold).toMatchObject({ requiresUnit: true })
      expect(flag.evaluated_value).toBeNull()
      expect(flag.evaluated_at).not.toBeNull()
    }
  })

  it('clears the flags once the field has a unit in a new schema version', async () => {
    const member = await asUser(MEMBER, WS_A)
    // Published fields are immutable, so a unit is set the way DSET-02.4 will:
    // publish a new schema version and point the dataset at it.
    await migrator.query(
      `INSERT INTO api.dataset_schema_versions (id, schema_id, version, lifecycle) VALUES ('${SCHEMA_VERSION_2}', '${SCHEMA_DEF}', 2, 'draft')`,
    )
    await migrator.query(
      `INSERT INTO api.dataset_schema_version_fields (id, schema_version_id, field_id, key, label, logical_type, nullable, validation, quantity, display_order) VALUES
        (gen_random_uuid(), '${SCHEMA_VERSION_2}', '${FIELD_UNIT}', 'titre_unitless', 'Titre', 'decimal', true, '{"extensions":{"systemFlags":{"missing_unit":{"requiresUnit":true}}}}'::jsonb, '{"kind":"concentration","dimension":"mass/volume","storageUnit":"g/L"}'::jsonb, 1),
        (gen_random_uuid(), '${SCHEMA_VERSION_2}', '${FIELD_CV}', 'cv_value', 'CV value', 'decimal', true, '{"extensions":{"systemFlags":{"high_cv":{"maxCvPercent":20,"groupByFieldId":"${FIELD_GROUP}","minReplicates":3}}}}'::jsonb, NULL, 2),
        (gen_random_uuid(), '${SCHEMA_VERSION_2}', '${FIELD_GROUP}', 'sample', 'Sample', 'text', true, '{}'::jsonb, NULL, 3),
        (gen_random_uuid(), '${SCHEMA_VERSION_2}', '${FIELD_OUT}', 'out', 'Out', 'decimal', true, '{"extensions":{"systemFlags":{"out_of_range":{"min":2,"max":4}}}}'::jsonb, NULL, 4)`,
    )
    await migrator.query(
      `UPDATE api.dataset_schema_versions SET lifecycle = 'active', published_at = now() WHERE id = '${SCHEMA_VERSION_2}'`,
    )
    await migrator.query(
      `UPDATE api.datasets SET schema_version_id = '${SCHEMA_VERSION_2}' WHERE id = '${DATASET}'`,
    )
    await recompute(member)
    expect(await activeFlags(member, `kind = 'missing_unit'`)).toHaveLength(0)

    // Restore for the remaining tests: the original unitless version re-flags.
    await migrator.query(
      `UPDATE api.datasets SET schema_version_id = '${SCHEMA_VERSION}' WHERE id = '${DATASET}'`,
    )
    await recompute(member)
    expect(await activeFlags(member, `kind = 'missing_unit'`)).toHaveLength(4)
  })
})

describe('high_cv system rule', () => {
  it('flags the replicate group above the CV limit and never the lone row', async () => {
    const member = await asUser(MEMBER, WS_A)
    await recompute(member)

    const flags = await activeFlags(member, `kind = 'high_cv'`)
    expect(flags.map((flag) => flag.row_id).sort()).toEqual([R1, R2, R3].sort())
    for (const flag of flags) {
      expect(flag).toMatchObject({
        field_id: FIELD_CV,
        source: 'system',
        system_rule: 'high_cv',
      })
      expect(flag.threshold).toMatchObject({
        maxCvPercent: 20,
        groupKey: 'S1',
        replicateCount: 3,
      })
      expect(Number(flag.threshold?.cvPercent)).toBeCloseTo(20.41, 1)
      expect(flag.evaluated_at).not.toBeNull()
    }
  })

  it('clears the group flags when a corrected replicate brings the CV down', async () => {
    const member = await asUser(MEMBER, WS_A)
    await commitUpdate(member, 'ruleflag-correct', R3, { [FIELD_CV]: 11 })
    expect(await activeFlags(member, `kind = 'high_cv'`)).toHaveLength(0)
  })

  it('writes and freezes the out-of-range provenance through commit', async () => {
    const member = await asUser(MEMBER, WS_A)
    await commitUpdate(member, 'ruleflag-out-of-range', R1, { [FIELD_OUT]: 9 })

    const flags = await activeFlags(member, `kind = 'out_of_range'`)
    expect(flags).toHaveLength(1)
    expect(flags[0]).toMatchObject({
      row_id: R1,
      field_id: FIELD_OUT,
      source: 'system',
      system_rule: 'out_of_range',
    })
    expect(flags[0]!.threshold).toMatchObject({ min: 2, max: 4 })
    expect(Number(flags[0]!.evaluated_value)).toBe(9)
  })
})

describe('clear-reason contract', () => {
  it('requires a reason for a system flag, records the actor and keeps the override', async () => {
    const member = await asUser(MEMBER, WS_A)
    // Re-establish an active high_cv flag on R3 (value 15 again).
    await commitUpdate(member, 'ruleflag-refire', R3, { [FIELD_CV]: 15 })
    const [target] = await activeFlags(
      member,
      `kind = 'high_cv' AND row_id = '${R3}'`,
    )
    expect(target).toBeTruthy()

    await expect(
      member.query('SELECT api.clear_dataset_value_flag($1)', [target!.id]),
    ).rejects.toMatchObject({ code: '22023' })

    const cleared = await member.query<FlagRow>(
      'SELECT * FROM api.clear_dataset_value_flag($1,$2)',
      [target!.id, 'Reviewed: repeat queued for R3'],
    )
    expect(cleared.rows[0]).toMatchObject({
      cleared_reason: 'Reviewed: repeat queued for R3',
      cleared_by_user_id: MEMBER,
    })

    // Recomputing must not resurrect a rule a person dismissed for this value.
    await recompute(member)
    expect(
      await activeFlags(member, `kind = 'high_cv' AND row_id = '${R3}'`),
    ).toHaveLength(0)
    // The rest of the group is still flagged.
    expect(
      (await activeFlags(member, `kind = 'high_cv'`))
        .map((f) => f.row_id)
        .sort(),
    ).toEqual([R1, R2].sort())
  })

  it('refuses to clear the same flag twice and an unknown flag id', async () => {
    const member = await asUser(MEMBER, WS_A)
    const [alreadyCleared] = (
      await migrator.query<{ id: string }>(
        `SELECT id FROM api.dataset_value_flags
          WHERE dataset_id = $1 AND cleared_reason IS NOT NULL LIMIT 1`,
        [DATASET],
      )
    ).rows
    expect(alreadyCleared).toBeTruthy()
    await expect(
      member.query('SELECT api.clear_dataset_value_flag($1,$2)', [
        alreadyCleared!.id,
        'again',
      ]),
    ).rejects.toMatchObject({ code: '22023' })

    await expect(
      member.query('SELECT api.clear_dataset_value_flag($1,$2)', [
        '00000000-0000-4000-8000-0000000000ff',
        'no such flag',
      ]),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('keeps the manual flag and its reason-free clear unchanged', async () => {
    const member = await asUser(MEMBER, WS_A)
    const { rows } = await member.query<FlagRow>(
      `SELECT * FROM api.flag_dataset_value($1,$2,$3,'out_of_range','Manual decision')`,
      [DATASET, R2, FIELD_OUT],
    )
    expect(rows[0]).toMatchObject({ source: 'manual', system_rule: null })
    const cleared = await member.query<FlagRow>(
      'SELECT * FROM api.clear_dataset_value_flag($1)',
      [rows[0]!.id],
    )
    expect(cleared.rows[0]).toMatchObject({
      cleared_reason: null,
      cleared_by_user_id: MEMBER,
    })
  })
})

describe('denials and stale input', () => {
  it('does not let a viewer read, flag, clear or recompute', async () => {
    const viewer = await asUser(VIEWER, WS_A)
    // A viewer can read flags in their workspace but cannot write them.
    expect(await activeFlags(viewer)).not.toHaveLength(0)
    await expectDenied(
      viewer.query(
        `SELECT api.flag_dataset_value($1,$2,$3,'missing_unit','viewer attempt')`,
        [DATASET, R1, FIELD_UNIT],
      ),
      '42501',
    )
    const systemFlags = await activeFlags(viewer, `source = 'system'`)
    expect(systemFlags.length).toBeGreaterThan(0)
    await expectDenied(
      viewer.query('SELECT api.clear_dataset_value_flag($1,$2)', [
        systemFlags[0]!.id,
        'viewer attempt',
      ]),
      '42501',
    )
    await expectDenied(
      viewer.query('SELECT api.recompute_dataset_system_flags($1)', [DATASET]),
      '42501',
    )
  })

  it('hides another workspace and denies a non-member', async () => {
    const otherWorkspace = await asUser(OUTSIDER, WS_B)
    expect(await activeFlags(otherWorkspace)).toHaveLength(0)
    await expectDenied(
      otherWorkspace.query('SELECT api.recompute_dataset_system_flags($1)', [
        DATASET,
      ]),
      '42501',
    )

    const nonMember = await asUser(OUTSIDER, WS_A)
    expect(await activeFlags(nonMember)).toHaveLength(0)
    await expectDenied(
      nonMember.query(
        `SELECT api.flag_dataset_value($1,$2,$3,'missing_unit','non-member')`,
        [DATASET, R1, FIELD_UNIT],
      ),
      '42501',
    )
  })

  it('refuses a stale validation revision and an invalid batch shape', async () => {
    const member = await asUser(MEMBER, WS_A)
    const stale = await member.query<{
      result: { ok: boolean; errors: unknown[] }
    }>(`SELECT api.validate_dataset_row_batch($1,$2,$3::jsonb) AS result`, [
      DATASET,
      99,
      JSON.stringify([
        {
          operation: 'update',
          rowId: R1,
          expectedRevision: 1,
          values: { [FIELD_OUT]: 3 },
        },
      ]),
    ])
    expect(stale.rows[0]!.result.ok).toBe(false)
    expect(stale.rows[0]!.result.errors).toEqual([
      expect.objectContaining({ code: 'stale_dataset_revision' }),
    ])

    await expect(
      member.query(`SELECT api.validate_dataset_row_batch($1,$2,$3::jsonb)`, [
        DATASET,
        1,
        JSON.stringify({ not: 'an array' }),
      ]),
    ).rejects.toMatchObject({ code: '22023' })
  })
})
