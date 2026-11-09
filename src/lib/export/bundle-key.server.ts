/**
 * The workspace's key for signing export bundles.
 *
 * The pair is made the first time a bundle is downloaded. The private half
 * stays in internal.workspace_signing_keys and never leaves the server; the
 * public half goes into every bundle and is shown in Settings > Audit so
 * people can compare its fingerprint with the one inside a bundle.
 */
import { sql } from 'drizzle-orm'

import { db } from '#/db/client.server'
import { generateWorkspaceKeyPair, keyFingerprint } from './bundle-key'
import type { WorkspaceKey } from './bundle-key'

export async function ensureWorkspaceKey(
  workspaceId: string,
): Promise<WorkspaceKey> {
  const pair = generateWorkspaceKeyPair()

  const result = await db.execute<{
    public_key_pem: string
    private_key_pem: string
    fingerprint: string
    created_at: Date | string
  }>(
    sql`select * from internal.ensure_workspace_signing_key(
      ${workspaceId}::uuid, ${pair.publicKeyPem}, ${pair.privateKeyPem},
      ${keyFingerprint(pair.publicKeyPem)})`,
  )

  const row = result.rows[0] as (typeof result.rows)[number] | undefined

  if (!row) throw new Error('could not read the workspace signing key')

  return {
    publicKeyPem: row.public_key_pem,
    privateKeyPem: row.private_key_pem,
    fingerprint: row.fingerprint,
    createdAt: new Date(row.created_at).toISOString(),
  }
}
