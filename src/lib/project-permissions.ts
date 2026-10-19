import { useQuery } from '@tanstack/react-query'

import { notebookDataClient } from '#/lib/notebook-data'
import { fetchMyProjectAssignments } from '#/lib/workspace-access'

/**
 * Whether the signed-in user may manage a project: its lead, or anyone whose
 * project assignment carries `can_manage` (the project's owners). Gating on the
 * lead alone locked owners out of Members and Settings while the server would
 * have let them in, so the screens ask the same permission the server checks.
 */
export function useCanManageProject(
  projectId: string,
  leadUserId: string | null | undefined,
  userId: string,
): { canManage: boolean; isLoading: boolean } {
  const assignments = useQuery({
    queryKey: ['ui-port', 'project-permissions', 'mine'],
    queryFn: () => fetchMyProjectAssignments(notebookDataClient),
    staleTime: 60_000,
    retry: false,
  })
  const isLead = Boolean(leadUserId) && leadUserId === userId
  const assigned = (assignments.data ?? []).some(
    (row) => row.project_id === projectId && row.can_manage,
  )
  return { canManage: isLead || assigned, isLoading: assignments.isLoading }
}
