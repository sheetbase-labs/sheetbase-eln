/**
 * The real connections behind the remote job module (src/lib/pipeline-hpc.server.ts):
 * the connection a step names, its sealed secret, the app's own address, and a
 * transaction on the database. Kept apart so the module itself runs in tests
 * without the database client or the secret key.
 */
import { PooledClient } from '#/db/pool.server'
import { env } from '#/env.server'
import { openSecret, secretKey } from './connector-secrets.server'
import { parseHpcConfig, slurmClient } from './pipeline-hpc.server'
import type {
  HpcQueryable,
  JobCallbackDeps,
  RemoteJobDeps,
} from './pipeline-hpc.server'

export const realRemoteJobDeps: RemoteJobDeps = {
  loadConnection: async (conn, workspaceId, key, secret) => {
    const { rows } = await conn.query<{
      id: string
      status: string
      base_url: string
      settings: unknown
    }>(
      `SELECT id, status, base_url, settings FROM api.pipeline_connections
        WHERE workspace_id = $1 AND key = $2 AND kind = 'hpc'`,
      [workspaceId, key],
    )

    const connection = rows.at(0)

    if (!connection)
      return {
        kind: 'refused',
        message: `There is no remote job connection called ${key}.`,
      }

    if (connection.status !== 'active')
      return {
        kind: 'refused',
        message: `The connection ${key} is switched off.`,
      }

    const sealed = await conn.query<{ ciphertext: Buffer }>(
      `SELECT ciphertext FROM internal.pipeline_connection_secrets
        WHERE workspace_id = $1 AND connection_id = $2 AND secret_name = $3`,
      [workspaceId, connection.id, secret],
    )

    const ciphertext = sealed.rows.at(0)?.ciphertext

    if (!ciphertext)
      return {
        kind: 'refused',
        message: `The connection ${key} has no secret called ${secret}. A steward sets it in Settings.`,
      }

    return parseHpcConfig(
      key,
      connection.base_url,
      connection.settings,
      openSecret(Buffer.from(ciphertext).toString('utf8'), secretKey()),
    )
  },
  client: (connection) => slurmClient(connection),
  publicUrl: () => env.BETTER_AUTH_URL,
  now: () => new Date(),
}

/** One transaction on the app's database; rolled back if the work throws. */
export async function withAppTransaction<T>(
  fn: (conn: HpcQueryable) => Promise<T>,
): Promise<T> {
  const client = new PooledClient({ connectionString: env.DATABASE_URL })

  await client.connect()

  try {
    await client.query('BEGIN')

    try {
      const result = await fn({
        query: (text, values = []) => client.query(text, values),
      })

      await client.query('COMMIT')

      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    }
  } finally {
    await client.end().catch(() => {})
  }
}

export const realJobCallbackDeps: JobCallbackDeps = {
  withTransaction: withAppTransaction,
  now: () => new Date(),
}
