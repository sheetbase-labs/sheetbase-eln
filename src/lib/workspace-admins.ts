import { createServerFn } from '@tanstack/react-start'

export interface WorkspaceAdminContact {
  name: string
  email: string
  role: string
}

/**
 * Who administers the caller's active workspace (active owners and admins).
 * Readable by every member, because the Members page is admin-only and "Ask a
 * workspace admin" is otherwise a pointer to nobody (J-SET-16).
 */
export const getWorkspaceAdmins = createServerFn({ method: 'GET' }).handler(
  async (): Promise<WorkspaceAdminContact[]> => {
    const { getRequestHeaders } = await import('@tanstack/react-start/server')
    const { getCurrentContext, listAccessContacts } =
      await import('#/lib/current-user')
    const context = await getCurrentContext(getRequestHeaders())
    if (!context?.workspace || context.workspace.suspended) return []
    return listAccessContacts(context.workspace.id)
  },
)

export const workspaceAdminsKey = (workspaceId: string) =>
  ['workspace-admins', workspaceId] as const

/** "Olive Owner and Sam Admin", or null when there is nobody to name. */
export function formatAdminNames(
  admins: readonly { name: string }[],
): string | null {
  const names = admins.map((a) => a.name)
  if (names.length === 0) return null
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}
