/**
 * OPS-002 integration proof: storage hierarchy, transactional sample moves,
 * double-occupation prevention under concurrency, capacity enforcement,
 * quarantine/missing position guards, barcode lookup and movement/custody
 * history. Runs against a freshly migrated sheetbase_test database.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS_A = '00000000-0000-4000-8000-00000000202a'
const WS_B = '00000000-0000-4000-8000-00000000202b'
const PROJ_A = '00000000-0000-4000-8000-00000000213a'
const PROJ_B = '00000000-0000-4000-8000-00000000213b'
const OWNER_A = 'ops002-owner-a'
const MEMBER_A = 'ops002-member-a'
const OWNER_B = 'ops002-owner-b'

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

async function buildHierarchy(
  client: Client,
  workspaceId: string,
  suffix = '',
): Promise<{
  site: string
  room: string
  unit: string
  shelf: string
  rack: string
  box: string
  positions: Record<string, string>
}> {
  const sfx = (base: string) => (suffix ? `${base}-${suffix}` : base)
  const { rows: siteRows } = await client.query(
    `INSERT INTO api.storage_sites (workspace_id, name, code, capacity)
     VALUES ($1, $2, $3, 10) RETURNING id`,
    [workspaceId, `Main Site ${suffix}`.trim(), sfx('MS')],
  )
  const site = siteRows[0].id
  const { rows: roomRows } = await client.query(
    `INSERT INTO api.storage_rooms (workspace_id, site_id, name, code, capacity)
     VALUES ($1, $2, $3, $4, 10) RETURNING id`,
    [workspaceId, site, `Cold Room ${suffix}`.trim(), sfx('CR')],
  )
  const room = roomRows[0].id
  const { rows: unitRows } = await client.query(
    `INSERT INTO api.storage_units (workspace_id, room_id, name, code, unit_type, temperature_min_c, temperature_max_c, capacity)
     VALUES ($1, $2, $3, $4, 'freezer', -80, -60, 4) RETURNING id`,
    [workspaceId, room, `Freezer A ${suffix}`.trim(), sfx('FA')],
  )
  const unit = unitRows[0].id
  const { rows: shelfRows } = await client.query(
    `INSERT INTO api.storage_shelves (workspace_id, unit_id, name, position, capacity)
     VALUES ($1, $2, $3, 1, 4) RETURNING id`,
    [workspaceId, unit, `Shelf 1 ${suffix}`.trim()],
  )
  const shelf = shelfRows[0].id
  const { rows: rackRows } = await client.query(
    `INSERT INTO api.storage_racks (workspace_id, shelf_id, name, position, capacity)
     VALUES ($1, $2, $3, 1, 4) RETURNING id`,
    [workspaceId, shelf, `Rack 1 ${suffix}`.trim()],
  )
  const rack = rackRows[0].id
  const { rows: boxRows } = await client.query(
    `SELECT * FROM api.create_storage_box($1, $2, $3, $4, 2, 3, '{}'::jsonb)`,
    [workspaceId, rack, `Box 1 ${suffix}`.trim(), sfx('BX1')],
  )
  const box = boxRows[0].id
  const { rows: posRows } = await client.query(
    `SELECT id, label FROM api.storage_positions WHERE box_id = $1 ORDER BY row_index, col_index`,
    [box],
  )
  const positions: Record<string, string> = {}
  for (const p of posRows) positions[p.label] = p.id
  return { site, room, unit, shelf, rack, box, positions }
}

// Unique suffix source so each buildHierarchy call within a workspace gets
// distinct storage codes (the (workspace_id, code) unique constraint would
// otherwise collide across tests sharing the same DB).
let hierarchySeq = 0
function nextSuffix(): string {
  hierarchySeq += 1
  return String(hierarchySeq)
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${OWNER_A}', 'OPS002 Owner A', 'ops002-owner-a@sheetbase.test', true),
      ('${MEMBER_A}', 'OPS002 Member A', 'ops002-member-a@sheetbase.test', true),
      ('${OWNER_B}', 'OPS002 Owner B', 'ops002-owner-b@sheetbase.test', true);
     INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS_A}', 'ops002-a', 'OPS002 A'),
      ('${WS_B}', 'ops002-b', 'OPS002 B');
     INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS_A}', '${OWNER_A}', 'owner'),
      ('${WS_A}', '${MEMBER_A}', 'member'),
      ('${WS_B}', '${OWNER_B}', 'owner');
     INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES
      ('${PROJ_A}', '${WS_A}', 'ops-a', 'OPS A', '${OWNER_A}'),
      ('${PROJ_B}', '${WS_B}', 'ops-b', 'OPS B', '${OWNER_B}')`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('OPS-002 storage hierarchy and box generation', () => {
  it('creates a box with a rows*cols position grid via the RPC', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const h = await buildHierarchy(owner, WS_A, nextSuffix())
    expect(Object.keys(h.positions).sort()).toEqual(
      ['A1', 'A2', 'A3', 'B1', 'B2', 'B3'].sort(),
    )
    const { rows: boxRow } = await owner.query(
      `SELECT rows, cols, capacity FROM api.storage_boxes WHERE id = $1`,
      [h.box],
    )
    expect(boxRow[0].capacity).toBe(6)
    const { rows: posRows } = await owner.query(
      `SELECT status FROM api.storage_positions WHERE box_id = $1`,
      [h.box],
    )
    expect(posRows.every((r) => r.status === 'available')).toBe(true)
  })

  it('RLS isolates storage rows by workspace', async () => {
    const ownerA = await asAuthenticated(OWNER_A, WS_A)
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    await buildHierarchy(ownerA, WS_A, nextSuffix())
    const { rows: bSites } = await ownerB.query(
      `SELECT * FROM api.storage_sites`,
    )
    expect(bSites).toHaveLength(0)
  })
})

describe('OPS-002 transactional sample moves', () => {
  it('places a sample into a position and updates storageLocation', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const h = await buildHierarchy(owner, WS_A, nextSuffix())
    const sample = await createSample(owner, PROJ_A, 'Plasma 1', {
      quantity: 2,
      quantityUnit: 'mL',
      barcode: 'BC-PLACE-1',
    })
    const { rows } = await owner.query(
      `SELECT * FROM api.move_sample_to_position($1, $2, $3, 'first placement')`,
      [sample.id, h.positions.A1, sample.metadata_version],
    )
    expect(rows[0].properties.storageLocation).toContain('A1')
    expect(rows[0].properties.storageLocation).toContain('Freezer A')

    const { rows: posRows } = await owner.query(
      `SELECT status, occupied_record_id FROM api.storage_positions WHERE id = $1`,
      [h.positions.A1],
    )
    expect(posRows[0].status).toBe('occupied')
    expect(posRows[0].occupied_record_id).toBe(sample.id)
  })

  it('prevents double occupation: two samples cannot take the same position', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const h = await buildHierarchy(owner, WS_A, nextSuffix())
    const s1 = await createSample(owner, PROJ_A, 'Double 1', { barcode: 'D1' })
    const s2 = await createSample(owner, PROJ_A, 'Double 2', { barcode: 'D2' })
    await owner.query(`SELECT * FROM api.move_sample_to_position($1, $2, $3)`, [
      s1.id,
      h.positions.A1,
      s1.metadata_version,
    ])
    await expect(
      owner.query(`SELECT * FROM api.move_sample_to_position($1, $2, $3)`, [
        s2.id,
        h.positions.A1,
        s2.metadata_version,
      ]),
    ).rejects.toMatchObject({ code: 'SB010' })
    // First sample still occupies; second sample did not take the slot.
    const { rows: posRows } = await owner.query(
      `SELECT occupied_record_id FROM api.storage_positions WHERE id = $1`,
      [h.positions.A1],
    )
    expect(posRows[0].occupied_record_id).toBe(s1.id)
  })

  it('moves a sample between positions and clears the previous one', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const h = await buildHierarchy(owner, WS_A, nextSuffix())
    const sample = await createSample(owner, PROJ_A, 'Movable', {
      barcode: 'MV',
    })
    const placed = await owner.query(
      `SELECT * FROM api.move_sample_to_position($1, $2, $3)`,
      [sample.id, h.positions.A1, sample.metadata_version],
    )
    const moved = await owner.query(
      `SELECT * FROM api.move_sample_to_position($1, $2, $3, 'relocated')`,
      [sample.id, h.positions.B2, placed.rows[0].metadata_version],
    )
    expect(moved.rows[0].properties.storageLocation).toContain('B2')
    const { rows: posRows } = await owner.query(
      `SELECT (SELECT status FROM api.storage_positions WHERE id = $1) AS a,
              (SELECT status FROM api.storage_positions WHERE id = $2) AS b`,
      [h.positions.A1, h.positions.B2],
    )
    expect(posRows[0].a).toBe('available')
    expect(posRows[0].b).toBe('occupied')
  })

  it('records storage_movements and a sample_events transfer row on each move', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const h = await buildHierarchy(owner, WS_A, nextSuffix())
    const sample = await createSample(owner, PROJ_A, 'Audited', {
      barcode: 'AU',
    })
    const placed = await owner.query(
      `SELECT * FROM api.move_sample_to_position($1, $2, $3)`,
      [sample.id, h.positions.A1, sample.metadata_version],
    )
    await owner.query(`SELECT * FROM api.move_sample_to_position($1, $2, $3)`, [
      sample.id,
      h.positions.A2,
      placed.rows[0].metadata_version,
    ])
    const { rows: moves } = await owner.query(
      `SELECT operation, from_path, to_path FROM api.storage_movements
       WHERE record_id = $1 ORDER BY created_at ASC`,
      [sample.id],
    )
    expect(moves.map((r) => r.operation)).toEqual(['place', 'move'])
    expect(moves[0].from_path).toBeNull()
    expect(moves[0].to_path).toContain('A1')
    expect(moves[1].from_path).toContain('A1')
    expect(moves[1].to_path).toContain('A2')

    // The chain of custody (sample_events) gets a transfer row per move so
    // the sample inspector and storage inspector agree.
    const { rows: events } = await owner.query(
      `SELECT operation, from_location, to_location FROM api.sample_events
       WHERE record_id = $1 AND operation = 'transfer' ORDER BY created_at ASC`,
      [sample.id],
    )
    expect(events).toHaveLength(2)
    expect(events[1].from_location).toContain('A1')
    expect(events[1].to_location).toContain('A2')
  })

  it('rejects a move to a position in a different workspace', async () => {
    const ownerA = await asAuthenticated(OWNER_A, WS_A)
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    const hB = await buildHierarchy(ownerB, WS_B, nextSuffix())
    const sampleA = await createSample(ownerA, PROJ_A, 'Cross WS', {
      barcode: 'XWS',
    })
    await expect(
      ownerA.query(`SELECT * FROM api.move_sample_to_position($1, $2, $3)`, [
        sampleA.id,
        hB.positions.A1,
        sampleA.metadata_version,
      ]),
    ).rejects.toMatchObject({ code: 'SB011' })
  })

  it('rejects a stale metadata version on move', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const h = await buildHierarchy(owner, WS_A, nextSuffix())
    const sample = await createSample(owner, PROJ_A, 'Stale', { barcode: 'ST' })
    await owner.query(`SELECT * FROM api.move_sample_to_position($1, $2, $3)`, [
      sample.id,
      h.positions.A1,
      sample.metadata_version,
    ])
    await expect(
      owner.query(`SELECT * FROM api.move_sample_to_position($1, $2, $3)`, [
        sample.id,
        h.positions.A2,
        sample.metadata_version,
      ]),
    ).rejects.toMatchObject({ code: 'SB001' })
  })
})

describe('OPS-002 concurrent moves are serialised', () => {
  it('two concurrent moves of the same sample to different positions: only one wins, no double occupancy', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const h = await buildHierarchy(owner, WS_A, nextSuffix())
    const sample = await createSample(owner, PROJ_A, 'Concurrent', {
      barcode: 'CC',
    })
    // Two simultaneous moves from the same starting state. The row lock on the
    // sample serialises them: the winner moves the sample; the loser sees a
    // stale metadata_version (SB001) or an already-occupied target (SB010).
    const [r1, r2] = await Promise.allSettled([
      owner.query(`SELECT * FROM api.move_sample_to_position($1, $2, $3)`, [
        sample.id,
        h.positions.A1,
        sample.metadata_version,
      ]),
      owner.query(`SELECT * FROM api.move_sample_to_position($1, $2, $3)`, [
        sample.id,
        h.positions.A2,
        sample.metadata_version,
      ]),
    ])
    const ok = [r1, r2].filter((r) => r.status === 'fulfilled').length
    const failed = [r1, r2].filter(
      (r) =>
        r.status === 'rejected' &&
        (r.reason.code === 'SB001' || r.reason.code === 'SB010'),
    ).length
    expect(ok).toBe(1)
    expect(failed).toBe(1)
    // The sample occupies exactly one position.
    const { rows: occ } = await owner.query(
      `SELECT count(*)::int AS n FROM api.storage_positions
       WHERE occupied_record_id = $1`,
      [sample.id],
    )
    expect(occ[0].n).toBe(1)
  })

  it('two concurrent moves of different samples into the SAME position: only one wins', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const h = await buildHierarchy(owner, WS_A, nextSuffix())
    const s1 = await createSample(owner, PROJ_A, 'Concurrent A', {
      barcode: 'CA',
    })
    const s2 = await createSample(owner, PROJ_A, 'Concurrent B', {
      barcode: 'CB',
    })
    const [r1, r2] = await Promise.allSettled([
      owner.query(`SELECT * FROM api.move_sample_to_position($1, $2, $3)`, [
        s1.id,
        h.positions.A1,
        s1.metadata_version,
      ]),
      owner.query(`SELECT * FROM api.move_sample_to_position($1, $2, $3)`, [
        s2.id,
        h.positions.A1,
        s2.metadata_version,
      ]),
    ])
    const ok = [r1, r2].filter((r) => r.status === 'fulfilled').length
    const blocked = [r1, r2].filter(
      (r) => r.status === 'rejected' && r.reason.code === 'SB010',
    ).length
    expect(ok).toBe(1)
    expect(blocked).toBe(1)
    const { rows: occ } = await owner.query(
      `SELECT occupied_record_id FROM api.storage_positions WHERE id = $1`,
      [h.positions.A1],
    )
    expect([s1.id, s2.id]).toContain(occ[0].occupied_record_id)
  })
})

describe('OPS-002 capacity enforcement', () => {
  it('rejects a new child when the parent capacity is reached', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const { rows: siteRows } = await owner.query(
      `INSERT INTO api.storage_sites (workspace_id, name, code, capacity)
       VALUES ($1, 'Cap Site', 'CS', 1) RETURNING id`,
      [WS_A],
    )
    await owner.query(
      `INSERT INTO api.storage_rooms (workspace_id, site_id, name, code, capacity)
       VALUES ($1, $2, 'Room 1', 'R1', 0)`,
      [WS_A, siteRows[0].id],
    )
    await expect(
      owner.query(
        `INSERT INTO api.storage_rooms (workspace_id, site_id, name, code, capacity)
         VALUES ($1, $2, 'Room 2', 'R2', 0)`,
        [WS_A, siteRows[0].id],
      ),
    ).rejects.toMatchObject({ code: 'SB014' })
  })

  it('capacity = 0 means unlimited', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const { rows: siteRows } = await owner.query(
      `INSERT INTO api.storage_sites (workspace_id, name, code, capacity)
       VALUES ($1, 'Unlim Site', 'US', 0) RETURNING id`,
      [WS_A],
    )
    for (let i = 0; i < 3; i++) {
      await owner.query(
        `INSERT INTO api.storage_rooms (workspace_id, site_id, name, code, capacity)
         VALUES ($1, $2, $3, $4, 0)`,
        [WS_A, siteRows[0].id, `Room ${i}`, `UR${i}`],
      )
    }
    const { rows } = await owner.query(
      `SELECT count(*)::int AS n FROM api.storage_rooms WHERE site_id = $1`,
      [siteRows[0].id],
    )
    expect(rows[0].n).toBe(3)
  })
})

describe('OPS-002 quarantine and missing positions', () => {
  it('refuses to move a sample into a quarantined position', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const h = await buildHierarchy(owner, WS_A, nextSuffix())
    await owner.query(
      `SELECT * FROM api.set_position_status($1, 'quarantined')`,
      [h.positions.A1],
    )
    const sample = await createSample(owner, PROJ_A, 'Quarantine test', {
      barcode: 'QT',
    })
    await expect(
      owner.query(`SELECT * FROM api.move_sample_to_position($1, $2, $3)`, [
        sample.id,
        h.positions.A1,
        sample.metadata_version,
      ]),
    ).rejects.toMatchObject({ code: 'SB013' })
  })

  it('refuses to quarantine a position that holds a sample', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const h = await buildHierarchy(owner, WS_A, nextSuffix())
    const sample = await createSample(owner, PROJ_A, 'Occ holder', {
      barcode: 'OH',
    })
    await owner.query(`SELECT * FROM api.move_sample_to_position($1, $2, $3)`, [
      sample.id,
      h.positions.A1,
      sample.metadata_version,
    ])
    await expect(
      owner.query(`SELECT * FROM api.set_position_status($1, 'quarantined')`, [
        h.positions.A1,
      ]),
    ).rejects.toMatchObject({ code: 'SB013' })
  })

  it('marks a position missing and restores it', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const h = await buildHierarchy(owner, WS_A, nextSuffix())
    const { rows: missing } = await owner.query(
      `SELECT * FROM api.set_position_status($1, 'missing')`,
      [h.positions.A1],
    )
    expect(missing[0].status).toBe('missing')
    const sample = await createSample(owner, PROJ_A, 'Missing test', {
      barcode: 'MS',
    })
    await expect(
      owner.query(`SELECT * FROM api.move_sample_to_position($1, $2, $3)`, [
        sample.id,
        h.positions.A1,
        sample.metadata_version,
      ]),
    ).rejects.toMatchObject({ code: 'SB013' })
    const { rows: restored } = await owner.query(
      `SELECT * FROM api.set_position_status($1, 'available')`,
      [h.positions.A1],
    )
    expect(restored[0].status).toBe('available')
  })

  it('remove_sample_from_position clears occupancy and storageLocation', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const h = await buildHierarchy(owner, WS_A, nextSuffix())
    const sample = await createSample(owner, PROJ_A, 'Removable', {
      barcode: 'RM',
    })
    const placed = await owner.query(
      `SELECT * FROM api.move_sample_to_position($1, $2, $3)`,
      [sample.id, h.positions.A1, sample.metadata_version],
    )
    const removed = await owner.query(
      `SELECT * FROM api.remove_sample_from_position($1, $2, 'checked out')`,
      [sample.id, placed.rows[0].metadata_version],
    )
    expect(removed.rows[0].properties.storageLocation).toBeUndefined()
    const { rows: pos } = await owner.query(
      `SELECT status FROM api.storage_positions WHERE id = $1`,
      [h.positions.A1],
    )
    expect(pos[0].status).toBe('available')
    const { rows: mvmt } = await owner.query(
      `SELECT operation FROM api.storage_movements WHERE record_id = $1 ORDER BY created_at ASC`,
      [sample.id],
    )
    expect(mvmt.map((r) => r.operation)).toEqual(['place', 'remove'])
  })
})

describe('OPS-002 barcode lookup', () => {
  it('lookup_sample_by_barcode returns the active sample in the workspace', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    await createSample(owner, PROJ_A, 'Barcode target', { barcode: 'LOOKUP-1' })
    const { rows } = await owner.query(
      `SELECT * FROM api.lookup_sample_by_barcode('LOOKUP-1')`,
    )
    expect(rows[0]).not.toBeNull()
    expect(rows[0].properties.barcode).toBe('LOOKUP-1')
  })

  it('lookup returns null for an unknown barcode', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const { rows } = await owner.query(
      `SELECT * FROM api.lookup_sample_by_barcode('NOPE')`,
    )
    expect(rows).toHaveLength(0)
  })

  it('lookup does not surface samples from another workspace', async () => {
    const ownerA = await asAuthenticated(OWNER_A, WS_A)
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    await createSample(ownerA, PROJ_A, 'A only', { barcode: 'ISOLATED' })
    const { rows } = await ownerB.query(
      `SELECT * FROM api.lookup_sample_by_barcode('ISOLATED')`,
    )
    expect(rows).toHaveLength(0)
  })
})

describe('OPS-002 custody history is complete', () => {
  it('a sample moved through three positions has a continuous movement and custody trail', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const h = await buildHierarchy(owner, WS_A, nextSuffix())
    const sample = await createSample(owner, PROJ_A, 'Trail', { barcode: 'TR' })
    let v = sample.metadata_version
    const seq = [h.positions.A1, h.positions.B1, h.positions.A2]
    for (const posId of seq) {
      const { rows } = await owner.query(
        `SELECT * FROM api.move_sample_to_position($1, $2, $3)`,
        [sample.id, posId, v],
      )
      v = rows[0].metadata_version
    }
    const { rows: moves } = await owner.query(
      `SELECT operation, to_path FROM api.storage_movements
       WHERE record_id = $1 ORDER BY created_at ASC`,
      [sample.id],
    )
    expect(moves.map((r) => r.operation)).toEqual(['place', 'move', 'move'])
    expect(moves.map((r) => r.to_path)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('A1'),
        expect.stringContaining('B1'),
        expect.stringContaining('A2'),
      ]),
    )
    const { rows: events } = await owner.query(
      `SELECT count(*)::int AS n FROM api.sample_events
       WHERE record_id = $1 AND operation = 'transfer'`,
      [sample.id],
    )
    expect(events[0].n).toBe(3)
    // Final state: exactly one position occupied.
    const { rows: occ } = await owner.query(
      `SELECT count(*)::int AS n FROM api.storage_positions
       WHERE occupied_record_id = $1`,
      [sample.id],
    )
    expect(occ[0].n).toBe(1)
  })
})
