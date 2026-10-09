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
    // AUTO-02: the pipeline transform sandbox role must exist in the local
    // cluster (normally provisioned by docker/db/init/00-roles.sh or
    // .agents/setup). Create it idempotently so DB tests pass on a cluster
    // that predates it.
    await client.query(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pipeline_worker') THEN
           CREATE ROLE pipeline_worker NOLOGIN NOINHERIT;
         END IF;
       END $$`,
    )
    await client.query(`DROP DATABASE IF EXISTS ${TEST_DATABASE} WITH (FORCE)`)
    await client.query(`CREATE DATABASE ${TEST_DATABASE} OWNER migrator`)
  } finally {
    await client.end()
  }
}

/** Apply the full migration history to the test database. */
export async function migrateTestDatabase(): Promise<void> {
  const db = drizzle(migratorUrl())
  try {
    await migrate(db, { migrationsFolder: 'drizzle' })
  } finally {
    await db.$client.end()
  }
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

/**
 * Internal Better Auth sessions for actors whose claims carry a session_id.
 * Submission and signing RPCs require a live matching session.
 */
export async function ensureSessions(
  client: Client,
  userIds: readonly string[],
): Promise<void> {
  for (const id of userIds) {
    await client.query(
      `INSERT INTO internal.session(id,token,"userId","expiresAt")
       VALUES ($1,$1,$2,now()+interval '1 hour')
       ON CONFLICT (id) DO NOTHING`,
      [`session-${id}`, id],
    )
  }
}

/**
 * Explicit project authority for a test principal. Since SET-02 / ADR-0050 a
 * project is private to its lead until an explicit rule exists, so fixtures
 * that write through a claimed actor must grant it. Inserted through the
 * migrator so the fixture does not need a managing lead of its own.
 */
export async function grantProjectAccess(
  client: Client,
  input: {
    workspaceId: string
    projectId: string
    userId: string
    canView?: boolean
    canEdit?: boolean
    canReview?: boolean
    canManage?: boolean
  },
): Promise<void> {
  await client.query(
    `INSERT INTO api.project_access(workspace_id,project_id,user_id,can_view,can_edit,can_review,can_manage,granted_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$3)
     ON CONFLICT(workspace_id,project_id,user_id) DO UPDATE SET
       can_view=excluded.can_view, can_edit=excluded.can_edit,
       can_review=excluded.can_review, can_manage=excluded.can_manage`,
    [
      input.workspaceId,
      input.projectId,
      input.userId,
      input.canView ?? true,
      input.canEdit ?? true,
      input.canReview ?? false,
      input.canManage ?? false,
    ],
  )
}
