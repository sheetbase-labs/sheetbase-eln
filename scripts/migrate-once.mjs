/**
 * PLAT-01 — concurrency-safe one-shot migration runner.
 *
 * `drizzle-kit migrate` is idempotent but does not take a cross-connection
 * lock, so two simultaneous migrators (e.g. a retried deploy while the first
 * migrate container is still running) could race on the journal. This wrapper
 * holds a PostgreSQL advisory lock for the whole migration, so concurrent
 * invocations serialise instead of racing. The lock is session-scoped: it is
 * released automatically if the process dies, so a crashed migrator cannot
 * wedge future releases.
 *
 * Used by the `migrate` one-shot service in compose.deploy.yaml. Fails fast
 * and non-zero so the deployment controller stops before starting the app.
 */
import { spawnSync } from 'node:child_process'

import { Client } from 'pg'

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
await client.connect()
try {
  await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY])
  const result = spawnSync('./node_modules/.bin/drizzle-kit', ['migrate'], {
    stdio: 'inherit',
    // drizzle.config.ts reads MIGRATION_DATABASE_URL. Keep the credential in
    // the environment, never on the command line.
    env: process.env,
  })
  if (result.status !== 0) {
    throw new Error(`drizzle-kit migrate exited with status ${result.status}`)
  }
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
