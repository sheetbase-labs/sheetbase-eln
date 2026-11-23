/**
 * The path a visitor takes on the open demo: the auth-free person opens the
 * app on a freshly seeded first-run database. Their one workspace is empty and
 * not yet set up; skipping or finishing setup never fills it; asking for the
 * demo creates a separate Demo workspace and leaves their own untouched.
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
    const { addSampleData } = await import('#/lib/sample-data.server')
    const [own] = await workspacesOf(DEV_USER.id)
    const result = await addSampleData({ userId: DEV_USER.id }, db)

    expect(result.ok).toBe(true)

    if (!result.ok) return

    expect(result.workspaceId).not.toBe(own!.id)
    expect((await numbers(result.workspaceId)).projects).toBe(1)
    expect(await numbers(own!.id)).toEqual({ projects: 0, records: 0 })

    const owned = await workspacesOf(DEV_USER.id)

    expect(owned.map((w) => w.name)).toContain('Demo')
    expect(owned.find((w) => w.id === own!.id)?.setup).toBe(false)
    expect(owned.find((w) => w.id === result.workspaceId)?.setup).toBe(true)

    // Asking again opens the same Demo rather than making another.
    const again = await addSampleData({ userId: DEV_USER.id }, db)

    expect(again).toEqual({ ok: true, workspaceId: result.workspaceId })
    expect(await workspacesOf(DEV_USER.id)).toHaveLength(2)
  })
})
