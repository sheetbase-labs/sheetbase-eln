/**
 * `src/lib/capability.ts` decides which buttons the app offers, and
 * `api.has_capability` decides what the database accepts. They are two
 * copies of one role-to-capability table, so a role the app offers a button to
 * but the database refuses (or the other way round) means a dead button or a
 * hidden one. This compares every role with every capability.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CAPABILITIES, hasCapability } from '#/lib/capability'
import { hasDataAccess } from '#/lib/data-access-roles'

import { prepareTestDatabase } from './helpers'

const WORKSPACE = '00000000-0000-4000-8000-00000000c901'

// client_viewer is left out: a membership with that role has to name a client.
const ROLES = [
  'owner',
  'admin',
  'member',
  'steward',
  'scientist',
  'analyst',
  'reviewer',
  'viewer',
] as const

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

const userId = (role: string) => `capability-mirror-${role}`

async function resolvedInDatabase(role: string): Promise<string[]> {
  const client = await asRole('authenticator')

  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      sub: userId(role),
      workspace_id: WORKSPACE,
      role: 'authenticated',
    }),
  ])

  const granted: string[] = []

  for (const capability of CAPABILITIES) {
    const result = await client.query<{ allowed: boolean }>(
      'select api.has_capability($1, $2) as allowed',
      [WORKSPACE, capability],
    )

    if (result.rows[0]?.allowed) granted.push(capability)
  }

  return granted
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'capability-mirror','Capability mirror')`,
    [WORKSPACE],
  )

  for (const role of ROLES) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values ($1,$1,$2,true)`,
      [userId(role), `${userId(role)}@test.invalid`],
    )
    await migrator.query(
      `insert into api.workspace_memberships(workspace_id,user_id,role) values ($1,$2,$3)`,
      [WORKSPACE, userId(role), role],
    )
  }
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator.end()
})

describe('capability.ts and api.has_capability', () => {
  it.each(ROLES)('agree on what %s may do', async (role) => {
    const inApp = CAPABILITIES.filter((capability) =>
      hasCapability(role, capability),
    )

    const inDatabase = await resolvedInDatabase(role)

    expect(
      inApp,
      `${role}: the app offers these, the database ${inDatabase.length ? 'grants ' + inDatabase.join(', ') : 'grants none'}. Change src/lib/capability.ts or a new migration so both say the same.`,
    ).toEqual(inDatabase)
  })

  it.each(ROLES)(
    '%s is a workspace writer exactly when it may create records',
    async (role) => {
      const client = await asRole('authenticator')

      clients.push(client)
      await client.query('SET ROLE authenticated')
      await client.query(`select set_config('request.jwt.claims',$1,false)`, [
        JSON.stringify({
          sub: userId(role),
          workspace_id: WORKSPACE,
          role: 'authenticated',
        }),
      ])

      const result = await client.query<{ writer: boolean }>(
        'select api.is_workspace_writer($1) as writer',
        [WORKSPACE],
      )

      expect(
        result.rows[0]?.writer,
        `${role}: api.is_workspace_writer must equal the record.create capability`,
      ).toBe(hasCapability(role, 'record.create'))
    },
  )

  it.each(ROLES)(
    '%s has data access in the app exactly when the database says so',
    async (role) => {
      const client = await asRole('authenticator')

      clients.push(client)
      await client.query('SET ROLE authenticated')
      await client.query(`select set_config('request.jwt.claims',$1,false)`, [
        JSON.stringify({
          sub: userId(role),
          workspace_id: WORKSPACE,
          role: 'authenticated',
        }),
      ])

      const result = await client.query<{ allowed: boolean }>(
        'select api.has_data_access($1) as allowed',
        [WORKSPACE],
      )

      expect(
        result.rows[0]?.allowed,
        `${role}: src/lib/data-access-roles.ts and api.has_data_access disagree about the default roles`,
      ).toBe(hasDataAccess(role, null))
    },
  )
})
