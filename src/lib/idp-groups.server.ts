/**
 * Applying a person's sign-in groups to the workspaces that map them
 * (`internal.apply_idp_groups`, migration 0092). Shared by the OIDC and SAML
 * sign-ins.
 */
import { sql } from 'drizzle-orm'

import type { db } from '#/db/client.server'
import { logger } from './logger'
import { annotateRequest } from './request-log'

/**
 * Never allowed to fail the sign-in itself. The groups go to the database as
 * one array value: spread into the statement, one name becomes a bare string
 * and several become a row, and neither is a list of names.
 */
export async function applyIdpGroups(
  database: typeof db,
  userId: string,
  groups: string[],
): Promise<void> {
  try {
    const result = await database.execute<{ n: number }>(
      sql`select internal.apply_idp_groups(${userId}, ${sql.param(groups)}::text[]) as n`,
    )
    annotateRequest({
      sso_groups: {
        count: groups.length,
        roles_changed: Number(result.rows[0]?.n ?? 0),
      },
    })
  } catch (error) {
    logger.warn('sso groups could not be applied', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
