import { db } from '#/db/client.server'
import type { SessionAuthContext } from '#/lib/request-auth'

/** Runs narrowly granted internal operations with the authenticated actor,
 * not an unscoped service identity. PostgreSQL still checks workspace authority. */
export async function withParserActor<T>(
  context: SessionAuthContext,
  operation: (query: typeof db.$client.query) => Promise<T>,
): Promise<T> {
  const client = await db.$client.connect()
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL ROLE service_role')
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({
        sub: context.userId,
        workspace_id: context.workspaceId,
        session_id: context.sessionId,
        role: 'service_role',
      }),
    ])
    const result = await operation(client.query.bind(client))
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export function recordParserFailure(
  context: SessionAuthContext,
  fileId: string,
  versionId: string | null,
  code: string,
  message: string,
) {
  return withParserActor(context, (query) =>
    query('SELECT internal.record_parser_import_failure($1,$2,$3,$4)', [
      fileId,
      versionId,
      code.slice(0, 100),
      message.slice(0, 2000),
    ]),
  )
}
