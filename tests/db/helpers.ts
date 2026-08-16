/**
 * Shared helpers for the database integration layer. Every suite gets a
 * freshly recreated, fully migrated sheetbase_test database.
 */
import { config } from 'dotenv'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Client } from 'pg'
import { expect } from 'vitest'

config({ path: ['.env.local', '.env'] })

export const TEST_DATABASE = 'sheetbase_test'

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} is required for database tests. Copy .env.example to .env.local.`,
    )
  }
  return value
}

function withDatabase(baseUrl: string, database: string): string {
  const url = new URL(baseUrl)
  url.pathname = `/${database}`
  return url.toString()
}

export function migratorUrl(): string {
  return withDatabase(
    process.env.MIGRATION_DATABASE_URL ?? required('DATABASE_URL'),
    TEST_DATABASE,
  )
}

/** Connect as a bootstrap role by name using local dev credentials. */
export function roleUrl(role: 'authenticator'): string {
  const url = new URL(required('PGRST_DB_URI'))
  url.hostname = 'localhost'
  url.port = process.env.POSTGRES_PORT ?? '5432'
  url.pathname = `/${TEST_DATABASE}`
  return url.toString()
}

/** Drop and recreate the test database, owned by migrator. */
export async function resetTestDatabase(): Promise<void> {
  const url = new URL(required('DATABASE_URL'))
  url.pathname = '/postgres'
  const client = new Client({ connectionString: url.toString() })
  await client.connect()
  try {
    await client.query(`DROP DATABASE IF EXISTS ${TEST_DATABASE} WITH (FORCE)`)
    await client.query(`CREATE DATABASE ${TEST_DATABASE} OWNER migrator`)
  } finally {
    await client.end()
  }
}

/** Apply the full migration history to the test database. */
export async function migrateTestDatabase(): Promise<void> {
  const db = drizzle(migratorUrl())
  await migrate(db, { migrationsFolder: 'drizzle' })
}

/** Fresh, migrated database plus connected clients for assertions. */
export async function prepareTestDatabase(): Promise<{
  migrator: Client
  asRole: (role: 'authenticator') => Promise<Client>
}> {
  try {
    await resetTestDatabase()
  } catch (error) {
    throw new Error(
      'Cannot reach local PostgreSQL. Run `pnpm services:up` first. ' +
        String(error instanceof Error ? error.message : error),
    )
  }
  await migrateTestDatabase()

  const migrator = new Client({ connectionString: migratorUrl() })
  await migrator.connect()

  return {
    migrator,
    asRole: async (role) => {
      const client = new Client({ connectionString: roleUrl(role) })
      await client.connect()
      return client
    },
  }
}

export async function expectDenied(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code })
}

/** JWT claims used by SECURITY DEFINER RPCs to resolve the actor workspace. */
export async function setActorJwt(
  client: Client,
  userId: string,
  workspaceId: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await client.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      role: 'authenticated',
      sub: userId,
      workspace_id: workspaceId,
      ...extra,
    }),
  ])
}

/** Migrator login against the same database as an application URL. */
export function migratorUrlForDatabase(databaseUrl: string): string {
  const app = new URL(databaseUrl)
  const mig = new URL(
    process.env.MIGRATION_DATABASE_URL ?? required('MIGRATION_DATABASE_URL'),
  )
  mig.pathname = app.pathname
  mig.search = app.search
  return mig.toString()
}

export async function createScientificTableAsMigrator(
  client: Client,
  userId: string,
  workspaceId: string,
  blockId: string,
  name: string,
  columns: unknown[],
): Promise<{
  table: { id: string; resource_name: string; schema_version: number }
  columns: Array<{ id: string; field_name: string; label?: string }>
  resourceName?: string
}> {
  await setActorJwt(client, userId, workspaceId)
  const { rows } = await client.query(
    `SELECT api.create_scientific_table($1,$2,$3::jsonb) result`,
    [blockId, name, JSON.stringify(columns)],
  )
  return rows[0].result
}

export async function openMigratorWriter(
  databaseUrl: string,
  userId: string,
  workspaceId: string,
): Promise<Client> {
  const client = new Client({
    connectionString: migratorUrlForDatabase(databaseUrl),
  })
  await client.connect()
  await setActorJwt(client, userId, workspaceId)
  return client
}
