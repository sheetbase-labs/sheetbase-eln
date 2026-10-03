/**
 * DSYS-06 — server-side display-identifier resolution.
 *
 * Proves the resolver maps a display identifier to the row UUID for the
 * caller's workspace and never across workspaces: the SQL filters on
 * workspace_id and runs under the caller's JWT claims, so RLS membership
 * applies too. No new database object is added — the resolver uses the
 * existing tables and policies.
 */
import type { Client } from 'pg'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { resolveIdentifier } from '#/lib/identifier-resolution.server'

import { prepareTestDatabase, roleUrl } from './helpers'

const WS_A = '00000000-0000-4000-8000-00000000b001'
const WS_B = '00000000-0000-4000-8000-00000000b002'
const USER_A = 'dsys06-user-a'
const USER_B = 'dsys06-user-b'
const PROJECT_A = '00000000-0000-4000-8000-00000000c001'
const PROJECT_B = '00000000-0000-4000-8000-00000000c002'
const SAMPLE_A = '00000000-0000-4000-8000-00000000c003'

let migrator: Client
let pool: Pool

beforeAll(async () => {
  ;({ migrator } = await prepareTestDatabase())
  pool = new Pool({ connectionString: roleUrl('authenticator') })

  await migrator.query(`
    INSERT INTO internal."user"(id, name, email, "emailVerified") VALUES
      ('${USER_A}', 'Resolver A', 'dsys06-a@test.invalid', true),
      ('${USER_B}', 'Resolver B', 'dsys06-b@test.invalid', true);

    INSERT INTO api.workspaces(id, slug, name) VALUES
      ('${WS_A}', 'dsys06-a', 'DSYS-06 Workspace A'),
      ('${WS_B}', 'dsys06-b', 'DSYS-06 Workspace B');

    INSERT INTO api.workspace_memberships(workspace_id, user_id, role) VALUES
      ('${WS_A}', '${USER_A}', 'member'),
      ('${WS_B}', '${USER_B}', 'member');

    INSERT INTO api.projects(id, workspace_id, key, title, display_id) VALUES
      ('${PROJECT_A}', '${WS_A}', 'dsys06-a', 'Project A', 'PRJ-9001'),
      ('${PROJECT_B}', '${WS_B}', 'dsys06-b', 'Project B', 'PRJ-9002');

    INSERT INTO api.records(id, workspace_id, project_id, kind, identifier, title, created_by_user_id)
    VALUES ('${SAMPLE_A}', '${WS_A}', '${PROJECT_A}', 'sample', 'SMP-9001', 'Sample A', '${USER_A}');
  `)
})

afterAll(async () => {
  await pool?.end()
  await migrator?.end()
})

describe('resolveIdentifier', () => {
  it('resolves a display identifier in the caller workspace', async () => {
    const id = await resolveIdentifier({
      entity: 'project',
      identifier: 'PRJ-9001',
      workspaceId: WS_A,
      userId: USER_A,
      pool,
    })
    expect(id).toBe(PROJECT_A)
  })

  it('returns null for another workspace’s identifier', async () => {
    const id = await resolveIdentifier({
      entity: 'project',
      identifier: 'PRJ-9002',
      workspaceId: WS_A,
      userId: USER_A,
      pool,
    })
    expect(id).toBeNull()
  })

  it('returns null when the caller is not a member of the workspace (RLS)', async () => {
    const id = await resolveIdentifier({
      entity: 'project',
      identifier: 'PRJ-9002',
      workspaceId: WS_B,
      userId: USER_A,
      pool,
    })
    expect(id).toBeNull()
  })

  it('resolves a record identifier and honours the entity kind', async () => {
    await expect(
      resolveIdentifier({
        entity: 'sample',
        identifier: 'SMP-9001',
        workspaceId: WS_A,
        userId: USER_A,
        pool,
      }),
    ).resolves.toBe(SAMPLE_A)

    await expect(
      resolveIdentifier({
        entity: 'experiment',
        identifier: 'SMP-9001',
        workspaceId: WS_A,
        userId: USER_A,
        pool,
      }),
    ).resolves.toBeNull()

    await expect(
      resolveIdentifier({
        entity: 'record',
        identifier: 'SMP-9001',
        workspaceId: WS_A,
        userId: USER_A,
        pool,
      }),
    ).resolves.toBe(SAMPLE_A)
  })

  it('returns null for an unknown identifier', async () => {
    const id = await resolveIdentifier({
      entity: 'sample',
      identifier: 'SMP-9999',
      workspaceId: WS_A,
      userId: USER_A,
      pool,
    })
    expect(id).toBeNull()
  })
})
