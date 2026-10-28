/**
 * Which workspace roles get data access: the technical view of the workspace
 * (keys, API routes, Postgres names) and a personal read-only SQL login.
 *
 * `api.has_data_access()` is the authority. This module only mirrors it so the
 * first render can show or hide the technical affordances. It has no React or
 * server imports so both sides can use it.
 */

/** Roles a workspace may give data access. client_viewer never can. */
export const DATA_ACCESS_ROLE_OPTIONS = [
  { role: 'owner', label: 'Owner' },
  { role: 'admin', label: 'Administrator' },
  { role: 'member', label: 'Member' },
  { role: 'steward', label: 'Data steward' },
  { role: 'scientist', label: 'Scientist' },
  { role: 'analyst', label: 'Analyst' },
  { role: 'reviewer', label: 'Reviewer' },
  { role: 'viewer', label: 'Viewer' },
] as const

export type DataAccessRole = (typeof DATA_ACCESS_ROLE_OPTIONS)[number]['role']

/** What a workspace has until an owner or admin changes it. */
export const DEFAULT_DATA_ACCESS_ROLES: readonly string[] = ['steward']

/** True when `role` is one of the roles with data access. */
export function hasDataAccess(
  role: string | null | undefined,
  roles: readonly string[] | null | undefined,
): boolean {
  if (!role) return false
  return (roles ?? DEFAULT_DATA_ACCESS_ROLES).includes(role)
}
