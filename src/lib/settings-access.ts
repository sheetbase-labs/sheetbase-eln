/**
 * Which roles reach each settings area, as the workspace configured it
 * (Settings → Members and roles → Roles and permissions).
 *
 * The database is authoritative: `api.settings_access_level` and
 * `api.has_settings_access` resolve the same mapping for every settings RPC
 * and for `api.has_capability`. This module mirrors the defaults so the nav and
 * the pages can decide what to show without a round trip.
 */

export const SETTINGS_AREAS = [
  'general',
  'ai',
  'members',
  'signatures',
  'clients',
  'instruments',
  'integrations',
  'storage',
  'access',
  'audit',
  'diagnostics',
  'usage',
] as const

export type SettingsArea = (typeof SETTINGS_AREAS)[number]

export const SETTINGS_AREA_LABELS: Record<SettingsArea, string> = {
  general: 'General',
  ai: 'AI',
  members: 'Members and roles',
  signatures: 'Electronic signatures',
  clients: 'Clients',
  instruments: 'Instruments and parsers',
  integrations: 'Integrations',
  storage: 'Storage and labels',
  access: 'Project access',
  audit: 'Audit and retention',
  diagnostics: 'Diagnostics',
  usage: 'Usage',
}

/** The roles an owner can set a level for. An owner always manages every
 * area, and client viewers never reach settings. */
export const SETTINGS_ACCESS_ROLES = [
  'admin',
  'steward',
  'scientist',
  'analyst',
  'reviewer',
  'viewer',
] as const

export type SettingsAccessRole = (typeof SETTINGS_ACCESS_ROLES)[number]

export type SettingsLevel = 'none' | 'view' | 'manage'

export type SettingsAccessMap = Record<SettingsArea, SettingsLevel>

/** One stored choice: a role's level for an area. */
export interface SettingsAccessRow {
  area: string
  role: string
  level: string
}

const STEWARD_AREAS: ReadonlySet<SettingsArea> = new Set([
  'instruments',
  'integrations',
  'storage',
])

/** What a role gets where the workspace made no choice. Keep in step with
 * `internal.settings_access_default`. */
export function defaultSettingsLevel(
  area: SettingsArea,
  role: string | null | undefined,
): SettingsLevel {
  if (role === 'owner' || role === 'admin') return 'manage'
  if (role === 'steward' && STEWARD_AREAS.has(area)) return 'manage'
  return 'none'
}

/** The roles `member` shares a column with: the matrix shows Scientist for
 * both, and a choice is stored against each. */
export const MEMBER_CLASS_ROLES = ['member', 'scientist'] as const

function asLevel(value: string): SettingsLevel | null {
  return value === 'none' || value === 'view' || value === 'manage'
    ? value
    : null
}

/** The level one role has in one area, given the stored choices. */
export function settingsLevelFor(
  area: SettingsArea,
  role: string | null | undefined,
  rows: readonly SettingsAccessRow[] = [],
): SettingsLevel {
  if (role === 'owner') return 'manage'
  if (!role || role === 'client_viewer') return 'none'
  const stored = rows.find((r) => r.area === area && r.role === role)
  return (stored && asLevel(stored.level)) || defaultSettingsLevel(area, role)
}

/** Every area's level for one role. */
export function resolveSettingsAccess(
  role: string | null | undefined,
  rows: readonly SettingsAccessRow[] = [],
): SettingsAccessMap {
  return Object.fromEntries(
    SETTINGS_AREAS.map((area) => [area, settingsLevelFor(area, role, rows)]),
  ) as SettingsAccessMap
}

/** The levels for a workspace context: the server-resolved map when the
 * context carries one, else the role's defaults. */
export function settingsAccessOf(
  workspace:
    | { role?: string | null; settingsAccess?: SettingsAccessMap | undefined }
    | null
    | undefined,
): SettingsAccessMap {
  return workspace?.settingsAccess ?? resolveSettingsAccess(workspace?.role)
}

export function settingsLevelOf(
  workspace: Parameters<typeof settingsAccessOf>[0],
  area: SettingsArea,
): SettingsLevel {
  return settingsAccessOf(workspace)[area]
}

/** Can the signed-in role change this area's settings? */
export function canManageSettings(
  workspace: Parameters<typeof settingsAccessOf>[0],
  area: SettingsArea,
): boolean {
  return settingsLevelOf(workspace, area) === 'manage'
}

/** Can the signed-in role open this area at all (view or manage)? */
export function canOpenSettings(
  workspace: Parameters<typeof settingsAccessOf>[0],
  area: SettingsArea,
): boolean {
  return settingsLevelOf(workspace, area) !== 'none'
}

export const SETTINGS_LEVEL_LABELS: Record<SettingsLevel, string> = {
  none: 'None',
  view: 'View',
  manage: 'Manage',
}

/** What each role can do, in the words a scientist would use. */
export const ROLE_PLAIN_DESCRIPTIONS: Record<string, string> = {
  owner:
    'Runs the workspace. Always has full access to every setting and can’t be locked out.',
  admin:
    'Sets up the workspace, its people and its settings. Can’t sign records they didn’t author or review.',
  steward:
    'Looks after the data: models, measurement tables, instruments (registering them and recording calibrations), parsers, and integrations.',
  scientist:
    'Creates and edits experiments, samples and datasets in their projects. Signs as author.',
  analyst:
    'Works with datasets and analyses in their projects, and records results.',
  reviewer:
    'Everything a scientist can do, plus reviews and signs other people’s records.',
  viewer: 'Reads, copies, exports and comments. Can’t change anything.',
  client_viewer:
    'An outside client. Sees only the approved records shared with them.',
}

/**
 * The day-to-day work a role can be allowed or not. Everyone who could write
 * before can still until the workspace changes a role's choice; the choice is
 * stored with the settings access choices, under `work_<key>`. Keep in step
 * with `api.has_capability` (`work.<key>`).
 */
export const WORK_PERMISSIONS = [
  'comments',
  'records',
  'experiments',
  'sheets',
  'samples',
  'datasets',
  'planning',
  'protocols',
  'reports',
  'approvals',
  'client_sharing',
  'runs',
  'parsers',
] as const

export type WorkPermission = (typeof WORK_PERMISSIONS)[number]

const WORK_DEFAULT_ROLES: ReadonlySet<string> = new Set([
  'owner',
  'admin',
  'member',
  'steward',
  'scientist',
  'analyst',
  'reviewer',
])

/** Whether a role may do this kind of work, given the stored choices. */
export function workPermissionAllowed(
  permission: WorkPermission,
  role: string | null | undefined,
  rows: readonly SettingsAccessRow[] = [],
): boolean {
  if (role === 'owner') return true
  if (!role || role === 'client_viewer') return false
  const stored = rows.find(
    (r) => r.area === `work_${permission}` && r.role === role,
  )
  if (stored) return stored.level === 'manage'
  return WORK_DEFAULT_ROLES.has(role)
}
