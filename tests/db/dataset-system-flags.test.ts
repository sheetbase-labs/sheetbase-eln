/**
 * DSET-01 step 1 — system rule-generated value flags.
 *
 * Validation derives a `system` flag from a Schema field rule, updates the
 * active system flag when the value still violates it, and clears the active
 * system flag when the value now passes. Manual flags are a separate `source`
 * and are never overwritten or cleared by validation. Reads stay workspace
 * scoped; writes are SECURITY DEFINER and writer-gated like the manual RPC.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  expectDenied,
  grantProjectAccess,
  prepareTestDatabase,
} from './helpers'

const WS_A = '00000000-0000-4000-8000-00000000d0a0'
const WS_B = '00000000-0000-4000-8000-00000000d0a1'
const PROJECT = '00000000-0000-4000-8000-00000000d0a2'
const DATASET = '00000000-0000-4000-8000-00000000d0a3'
const SCHEMA_DEF = '00000000-0000-4000-8000-00000000d0a4'
const SCHEMA_VERSION = '00000000-0000-4000-8000-00000000d0a5'
const FIELD_RANGE = '00000000-0000-4000-8000-00000000d0a6'
const FIELD_PLAIN = '00000000-0000-4000-8000-00000000d0a7'
const ROW = '00000000-0000-4000-8000-00000000d0a8'
const MEMBER = 'sysflag-member'
const VIEWER = 'sysflag-viewer'
const OUTSIDER = 'sysflag-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${MEMBER}', 'Flag Member', 'sysflag-member@sheetbase.test', true),
      ('${VIEWER}', 'Flag Viewer', 'sysflag-viewer@sheetbase.test', true),
      ('${OUTSIDER}', 'Flag Outsider', 'sysflag-outsider@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS_A}', 'sysflag-a', 'System flag A'),
      ('${WS_B}', 'sysflag-b', 'System flag B')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS_A}', '${MEMBER}', 'member'),
      ('${WS_A}', '${VIEWER}', 'viewer'),
      ('${WS_B}', '${OUTSIDER}', 'member')`,
  )
  await migrator.query(
    `INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES ('${PROJECT}', '${WS_A}', 'sys', 'System flag project', '${MEMBER}')`,
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
    `INSERT INTO api.dataset_schema_definitions (id, workspace_id, key, name, lifecycle) VALUES ('${SCHEMA_DEF}', '${WS_A}', 'sysflag_schema', 'System flag schema', 'draft')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_schema_versions (id, schema_id, version, lifecycle) VALUES ('${SCHEMA_VERSION}', '${SCHEMA_DEF}', 1, 'draft')`,
  )
  // The out-of-range rule lives in the existing free-form `validation.extensions`
  // slot. Hard `min`/`max` stay the format constraint (still a validation error);
  // the extension opts a field into a soft, flag-generating rule instead.
  await migrator.query(
    `INSERT INTO api.dataset_schema_version_fields (id, schema_version_id, field_id, key, label, logical_type, nullable, validation, display_order) VALUES
      (gen_random_uuid(), '${SCHEMA_VERSION}', '${FIELD_RANGE}', 'titre', 'Titre', 'decimal', true, '{"extensions":{"systemFlags":{"out_of_range":{"min":2,"max":4}}}}'::jsonb, 1),
      (gen_random_uuid(), '${SCHEMA_VERSION}', '${FIELD_PLAIN}', 'batch', 'Batch', 'text', true, '{}'::jsonb, 2)`,
  )
  await migrator.query(
    `UPDATE api.dataset_schema_versions SET lifecycle = 'active', published_at = now() WHERE id = '${SCHEMA_VERSION}'`,
  )
  await migrator.query(
    `INSERT INTO api.datasets (id, workspace_id, schema_version_id, name, primary_project_id) VALUES ('${DATASET}', '${WS_A}', '${SCHEMA_VERSION}', 'System flag dataset', '${PROJECT}')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_rows (id, dataset_id, workspace_id) VALUES ('${ROW}', '${DATASET}', '${WS_A}')`,
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

async function validate(
  client: Client,
  value: number,
): Promise<{ ok: boolean; errors: unknown[] }> {
  const rows = [
    {
      operation: 'update',
      rowId: ROW,
      expectedRevision: 1,
      values: { [FIELD_RANGE]: value },
    },
  ]
  const { rows: out } = await client.query<{
    result: { ok: boolean; errors: unknown[] }
  }>(`SELECT api.validate_dataset_row_batch($1,$2,$3::jsonb) AS result`, [
    DATASET,
    1,
    JSON.stringify(rows),
  ])
  return out[0]!.result
}

async function activeFlags(
  client: Client,
  source?: 'manual' | 'system',
): Promise<
  Array<{ id: string; kind: string; source: string; reason: string }>
> {
  const filter = source ? ` AND source = '${source}'` : ''
  const { rows } = await client.query<{
    id: string
    kind: string
    source: string
    reason: string
  }>(
    `SELECT id, kind, source, reason FROM api.dataset_value_flags
      WHERE dataset_id = $1 AND row_id = $2 AND field_id = $3 AND cleared_at IS NULL${filter}
      ORDER BY source`,
    [DATASET, ROW, FIELD_RANGE],
  )
  return rows
}

describe('system rule-generated flags', () => {
  it('writes a system flag when a value is out of range and clears it when corrected', async () => {
    const member = await asUser(MEMBER, WS_A)

    const violating = await validate(member, 9)
    expect(violating.ok).toBe(true)

    let flags = await activeFlags(member, 'system')
    expect(flags).toHaveLength(1)
    expect(flags[0]).toMatchObject({
      kind: 'out_of_range',
      source: 'system',
    })
    expect(flags[0]!.reason).toContain('above the maximum 4')

    const passing = await validate(member, 3)
    expect(passing.ok).toBe(true)
    flags = await activeFlags(member, 'system')
    expect(flags).toHaveLength(0)
  })

  it('a manual flag survives validation and is never overwritten or cleared', async () => {
    const member = await asUser(MEMBER, WS_A)
    await member.query(
      `SELECT api.flag_dataset_value($1, $2, $3, 'out_of_range', 'Manual: above top standard')`,
      [DATASET, ROW, FIELD_RANGE],
    )

    // A system rule fires on the same value/kind; it must not touch the manual flag.
    await validate(member, 9)
    let manual = await activeFlags(member, 'manual')
    expect(manual).toHaveLength(1)
    expect(manual[0]!.reason).toBe('Manual: above top standard')
    expect(await activeFlags(member, 'system')).toHaveLength(1)

    // The value now passes: the system flag clears, the manual decision stays.
    await validate(member, 3)
    manual = await activeFlags(member, 'manual')
    expect(manual).toHaveLength(1)
    expect(manual[0]!.reason).toBe('Manual: above top standard')
    expect(await activeFlags(member, 'system')).toHaveLength(0)
  })

  it('keeps the manual reason-required contract and defaults new flags to manual', async () => {
    const member = await asUser(MEMBER, WS_A)
    await expect(
      member.query(
        `SELECT api.flag_dataset_value($1, $2, $3, 'missing_unit', '')`,
        [DATASET, ROW, FIELD_PLAIN],
      ),
    ).rejects.toMatchObject({ code: '22023' })

    const { rows } = await member.query<{ source: string }>(
      `SELECT source FROM api.flag_dataset_value($1, $2, $3, 'missing_unit', 'Unit not recorded')`,
      [DATASET, ROW, FIELD_PLAIN],
    )
    expect(rows[0]!.source).toBe('manual')
  })

  it('does not let a viewer write system flags through validation', async () => {
    const viewer = await asUser(VIEWER, WS_A)
    const result = await validate(viewer, 9)
    expect(result.ok).toBe(true)
    // No system flag beyond whatever the member tests left behind.
    const system = await activeFlags(viewer, 'system')
    expect(system).toHaveLength(0)
  })

  it('denies a non-member or another workspace read and write', async () => {
    const otherWorkspace = await asUser(OUTSIDER, WS_B)
    expect(await activeFlags(otherWorkspace)).toHaveLength(0)
    await expectDenied(validate(otherWorkspace, 9), '42501')

    // Same workspace id but no membership: RLS hides the flags and validation denies.
    const nonMember = await asUser(OUTSIDER, WS_A)
    expect(await activeFlags(nonMember)).toHaveLength(0)
    await expectDenied(validate(nonMember, 9), '42501')
  })

  it('refuses a viewer writing a manual flag', async () => {
    const viewer = await asUser(VIEWER, WS_A)
    await expectDenied(
      viewer.query(
        `SELECT api.flag_dataset_value($1, $2, $3, 'high_cv', 'CV above 20%')`,
        [DATASET, ROW, FIELD_RANGE],
      ),
      '42501',
    )
  })

  it('freezes the source of manual and system flags into a snapshot', async () => {
    const member = await asUser(MEMBER, WS_A)
    // The manual flag on FIELD_RANGE is still active from the earlier test.
    await validate(member, 9)
    const snap = await member.query<{ id: string }>(
      `SELECT (api.snapshot_dataset($1, $2, 'flags')).id AS id`,
      [DATASET, 1],
    )
    const { rows } = await migrator.query<{ kind: string; source: string }>(
      `SELECT kind, source FROM api.dataset_version_flags WHERE dataset_version_id = $1`,
      [snap.rows[0]!.id],
    )
    expect(
      rows
        .filter((row) => row.kind === 'out_of_range')
        .map((row) => row.source)
        .sort(),
    ).toEqual(['manual', 'system'])
  })
})
