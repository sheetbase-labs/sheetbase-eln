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
  }>('user_preferences', '?limit=1&select=appearance,nav_collapsed')
  const row = rows[0]
  if (rows.length === 0) return null
  return {
    appearance: toAppearance(row.appearance),
    navCollapsed: row.nav_collapsed,
  }
}

export async function setUserPreference(
  client: DataClient,
  preferences: UserPreferences,
): Promise<void> {
  await client.rpc('set_user_preference', {
    p_appearance: preferences.appearance,
    p_nav_collapsed: preferences.navCollapsed,
  })
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
  const rows = await client.rpc<
    Array<{ initials: string | null; job_title: string | null }>
  >('my_profile', {})
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
