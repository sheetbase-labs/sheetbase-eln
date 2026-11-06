/**
 * Runs the validation checks for a workspace and keeps the result.
 *
 * Uses the migration login when there is one: the audit check runs a function
 * that only its owner may call, the same as the server's own audit schedule.
 */
import { PooledClient } from '#/db/pool.server'
import { db } from '#/db/client.server'
import { env } from '#/env.server'
import { ensureWorkspaceKey } from '../export/bundle-key.server'
import { signWithKey } from '../export/bundle-key'
import { sessionIdleSeconds } from '../session-idle'
import { runChecks } from './checks.server'
import type { ValidationRunRecord } from './types'

export function appVersion(): string {
  return env.SHEETBASE_ARTIFACT_VERSION || 'local'
}

export async function runAndRecordValidation(input: {
  workspaceId: string
  userId: string
  fetchImpl?: typeof fetch
}): Promise<ValidationRunRecord> {
  const client = new PooledClient({
    connectionString: process.env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL,
  })
  await client.connect()
  const startedAt = new Date()
  try {
    const results = await runChecks({
      db: client,
      workspaceId: input.workspaceId,
      userId: input.userId,
      now: () => new Date(),
      idleSecondsFor: (userId) => sessionIdleSeconds(db, userId),
      exportKey: async () => {
        const key = await ensureWorkspaceKey(input.workspaceId)
        return {
          publicKeyPem: key.publicKeyPem,
          fingerprint: key.fingerprint,
          sign: (data) => signWithKey(key.privateKeyPem, data),
        }
      },
      fetch: input.fetchImpl ?? fetch,
      config: {
        postgrestUrl: env.POSTGREST_URL,
        publicUrl: process.env.BETTER_AUTH_URL ?? '',
        expectedMigration: env.SHEETBASE_EXPECTED_MIGRATION,
      },
    })
    const migration = (
      await client.query<{ latest: string | null }>(
        'SELECT max(created_at)::text AS latest FROM drizzle.__drizzle_migrations',
      )
    ).rows[0]?.latest
    const { rows } = await client.query<ValidationRunRecord>(
      `SELECT * FROM internal.record_validation_run($1, $2, $3, $4, $5::jsonb, $6)`,
      [
        input.workspaceId,
        input.userId,
        appVersion(),
        migration ?? null,
        JSON.stringify(results),
        startedAt,
      ],
    )
    return rows[0]
  } finally {
    await client.end()
  }
}
