import type { LinkProps } from '@tanstack/react-router'

import { resolveSettingsAccess } from '#/lib/settings-access'
import type { SettingsAccessMap, SettingsArea } from '#/lib/settings-access'

/**
 * SHELL-01.2 — the Settings section navigation, split out of the route so the
 * access→section mapping is pure and unit-testable.
 *
 * Each workspace section belongs to a settings `area`, and a role sees it when
 * the workspace lets that role view or manage the area (Roles and permissions;
 * the defaults are in `#/lib/settings-access`). Everyone certifies their own
 * signature under My signature in the Account section; Electronic signatures
 * here is the workspace policy. API and SDK (personal tokens), Profile and
 * Notifications belong to every member.
 */
export type SettingsNavItem = {
  label: string
  link: LinkProps
  match: (path: string) => boolean
  /** The settings area whose access decides whether the section shows. */
  area?: SettingsArea
  /** Roles that see the section whatever their area access. */
  alwaysFor?: readonly string[]
}

/** Roles that author records and so certify their own signature. A read-only
 * viewer or a client has nothing to sign. */
const SIGNING_ROLES = [
  'owner',
  'admin',
  'steward',
  'member',
  'scientist',
  'analyst',
  'reviewer',
] as const

/** Whether a workspace role certifies its own signature. */
export function isSigningRole(role: string): boolean {
  return (SIGNING_ROLES as readonly string[]).includes(role)
}

export const settingsWorkspaceNav: SettingsNavItem[] = [
  {
    label: 'General',
    link: { to: '/settings' },
    match: (p) => p === '/settings' || p === '/settings/',
    area: 'general',
  },
  {
    label: 'AI',
    link: { to: '/settings/ai' },
    match: (p) => p.startsWith('/settings/ai'),
    area: 'ai',
  },
  {
    label: 'Members and roles',
    link: { to: '/settings/members' },
    match: (p) =>
      p.startsWith('/settings/members') || p.startsWith('/settings/roles'),
    area: 'members',
  },
  {
    label: 'Electronic signatures',
    link: { to: '/settings/signatures' },
    match: (p) => p.startsWith('/settings/signatures'),
    area: 'signatures',
  },
  {
    label: 'Clients',
    link: { to: '/settings/clients' },
    match: (p) => p.startsWith('/settings/clients'),
    area: 'clients',
  },
  {
    label: 'Instruments and parsers',
    link: { to: '/settings/instruments' },
    match: (p) => p.startsWith('/settings/instruments'),
    area: 'instruments',
  },
  {
    label: 'Integrations',
    link: { to: '/settings/integrations' },
    match: (p) => p.startsWith('/settings/integrations'),
    area: 'integrations',
  },
  {
    label: 'Storage and labels',
    link: { to: '/settings/storage' },
    match: (p) => p.startsWith('/settings/storage'),
    roles: [...WORKSPACE_ADMIN_ROLES, 'steward'],
  },
  {
    label: 'Project access',
    link: { to: '/settings/access' },
    match: (p) => p.startsWith('/settings/access'),
    area: 'access',
  },
  {
    label: 'Audit and retention',
    link: { to: '/settings/audit' },
    match: (p) => p.startsWith('/settings/audit'),
    area: 'audit',
  },
  {
    label: 'Diagnostics',
    link: { to: '/settings/diagnostics' },
    match: (p) => p.startsWith('/settings/diagnostics'),
    area: 'diagnostics',
  },
  {
    label: 'Usage',
    link: { to: '/settings/usage' },
    match: (p) => p.startsWith('/settings/usage'),
    area: 'usage',
  },
  {
    label: 'API and SDK',
    link: { to: '/settings/api' },
    match: (p) => p.startsWith('/settings/api'),
  },
]

export const settingsAccountNav: SettingsNavItem[] = [
  {
    label: 'Profile',
    link: { to: '/settings/profile' },
    match: (p) => p.startsWith('/settings/profile'),
  },
  {
    label: 'My signature',
    link: { to: '/settings/my-signature' },
    match: (p) => p.startsWith('/settings/my-signature'),
    alwaysFor: SIGNING_ROLES,
  },
  {
    label: 'Notifications',
    link: { to: '/settings/notifications' },
    match: (p) => p.startsWith('/settings/notifications'),
  },
]

/** Whether a role (with its resolved access) may open a nav section. */
export function canOpenSettingsItem(
  item: SettingsNavItem,
  role: string | null | undefined,
  access: SettingsAccessMap,
): boolean {
  if (!item.area && !item.alwaysFor) return true
  if (item.alwaysFor && role && item.alwaysFor.includes(role)) return true
  return item.area ? access[item.area] !== 'none' : false
}

/** The nav section a settings path belongs to, if any. */
export function settingsItemForPath(path: string): SettingsNavItem | undefined {
  return [...settingsWorkspaceNav, ...settingsAccountNav].find((i) =>
    i.match(path),
  )
}

/** Where the Settings entry points open: General for anyone who can open it,
 * anyone else on their own profile rather than a refusal. */
export function settingsHomePath(
  role: string | null | undefined,
  access: SettingsAccessMap = resolveSettingsAccess(role),
): '/settings' | '/settings/profile' {
  return access.general !== 'none' ? '/settings' : '/settings/profile'
}

/** The Settings nav a role may open, given the workspace's access choices
 * (the role's defaults when none are passed). */
export function settingsNavForRole(
  role: string | null | undefined,
  access: SettingsAccessMap = resolveSettingsAccess(role),
): {
  workspace: SettingsNavItem[]
  account: SettingsNavItem[]
} {
  return {
    workspace: settingsWorkspaceNav.filter((i) =>
      canOpenSettingsItem(i, role, access),
    ),
    account: settingsAccountNav.filter((i) =>
      canOpenSettingsItem(i, role, access),
    ),
  }
}
