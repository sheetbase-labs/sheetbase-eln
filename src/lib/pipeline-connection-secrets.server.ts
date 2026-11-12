/**
 * Sealed secrets of a pipeline connection (server-side).
 *
 * A web call step names a secret; its value lives here, sealed with the same
 * envelope as connector secrets, and is only ever opened by the run that calls.
 * Setting and removing one is for owners, admins and stewards in the app: no
 * token, agent or pipeline reaches this. Only the name and the time it was set
 * leave the server, and the connection row keeps the names so the API and the
 * pipeline editor can say which exist.
 */
import { and, eq } from 'drizzle-orm'

import { sealSecret, secretKey } from './connector-secrets.server'
import { WEB_SECRET_NAME_RE } from './pipelines/web-call'

async function loadSession(workspaceId: string) {
  const [{ getRequestHeaders }, { getCurrentContext }, { db }] =
    await Promise.all([
      import('@tanstack/react-start/server'),
      import('#/lib/current-user'),
      import('#/db/client.server'),
    ])

  const context = await getCurrentContext(getRequestHeaders())

  if (!context) throw new Error('You must be signed in.')

  if (!context.workspace || context.workspace.id !== workspaceId)
    throw new Error('You do not have access to this workspace.')

  if (!['owner', 'admin', 'steward'].includes(context.workspace.role))
    throw new Error(
      'Only owners, admins or stewards manage connection secrets.',
    )

  return { db, context }
}

type Db = Awaited<ReturnType<typeof loadSession>>['db']

/** The names kept on the connection row, in step with the sealed values. */
async function syncNames(
  tx: Parameters<Parameters<Db['transaction']>[0]>[0],
  workspaceId: string,
  connectionId: string,
): Promise<string[]> {
  const { pipelineConnectionSecrets, pipelineConnections } =
    await import('#/db/schema')

  const rows = await tx
    .select({ name: pipelineConnectionSecrets.secretName })
    .from(pipelineConnectionSecrets)
    .where(
      and(
        eq(pipelineConnectionSecrets.workspaceId, workspaceId),
        eq(pipelineConnectionSecrets.connectionId, connectionId),
      ),
    )

  const names = rows.map((row) => row.name).sort()

  await tx
    .update(pipelineConnections)
    .set({ secretNames: names, updatedAt: new Date() })
    .where(
      and(
        eq(pipelineConnections.workspaceId, workspaceId),
        eq(pipelineConnections.id, connectionId),
      ),
    )

  return names
}

export async function setConnectionSecret(
  workspaceId: string,
  connectionId: string,
  secretName: string,
  value: string,
): Promise<{ secretNames: string[]; rotated: boolean }> {
  if (!WEB_SECRET_NAME_RE.test(secretName))
    throw new Error('A secret is named with letters, digits and _.')

  if (!value.trim() || /[\r\n]/.test(value))
    throw new Error('A secret value is one line and is not empty.')

  const { db, context } = await loadSession(workspaceId)

  const { pipelineConnectionSecrets, pipelineConnections } =
    await import('#/db/schema')

  const sealed = Buffer.from(sealSecret(value.trim(), secretKey()), 'utf8')

  return db.transaction(async (tx) => {
    const owned = await tx
      .select({ id: pipelineConnections.id })
      .from(pipelineConnections)
      .where(
        and(
          eq(pipelineConnections.id, connectionId),
          eq(pipelineConnections.workspaceId, workspaceId),
        ),
      )
      .then((rows) => rows.at(0))

    if (!owned) throw new Error('Connection not found in this workspace.')

    const existing = await tx
      .select({ id: pipelineConnectionSecrets.id })
      .from(pipelineConnectionSecrets)
      .where(
        and(
          eq(pipelineConnectionSecrets.connectionId, connectionId),
          eq(pipelineConnectionSecrets.secretName, secretName),
        ),
      )
      .then((rows) => rows.at(0))

    if (existing)
      await tx
        .update(pipelineConnectionSecrets)
        .set({ ciphertext: sealed, updatedAt: new Date() })
        .where(eq(pipelineConnectionSecrets.id, existing.id))
    else
      await tx.insert(pipelineConnectionSecrets).values({
        workspaceId,
        connectionId,
        secretName,
        ciphertext: sealed,
        createdByUserId: context.user.id,
      })

    return {
      secretNames: await syncNames(tx, workspaceId, connectionId),
      rotated: Boolean(existing),
    }
  })
}

export async function deleteConnectionSecret(
  workspaceId: string,
  connectionId: string,
  secretName: string,
): Promise<{ secretNames: string[] }> {
  const { db } = await loadSession(workspaceId)
  const { pipelineConnectionSecrets } = await import('#/db/schema')

  return db.transaction(async (tx) => {
    await tx
      .delete(pipelineConnectionSecrets)
      .where(
        and(
          eq(pipelineConnectionSecrets.workspaceId, workspaceId),
          eq(pipelineConnectionSecrets.connectionId, connectionId),
          eq(pipelineConnectionSecrets.secretName, secretName),
        ),
      )

    return { secretNames: await syncNames(tx, workspaceId, connectionId) }
  })
}
