/**
 * REG-003 integration proof: the `record_reagent_movement` controlled mutation
 * RPC, the `reagent_attention_summary` server-derived counts, and the
 * `reagent_movements` ledger. Covers receive, consume, quarantine, restore,
 * over-consume rejection, low-stock/expiry derivation from configured
 * thresholds, archived/invalid/non-reagent rejection, optimistic concurrency,
 * and audit attribution.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { grantProjectAccess, prepareTestDatabase } from './helpers'

const WS_A = '00000000-0000-4000-8000-00000000330a'
const WS_B = '00000000-0000-4000-8000-00000000330b'
const PROJ_A = '00000000-0000-4000-8000-00000000331a'
const OWNER_A = 'reg003-owner-a'
const MEMBER_A = 'reg003-member-a'
const OWNER_B = 'reg003-owner-b'

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

async function createReagent(
  client: Client,
  project: string,
  title: string,
  status = 'available',
  properties: Record<string, unknown> = {},
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `SELECT * FROM api.create_record($1::uuid, 'reagent', $2, $3, ARRAY[]::text[], $4::jsonb)`,
    [project, title, status, JSON.stringify(properties)],
  )
  return rows[0]
}

async function move(
  client: Client,
  recordId: string,
  operation: string,
  quantityDelta: number | null,
  expectedVersion: number,
  reason: string | null = null,
): Promise<{ movement: Record<string, any>; record: Record<string, any> }> {
  const { rows } = await client.query(
    `SELECT * FROM api.record_reagent_movement($1, $2, $3, $4, $5)`,
    [recordId, operation, expectedVersion, quantityDelta ?? 0, reason],
  )
  return rows[0].record_reagent_movement
}

async function movementsFor(
  client: Client,
  recordId: string,
): Promise<Record<string, any>[]> {
  const { rows } = await client.query(
    `SELECT * FROM api.reagent_movements WHERE reagent_record_id=$1 ORDER BY created_at`,
    [recordId],
  )
  return rows
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${OWNER_A}', 'REG-003 Owner A', 'reg003-owner-a@sheetbase.test', true),
      ('${MEMBER_A}', 'REG-003 Member A', 'reg003-member-a@sheetbase.test', true),
      ('${OWNER_B}', 'REG-003 Owner B', 'reg003-owner-b@sheetbase.test', true);
     INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS_A}', 'reg003-a', 'REG-003 A'),
      ('${WS_B}', 'reg003-b', 'REG-003 B');
     INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS_A}', '${OWNER_A}', 'owner'),
      ('${WS_A}', '${MEMBER_A}', 'member'),
      ('${WS_B}', '${OWNER_B}', 'owner');
     INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES
      ('${PROJ_A}', '${WS_A}', 'reg003-a', 'REG-003 A', '${OWNER_A}')`,
  )

  await grantProjectAccess(migrator, {
    workspaceId: WS_A,
    projectId: PROJ_A,
    userId: MEMBER_A,
    canView: true,
    canEdit: true,
  })
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('record_reagent_movement — receive', () => {
  it('increases quantity, sets status to available, and writes a ledger snapshot', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const reagent = await createReagent(
      owner,
      PROJ_A,
      'Acetonitrile',
      'available',
      {
        supplier: 'Sigma',
        catalog_no: 'A123',
        lot: 'L9',
        expiry: '2027-01-01',
        quantity: '5',
        unit: 'mL',
        storage: '-20 °C',
      },
    )

    const result = await move(
      owner,
      reagent.id,
      'receive',
      10,
      reagent.metadata_version,
      'PO-1',
    )
    expect(result.record.status).toBe('available')
    expect(result.record.metadata_version).toBe(reagent.metadata_version + 1)
    expect(Number(result.record.properties.quantity)).toBe(15)
    expect(result.movement.operation).toBe('receive')
    expect(Number(result.movement.quantity_delta)).toBe(10)
    expect(Number(result.movement.resulting_quantity)).toBe(15)
    expect(result.movement.supplier).toBe('Sigma')
    expect(result.movement.lot).toBe('L9')
    expect(result.movement.expiry).toBe('2027-01-01')

    const ledger = await movementsFor(owner, reagent.id)
    expect(ledger).toHaveLength(1)
    expect(ledger[0].supplier).toBe('Sigma')
  })

  it('restocks a consumed reagent back to available', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const reagent = await createReagent(
      owner,
      PROJ_A,
      'Consumed reagent',
      'consumed',
      {
        quantity: '0',
        unit: 'mL',
      },
    )
    const result = await move(
      owner,
      reagent.id,
      'receive',
      5,
      reagent.metadata_version,
    )
    expect(result.record.status).toBe('available')
    expect(Number(result.record.properties.quantity)).toBe(5)
  })

  it('rejects receive on a quarantined reagent', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const reagent = await createReagent(
      owner,
      PROJ_A,
      'Quarantined receive',
      'available',
      {
        quantity: '3',
      },
    )
    await move(owner, reagent.id, 'quarantine', null, reagent.metadata_version)
    const quarantined = await owner.query(
      `SELECT metadata_version FROM api.records WHERE id=$1`,
      [reagent.id],
    )
    await expect(
      move(
        owner,
        reagent.id,
        'receive',
        2,
        quarantined.rows[0].metadata_version,
      ),
    ).rejects.toMatchObject({ code: 'SB004' })
  })
})

describe('record_reagent_movement — consume', () => {
  it('decreases quantity and writes a negative delta', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const reagent = await createReagent(
      owner,
      PROJ_A,
      'Consume me',
      'available',
      {
        quantity: '10',
        unit: 'mL',
      },
    )
    const result = await move(
      owner,
      reagent.id,
      'consume',
      4,
      reagent.metadata_version,
      'EXP-1',
    )
    expect(Number(result.record.properties.quantity)).toBe(6)
    expect(Number(result.movement.quantity_delta)).toBe(-4)
    expect(Number(result.movement.resulting_quantity)).toBe(6)
    expect(result.record.status).toBe('available')
  })

  it('sets status to consumed when quantity reaches zero', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const reagent = await createReagent(
      owner,
      PROJ_A,
      'Drain to zero',
      'available',
      {
        quantity: '5',
      },
    )
    const result = await move(
      owner,
      reagent.id,
      'consume',
      5,
      reagent.metadata_version,
    )
    expect(Number(result.record.properties.quantity)).toBe(0)
    expect(result.record.status).toBe('consumed')
  })

  it('rejects over-consume with insufficient_stock', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const reagent = await createReagent(
      owner,
      PROJ_A,
      'Over consume',
      'available',
      {
        quantity: '3',
      },
    )
    await expect(
      move(owner, reagent.id, 'consume', 10, reagent.metadata_version),
    ).rejects.toMatchObject({ code: 'SB006' })
  })
})

describe('record_reagent_movement — quarantine and restore', () => {
  it('quarantines an available reagent without changing quantity', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const reagent = await createReagent(
      owner,
      PROJ_A,
      'Quarantine me',
      'available',
      {
        quantity: '7',
      },
    )
    const result = await move(
      owner,
      reagent.id,
      'quarantine',
      null,
      reagent.metadata_version,
    )
    expect(result.record.status).toBe('quarantined')
    expect(Number(result.movement.quantity_delta)).toBe(0)
    expect(Number(result.movement.resulting_quantity)).toBe(7)
  })

  it('restores a quarantined reagent to available', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const reagent = await createReagent(
      owner,
      PROJ_A,
      'Restore me',
      'available',
      {
        quantity: '7',
      },
    )
    const quarantined = await move(
      owner,
      reagent.id,
      'quarantine',
      null,
      reagent.metadata_version,
    )
    const result = await move(
      owner,
      reagent.id,
      'restore',
      null,
      quarantined.record.metadata_version,
    )
    expect(result.record.status).toBe('available')
    expect(result.movement.operation).toBe('restore')
  })

  it('rejects quarantine of a non-available reagent', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const reagent = await createReagent(
      owner,
      PROJ_A,
      'Reserved quarantine',
      'reserved',
      {
        quantity: '1',
      },
    )
    await expect(
      move(owner, reagent.id, 'quarantine', null, reagent.metadata_version),
    ).rejects.toMatchObject({ code: 'SB004' })
  })
})

describe('record_reagent_movement — guards', () => {
  it('rejects non-reagent records', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const { rows } = await owner.query(
      `SELECT * FROM api.create_record($1::uuid, 'sample', 'Not a reagent', 'available', ARRAY[]::text[], '{}'::jsonb)`,
      [PROJ_A],
    )
    await expect(
      move(owner, rows[0].id, 'receive', 1, rows[0].metadata_version),
    ).rejects.toMatchObject({ code: 'SB004' })
  })

  it('rejects archived reagents as frozen', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const reagent = await createReagent(
      owner,
      PROJ_A,
      'Archive then move',
      'available',
      {
        quantity: '2',
      },
    )
    const { rows: archived } = await owner.query(
      `SELECT * FROM api.archive_record($1, $2)`,
      [reagent.id, reagent.metadata_version],
    )
    await expect(
      move(owner, reagent.id, 'receive', 1, archived[0].metadata_version),
    ).rejects.toMatchObject({ code: 'SB004' })
  })

  it('rejects stale metadata versions (optimistic concurrency)', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const reagent = await createReagent(
      owner,
      PROJ_A,
      'Stale move',
      'available',
      {
        quantity: '2',
      },
    )
    await move(owner, reagent.id, 'receive', 1, reagent.metadata_version)
    // Reuse the original (now stale) version.
    await expect(
      move(owner, reagent.id, 'receive', 1, reagent.metadata_version),
    ).rejects.toMatchObject({ code: 'SB001' })
  })

  it('rejects cross-workspace reagents', async () => {
    const ownerA = await asAuthenticated(OWNER_A, WS_A)
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    const reagent = await createReagent(
      ownerA,
      PROJ_A,
      'Cross ws',
      'available',
      {
        quantity: '2',
      },
    )
    await expect(
      move(ownerB, reagent.id, 'receive', 1, reagent.metadata_version),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('attributes the actor on the ledger row', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const reagent = await createReagent(
      owner,
      PROJ_A,
      'Attributed',
      'available',
      {
        quantity: '1',
      },
    )
    await move(owner, reagent.id, 'receive', 1, reagent.metadata_version)
    const ledger = await movementsFor(owner, reagent.id)
    expect(ledger[0].actor_user_id).toBe(OWNER_A)
  })
})

describe('reagent_attention_summary — threshold-derived counts', () => {
  it('counts low stock, near expiry, expired and quarantined from properties', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    // Use a dedicated project so these reagents don't collide with other tests.
    const attnProject = '00000000-0000-4000-8000-00000000339a'
    // No RETURNING: the owner rule is created by an AFTER INSERT trigger, and
    // the new row is only readable once that trigger has run.
    await owner.query(
      `INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES ($1, $2, 'reg003-attn', 'REG-003 Attn', $3)`,
      [attnProject, WS_A, OWNER_A],
    )

    // Low stock: quantity at threshold.
    await createReagent(owner, attnProject, 'Low stock', 'available', {
      quantity: '1',
      low_stock_threshold: '5',
    })
    // Near expiry: within 30 days.
    const near = new Date()
    near.setUTCDate(near.getUTCDate() + 10)
    await createReagent(owner, attnProject, 'Near expiry', 'available', {
      expiry: near.toISOString().slice(0, 10),
    })
    // Expired: past expiry.
    await createReagent(owner, attnProject, 'Expired', 'available', {
      expiry: '2020-01-01',
    })
    // Quarantined.
    const quarantined = await createReagent(
      owner,
      attnProject,
      'Quarantined',
      'available',
      {
        quantity: '5',
      },
    )
    await move(
      owner,
      quarantined.id,
      'quarantine',
      null,
      quarantined.metadata_version,
    )
    // OK reagent.
    await createReagent(owner, attnProject, 'Healthy', 'available', {
      quantity: '100',
    })

    const { rows } = await owner.query(
      `SELECT * FROM api.reagent_attention_summary(30)`,
    )
    const summary = rows[0].reagent_attention_summary
    expect(Number(summary.total)).toBeGreaterThanOrEqual(5)
    expect(Number(summary.lowStock)).toBeGreaterThanOrEqual(1)
    expect(Number(summary.nearExpiry)).toBeGreaterThanOrEqual(1)
    expect(Number(summary.expired)).toBeGreaterThanOrEqual(1)
    expect(Number(summary.quarantined)).toBeGreaterThanOrEqual(1)
  })

  it('returns zeros for a non-member / no-workspace context', async () => {
    // WS_B owner querying with no reagents in WS_B.
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    const { rows } = await ownerB.query(
      `SELECT * FROM api.reagent_attention_summary(30)`,
    )
    expect(rows[0].reagent_attention_summary).toMatchObject({
      total: 0,
      lowStock: 0,
      nearExpiry: 0,
      expired: 0,
      quarantined: 0,
    })
  })
})

describe('reagent_movements — ledger preservation', () => {
  it('preserves historical supplier/lot snapshot after the record is updated', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const reagent = await createReagent(
      owner,
      PROJ_A,
      'Snapshot preservation',
      'available',
      {
        supplier: 'Old Supplier',
        lot: 'LOT-OLD',
        quantity: '10',
        unit: 'mL',
      },
    )
    // Record a movement with the original supplier/lot.
    const first = await move(
      owner,
      reagent.id,
      'receive',
      5,
      reagent.metadata_version,
    )
    expect(first.movement.supplier).toBe('Old Supplier')
    expect(first.movement.lot).toBe('LOT-OLD')

    // Update the reagent's supplier/lot via the controlled mutation path
    // (metadata version bumped by the first move). We use a direct properties
    // update through create_record is not available; instead update via
    // transition + property patch through the records table as the owner.
    const updatedVersion = first.record.metadata_version
    await owner.query(
      `UPDATE api.records SET properties = properties || '{"supplier":"New Supplier","lot":"LOT-NEW"}'::jsonb, metadata_version = metadata_version + 1 WHERE id = $1`,
      [reagent.id],
    )

    // Record a second movement — its snapshot should use the NEW values.
    const fresh = await owner.query(
      `SELECT metadata_version FROM api.records WHERE id=$1`,
      [reagent.id],
    )
    const second = await move(
      owner,
      reagent.id,
      'consume',
      3,
      fresh.rows[0].metadata_version,
    )
    expect(second.movement.supplier).toBe('New Supplier')
    expect(second.movement.lot).toBe('LOT-NEW')

    // The first ledger row still has the OLD snapshot.
    const ledger = await movementsFor(owner, reagent.id)
    expect(ledger).toHaveLength(2)
    expect(ledger[0].supplier).toBe('Old Supplier')
    expect(ledger[0].lot).toBe('LOT-OLD')
    expect(ledger[1].supplier).toBe('New Supplier')
    expect(ledger[1].lot).toBe('LOT-NEW')
  })
})
