/**
 * Lists, counts and search at the size of a lab with a few years of records:
 * ten thousand experiments and fifty thousand samples. What the lists read must
 * agree with what the counts say, page by page, and nothing may be missed past
 * the first page. See src/db/seed/scale.ts.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  SCALE_EXPERIMENTS,
  SCALE_EXPERIMENT_STATUSES,
  SCALE_SAMPLES,
  seedScale,
} from '../../src/db/seed/scale'
import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-0000000047a0'
const PROJECT = '00000000-0000-4000-8000-0000000047a1'
const ARCHIVED_PROJECT = '00000000-0000-4000-8000-0000000047a2'
const OWNER = 'ls-owner'
const MEMBER = 'ls-member'

/** A read that takes this long at this size is a regression, not noise. */
const SLOW_MS = 30_000

/** A count of every sample must come back well inside this, with room for a slow CI runner. */
const COUNT_BUDGET_MS = 1_000

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: userId, workspace_id: WS, role: 'authenticated' }),
  ])
  return client
}

async function timed<T>(read: () => Promise<T>): Promise<T> {
  const start = Date.now()
  const result = await read()
  expect(Date.now() - start).toBeLessThan(SLOW_MS)
  return result
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(`
    INSERT INTO internal."user" (id, name, email, "emailVerified") VALUES
      ('${OWNER}', 'Owner', 'ls-o@sheetbase.test', true),
      ('${MEMBER}', 'Member', 'ls-m@sheetbase.test', true);
    INSERT INTO api.workspaces (id, slug, name) VALUES ('${WS}', 'ls', 'LS');
    INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS}', '${OWNER}', 'owner'), ('${WS}', '${MEMBER}', 'member');
    INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES
      ('${PROJECT}', '${WS}', 'ls-live', 'Live project', '${OWNER}'),
      ('${ARCHIVED_PROJECT}', '${WS}', 'ls-old', 'Retired project', '${OWNER}');
  `)
  await seedScale(migrator, {
    workspaceId: WS,
    projectIds: [PROJECT, ARCHIVED_PROJECT],
    userIds: [OWNER, MEMBER],
  })
  // Retire a project after its work, as labs do; its records stay.
  await migrator.query(
    `UPDATE api.projects SET archived_at = now() WHERE id = $1`,
    [ARCHIVED_PROJECT],
  )
  await migrator.query('ANALYZE api.records')
}, 300_000)

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('experiments at scale', () => {
  it('counts every experiment, split by status, exactly', async () => {
    const owner = await actor(OWNER)
    const { rows } = await timed(() =>
      owner.query<{ status: string; total: number; mine: number }>(
        `SELECT status, total, mine FROM api.experiment_tab_counts($1)`,
        [OWNER],
      ),
    )
    expect(rows.reduce((sum, r) => sum + r.total, 0)).toBe(SCALE_EXPERIMENTS)
    for (const status of new Set(SCALE_EXPERIMENT_STATUSES)) {
      const expected = Array.from(
        { length: SCALE_EXPERIMENTS },
        (_, i) => i + 1,
      )
        .map(
          (n) =>
            SCALE_EXPERIMENT_STATUSES[n % SCALE_EXPERIMENT_STATUSES.length],
        )
        .filter((s) => s === status).length
      expect(rows.find((r) => r.status === status)?.total).toBe(expected)
    }
    expect(rows.reduce((sum, r) => sum + r.mine, 0)).toBe(SCALE_EXPERIMENTS / 2)
  })

  it('counts the date window and the search the way the list reads them', async () => {
    const owner = await actor(OWNER)
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
    const counted = await timed(() =>
      owner.query<{ total: number }>(
        `SELECT total FROM api.experiment_tab_counts($1, NULL, $2)`,
        [OWNER, since],
      ),
    )
    const read = await owner.query<{ n: string }>(
      `SELECT count(*) AS n FROM api.records
        WHERE kind = 'experiment' AND deleted_at IS NULL AND updated_at >= $1`,
      [since],
    )
    expect(counted.rows.reduce((sum, r) => sum + r.total, 0)).toBe(
      Number(read.rows[0]!.n),
    )
    expect(Number(read.rows[0]!.n)).toBeGreaterThan(0)
    expect(Number(read.rows[0]!.n)).toBeLessThan(SCALE_EXPERIMENTS)

    const searched = await timed(() =>
      owner.query<{ total: number }>(
        `SELECT total FROM api.experiment_tab_counts($1, NULL, NULL, 'Scale run 77')`,
        [OWNER],
      ),
    )
    // "Scale run 77", "Scale run 770".."779" and "Scale run 7700".."7799".
    expect(searched.rows.reduce((sum, r) => sum + r.total, 0)).toBe(
      1 + 10 + 100,
    )
  })

  it('pages through a tab to its last row without a gap or a repeat', async () => {
    const owner = await actor(OWNER)
    const seen = new Set<string>()
    const pageSize = 300
    for (let offset = 0; ; offset += pageSize) {
      const { rows } = await timed(() =>
        owner.query<{ id: string }>(
          `SELECT id FROM api.records
            WHERE kind = 'experiment' AND deleted_at IS NULL AND archived_at IS NULL
              AND status IN ('approved', 'locked', 'failed')
            ORDER BY updated_at DESC, id ASC LIMIT $1 OFFSET $2`,
          [pageSize, offset],
        ),
      )
      for (const row of rows) {
        expect(seen.has(row.id)).toBe(false)
        seen.add(row.id)
      }
      if (rows.length < pageSize) break
    }
    const counted = await owner.query<{ total: number }>(
      `SELECT total FROM api.experiment_tab_counts($1) WHERE status = 'approved'`,
      [OWNER],
    )
    expect(seen.size).toBe(counted.rows[0]!.total)
  })
})

describe('samples at scale', () => {
  it('counts the in-stock and consumed tabs exactly', async () => {
    const owner = await actor(OWNER)
    const count = async (where: string) =>
      Number(
        (
          await timed(() =>
            owner.query<{ n: string }>(
              `SELECT count(*) AS n FROM api.records
                WHERE kind = 'sample' AND deleted_at IS NULL AND archived_at IS NULL AND ${where}`,
            ),
          )
        ).rows[0]!.n,
      )
    const inStock = await count(`status NOT IN ('consumed', 'disposed')`)
    const consumed = await count(`status IN ('consumed', 'disposed')`)
    expect(inStock + consumed).toBe(SCALE_SAMPLES)
    expect(consumed).toBeGreaterThan(0)
    expect(await count(`status = 'quarantined'`)).toBeGreaterThan(0)
  })

  it('counts all the samples in under a second for a member of the project', async () => {
    // Row-level security used to ask "may I see this project?" once per row,
    // which took seconds at this size. The answer is now worked out once per
    // statement (migration 0049), so a plain count stays quick.
    const owner = await actor(OWNER)
    const start = Date.now()
    const { rows } = await owner.query<{ n: string }>(
      `SELECT count(*) AS n FROM api.records WHERE kind = 'sample' AND deleted_at IS NULL`,
    )
    const elapsed = Date.now() - start
    expect(Number(rows[0]!.n)).toBe(SCALE_SAMPLES)
    expect(elapsed).toBeLessThan(COUNT_BUDGET_MS)
  })

  it('lists each storage place once, however many samples sit in it', async () => {
    const owner = await actor(OWNER)
    const { rows } = await timed(() =>
      owner.query<{ location: string }>(
        `SELECT location FROM api.sample_storage_locations()`,
      ),
    )
    // 40 freezers and 12 racks cycle together, so 120 distinct places.
    expect(rows).toHaveLength(120)
  })
})

describe('search at scale', () => {
  it('finds a record past the first page of everything', async () => {
    const owner = await actor(OWNER)
    const { rows } = await timed(() =>
      owner.query<{ identifier: string }>(
        `SELECT identifier FROM api.search(p_query := 'EXP-109999', p_result_type := 'record')`,
      ),
    )
    expect(rows.map((r) => r.identifier)).toContain('EXP-109999')
  })
})
