/**
 * Single sign-on groups. The identity provider sends a person's groups with
 * the sign-in; a workspace maps those groups to roles (migration 0092). The
 * sign-in itself finishes in another step from the one that reads the groups,
 * so they are held here briefly, keyed by the person's address, and taken by
 * the step that knows who signed in.
 */

/** The claim most providers use; `OIDC_GROUPS_CLAIM` names another. */
export const DEFAULT_GROUPS_CLAIM = 'groups'

/** Long enough to cross one sign-in, short enough to never outlive it. */
const HOLD_MS = 2 * 60 * 1000

const held = new Map<string, { groups: string[]; until: number }>()

/**
 * The groups in a profile, or null when it carries no such claim at all. A
 * claim that is present and empty means "in no groups", which is different:
 * the first changes nothing, the second takes roles away.
 */
export function groupsFromProfile(
  profile: Record<string, unknown>,
  claim: string = DEFAULT_GROUPS_CLAIM,
): string[] | null {
  const value = profile[claim]

  if (value === undefined || value === null) return null

  const list: unknown[] = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : []

  return list
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export function holdGroups(
  email: string,
  groups: string[],
  at: number = Date.now(),
): void {
  for (const [key, entry] of held) if (entry.until < at) held.delete(key)
  held.set(email.toLowerCase(), { groups, until: at + HOLD_MS })
}

/** Take (and forget) the groups held for an address. */
export function takeGroups(
  email: string,
  at: number = Date.now(),
): string[] | null {
  const key = email.toLowerCase()
  const entry = held.get(key)
  held.delete(key)

  return entry && entry.until >= at ? entry.groups : null
}
