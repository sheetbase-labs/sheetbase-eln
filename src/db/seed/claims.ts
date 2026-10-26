import { Client } from 'pg'

import type { SeedStep } from './run'

/**
 * Runs `fn` as `actorId` in `workspaceId` through the PostgREST role with JWT
 * claims, the same write actor the app uses, so capability and RLS checks run.
 */
export async function withDesignClaims<T>(
  db: Parameters<SeedStep['run']>[0],
  actorId: string,
  workspaceId: string,
  fn: (client: Client) => Promise<T>,
  sessionId?: string,
): Promise<T> {
  const poolCs = db.$client.options.connectionString
  const pgrst = new URL(process.env.PGRST_DB_URI ?? '')
  if (!poolCs || !pgrst.username) {
    throw new Error('PGRST_DB_URI and the pool connection string are required')
  }
  const authUrl = new URL(poolCs)
  authUrl.username = pgrst.username
  authUrl.password = pgrst.password
  const client = new Client({ connectionString: authUrl.toString() })
  await client.connect()
  try {
    await client.query('SET ROLE authenticated')
    await client.query("SELECT set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({
        sub: actorId,
        workspace_id: workspaceId,
        role: 'authenticated',
        ...(sessionId ? { session_id: sessionId } : {}),
      }),
    ])
    return await fn(client)
  } finally {
    await client.query('RESET ROLE').catch(() => {})
    await client.end()
  }
}
