import { hasCapability } from './capability'
import type { Capability } from './capability'

/**
 * SHELL-01.2 — role-aware navigation.
 *
 * The design says "sections a role cannot open are omitted, not disabled" but
 * defines no ELN role map. Navigation reuses the CORE-05 capability vocabulary
 * (mirrored authoritatively in SQL `api.has_capability`) and the workspace role
 * list from `workspace-admin`. An entry with neither `roles` nor `capability`
 * is visible to everyone, including a caller with no workspace role: everyday
 * scientific navigation must never disappear.
 */
export type NavVisibility = {
  /** Explicit allow-list of workspace roles. Omitted means any role. */
  roles?: readonly string[]
  /**
   * Requires a CORE-05 capability. Combined with `roles` as an AND when both
   * are present.
   */
  capability?: Capability
}

export type NavViewer = {
  role: string | null | undefined
}

/** Workspace configuration and membership: owners and admins. */
export const WORKSPACE_ADMIN_ROLES = ['owner', 'admin'] as const

export function canSeeNavItem(item: NavVisibility, viewer: NavViewer): boolean {
  const role = viewer.role ?? null
  if (item.capability && !hasCapability(role, item.capability)) return false
  if (item.roles && (role === null || !item.roles.includes(role))) return false
  return true
}

export function filterNavForRole<T extends NavVisibility>(
  items: readonly T[],
  role: string | null | undefined,
): T[] {
  return items.filter((item) => canSeeNavItem(item, { role }))
}
