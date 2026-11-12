/**
 * The real connections behind the remote job module (src/lib/pipeline-hpc.server.ts):
 * the connector a step names, its sealed token, the app's own address, and a
 * transaction on the database. Kept apart so the module itself runs in tests
 * without the database client or the secret key.
 */
import { PooledClient } from '#/db/pool.server'
import { env } from '#/env.server'
import { loadConnectorSecrets } from './connectors/enterprise/secrets.server'
import { sealedSecretName } from './pipelines/remote/secret'
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
      config: unknown
    }>(
      `SELECT id, status, config FROM api.connectors
        WHERE workspace_id = $1 AND key = $2 AND connector_type = 'custom'`,
      [workspaceId, key],
    )

    const connector = rows.at(0)

    if (!connector)
      return {
        kind: 'refused',
        message: `There is no remote job connection called ${key}.`,
      }

    if (connector.status !== 'active')
      return {
        kind: 'refused',
        message: `The connection ${key} is switched off.`,
      }

    try {
      const secrets = await loadConnectorSecrets({
        workspaceId,
        connectorId: connector.id,
        required: [sealedSecretName(secret)],
      })

      return parseHpcConfig(
        key,
        connector.config,
        secrets[sealedSecretName(secret)],
      )
    } catch {
      return {
        kind: 'refused',
        message: `The connection ${key} has no secret called ${secret}. A steward sets it in Settings.`,
      }
    }
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
