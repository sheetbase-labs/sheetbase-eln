/**
 * REG-002 integration proof: sample controlled mutations (receive, consume,
 * transfer, edit, archive, restore), quantity/location integrity guards,
 * chain-of-custody event attribution, low-stock state and workspace
 * isolation. Runs against a freshly migrated sheetbase_test database.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS_A = '00000000-0000-4000-8000-00000000200a'
const WS_B = '00000000-0000-4000-8000-00000000200b'
const PROJ_A = '00000000-0000-4000-8000-00000000211a'
const PROJ_B = '00000000-0000-4000-8000-00000000211b'
const OWNER_A = 'reg002-owner-a'
const MEMBER_A = 'reg002-member-a'
const OWNER_B = 'reg002-owner-b'

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
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    claims(userId, workspaceId),
  ])
  return client
}

async function createSample(
  client: Client,
  project: string,
  title: string,
  properties: Record<string, unknown> = {},
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `SELECT * FROM api.create_record($1::uuid, 'sample', $2, 'available', ARRAY[]::text[], $3::jsonb)`,
    [project, title, JSON.stringify(properties)],
  )
  return rows[0]
}

function quantityOf(row: Record<string, any>): number | null {
  const q = row.properties?.quantity
  return q == null ? null : Number(q)
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${OWNER_A}', 'REG002 Owner A', 'reg002-owner-a@sheetbase.test', true),
      ('${MEMBER_A}', 'REG002 Member A', 'reg002-member-a@sheetbase.test', true),
      ('${OWNER_B}', 'REG002 Owner B', 'reg002-owner-b@sheetbase.test', true);
     INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS_A}', 'reg002-a', 'REG002 A'),
      ('${WS_B}', 'reg002-b', 'REG002 B');
     INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS_A}', '${OWNER_A}', 'owner'),
      ('${WS_A}', '${MEMBER_A}', 'member'),
      ('${WS_B}', '${OWNER_B}', 'owner');
     INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES
      ('${PROJ_A}', '${WS_A}', 'reg-a', 'REG A', '${OWNER_A}'),
      ('${PROJ_B}', '${WS_B}', 'reg-b', 'REG B', '${OWNER_B}')`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('REG-002 receive / consume quantity integrity', () => {
  it('receives stock, records a custody event with actor attribution, and bumps metadata_version', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const sample = await createSample(owner, PROJ_A, 'Plasma 1', {
      quantity: 0,
      quantityUnit: 'mL',
      storageLocation: 'Freezer A',
    })
    const before = sample.metadata_version
    const { rows } = await owner.query(
      `SELECT * FROM api.receive_sample(p_record_id => $1, p_quantity => 10, p_expected_metadata_version => $3, p_unit => $2, p_location => 'Freezer A', p_notes => 'first receipt')`,
      [sample.id, 'mL', before],
    )
    const updated = rows[0]
    expect(quantityOf(updated)).toBe(10)
    expect(updated.status).toBe('available')
    expect(updated.metadata_version).toBe(before + 1)
    expect(updated.updated_by_user_id).toBe(OWNER_A)

    const { rows: events } = await owner.query(
      `SELECT * FROM api.sample_events WHERE record_id = $1 ORDER BY created_at ASC`,
      [sample.id],
    )
    expect(events).toHaveLength(1)
    expect(events[0].operation).toBe('receive')
    expect(Number(events[0].quantity_delta)).toBe(10)
    expect(Number(events[0].quantity_before)).toBe(0)
    expect(Number(events[0].quantity_after)).toBe(10)
    expect(events[0].actor_user_id).toBe(OWNER_A)
    expect(events[0].notes).toBe('first receipt')
  })

  it('refuses a non-positive receive quantity', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const sample = await createSample(owner, PROJ_A, 'Bad receive')
    await expect(
      owner.query(
        `SELECT * FROM api.receive_sample(p_record_id => $1, p_quantity => 0, p_expected_metadata_version => $2)`,
        [sample.id, sample.metadata_version],
      ),
    ).rejects.toMatchObject({ code: 'SB006' })
  })

  it('prevents consuming more than available (no negative quantity)', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const sample = await createSample(owner, PROJ_A, 'Limit 5', {
      quantity: 5,
      quantityUnit: 'mL',
    })
    await expect(
      owner.query(
        `SELECT * FROM api.consume_sample(p_record_id => $1, p_quantity => 6, p_expected_metadata_version => $2)`,
        [sample.id, sample.metadata_version],
      ),
    ).rejects.toMatchObject({ code: 'SB006' })
    // Quantity unchanged after the failed consume.
    const { rows } = await owner.query(
      `SELECT properties FROM api.records WHERE id = $1`,
      [sample.id],
    )
    expect(Number(rows[0].properties.quantity)).toBe(5)
  })

  it('consumes to zero and transitions to consumed', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const sample = await createSample(owner, PROJ_A, 'Exact consume', {
      quantity: 4,
      quantityUnit: 'mL',
    })
    const { rows } = await owner.query(
      `SELECT * FROM api.consume_sample(p_record_id => $1, p_quantity => 4, p_expected_metadata_version => $2, p_notes => 'used up')`,
      [sample.id, sample.metadata_version],
    )
    const updated = rows[0]
    expect(quantityOf(updated)).toBe(0)
    expect(updated.status).toBe('consumed')
    const { rows: events } = await owner.query(
      `SELECT * FROM api.sample_events WHERE record_id = $1 AND operation = 'consume'`,
      [sample.id],
    )
    expect(Number(events[0].quantity_delta)).toBe(-4)
    expect(Number(events[0].quantity_after)).toBe(0)
  })
})

describe('REG-002 transfer location integrity', () => {
  it('transfers between distinct locations and records from/to', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const sample = await createSample(owner, PROJ_A, 'Movable', {
      quantity: 3,
      quantityUnit: 'mL',
      storageLocation: 'Freezer A',
    })
    const { rows } = await owner.query(
      `SELECT * FROM api.transfer_sample(p_record_id => $1, p_to_location => 'Freezer B', p_expected_metadata_version => $2, p_notes => 'moved')`,
      [sample.id, sample.metadata_version],
    )
    expect(rows[0].properties.storageLocation).toBe('Freezer B')
    const { rows: events } = await owner.query(
      `SELECT * FROM api.sample_events WHERE record_id = $1 AND operation = 'transfer'`,
      [sample.id],
    )
    expect(events[0].from_location).toBe('Freezer A')
    expect(events[0].to_location).toBe('Freezer B')
  })

  it('refuses a transfer to the same location', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const sample = await createSample(owner, PROJ_A, 'Noop move', {
      quantity: 1,
      storageLocation: 'Bench 1',
    })
    await expect(
      owner.query(
        `SELECT * FROM api.transfer_sample(p_record_id => $1, p_to_location => 'Bench 1', p_expected_metadata_version => $2)`,
        [sample.id, sample.metadata_version],
      ),
    ).rejects.toMatchObject({ code: 'SB007' })
  })

  it('refuses an untraceable transfer from an unknown location', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const sample = await createSample(owner, PROJ_A, 'No origin', {
      quantity: 1,
    })
    await expect(
      owner.query(
        `SELECT * FROM api.transfer_sample(p_record_id => $1, p_to_location => 'Freezer A', p_expected_metadata_version => $2)`,
        [sample.id, sample.metadata_version],
      ),
    ).rejects.toMatchObject({ code: 'SB008' })
  })
})

describe('REG-002 edit / archive / restore', () => {
  it('edits properties and archives then restores with custody events', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const sample = await createSample(owner, PROJ_A, 'Editable', {
      quantity: 2,
      quantityUnit: 'mL',
      storageLocation: 'Freezer A',
    })
    const { rows: edited } = await owner.query(
      `SELECT * FROM api.edit_sample($1, $2, NULL, $3::jsonb, NULL, 'updated barcode')`,
      [
        sample.id,
        sample.metadata_version,
        JSON.stringify({ barcode: 'BC-9', lowStockThreshold: 1 }),
      ],
    )
    expect(edited[0].properties.barcode).toBe('BC-9')
    expect(Number(edited[0].properties.lowStockThreshold)).toBe(1)

    const { rows: archived } = await owner.query(
      `SELECT * FROM api.archive_sample($1, $2, 'done')`,
      [sample.id, edited[0].metadata_version],
    )
    expect(archived[0].archived_at).not.toBeNull()

    // Controlled mutations refuse to operate on archived samples.
    await expect(
      owner.query(
        `SELECT * FROM api.receive_sample(p_record_id => $1, p_quantity => 1, p_expected_metadata_version => $2)`,
        [sample.id, archived[0].metadata_version],
      ),
    ).rejects.toMatchObject({ code: 'SB004' })

    const { rows: restored } = await owner.query(
      `SELECT * FROM api.restore_sample($1, $2, 'reopened')`,
      [sample.id, archived[0].metadata_version],
    )
    expect(restored[0].archived_at).toBeNull()

    const { rows: ops } = await owner.query(
      `SELECT operation FROM api.sample_events WHERE record_id = $1 ORDER BY created_at ASC`,
      [sample.id],
    )
    expect(ops.map((r) => r.operation)).toEqual(['edit', 'archive', 'restore'])
  })

  it('edit_sample cannot mutate quantity, unit or storage location directly', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const sample = await createSample(owner, PROJ_A, 'Guarded edit', {
      quantity: 2,
      quantityUnit: 'mL',
      storageLocation: 'Freezer A',
    })
    // A caller tries to change quantity / unit / location through edit_sample
    // instead of the audited receive / consume / transfer RPCs.
    const { rows } = await owner.query(
      `SELECT * FROM api.edit_sample(p_record_id => $1, p_expected_metadata_version => $2, p_properties => $3::jsonb)`,
      [
        sample.id,
        sample.metadata_version,
        JSON.stringify({
          quantity: 999,
          quantityUnit: 'L',
          storageLocation: 'Bench 9',
          barcode: 'BC-guard',
        }),
      ],
    )
    const updated = rows[0]
    // Controlled keys are ignored; the audited values are preserved.
    expect(Number(updated.properties.quantity)).toBe(2)
    expect(updated.properties.quantityUnit).toBe('mL')
    expect(updated.properties.storageLocation).toBe('Freezer A')
    // Non-controlled identity keys still flow through edit.
    expect(updated.properties.barcode).toBe('BC-guard')
  })
})

describe('REG-002 optimistic concurrency', () => {
  it('rejects a mutation with a stale metadata version', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const sample = await createSample(owner, PROJ_A, 'Concurrency', {
      quantity: 1,
      storageLocation: 'A',
    })
    await owner.query(
      `SELECT * FROM api.receive_sample(p_record_id => $1, p_quantity => 1, p_expected_metadata_version => $2)`,
      [sample.id, sample.metadata_version],
    )
    // Reuse the original (now stale) version.
    await expect(
      owner.query(
        `SELECT * FROM api.consume_sample(p_record_id => $1, p_quantity => 1, p_expected_metadata_version => $2)`,
        [sample.id, sample.metadata_version],
      ),
    ).rejects.toMatchObject({ code: 'SB001' })
  })
})

describe('REG-002 workspace isolation', () => {
  it('prevents a cross-workspace consume and reads only own events', async () => {
    const ownerA = await asAuthenticated(OWNER_A, WS_A)
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    const sample = await createSample(ownerA, PROJ_A, 'Isolated', {
      quantity: 5,
      quantityUnit: 'mL',
      storageLocation: 'Freezer A',
    })
    // Workspace B cannot see or consume A's sample (RLS hides the row; the
    // RPC's SELECT ... FOR UPDATE finds nothing).
    await expect(
      ownerB.query(
        `SELECT * FROM api.consume_sample(p_record_id => $1, p_quantity => 1, p_expected_metadata_version => $2)`,
        [sample.id, 1],
      ),
    ).rejects.toMatchObject({ code: '42501' })
    // B sees no events for A's sample.
    const { rows: bEvents } = await ownerB.query(
      `SELECT * FROM api.sample_events WHERE record_id = $1`,
      [sample.id],
    )
    expect(bEvents).toHaveLength(0)
    // A still has its full quantity.
    const { rows: aRow } = await ownerA.query(
      `SELECT properties FROM api.records WHERE id = $1`,
      [sample.id],
    )
    expect(Number(aRow[0].properties.quantity)).toBe(5)
  })
})
