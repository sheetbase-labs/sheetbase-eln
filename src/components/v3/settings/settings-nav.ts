import type { LinkProps } from '@tanstack/react-router'

import { WORKSPACE_ADMIN_ROLES, filterNavForRole } from '#/lib/nav-visibility'
import type { NavVisibility } from '#/lib/nav-visibility'

/**
 * SHELL-01.2 — the Settings section navigation, split out of the route so the
 * role→section mapping is pure and unit-testable.
 *
 * The app already restricts these surfaces:
 * - workspace configuration and membership (General, Members and roles,
 *   Electronic signatures, Project access, Audit and retention, Diagnostics,
 *   Usage) is an owner/admin surface;
 * - Integrations and Instruments and parsers require `integrations.manage`
 *   (owner/admin/steward), see `src/routes/settings/integrations.tsx`;
 * - API and SDK (personal tokens, plus owner-only service credentials),
 *   Profile and Notifications belong to every member.
 */
export type SettingsNavItem = NavVisibility & {
  label: string
  link: LinkProps
  match: (path: string) => boolean
}

export const settingsWorkspaceNav: SettingsNavItem[] = [
  {
    label: 'General',
    link: { to: '/settings' },
    match: (p) => p === '/settings' || p === '/settings/',
    roles: WORKSPACE_ADMIN_ROLES,
  },
  {
    label: 'Members and roles',
    link: { to: '/settings/members' },
    match: (p) => p.startsWith('/settings/members'),
    roles: WORKSPACE_ADMIN_ROLES,
  },
  {
    label: 'Electronic signatures',
    link: { to: '/settings/signatures' },
    match: (p) => p.startsWith('/settings/signatures'),
    roles: WORKSPACE_ADMIN_ROLES,
  },
  {
    label: 'Instruments and parsers',
    link: { to: '/settings/instruments' },
    match: (p) => p.startsWith('/settings/instruments'),
    capability: 'integrations.manage',
  },
  {
    label: 'Integrations',
    link: { to: '/settings/integrations' },
    match: (p) => p.startsWith('/settings/integrations'),
    capability: 'integrations.manage',
  },
  {
    label: 'Project access',
    link: { to: '/settings/access' },
    match: (p) => p.startsWith('/settings/access'),
    roles: WORKSPACE_ADMIN_ROLES,
  },
  {
    label: 'Audit and retention',
    link: { to: '/settings/audit' },
    match: (p) => p.startsWith('/settings/audit'),
    roles: WORKSPACE_ADMIN_ROLES,
  },
  {
    label: 'Diagnostics',
    link: { to: '/settings/diagnostics' },
    match: (p) => p.startsWith('/settings/diagnostics'),
    roles: WORKSPACE_ADMIN_ROLES,
  },
  {
    label: 'Usage',
    link: { to: '/settings/usage' },
    match: (p) => p.startsWith('/settings/usage'),
    roles: WORKSPACE_ADMIN_ROLES,
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
    label: 'Notifications',
    link: { to: '/settings/notifications' },
    match: (p) => p.startsWith('/settings/notifications'),
  },
]

/** The Settings nav a workspace role may open. */
export function settingsNavForRole(role: string | null | undefined): {
  workspace: SettingsNavItem[]
  account: SettingsNavItem[]
} {
  return {
    workspace: filterNavForRole(settingsWorkspaceNav, role),
    account: filterNavForRole(settingsAccountNav, role),
  }
}
