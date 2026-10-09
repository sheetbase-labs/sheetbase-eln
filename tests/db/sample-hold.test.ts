/**
 * LAB-02 step 1 integration proof: sample hold-limit fields round-trip, the
 * scheduled sweep moves samples past their hold limit to `hold_exceeded` with a
 * System `sample_events` audit row, samples within their limit are untouched,
 * the allowed-use list is enforced at withdrawal, and every read/write stays
 * workspace-scoped. Runs against a freshly migrated sheetbase_test database.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS_A = '00000000-0000-4000-8000-00000000210a'
const WS_B = '00000000-0000-4000-8000-00000000210b'
const PROJ_A = '00000000-0000-4000-8000-00000000221a'
const PROJ_B = '00000000-0000-4000-8000-00000000221b'
const OWNER_A = 'lab002-owner-a'
const MEMBER_A = 'lab002-member-a'
const OWNER_B = 'lab002-owner-b'
const ALLOWED_EXP = '00000000-0000-4000-8000-0000000022aa'
const OTHER_EXP = '00000000-0000-4000-8000-0000000022ab'

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

/** ISO timestamp `days` in the past, so the hold deadline is already passed. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${OWNER_A}', 'LAB002 Owner A', 'lab002-owner-a@sheetbase.test', true),
      ('${MEMBER_A}', 'LAB002 Member A', 'lab002-member-a@sheetbase.test', true),
      ('${OWNER_B}', 'LAB002 Owner B', 'lab002-owner-b@sheetbase.test', true);
     INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS_A}', 'lab002-a', 'LAB002 A'),
      ('${WS_B}', 'lab002-b', 'LAB002 B');
     INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS_A}', '${OWNER_A}', 'owner'),
      ('${WS_A}', '${MEMBER_A}', 'member'),
      ('${WS_B}', '${OWNER_B}', 'owner');
     INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES
      ('${PROJ_A}', '${WS_A}', 'lab-a', 'LAB A', '${OWNER_A}'),
      ('${PROJ_B}', '${WS_B}', 'lab-b', 'LAB B', '${OWNER_B}')`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('LAB-02 hold-limit fields', () => {
  it('round-trips the hold condition, start, duration, deadline and allowed uses', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const sample = await createSample(owner, PROJ_A, 'Hold fields', {
      quantity: 10,
      quantityUnit: 'mL',
      holdCondition: '2-8 C',
      holdStartedAt: '2026-09-20T00:00:00.000Z',
      holdDurationDays: 14,
      holdUntil: '2026-10-04T00:00:00.000Z',
      allowedUseExperimentIds: [ALLOWED_EXP],
    })
    const { rows } = await owner.query(
      `SELECT properties FROM api.records WHERE id = $1`,
      [sample.id],
    )
    const props = rows[0].properties
    expect(props.holdCondition).toBe('2-8 C')
    expect(props.holdStartedAt).toBe('2026-09-20T00:00:00.000Z')
    expect(Number(props.holdDurationDays)).toBe(14)
    expect(props.holdUntil).toBe('2026-10-04T00:00:00.000Z')
    expect(props.allowedUseExperimentIds).toEqual([ALLOWED_EXP])
  })

  it('edits hold fields through edit_sample', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const sample = await createSample(owner, PROJ_A, 'Editable hold', {
      quantity: 5,
    })
    const { rows } = await owner.query(
      `SELECT * FROM api.edit_sample($1, $2, NULL, $3::jsonb, NULL, 'set hold')`,
      [
        sample.id,
        sample.metadata_version,
        JSON.stringify({
          holdCondition: '-80 C',
          holdDurationDays: 30,
          allowedUseExperimentIds: [ALLOWED_EXP, OTHER_EXP],
        }),
      ],
    )
    expect(rows[0].properties.holdCondition).toBe('-80 C')
    expect(Number(rows[0].properties.holdDurationDays)).toBe(30)
    expect(rows[0].properties.allowedUseExperimentIds).toEqual([
      ALLOWED_EXP,
      OTHER_EXP,
    ])
  })
})

describe('LAB-02 scheduled hold sweep', () => {
  it('moves only samples past their limit to hold_exceeded with a System event', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const past = await createSample(owner, PROJ_A, 'Past hold', {
      quantity: 10,
      quantityUnit: 'mL',
      holdCondition: '2-8 C',
      holdStartedAt: daysAgo(10),
      holdDurationDays: 3,
    })
    const within = await createSample(owner, PROJ_A, 'Within hold', {
      quantity: 10,
      quantityUnit: 'mL',
      holdCondition: '2-8 C',
      holdStartedAt: daysAgo(1),
      holdDurationDays: 30,
    })

    const { rows: swept } = await migrator.query(
      `SELECT api.sweep_sample_hold_limits(100) AS result`,
    )
    expect(swept[0].result.exceededCount).toBeGreaterThanOrEqual(1)

    const { rows: pastRow } = await owner.query(
      `SELECT status, metadata_version FROM api.records WHERE id = $1`,
      [past.id],
    )
    expect(pastRow[0].status).toBe('hold_exceeded')
    expect(pastRow[0].metadata_version).toBe(past.metadata_version + 1)

    const { rows: withinRow } = await owner.query(
      `SELECT status FROM api.records WHERE id = $1`,
      [within.id],
    )
    expect(withinRow[0].status).toBe('available')

    // The transition is a canonical sample_event attributed to System (null).
    const { rows: events } = await owner.query(
      `SELECT operation, actor_user_id FROM api.sample_events
        WHERE record_id = $1 AND operation = 'hold_exceeded'`,
      [past.id],
    )
    expect(events).toHaveLength(1)
    expect(events[0].actor_user_id).toBeNull()
    // A change event carries the status transition too.
    const { rows: changes } = await owner.query(
      `SELECT payload FROM api.change_events
        WHERE entity_type = 'record' AND entity_uuid = $1
        ORDER BY sequence DESC LIMIT 1`,
      [past.id],
    )
    expect(changes[0].payload.changes.status).toEqual({
      from: 'available',
      to: 'hold_exceeded',
    })
  })

  it('is idempotent: a second sweep does not re-transition', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const past = await createSample(owner, PROJ_A, 'Once only', {
      quantity: 1,
      holdStartedAt: daysAgo(30),
      holdDurationDays: 1,
    })
    await migrator.query(`SELECT api.sweep_sample_hold_limits(100)`)
    await migrator.query(`SELECT api.sweep_sample_hold_limits(100)`)
    const { rows } = await owner.query(
      `SELECT count(*)::int AS n FROM api.sample_events
        WHERE record_id = $1 AND operation = 'hold_exceeded'`,
      [past.id],
    )
    expect(rows[0].n).toBe(1)
  })

  it('honours an explicit holdUntil deadline', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const future = await createSample(owner, PROJ_A, 'Future deadline', {
      quantity: 1,
      holdUntil: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    })
    const overdue = await createSample(owner, PROJ_A, 'Overdue deadline', {
      quantity: 1,
      holdUntil: daysAgo(1),
    })
    await migrator.query(`SELECT api.sweep_sample_hold_limits(100)`)
    const { rows } = await owner.query(
      `SELECT id, status FROM api.records WHERE id = ANY($1::uuid[])`,
      [[future.id, overdue.id]],
    )
    const byId = new Map(rows.map((r) => [r.id, r.status]))
    expect(byId.get(future.id)).toBe('available')
    expect(byId.get(overdue.id)).toBe('hold_exceeded')
  })
})

describe('LAB-02 allowed-use enforcement at withdrawal', () => {
  it('refuses withdrawal of a hold_exceeded sample unless the experiment is allowed', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const sample = await createSample(owner, PROJ_A, 'Restricted hold', {
      quantity: 10,
      quantityUnit: 'mL',
      holdStartedAt: daysAgo(10),
      holdDurationDays: 1,
      allowedUseExperimentIds: [ALLOWED_EXP],
    })
    await migrator.query(`SELECT api.sweep_sample_hold_limits(100)`)

    const { rows: held } = await owner.query(
      `SELECT status, metadata_version FROM api.records WHERE id = $1`,
      [sample.id],
    )
    expect(held[0].status).toBe('hold_exceeded')

    // No experiment context: refused.
    await expect(
      owner.query(
        `SELECT * FROM api.consume_sample(p_record_id => $1, p_quantity => 1, p_expected_metadata_version => $2)`,
        [sample.id, held[0].metadata_version],
      ),
    ).rejects.toMatchObject({ code: 'SB004' })

    // A different experiment: refused.
    await expect(
      owner.query(
        `SELECT * FROM api.consume_sample(p_record_id => $1, p_quantity => 1, p_expected_metadata_version => $2, p_experiment_id => $3)`,
        [sample.id, held[0].metadata_version, OTHER_EXP],
      ),
    ).rejects.toMatchObject({ code: 'SB004' })

    // An allowed experiment: permitted, quantity decremented.
    const { rows: consumed } = await owner.query(
      `SELECT * FROM api.consume_sample(p_record_id => $1, p_quantity => 2, p_expected_metadata_version => $2, p_experiment_id => $3)`,
      [sample.id, held[0].metadata_version, ALLOWED_EXP],
    )
    expect(Number(consumed[0].properties.quantity)).toBe(8)
  })
})

describe('LAB-02 workspace isolation', () => {
  it('transitions each sample in its own workspace and hides other workspaces', async () => {
    const ownerA = await asAuthenticated(OWNER_A, WS_A)
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    const sampleA = await createSample(ownerA, PROJ_A, 'A hold', {
      quantity: 1,
      holdStartedAt: daysAgo(10),
      holdDurationDays: 1,
    })
    const sampleB = await createSample(ownerB, PROJ_B, 'B hold', {
      quantity: 1,
      holdStartedAt: daysAgo(10),
      holdDurationDays: 1,
    })

    await migrator.query(`SELECT api.sweep_sample_hold_limits(100)`)

    const { rows: a } = await ownerA.query(
      `SELECT workspace_id, status FROM api.records WHERE id = $1`,
      [sampleA.id],
    )
    const { rows: b } = await ownerB.query(
      `SELECT workspace_id, status FROM api.records WHERE id = $1`,
      [sampleB.id],
    )
    expect(a[0]).toMatchObject({ workspace_id: WS_A, status: 'hold_exceeded' })
    expect(b[0]).toMatchObject({ workspace_id: WS_B, status: 'hold_exceeded' })

    // Workspace A cannot see B's sample or its audit event.
    const { rows: crossRecord } = await ownerA.query(
      `SELECT id FROM api.records WHERE id = $1`,
      [sampleB.id],
    )
    expect(crossRecord).toHaveLength(0)
    const { rows: crossEvents } = await ownerA.query(
      `SELECT id FROM api.sample_events WHERE record_id = $1`,
      [sampleB.id],
    )
    expect(crossEvents).toHaveLength(0)
  })
})
