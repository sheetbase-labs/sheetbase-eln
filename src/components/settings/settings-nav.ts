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
/** The three places Settings is split into: the lab's day-to-day set-up, the
 * workspace's own administration, and each person's account. */
export type SettingsPlace = 'lab' | 'workspace' | 'account'

export const settingsPlaces: readonly { key: SettingsPlace; label: string }[] =
  [
    { key: 'lab', label: 'Lab setup' },
    { key: 'workspace', label: 'Workspace' },
    { key: 'account', label: 'Account' },
  ]

export type SettingsNavItem = {
  label: string
  link: LinkProps
  match: (path: string) => boolean
  /** Which of the three settings places the section belongs to. */
  place: SettingsPlace
  /** The small heading the section sits under in the side list. */
  cluster?: string
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

const PEOPLE = 'People and access'
const POLICY = 'Policy'
const HEALTH = 'Health and data'

/** Roles that may change models (`schema.edit`). */
const MODEL_ROLES = ['owner', 'admin', 'steward'] as const

export const settingsLabNav: SettingsNavItem[] = [
  // Models are lab set-up rather than daily work, so they are listed here and
  // not in the sidebar. The page keeps its own full-width layout at /models,
  // since the model editor needs the room.
  {
    place: 'lab',
    label: 'Models',
    link: { to: '/models' },
    match: (p) => p === '/models' || p.startsWith('/models/'),
    alwaysFor: MODEL_ROLES,
  },
  {
    place: 'lab',
    label: 'Storage locations',
    link: { to: '/settings/lab/storage' },
    match: (p) => p.startsWith('/settings/lab/storage'),
    area: 'storage',
  },
  {
    place: 'lab',
    label: 'Label templates',
    link: { to: '/settings/lab/labels' },
    match: (p) => p.startsWith('/settings/lab/labels'),
    area: 'storage',
  },
  {
    place: 'lab',
    label: 'Sample release',
    link: { to: '/settings/lab/release' },
    match: (p) => p.startsWith('/settings/lab/release'),
    area: 'storage',
  },
  {
    place: 'lab',
    label: 'Sample workflows',
    link: { to: '/settings/lab/workflows' },
    match: (p) => p.startsWith('/settings/lab/workflows'),
    area: 'storage',
  },
  {
    place: 'lab',
    label: 'Instruments and parsers',
    link: { to: '/settings/lab/instruments' },
    match: (p) => p.startsWith('/settings/lab/instruments'),
    area: 'instruments',
  },
  {
    place: 'lab',
    label: 'Retention and holds',
    link: { to: '/settings/lab/retention' },
    match: (p) => p.startsWith('/settings/lab/retention'),
    area: 'general',
  },
  {
    place: 'lab',
    label: 'Scheduled reports',
    link: { to: '/settings/lab/reports' },
    match: (p) => p.startsWith('/settings/lab/reports'),
    area: 'general',
  },
  {
    place: 'lab',
    label: 'Sidebar',
    link: { to: '/settings/lab/sidebar' },
    match: (p) => p.startsWith('/settings/lab/sidebar'),
    area: 'general',
  },
]

export const settingsWorkspaceNav: SettingsNavItem[] = [
  {
    place: 'workspace',
    cluster: PEOPLE,
    label: 'Members and roles',
    link: { to: '/settings/workspace/members' },
    match: (p) =>
      p.startsWith('/settings/workspace/members') ||
      p.startsWith('/settings/workspace/roles'),
    area: 'members',
  },
  {
    place: 'workspace',
    cluster: PEOPLE,
    label: 'Project access',
    link: { to: '/settings/workspace/access' },
    match: (p) => p.startsWith('/settings/workspace/access'),
    area: 'access',
  },
  {
    place: 'workspace',
    cluster: PEOPLE,
    label: 'Clients',
    link: { to: '/settings/workspace/clients' },
    match: (p) => p.startsWith('/settings/workspace/clients'),
    area: 'clients',
  },
  {
    place: 'workspace',
    cluster: POLICY,
    label: 'General',
    link: { to: '/settings/workspace' },
    match: (p) => p === '/settings/workspace' || p === '/settings/workspace/',
    area: 'general',
  },
  {
    place: 'workspace',
    cluster: POLICY,
    label: 'Electronic signatures',
    link: { to: '/settings/workspace/signatures' },
    match: (p) => p.startsWith('/settings/workspace/signatures'),
    area: 'signatures',
  },
  {
    place: 'workspace',
    cluster: POLICY,
    label: 'AI',
    link: { to: '/settings/workspace/ai' },
    match: (p) => p.startsWith('/settings/workspace/ai'),
    area: 'ai',
  },
  {
    place: 'workspace',
    cluster: HEALTH,
    label: 'Integrations',
    link: { to: '/settings/workspace/integrations' },
    match: (p) => p.startsWith('/settings/workspace/integrations'),
    area: 'integrations',
  },
  {
    place: 'workspace',
    cluster: HEALTH,
    label: 'Plugins',
    link: { to: '/settings/workspace/plugins' },
    match: (p) => p.startsWith('/settings/workspace/plugins'),
    // Administrators only: it follows General, which only they hold by default.
    area: 'general',
  },
  {
    place: 'workspace',
    cluster: HEALTH,
    label: 'Open data',
    link: { to: '/settings/workspace/open-data' },
    match: (p) => p.startsWith('/settings/workspace/open-data'),
    area: 'integrations',
  },
  {
    place: 'workspace',
    cluster: HEALTH,
    label: 'Audit and retention',
    link: { to: '/settings/workspace/audit' },
    match: (p) =>
      p.startsWith('/settings/workspace/audit') ||
      p.startsWith('/settings/workspace/validation'),
    area: 'audit',
  },
  {
    place: 'workspace',
    cluster: HEALTH,
    label: 'Usage',
    link: { to: '/settings/workspace/usage' },
    match: (p) => p.startsWith('/settings/workspace/usage'),
    area: 'usage',
  },
  {
    place: 'workspace',
    cluster: HEALTH,
    label: 'Diagnostics',
    link: { to: '/settings/workspace/diagnostics' },
    match: (p) => p.startsWith('/settings/workspace/diagnostics'),
    area: 'diagnostics',
  },
  {
    place: 'workspace',
    cluster: HEALTH,
    label: 'Backups and export',
    link: { to: '/settings/workspace/backups' },
    match: (p) => p.startsWith('/settings/workspace/backups'),
    area: 'backups',
  },
]

export const settingsAccountNav: SettingsNavItem[] = [
  {
    place: 'account',
    label: 'Profile',
    link: { to: '/settings/account/profile' },
    match: (p) => p.startsWith('/settings/account/profile'),
  },
  {
    place: 'account',
    label: 'My signature',
    link: { to: '/settings/account/signature' },
    match: (p) => p.startsWith('/settings/account/signature'),
    alwaysFor: SIGNING_ROLES,
  },
  {
    place: 'account',
    label: 'Out of office',
    link: { to: '/settings/account/away' },
    match: (p) => p.startsWith('/settings/account/away'),
  },
  {
    place: 'account',
    label: 'Lab watchers',
    link: { to: '/settings/account/watchers' },
    match: (p) => p.startsWith('/settings/account/watchers'),
  },
  {
    place: 'account',
    label: 'Notifications',
    link: { to: '/settings/account/notifications' },
    match: (p) => p.startsWith('/settings/account/notifications'),
  },
  {
    place: 'account',
    label: 'API and SDK',
    link: { to: '/settings/account/api' },
    match: (p) => p.startsWith('/settings/account/api'),
  },
]

const ALL_ITEMS = [
  ...settingsLabNav,
  ...settingsWorkspaceNav,
  ...settingsAccountNav,
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
  return ALL_ITEMS.find((i) => i.match(path))
}

/** Which of the three places a settings path is in. */
export function settingsPlaceForPath(path: string): SettingsPlace | undefined {
  return settingsItemForPath(path)?.place
}

/** The Settings nav a role may open, given the workspace's access choices
 * (the role's defaults when none are passed), by place. */
export function settingsNavForRole(
  role: string | null | undefined,
  access: SettingsAccessMap = resolveSettingsAccess(role),
): Record<SettingsPlace, SettingsNavItem[]> {
  const open = (items: SettingsNavItem[]) =>
    items.filter((i) => canOpenSettingsItem(i, role, access))

  return {
    lab: open(settingsLabNav),
    workspace: open(settingsWorkspaceNav),
    account: open(settingsAccountNav),
  }
}

/** Where the Settings entry points open: the first section the role may open,
 * Workspace before Lab setup before Account, so an admin lands on General and
 * a member on their own profile. */
export function settingsHomePath(
  role: string | null | undefined,
  access: SettingsAccessMap = resolveSettingsAccess(role),
): string {
  const nav = settingsNavForRole(role, access)

  // Only a section inside Settings: Models opens its own page.
  const first = [...nav.workspace, ...nav.lab, ...nav.account].find((i) =>
    String(i.link.to).startsWith('/settings'),
  )

  return (first?.link.to as string | undefined) ?? '/settings/account/profile'
}
