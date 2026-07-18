/**
 * API-002 integration proof: the role and schema privilege model.
 * Runs against a real, freshly migrated sheetbase_test database.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const INSUFFICIENT_PRIVILEGE = '42501'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  // Probe objects with no grants: the privilege model, not the object,
  // decides access.
  await migrator.query('CREATE TABLE api.probe (id int PRIMARY KEY)')
  await migrator.query('CREATE TABLE internal.probe (id int PRIMARY KEY)')
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

async function connectAs(role: 'authenticator'): Promise<Client> {
  const client = await asRole(role)
  clients.push(client)
  return client
}

describe('role and schema privileges', () => {
  it('lets the migration role create objects in both schemas', async () => {
    // The beforeAll probe creation ran as the migrator role;
    // reaching this assertion proves DDL works without the superuser.
    const { rows } = await migrator.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_tables
       WHERE schemaname IN ('api', 'internal') AND tablename = 'probe'`,
    )
    expect(rows[0]?.n).toBe(2)
  })

  it('denies the anonymous role reads on ungranted api tables', async () => {
    const client = await connectAs('authenticator')
    await client.query('SET ROLE anon')
    await expectDenied(
      client.query('SELECT * FROM api.probe'),
      INSUFFICIENT_PRIVILEGE,
    )
  })

  it('denies the authenticated role reads on ungranted api tables', async () => {
    const client = await connectAs('authenticator')
    await client.query('SET ROLE authenticated')
    await expectDenied(
      client.query('SELECT * FROM api.probe'),
      INSUFFICIENT_PRIVILEGE,
    )
  })

  it('hides the internal schema from request roles entirely', async () => {
    const client = await connectAs('authenticator')
    await client.query('SET ROLE authenticated')
    await expectDenied(
      client.query('SELECT * FROM internal.probe'),
      INSUFFICIENT_PRIVILEGE,
    )
  })

  it('prevents request roles from creating objects anywhere', async () => {
    const client = await connectAs('authenticator')
    await client.query('SET ROLE authenticated')
    await expectDenied(
      client.query('CREATE TABLE api.sneaky (id int)'),
      INSUFFICIENT_PRIVILEGE,
    )
    await expectDenied(
      client.query('CREATE TABLE public.sneaky (id int)'),
      INSUFFICIENT_PRIVILEGE,
    )
  })

  it('keeps the authenticator itself powerless without switching role', async () => {
    const client = await connectAs('authenticator')
    await expectDenied(
      client.query('SELECT * FROM api.probe'),
      INSUFFICIENT_PRIVILEGE,
    )
  })
})
