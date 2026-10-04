import type { Client } from 'pg'

/** Explicit fixture rules, never inferred from workspace role or project lead. */
export async function grantFixtureProjectAccess({
  client,
  workspaceId,
  projectId,
  userId,
  canEdit = false,
  canReview = false,
  canManage = false,
}: {
  client: Client
  workspaceId: string
  projectId: string
  userId: string
  canEdit?: boolean
  canReview?: boolean
  canManage?: boolean
}) {
  await client.query(
    `INSERT INTO api.project_access
      (workspace_id,project_id,user_id,can_view,can_edit,can_review,can_manage,granted_by_user_id)
     VALUES ($1,$2,$3,true,$4,$5,$6,$3)
     ON CONFLICT (workspace_id,project_id,user_id) DO UPDATE
     SET can_view=true,can_edit=$4,can_review=$5,can_manage=$6`,
    [workspaceId, projectId, userId, canEdit, canReview, canManage],
  )
}
