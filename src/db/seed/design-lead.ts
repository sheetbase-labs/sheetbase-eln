/**
 * Joining the design workspace as its lead scientist. The seed's own person
 * (Gareth P.) owns Process Development and its projects; whoever joins gets
 * the same standing: owner of the workspace, the same project access, groups,
 * favourites and followed items. Without the project access, Projects,
 * Experiments and every list or page built on them would be empty for them,
 * because a project's records are read only through a project access grant.
 *
 * Both ways in use it: the Demo workspace a person asks for in lab setup, and
 * the auth-free development user that `pnpm db:seed --design` signs in as.
 */
import { sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import * as schema from '../schema'
import { DESIGN_USER_IDS, DESIGN_WORKSPACE_IDS } from './design'

export async function joinDesignAsLead(
  db: NodePgDatabase<typeof schema>,
  userId: string,
): Promise<void> {
  const workspaceId = DESIGN_WORKSPACE_IDS.processDevelopment
  const lead = DESIGN_USER_IDS.gareth

  await db
    .insert(schema.workspaceMemberships)
    .values({ workspaceId, userId, role: 'owner' })
    .onConflictDoUpdate({
      target: [
        schema.workspaceMemberships.workspaceId,
        schema.workspaceMemberships.userId,
      ],
      set: { role: 'owner' },
    })

  if (userId === lead) return

  await db.execute(sql`
    INSERT INTO api.project_access
      (workspace_id, project_id, user_id, access_level, granted_by_user_id,
       can_view, can_edit, can_review, client_portal, can_manage, project_role)
    SELECT workspace_id, project_id, ${userId}, access_level, granted_by_user_id,
           can_view, can_edit, can_review, client_portal, can_manage, project_role
      FROM api.project_access
     WHERE workspace_id = ${workspaceId} AND user_id = ${lead}
    ON CONFLICT DO NOTHING`)
  await db.execute(sql`
    INSERT INTO api.workspace_group_memberships (workspace_id, group_id, user_id)
    SELECT workspace_id, group_id, ${userId}
      FROM api.workspace_group_memberships
     WHERE workspace_id = ${workspaceId} AND user_id = ${lead}
    ON CONFLICT DO NOTHING`)
  await db.execute(sql`
    INSERT INTO api.user_favourites (workspace_id, user_id, object_kind, object_id)
    SELECT workspace_id, ${userId}, object_kind, object_id
      FROM api.user_favourites
     WHERE workspace_id = ${workspaceId} AND user_id = ${lead}
    ON CONFLICT DO NOTHING`)
  await db.execute(sql`
    INSERT INTO api.work_item_follows (workspace_id, user_id, record_id)
    SELECT workspace_id, ${userId}, record_id
      FROM api.work_item_follows
     WHERE workspace_id = ${workspaceId} AND user_id = ${lead}
    ON CONFLICT DO NOTHING`)
}
