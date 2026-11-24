/**
 * The path a visitor takes on the open demo: the auth-free person opens the
 * app on a freshly seeded first-run database. Their one workspace is empty and
 * not yet set up; skipping or finishing setup never fills it; asking for the
 * demo creates a separate Demo workspace carrying the full demonstration seed
 * (the same data as `pnpm db:seed --design`) and leaves their own untouched.
 */
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import * as schema from '#/db/schema'
import { DEV_USER, firstRunSteps } from '#/db/seed/run'

import { migratorUrl, prepareTestDatabase } from './helpers'

let migrator: Client
let db: ReturnType<typeof drizzle<typeof schema>>

async function numbers(workspaceId: string) {
  const { rows } = await migrator.query<Record<string, string>>(
    `SELECT (SELECT count(*) FROM api.projects WHERE workspace_id = $1)::text AS projects,
            (SELECT count(*) FROM api.records WHERE workspace_id = $1)::text AS records`,
    [workspaceId],
  )

  return {
    projects: Number(rows[0]?.projects),
    records: Number(rows[0]?.records),
  }
}

/**
 * Floors from the full seed (registries, shipments, requests, reports, ...).
 * The small Lentivector sample had one project and a handful of records, so
 * any of these failing means the Demo workspace is not carrying the full seed.
 */
const FULL_SEED_FLOORS = {
  projects: 20,
  records: 300,
  datasets: 10,
  shipments: 9,
  request_details: 9,
  report_definitions: 13,
  instruments: 10,
  pipeline_definitions: 9,
  storage_units: 8,
  workspace_memberships: 8,
} satisfies Record<string, number>

async function workspacesOf(userId: string) {
  const { rows } = await migrator.query<{
    id: string
    name: string
    setup: boolean
  }>(
    `SELECT w.id, w.name, s.setup_completed_at IS NOT NULL AS setup
       FROM api.workspace_memberships m
       JOIN api.workspaces w ON w.id = m.workspace_id
  LEFT JOIN api.workspace_settings s ON s.workspace_id = w.id
      WHERE m.user_id = $1 ORDER BY w.created_at`,
    [userId],
  )

  return rows
}

beforeAll(async () => {
  ;({ migrator } = await prepareTestDatabase())
  db = drizzle(migratorUrl(), { schema })

  for (const step of firstRunSteps) await step.run(db)
})

afterAll(async () => {
  await db.$client.end()
  await migrator.end()
})

describe('first run on the open demo', () => {
  it('gives the person one workspace that is empty and not set up', async () => {
    const owned = await workspacesOf(DEV_USER.id)

    expect(owned).toHaveLength(1)
    expect(owned[0]?.setup).toBe(false)
    expect(await numbers(owned[0]!.id)).toEqual({ projects: 0, records: 0 })
  })

  it('seeds no other workspace, so nothing else can show', async () => {
    const { rows } = await migrator.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM api.workspaces`,
    )

    expect(Number(rows[0]?.n)).toBe(1)
  })

  it('is stable when the seed runs again', async () => {
    for (const step of firstRunSteps) await step.run(db)
    expect(await workspacesOf(DEV_USER.id)).toHaveLength(1)
  })

  it('creates a separate Demo workspace on request and leaves their own empty', async () => {
    const { addSampleData, sampleDataStatus } =
      await import('#/lib/sample-data.server')

    const [own] = await workspacesOf(DEV_USER.id)

    let result = await addSampleData({ userId: DEV_USER.id }, db, 1000)

    // The load outlives one request: until it finishes the person is told to
    // ask again, and the demo does not count as loaded.
    let asks = 1

    while (!result.ok && result.reason === 'loading') {
      expect((await sampleDataStatus(DEV_USER.id, db)).loaded).toBe(false)
      result = await addSampleData({ userId: DEV_USER.id }, db, 1000)
      asks += 1
    }

    expect(asks).toBeGreaterThan(1)

    expect(result.ok).toBe(true)

    if (!result.ok) return

    expect(result.workspaceId).not.toBe(own!.id)

    for (const [table, floor] of Object.entries(FULL_SEED_FLOORS)) {
      const { rows } = await migrator.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM api.${table} WHERE workspace_id = $1`,
        [result.workspaceId],
      )

      expect(
        Number(rows[0]?.n),
        `${table} in the Demo workspace`,
      ).toBeGreaterThanOrEqual(floor)
    }

    // They can open the projects: access is what lists are built from.
    const { rows: visible } = await migrator.query<{ n: string }>(
      `SELECT count(DISTINCT project_id)::text AS n FROM api.project_access
        WHERE workspace_id = $1 AND user_id = $2 AND can_view`,
      [result.workspaceId, DEV_USER.id],
    )

    expect(Number(visible[0]?.n)).toBeGreaterThanOrEqual(15)

    // Registry entries (the 42 from the full seed) are records with a registry model.
    const { rows: registry } = await migrator.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM api.records r
         JOIN api.record_models m ON m.workspace_id = r.workspace_id AND m.key = r.kind
        WHERE r.workspace_id = $1 AND m.is_registry`,
      [result.workspaceId],
    )

    expect(Number(registry[0]?.n)).toBeGreaterThanOrEqual(42)
    expect(await numbers(own!.id)).toEqual({ projects: 0, records: 0 })

    const owned = await workspacesOf(DEV_USER.id)

    expect(owned.map((w) => w.name)).toContain('Demo')
    expect(owned.find((w) => w.id === own!.id)?.setup).toBe(false)
    expect(owned.find((w) => w.id === result.workspaceId)?.setup).toBe(true)

    // Asking again opens the same Demo rather than making another.
    const again = await addSampleData({ userId: DEV_USER.id }, db)

    expect(again).toEqual({ ok: true, workspaceId: result.workspaceId })
    expect(await workspacesOf(DEV_USER.id)).toHaveLength(2)
  }, 300_000)
})
