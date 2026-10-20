/**
 * API-003 integration proof: identity/workspace schema constraints, fixture
 * seeds and database-maintained timestamps, against a freshly migrated
 * sheetbase_test database.
 */
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import * as schema from '#/db/schema'
import {
  FIXTURE_PROJECT_ID,
  FIXTURE_USER_ID,
  FIXTURE_WORKSPACE_ID,
} from '#/db/seed/identities'
import { fixtureSteps } from '#/db/seed/run'
import { resolveDevUserId } from '#/lib/dev-identity'
import { migratorUrl, prepareTestDatabase } from './helpers'

const UNIQUE_VIOLATION = '23505'
const FOREIGN_KEY_VIOLATION = '23503'
const CHECK_VIOLATION = '23514'

let migrator: Client
let db: ReturnType<typeof drizzle<typeof schema>>

beforeAll(async () => {
  ;({ migrator } = await prepareTestDatabase())
  db = drizzle(migratorUrl(), { schema })
})

afterAll(async () => {
  await db.$client.end()
  await migrator.end()
})

describe('identity and workspace schema', () => {
  it('applies fixture seeds idempotently without bypassing constraints', async () => {
    for (const step of fixtureSteps) await step.run(db)
    for (const step of fixtureSteps) await step.run(db)

    const { rows } = await migrator.query(`
      SELECT
        (SELECT count(*) FROM internal."user" WHERE id = '${FIXTURE_USER_ID}')::int AS users,
        (SELECT count(*) FROM api.workspaces WHERE id = '${FIXTURE_WORKSPACE_ID}')::int AS workspaces,
        (SELECT count(*) FROM api.workspace_memberships WHERE workspace_id = '${FIXTURE_WORKSPACE_ID}')::int AS memberships,
        (SELECT count(*) FROM api.projects WHERE id = '${FIXTURE_PROJECT_ID}')::int AS projects
    `)
    expect(rows[0]).toEqual({
      users: 1,
      workspaces: 1,
      // The fixture seed owner plus the auth-free development identity it
      // grants owner membership to (`auth-free development workspace
      // membership`), which the auth-free dev surface signs in as. They are
      // one row when SHEETBASE_DEV_USER_ID is the default fixture identity.
      memberships:
        resolveDevUserId(process.env.SHEETBASE_DEV_USER_ID) === FIXTURE_USER_ID
          ? 1
          : 2,
      projects: 1,
    })
  })

  it('rejects memberships for a user that does not exist', async () => {
    await expect(
      db.insert(schema.workspaceMemberships).values({
        workspaceId: FIXTURE_WORKSPACE_ID,
        userId: 'no-such-user',
        role: 'member',
      }),
    ).rejects.toMatchObject({ cause: { code: FOREIGN_KEY_VIOLATION } })
  })

  it('rejects duplicate memberships for the same user and workspace', async () => {
    await expect(
      db.insert(schema.workspaceMemberships).values({
        workspaceId: FIXTURE_WORKSPACE_ID,
        userId: FIXTURE_USER_ID,
        role: 'member',
      }),
    ).rejects.toMatchObject({ cause: { code: UNIQUE_VIOLATION } })
  })

  it('rejects roles outside the membership vocabulary', async () => {
    await expect(
      db.insert(schema.workspaceMemberships).values({
        workspaceId: FIXTURE_WORKSPACE_ID,
        userId: FIXTURE_USER_ID,
        role: 'superadmin',
      }),
    ).rejects.toMatchObject({ cause: { code: CHECK_VIOLATION } })
  })

  it('rejects projects outside the status vocabulary', async () => {
    await expect(
      db.insert(schema.projects).values({
        workspaceId: FIXTURE_WORKSPACE_ID,
        key: 'bad-status',
        title: 'Bad status',
        status: 'deleted',
      }),
    ).rejects.toMatchObject({ cause: { code: CHECK_VIOLATION } })
  })

  it('stamps updated_at on update through the database trigger', async () => {
    const before = await migrator.query(
      `SELECT updated_at FROM api.workspaces WHERE id = '${FIXTURE_WORKSPACE_ID}'`,
    )
    await new Promise((resolve) => setTimeout(resolve, 1100))
    await migrator.query(
      `UPDATE api.workspaces SET name = 'Fixture Workspace Renamed' WHERE id = '${FIXTURE_WORKSPACE_ID}'`,
    )
    const after = await migrator.query(
      `SELECT updated_at FROM api.workspaces WHERE id = '${FIXTURE_WORKSPACE_ID}'`,
    )
    expect(new Date(after.rows[0].updated_at).getTime()).toBeGreaterThan(
      new Date(before.rows[0].updated_at).getTime(),
    )
  })
})
