import { useQuery } from '@tanstack/react-query'

import {
  formatAdminNames,
  getWorkspaceAdmins,
  workspaceAdminsKey,
} from '#/lib/workspace-admins'

/**
 * "Workspace admins: Olive Owner and Sam Admin." for the lock states that tell
 * a member to ask an admin. Renders nothing until the names load, or when the
 * lookup fails, so the surrounding sentence still stands on its own.
 */
export function WorkspaceAdminsLine({
  workspaceId,
  className,
}: {
  workspaceId: string
  className?: string
}) {
  const admins = useQuery({
    queryKey: workspaceAdminsKey(workspaceId),
    queryFn: () => getWorkspaceAdmins(),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
  })
  const names = formatAdminNames(admins.data ?? [])
  if (!names) return null
  return <span className={className}> Workspace admins: {names}.</span>
}
