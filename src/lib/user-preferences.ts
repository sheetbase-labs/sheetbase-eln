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

export async function fetchUserPreferences(
  client: DataClient,
): Promise<UserPreferences | null> {
  const rows = await client.list<{
    appearance: string
    nav_collapsed: boolean
  }>('user_preferences', '?limit=1&select=appearance,nav_collapsed')
  const row = rows[0]
  if (!row) return null
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
