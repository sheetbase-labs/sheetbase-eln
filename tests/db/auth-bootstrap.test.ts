/**
 * AUTH-002 integration proof: first-user bootstrap, repeat-callback
 * idempotency and partial-failure rollback, against a freshly migrated
 * sheetbase_test database.
 */
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import * as schema from '#/db/schema'
import {
  bootstrapWorkspaceForUser,
  workspaceSlugForUser,
} from '#/lib/bootstrap'
import { migratorUrl, prepareTestDatabase } from './helpers'

let migrator: Client
let db: NodePgDatabase<typeof schema>

beforeAll(async () => {
  ;({ migrator } = await prepareTestDatabase())
  db = drizzle(migratorUrl(), { schema })
})

afterAll(async () => {
  await db.$client.end()
  await migrator.end()
})

async function addUser(id: string, name: string) {
  await db.insert(schema.user).values({
    id,
    name,
    email: `${id}@sheetbase.test`,
    emailVerified: true,
  })
}

describe('workspace bootstrap', () => {
  it('creates the initial workspace and owner membership in one transaction', async () => {
    await addUser('bootstrap-first', 'First User')

    const result = await bootstrapWorkspaceForUser(db, {
      id: 'bootstrap-first',
      name: 'First User',
    })

    expect(result.created).toBe(true)
    const workspace = await db.query.workspaces.findFirst({
      where: (table, { eq }) => eq(table.id, result.workspaceId),
      with: { memberships: true },
    })
    expect(workspace?.slug).toBe(workspaceSlugForUser('bootstrap-first'))
    expect(workspace?.memberships).toHaveLength(1)
    expect(workspace?.memberships[0]?.role).toBe('owner')
    expect(workspace?.memberships[0]?.userId).toBe('bootstrap-first')
  })

  it('is idempotent across repeat callbacks and retries', async () => {
    await addUser('bootstrap-repeat', 'Repeat User')

    const first = await bootstrapWorkspaceForUser(db, {
      id: 'bootstrap-repeat',
      name: 'Repeat User',
    })
    const second = await bootstrapWorkspaceForUser(db, {
      id: 'bootstrap-repeat',
      name: 'Repeat User',
    })

    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.workspaceId).toBe(first.workspaceId)

    const { rows } = await migrator.query(
      `SELECT count(*)::int AS n FROM api.workspace_memberships WHERE user_id = 'bootstrap-repeat'`,
    )
    expect(rows[0]?.n).toBe(1)
  })

  it('bootstraps later sign-ups independently while registration is open', async () => {
    await addUser('bootstrap-second', 'Second User')

    const result = await bootstrapWorkspaceForUser(db, {
      id: 'bootstrap-second',
      name: 'Second User',
    })

    expect(result.created).toBe(true)
    expect(result.workspaceId).not.toBe(
      workspaceSlugForUser('bootstrap-first'),
    )
  })

  it('rolls the workspace back when the membership insert fails', async () => {
    // No user row: the membership FK must fail, and the transaction must not
    // leave an orphaned workspace behind.
    const slug = workspaceSlugForUser('bootstrap-ghost')

    await expect(
      bootstrapWorkspaceForUser(db, { id: 'bootstrap-ghost', name: 'Ghost' }),
    ).rejects.toMatchObject({ cause: { code: '23503' } })

    const orphaned = await db.query.workspaces.findFirst({
      where: (table, { eq }) => eq(table.slug, slug),
    })
    expect(orphaned).toBeUndefined()
  })
})
