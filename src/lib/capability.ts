import type { WorkspaceRole } from './workspace-admin'

/**
 * CORE-05 capability vocabulary. PostgreSQL `api.has_capability` is
 * authoritative; this module mirrors the role mapping for UI gating.
 * Capabilities are not placed in JWT claims.
 */
export const CAPABILITIES = [
  'workspace.admin',
  'schema.edit',
  'schema.publish',
  'schema.retire',
  'record.link',
  'record.create',
  'instance.upgrade',
  'integrations.manage',
] as const

export type Capability = (typeof CAPABILITIES)[number]

const GOVERNED_SCHEMA_ROLES: ReadonlySet<string> = new Set([
  'owner',
  'admin',
  'steward',
])

const MEMBER_CLASS_ROLES: ReadonlySet<string> = new Set([
  'owner',
  'admin',
  'member',
  'steward',
  'scientist',
  'analyst',
  'reviewer',
])

/**
 * Role → capability mapping. Roles assign capabilities; later grants should
 * change resolution here and in SQL `api.has_capability`, not individual RPCs.
 *
 * GOV-01: `viewer` is read-only (no record.create / record.link /
 * instance.upgrade). Unused roles `scientist`, `analyst` and `reviewer`
 * remain member-class data actors and do not receive governed schema authority.
 */
export function capabilitiesForRole(role: WorkspaceRole): Capability[] {
  return CAPABILITIES.filter((capability) => hasCapability(role, capability))
}

export function hasCapability(
  role: string | null | undefined,
  capability: Capability,
): boolean {
  if (!role) return false
  switch (capability) {
    case 'workspace.admin':
      return role === 'owner'
    case 'schema.edit':
    case 'schema.publish':
    case 'schema.retire':
      return GOVERNED_SCHEMA_ROLES.has(role)
    case 'record.link':
    case 'record.create':
    case 'instance.upgrade':
      return MEMBER_CLASS_ROLES.has(role)
    case 'integrations.manage':
      return GOVERNED_SCHEMA_ROLES.has(role)
    default:
      return false
  }
}
