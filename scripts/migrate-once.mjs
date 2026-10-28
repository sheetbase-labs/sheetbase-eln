/**
 * PLAT-01 — concurrency-safe one-shot migration runner.
 *
 * Drizzle migrate is idempotent but does not take a cross-connection
 * lock, so two simultaneous migrators (e.g. a retried deploy while the first
 * migrate container is still running) could race on the journal. This wrapper
 * holds a PostgreSQL advisory lock for the whole migration, so concurrent
 * invocations serialise instead of racing. The lock is session-scoped: it is
 * released automatically if the process dies, so a crashed migrator cannot
 * wedge future releases.
 *
 * Used by `pnpm db:migrate` and the Compose migration one-shots. Fails fast
 * and non-zero so the deployment controller stops before starting the app.
 */
import { config } from 'dotenv'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Client } from 'pg'

// Match drizzle.config.ts: environment credentials take precedence over files.
config({ path: ['.env.local', '.env'], quiet: true })

// Fixed lock key for Sheetbase schema migrations. Any constant 64-bit signed
// integer works; it must simply be the same across all migrator versions.
const MIGRATION_LOCK_KEY = 7421834490123457n

const connectionString =
  process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL
if (!connectionString) {
  process.stderr.write(
    JSON.stringify({
      level: 'error',
      message:
        'MIGRATION_DATABASE_URL (or DATABASE_URL) is required to run migrations',
    }) + '\n',
  )
  process.exit(1)
}

const client = new Client({ connectionString })
try {
  await client.connect()
  const authority = await client.query(
    `SELECT current_user AS role, pg_get_userbyid(datdba) AS owner
     FROM pg_database WHERE datname = current_database()`,
  )
  if (
    authority.rows[0].role !== 'migrator' ||
    authority.rows[0].owner !== 'migrator'
  ) {
    throw new Error('Migrations require the migrator role and database owner')
  }
  await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY])
  // Historical data backfills (including 0255) must pass the same enabled
  // Sheet Instance guard as RPC writes. This context belongs only to this
  // newly created migration connection, never an application pool or role.
  // Drizzle owns the transaction. Session context spans that transaction and
  // is discarded when this dedicated connection closes in finally.
  await client.query(
    `SELECT set_config('sheetbase.sheet_instance_write', 'rpc-v1', false)`,
  )
  await migrate(drizzle(client), { migrationsFolder: './drizzle' })
  // PostgREST keeps a cache of the schema and only sees a new function or view
  // when told to reload (a running service answers 404 "not in the schema
  // cache" until then). Tell it every time, so a migration that adds an RPC
  // works without a manual restart; with no PostgREST listening it is a no-op.
  await client.query(`NOTIFY pgrst, 'reload schema'`)
  process.stdout.write(
    JSON.stringify({
      level: 'info',
      message: 'migrations applied under advisory lock',
    }) + '\n',
  )
} finally {
  // Release even when migrate failed, then close; both best-effort so the
  // original failure propagates.
  await client
    .query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY])
    .catch(() => undefined)
  await client.end().catch(() => undefined)
}
