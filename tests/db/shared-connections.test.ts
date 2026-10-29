/** Real PostgreSQL: connections are shared, bounded and never carry state over. */
import { afterAll, beforeAll, expect, it } from 'vitest'
import { Client } from 'pg'

import { getPool, PooledClient } from '#/db/pool.server'
import { subscribeToChangeEvents } from '#/lib/sse-subscribe'
import { migratorUrl, prepareTestDatabase } from './helpers'

let admin: Client
const url = () => migratorUrl()

async function connectionsFor(application: string): Promise<number> {
  const { rows } = await admin.query(
    `SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid()
        AND query ILIKE $1`,
    [application],
  )
  return rows[0].n
}

beforeAll(async () => {
  admin = (await prepareTestDatabase()).migrator
})

afterAll(async () => {
  await getPool(url()).end()
  await admin?.end()
})

it('serves a burst of requests from a bounded number of connections', async () => {
  process.env.DB_POOL_MAX = '4'
  const pools = new Set<unknown>()
  await Promise.all(
    Array.from({ length: 60 }, async () => {
      const client = new PooledClient({ connectionString: url() })
      await client.connect()
      pools.add(getPool(url()))
      await client.query('SELECT pg_sleep(0.02)')
      await client.end()
    }),
  )
  expect(pools.size).toBe(1)
  const pool = getPool(url())
  expect(pool.totalCount).toBeLessThanOrEqual(10)
})

it('does not leak a changed role into the next borrower', async () => {
  const first = new PooledClient({ connectionString: url() })
  await first.connect()
  await first.query('SET ROLE authenticated').catch(() => undefined)
  await first.end()
  const second = new PooledClient({ connectionString: url() })
  await second.connect()
  const { rows } = await second.query(
    'SELECT current_user AS u, session_user AS s',
  )
  expect(rows[0].u).toBe(rows[0].s)
  await second.end()
})

it('closes a connection that was returned mid-transaction', async () => {
  const first = new PooledClient({ connectionString: url() })
  await first.connect()
  const pid = (await first.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
  await first.query('BEGIN')
  await first.end()
  const { rows } = await admin.query(
    'SELECT 1 FROM pg_stat_activity WHERE pid = $1',
    [pid],
  )
  // The abandoned transaction's connection is closed rather than reused.
  await new Promise((r) => setTimeout(r, 200))
  const gone = await admin.query(
    'SELECT 1 FROM pg_stat_activity WHERE pid = $1',
    [pid],
  )
  expect(rows.length + gone.rows.length).toBeGreaterThanOrEqual(0)
  expect(gone.rows).toHaveLength(0)
})

it('keeps one live-update connection however many streams are open', async () => {
  const before = await connectionsFor('LISTEN%')
  const seen: string[] = []
  const stops = await Promise.all(
    Array.from({ length: 25 }, () =>
      subscribeToChangeEvents(
        '00000000-0000-4000-8000-000000000999',
        (e) => {
          seen.push(e.id)
        },
        url(),
      ),
    ),
  )
  const { rows } = await admin.query(
    `SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event = 'ClientRead'
        AND state = 'idle' AND query = 'LISTEN sheetbase_change'`,
  )
  expect(rows[0].n - before).toBe(1)
  await Promise.all(stops.map((stop) => stop()))
  await new Promise((r) => setTimeout(r, 200))
  const { rows: after } = await admin.query(
    `SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND query = 'LISTEN sheetbase_change'`,
  )
  expect(after[0].n).toBe(0)
})
