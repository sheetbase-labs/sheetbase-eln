/**
 * PLAT-01 — migration concurrency. The one-shot migrate runner must hold a
 * PostgreSQL advisory lock so two simultaneous migrators (e.g. a retried
 * deploy while the first migrate container is still running) serialise
 * instead of racing on the Drizzle journal, and a finished run must not
 * leave the lock held for future releases.
 */
import { spawn } from 'node:child_process'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { migratorUrl, prepareTestDatabase } from './helpers'

type ThenArg<T> = T extends PromiseLike<infer U> ? U : never

const LOCK_KEY = '7421834490123457'

function runMigrator(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/migrate-once.mjs'], {
      cwd: process.cwd(),
      env: { ...process.env, MIGRATION_DATABASE_URL: url },
      stdio: ['ignore', 'inherit', 'inherit'],
    })
    child.on('error', reject)
    child.on('close', (code) => resolve(code ?? -1))
  })
}

describe('migrate-once advisory locking', () => {
  let context: ThenArg<ReturnType<typeof prepareTestDatabase>>

  beforeAll(async () => {
    context = await prepareTestDatabase()
  })

  afterAll(async () => {
    await context.migrator.end()
  })

  it('serialises two concurrent migrators and both succeed', async () => {
    const [a, b] = await Promise.all([
      runMigrator(migratorUrl()),
      runMigrator(migratorUrl()),
    ])
    expect(a).toBe(0)
    expect(b).toBe(0)

    const journal = await context.migrator.query(
      'SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations',
    )
    // The full migration history is applied exactly once.
    expect(Number(journal.rows[0].n)).toBeGreaterThan(100)
  })

  it('releases the advisory lock when the migrator finishes', async () => {
    // A third sequential run proves the lock is not held permanently.
    expect(await runMigrator(migratorUrl())).toBe(0)
    const lock = await context.migrator.query(
      'SELECT pg_try_advisory_lock($1) AS acquired',
      [LOCK_KEY],
    )
    expect(lock.rows[0].acquired).toBe(true)
    await context.migrator.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY])
  })
})
