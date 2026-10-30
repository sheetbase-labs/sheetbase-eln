/**
 * Sample data added to a workspace that has just been set up: it is built for
 * that workspace and owner (not the fixture ones), the owner can see all of
 * it, a rerun converges, and nothing outside the workspace is touched.
 */
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import * as schema from '#/db/schema'
import { buildDemoSteps } from '#/db/seed/demo-steps'
import { DEMO_VIRUS_STABILITY_PROJECT_ID } from '#/db/seed/identities'
import { migratorUrl, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-0000000007c0'
const OTHER_WS = '00000000-0000-4000-8000-0000000007c1'
const OWNER = 'sample-data-owner'
const OTHER_OWNER = 'sample-data-other-owner'
const OWN_PROJECT = '00000000-0000-4000-8000-0000000007c2'

let migrator: Client
let db: ReturnType<typeof drizzle<typeof schema>>
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

async function count(client: Client, table: string): Promise<number> {
  const { rows } = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM api.${table}`,
  )
  return Number(rows[0]?.n)
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  db = drizzle(migratorUrl(), { schema })
  for (const [id, email] of [
    [OWNER, 'sample-owner@acme-bio.example'],
    [OTHER_OWNER, 'sample-other@acme-bio.example'],
  ]) {
    await db
      .insert(schema.user)
      .values({ id, name: id, email, emailVerified: true })
  }
  await db.insert(schema.workspaces).values([
    { id: WS, slug: 'sample-ws', name: 'Acme Bio' },
    { id: OTHER_WS, slug: 'other-ws', name: 'Another lab' },
  ])
  await db.insert(schema.workspaceMemberships).values([
    { workspaceId: WS, userId: OWNER, role: 'owner' },
    { workspaceId: OTHER_WS, userId: OTHER_OWNER, role: 'owner' },
  ])
  await db.insert(schema.projects).values({
    id: OWN_PROJECT,
    workspaceId: OTHER_WS,
    key: 'their-own',
    title: 'Their own project',
    leadUserId: OTHER_OWNER,
  })
})

afterAll(async () => {
  await db.$client.end()
  await migrator.end()
  for (const client of clients) await client.end()
})

async function asAuthenticated(userId: string, workspaceId: string) {
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

describe('sample data in a set-up workspace', () => {
  it('lands in that workspace, owned by the admin, and converges on a rerun', async () => {
    const steps = buildDemoSteps({ workspaceId: WS, userId: OWNER }).filter(
      (step) => !step.name.startsWith('demo file attachments'),
    )
    for (const step of steps) await step.run(db)
    const owner = await asAuthenticated(OWNER, WS)
    const projects = await count(owner, 'projects')
    const records = await count(owner, 'records')
    expect(projects).toBe(1)
    expect(records).toBeGreaterThan(20)

    for (const step of steps) await step.run(db)
    expect(await count(owner, 'projects')).toBe(projects)
    expect(await count(owner, 'records')).toBe(records)

    const { rows } = await migrator.query<{
      workspace_id: string
      lead: string
    }>(
      `SELECT workspace_id, lead_user_id AS lead FROM api.projects WHERE id = $1`,
      [DEMO_VIRUS_STABILITY_PROJECT_ID],
    )
    expect(rows).toEqual([{ workspace_id: WS, lead: OWNER }])
  })

  it('leaves other workspaces and the fixture workspace alone', async () => {
    const other = await asAuthenticated(OTHER_OWNER, OTHER_WS)
    expect(await count(other, 'projects')).toBe(1)
    expect(await count(other, 'records')).toBe(0)
    const { rows } = await migrator.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM api.records WHERE workspace_id <> $1`,
      [WS],
    )
    expect(Number(rows[0]?.n)).toBe(0)
  })
})
