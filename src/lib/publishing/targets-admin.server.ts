import { getRequestHeaders } from '@tanstack/react-start/server'

import { getPool } from '#/db/pool.server'
import { env } from '#/env.server'
import { getCurrentContext } from '#/lib/current-user'
import { sealSecret, secretKey } from '../connector-secrets.server'

/** Seals and stores a repository's token for an admin of its workspace. */
export async function setPublicationToken(
  targetId: string,
  token: string,
): Promise<void> {
  const context = await getCurrentContext(getRequestHeaders())

  if (!context?.workspace) throw new Error('You must be signed in.')

  if (!['owner', 'admin'].includes(context.workspace.role)) {
    throw new Error('Only owners and admins set up repositories.')
  }

  const pool = getPool(env.DATABASE_URL)

  const found = await pool.query(
    `SELECT 1 FROM api.publication_targets WHERE id = $1 AND workspace_id = $2`,
    [targetId, context.workspace.id],
  )

  if (found.rowCount === 0) throw new Error('Unknown repository.')
  await pool.query(`SELECT internal.set_publication_target_secret($1, $2)`, [
    targetId,
    sealSecret(token, secretKey()),
  ])
}
