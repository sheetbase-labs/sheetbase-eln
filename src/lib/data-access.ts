import { useRouteContext } from '@tanstack/react-router'

/**
 * Who sees technical handles (keys, API routes, Postgres names). The workspace
 * setting is authoritative in SQL (`api.has_data_access()`); this mirrors it
 * for the UI so the affordances paint on the first render. Everyone outside
 * the list sees no trace of them.
 */
export const DEFAULT_DATA_ACCESS_ROLES: readonly string[] = ['steward']

export function canUseDataAccess(
  role: string | null | undefined,
  roles: readonly string[] = DEFAULT_DATA_ACCESS_ROLES,
): boolean {
  if (!role || role === 'client_viewer') return false
  return roles.includes(role)
}

/** Whether the signed-in member is in a role the data-access setting enables. */
export function useDataAccess(): boolean {
  const { auth } = useRouteContext({ from: '__root__' })
  return canUseDataAccess(auth?.workspace?.role)
}
