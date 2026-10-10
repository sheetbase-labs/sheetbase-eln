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
