/**
 * DSET-01.4 — request repeat.
 *
 * One atomic SECURITY DEFINER RPC derives a dilution sample (LAB-01's existing
 * sample + record_links lineage model) and plans the Dataset rows that will
 * hold the repeat measurement (DSET-01.3). Covers success, lineage, the
 * no-values/scheduled state of the planned rows, rollback atomicity, duplicate
 * rejection and workspace/viewer denial.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS_A = '00000000-0000-4000-8000-00000000e0a0'
const WS_B = '00000000-0000-4000-8000-00000000e0a1'
const PROJECT_A = '00000000-0000-4000-8000-00000000e0a2'
const PROJECT_B = '00000000-0000-4000-8000-00000000e0a3'
const SCHEMA_DEF = '00000000-0000-4000-8000-00000000e0a4'
const SCHEMA_VERSION = '00000000-0000-4000-8000-00000000e0a5'
const FIELD = '00000000-0000-4000-8000-00000000e0a6'
const SAMPLE_FIELD = '00000000-0000-4000-8000-00000000e0ac'
const DATASET_A = '00000000-0000-4000-8000-00000000e0a7'
const DATASET_B = '00000000-0000-4000-8000-00000000e0a8'
const ROW_A = '00000000-0000-4000-8000-00000000e0a9'
const SOURCE_SAMPLE = '00000000-0000-4000-8000-00000000e0aa'
const MEMBER = 'repeat-member'
const VIEWER = 'repeat-viewer'
const OUTSIDER = 'repeat-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

const SCHEDULED = '2026-10-05T09:00:00+01:00'

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${MEMBER}', 'Repeat Member', 'repeat-member@sheetbase.test', true),
      ('${VIEWER}', 'Repeat Viewer', 'repeat-viewer@sheetbase.test', true),
      ('${OUTSIDER}', 'Repeat Outsider', 'repeat-outsider@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS_A}', 'repeat-a', 'Repeat A'),
      ('${WS_B}', 'repeat-b', 'Repeat B')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS_A}', '${MEMBER}', 'member'),
      ('${WS_A}', '${VIEWER}', 'viewer'),
      ('${WS_B}', '${OUTSIDER}', 'member')`,
  )
  await migrator.query(
    `INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES
      ('${PROJECT_A}', '${WS_A}', 'rep', 'Repeat A', '${MEMBER}'),
      ('${PROJECT_B}', '${WS_B}', 'repb', 'Repeat B', '${OUTSIDER}')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_schema_definitions (id, workspace_id, key, name, lifecycle) VALUES ('${SCHEMA_DEF}', '${WS_A}', 'repeat_schema', 'Repeat schema', 'draft')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_schema_versions (id, schema_id, version, lifecycle) VALUES ('${SCHEMA_VERSION}', '${SCHEMA_DEF}', 1, 'draft')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_schema_version_fields (id, schema_version_id, field_id, key, label, logical_type, nullable, display_order) VALUES
      (gen_random_uuid(), '${SCHEMA_VERSION}', '${FIELD}', 'titre', 'Titre', 'decimal', true, 1),
      (gen_random_uuid(), '${SCHEMA_VERSION}', '${SAMPLE_FIELD}', 'sample', 'Sample', 'text', true, 2)`,
  )
  await migrator.query(
    `UPDATE api.dataset_schema_versions SET lifecycle = 'active', published_at = now() WHERE id = '${SCHEMA_VERSION}'`,
  )
  // Dataset A uses the rich schema; Dataset B is a minimal cross-workspace target.
  await migrator.query(
    `INSERT INTO api.datasets (id, workspace_id, schema_version_id, name, primary_project_id, created_by_user_id) VALUES
      ('${DATASET_A}', '${WS_A}', '${SCHEMA_VERSION}', 'Repeat A dataset', '${PROJECT_A}', '${MEMBER}')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_rows (id, dataset_id, workspace_id) VALUES ('${ROW_A}', '${DATASET_A}', '${WS_A}')`,
  )
  await migrator.query(
    `INSERT INTO api.records (id, workspace_id, project_id, kind, identifier, title, status, properties, created_by_user_id) VALUES
      ('${SOURCE_SAMPLE}', '${WS_A}', '${PROJECT_A}', 'sample', 'SMP-REPEAT-0001', 'Source plasma', 'available', '{"quantity":5,"quantityUnit":"mL","storageLocation":"Freezer A"}'::jsonb, '${MEMBER}')`,
  )
  // Minimal schema/dataset in WS_B to prove cross-workspace refusal.
  await migrator.query(
    `INSERT INTO api.dataset_schema_definitions (id, workspace_id, key, name, lifecycle) VALUES ('00000000-0000-4000-8000-00000000e0b4', '${WS_B}', 'repeat_schema_b', 'Repeat schema B', 'draft')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_schema_versions (id, schema_id, version, lifecycle) VALUES ('00000000-0000-4000-8000-00000000e0b5', '00000000-0000-4000-8000-00000000e0b4', 1, 'draft')`,
  )
  await migrator.query(
    `UPDATE api.dataset_schema_versions SET lifecycle = 'active', published_at = now() WHERE id = '00000000-0000-4000-8000-00000000e0b5'`,
  )
  await migrator.query(
    `INSERT INTO api.datasets (id, workspace_id, schema_version_id, name, primary_project_id) VALUES ('${DATASET_B}', '${WS_B}', '00000000-0000-4000-8000-00000000e0b5', 'Repeat B dataset', '${PROJECT_B}')`,
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

interface RepeatResult {
  sample: {
    id: string
    kind: string
    identifier: string
    properties: Record<string, unknown>
  }
  plannedRowIds: string[]
  datasetId: string
  plannedRows: { id: string; plannedKey: string }[]
  idempotent: boolean
}

async function requestRepeat(
  client: Client,
  args: {
    source?: string
    dataset?: string
    scheduled?: string | null
    count?: number
    row?: string | null
    field?: string | null
    title?: string | null
    properties?: Record<string, unknown>
  } = {},
): Promise<RepeatResult> {
  const { rows } = await client.query<{ result: RepeatResult }>(
    `SELECT api.request_repeat($1,$2,$3::timestamptz,$4,$5,$6,$7,$8::jsonb) AS result`,
    [
      args.source ?? SOURCE_SAMPLE,
      args.dataset ?? DATASET_A,
      args.scheduled === undefined ? SCHEDULED : args.scheduled,
      args.count ?? 1,
      args.row === undefined ? ROW_A : args.row,
      args.field === undefined ? FIELD : args.field,
      args.title ?? null,
      JSON.stringify(args.properties ?? { quantity: 1, quantityUnit: 'mL' }),
    ],
  )
  return rows[0]!.result
}

describe('api.request_repeat', () => {
  it('atomically derives a dilution sample and plans no-value rows linked to the source', async () => {
    const member = await asUser(MEMBER, WS_A)
    const result = await requestRepeat(member, { count: 2 })

    expect(result.sample.kind).toBe('sample')
    expect(result.sample.identifier).toMatch(/^SMP-/)
    expect(Number(result.sample.properties.quantity)).toBe(1)
    expect(result.plannedRowIds).toHaveLength(2)

    // Lineage uses the existing record_links model: source sample -> derived.
    const { rows: links } = await member.query<{
      target_record_id: string
      target_kind: string
      link_type: string
      link_metadata: Record<string, unknown>
    }>(
      `SELECT target_record_id, target_kind, link_type, link_metadata
         FROM api.record_links
        WHERE source_record_id = $1 AND link_type = 'sample'`,
      [SOURCE_SAMPLE],
    )
    expect(links).toHaveLength(1)
    expect(links[0]!.target_record_id).toBe(result.sample.id)
    expect(links[0]!.target_kind).toBe('sample')
    expect(links[0]!.link_metadata.origin).toBe('request_repeat')
    expect(links[0]!.link_metadata.sourceDatasetId).toBe(DATASET_A)
    expect(links[0]!.link_metadata.sourceRowId).toBe(ROW_A)

    // The derived sample gets a creation event; the source is untouched.
    const { rows: events } = await member.query<{ operation: string }>(
      `SELECT operation FROM api.sample_events WHERE record_id = $1`,
      [result.sample.id],
    )
    expect(events.map((e) => e.operation)).toContain('create')
    const { rows: sourceEvents } = await member.query(
      `SELECT * FROM api.sample_events WHERE record_id = $1`,
      [SOURCE_SAMPLE],
    )
    expect(sourceEvents).toHaveLength(0)

    // Planned rows: status planned, scheduled time, and no values.
    const { rows: planned } = await member.query<{
      id: string
      status: string
      scheduled_at: string | null
    }>(
      `SELECT id, status, scheduled_at FROM api.dataset_rows WHERE id = ANY($1::uuid[])`,
      [result.plannedRowIds],
    )
    expect(planned).toHaveLength(2)
    for (const row of planned) {
      expect(row.status).toBe('planned')
      expect(row.scheduled_at).not.toBeNull()
    }
    const { rows: valueCounts } = await migrator.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM api.dataset_row_values WHERE row_id = ANY($1::uuid[])`,
      [result.plannedRowIds],
    )
    expect(valueCounts[0]!.n).toBe(0)
  })

  it('refuses values on the planned repeat rows', async () => {
    const member = await asUser(MEMBER, WS_A)
    const { rows: planned } = await member.query<{ id: string }>(
      `SELECT id FROM api.dataset_rows
        WHERE dataset_id = $1 AND status = 'planned' LIMIT 1`,
      [DATASET_A],
    )
    await expect(
      migrator.query(
        `INSERT INTO api.dataset_row_values (row_id, field_id, ordinal, numeric_value)
         VALUES ($1, $2, 0, 1.0)`,
        [planned[0]!.id, FIELD],
      ),
    ).rejects.toMatchObject({ code: 'SB072' })
  })

  it('rejects a duplicate request for the same measurement and schedule', async () => {
    const member = await asUser(MEMBER, WS_A)
    await expect(requestRepeat(member, { count: 1 })).rejects.toMatchObject({
      code: 'SB075',
    })
  })

  it('rolls back the whole repeat when a source field is invalid', async () => {
    const member = await asUser(MEMBER, WS_A)
    await expect(
      requestRepeat(member, {
        title: 'atomic repeat',
        field: '00000000-0000-4000-8000-00000000e0ff',
        scheduled: '2026-10-06T09:00:00+01:00',
      }),
    ).rejects.toMatchObject({ code: '22023' })

    const { rows } = await migrator.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM api.records WHERE title = 'atomic repeat'`,
    )
    expect(rows[0]!.n).toBe(0)
  })

  it('denies a viewer', async () => {
    const viewer = await asUser(VIEWER, WS_A)
    await expectDenied(requestRepeat(viewer), '42501')
  })

  it('hands a default-key repeat to the bench and fills its exact row once with the derived sample', async () => {
    const member = await asUser(MEMBER, WS_A)
    const repeat = await requestRepeat(member, {
      scheduled: '2026-10-09T09:00:00Z',
    })
    expect(repeat.datasetId).toBe(DATASET_A)
    expect(repeat.plannedRows).toEqual([
      {
        id: repeat.plannedRowIds[0],
        plannedKey: `repeat:${repeat.sample.id}:1`,
      },
    ])
    const plan = repeat.plannedRows[0]
    const { rows: plans } = await member.query(
      'SELECT * FROM api.reading_planned_rows WHERE id=$1',
      [plan.id],
    )
    expect(plans[0]).toMatchObject({
      planned_key: plan.plannedKey,
      sample_id: repeat.sample.id,
      measurement_field_id: FIELD,
    })
    const { rows: datasets } = await member.query(
      'SELECT revision FROM api.datasets WHERE id=$1',
      [DATASET_A],
    )
    const batch = JSON.stringify([
      {
        operation: 'create',
        rowId: '00000000-0000-4000-8000-00000000e0ad',
        plannedKey: plan.plannedKey,
        values: { [FIELD]: 3.75, [SAMPLE_FIELD]: repeat.sample.identifier },
      },
    ])
    const args = [
      DATASET_A,
      datasets[0].revision,
      batch,
      'repeat-bench-regression',
    ]
    const submit = () =>
      member.query(
        'SELECT api.commit_dataset_row_batch($1,$2,$3::jsonb,$4) result',
        args,
      )
    const first = (await submit()).rows[0].result
    expect(first).toMatchObject({
      ok: true,
      rows: [{ rowId: plan.id, operation: 'fill' }],
    })
    expect((await submit()).rows[0].result).toMatchObject({
      ok: true,
      idempotent: true,
      rows: first.rows,
    })
    expect(
      (
        await member.query(
          'SELECT * FROM api.reading_planned_rows WHERE id=$1',
          [plan.id],
        )
      ).rows,
    ).toEqual([])
    const live = (
      await member.query('SELECT api.dataset_value_context($1,$2) result', [
        DATASET_A,
        plan.id,
      ])
    ).rows[0].result
    expect(live.rows).toEqual([
      {
        rowId: plan.id,
        revision: 2,
        values: { [FIELD]: 3.75, [SAMPLE_FIELD]: repeat.sample.identifier },
      },
    ])
    for (const field of [FIELD, SAMPLE_FIELD]) {
      await member.query(
        "SELECT api.flag_dataset_value($1,$2,$3,'out_of_range','Check this exact value',NULL)",
        [DATASET_A, plan.id, field],
      )
    }
    const issues = (
      await member.query(
        "SELECT source_id,dataset_id,row_id,field_id FROM api.my_work_items WHERE source_type='dataset_value_flag'",
      )
    ).rows
    expect(issues).toHaveLength(2)
    expect(new Set(issues.map((issue) => issue.source_id)).size).toBe(2)
    expect(issues).toEqual(
      expect.arrayContaining(
        [FIELD, SAMPLE_FIELD].map((field_id) =>
          expect.objectContaining({
            dataset_id: DATASET_A,
            row_id: plan.id,
            field_id,
          }),
        ),
      ),
    )
    await member.query('SELECT api.mark_work_items_seen($1::text[])', [
      [`data_issue:${issues[0].source_id}`],
    ])
    const remaining = (
      await member.query(
        "SELECT api.inbox_work_items_page('needs-action','data') result",
      )
    ).rows[0].result
    expect(remaining.total).toBe(1)
    expect(remaining.items[0].source_id).toBe(issues[1].source_id)
    const outsider = await asUser(OUTSIDER, WS_B)
    expect(
      (
        await outsider.query('SELECT api.dataset_value_context($1,$2) result', [
          DATASET_A,
          plan.id,
        ])
      ).rows[0].result,
    ).toBeNull()
    expect(
      (
        await outsider.query(
          'SELECT * FROM api.reading_planned_rows WHERE dataset_id=$1',
          [DATASET_A],
        )
      ).rows,
    ).toEqual([])
  })

  it('denies a non-member and another workspace', async () => {
    // Outsider claims WS_A but has no membership there.
    const nonMember = await asUser(OUTSIDER, WS_A)
    await expectDenied(requestRepeat(nonMember), '42501')

    // Outsider in WS_B cannot repeat a WS_A sample into a WS_A dataset.
    const otherWorkspace = await asUser(OUTSIDER, WS_B)
    await expectDenied(requestRepeat(otherWorkspace), '42501')
  })
})
