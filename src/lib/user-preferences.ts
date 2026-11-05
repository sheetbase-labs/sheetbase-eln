import type { DataClient } from './data-client'

/**
 * Per-user appearance and navigation preferences (SHELL-02). Reads go straight
 * to the caller's own `api.user_preferences` row under RLS; writes go through
 * the `set_user_preference` RPC so the user id comes from request claims.
 */
export type Appearance = 'system' | 'light' | 'dark'

export interface UserPreferences {
  appearance: Appearance
  navCollapsed: boolean
  /** The sidebar groups this person folded (`work`, `lab`, ...). */
  navFolded: string[]
}

export const userPreferencesQueryKeys = {
  all: ['user-preferences'] as const,
}

function toAppearance(value: unknown): Appearance {
  return value === 'light' || value === 'dark' ? value : 'system'
}

/** The read in flight, so the theme and the sidebar, which both ask on first
 * paint, share one request instead of sending one each. */
let inflight: Promise<UserPreferences | null> | null = null

export function fetchUserPreferences(
  client: DataClient,
): Promise<UserPreferences | null> {
  inflight ??= readUserPreferences(client).finally(() => {
    inflight = null
  })
  return inflight
}

async function readUserPreferences(
  client: DataClient,
): Promise<UserPreferences | null> {
  const rows = await client.list<{
    appearance: string
    nav_collapsed: boolean
    nav_folded: string[] | null
  }>('user_preferences', '?limit=1&select=appearance,nav_collapsed,nav_folded')
  const row = rows[0]
  if (rows.length === 0) return null
  return {
    appearance: toAppearance(row.appearance),
    navCollapsed: row.nav_collapsed,
    navFolded: row.nav_folded ?? [],
  }
}

export async function setUserPreference(
  client: DataClient,
  preferences: Pick<UserPreferences, 'appearance' | 'navCollapsed'>,
): Promise<void> {
  await client.rpc('set_user_preference', {
    p_appearance: preferences.appearance,
    p_nav_collapsed: preferences.navCollapsed,
  })
}

/** Remember which sidebar groups this person folded. */
export async function setNavFolded(
  client: DataClient,
  groups: readonly string[],
): Promise<void> {
  await client.rpc('set_nav_folded', { p_groups: [...groups] })
}

/** Update only the appearance, leaving the navigation state untouched. */
export async function setUserAppearance(
  client: DataClient,
  appearance: Appearance,
): Promise<void> {
  await client.rpc('set_user_appearance', { p_appearance: appearance })
}

/** Switch the user's active workspace (SHELL-01.4). */
export async function setActiveWorkspace(
  client: DataClient,
  workspaceId: string,
): Promise<void> {
  await client.rpc('set_active_workspace', { p_workspace_id: workspaceId })
}

/**
 * Set the zone this person reads times in (`user_preferences.timezone`).
 * Stored instants stay UTC; the database validates the name against its zone
 * list and refuses an unknown one.
 */
export async function setUserTimeZone(
  client: DataClient,
  timeZone: string,
): Promise<void> {
  await client.rpc('set_user_profile', { p_timezone: timeZone })
}

export interface MyProfile {
  initials: string
  jobTitle: string
}

export const myProfileQueryKey = ['my-profile'] as const

/** Initials (derived from the name until set) and job title. */
export async function fetchMyProfile(client: DataClient): Promise<MyProfile> {
  // A GET: the account menu reads this on every page, and a read without a
  // body is safe to cancel when the page changes.
  const rows = await client.list<{
    initials: string | null
    job_title: string | null
  }>('rpc/my_profile')
  const row = rows.at(0)
  return { initials: row?.initials ?? '', jobTitle: row?.job_title ?? '' }
}

export async function setUserProfileFields(
  client: DataClient,
  fields: { initials?: string; jobTitle?: string },
): Promise<void> {
  await client.rpc('set_user_profile', {
    p_initials: fields.initials ?? null,
    p_job_title: fields.jobTitle ?? null,
  })
}
