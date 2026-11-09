import type { DataClient } from './data-client'
import { notebookDataClient } from './notebook-data'

/**
 * Pages a lab took out of everyone's sidebar (Settings > Lab setup >
 * Sidebar, migration 0084). Hiding a page only changes the sidebar: the page
 * still opens from search, links and the command palette.
 */
export const sidebarPagesQueryKey = (workspaceId: string) =>
  ['sidebar-pages', workspaceId] as const

export async function fetchHiddenNavPages(
  workspaceId: string,
  client: DataClient = notebookDataClient,
): Promise<string[]> {
  const rows = await client.list<{ hidden_nav_pages: string[] | null }>(
    'workspace_settings',
    `?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=hidden_nav_pages&limit=1`,
  )

  return rows[0]?.hidden_nav_pages ?? []
}

export async function setHiddenNavPages(
  workspaceId: string,
  pages: readonly string[],
  client: DataClient = notebookDataClient,
): Promise<void> {
  await client.rpc('set_hidden_nav_pages', {
    p_workspace_id: workspaceId,
    p_pages: [...pages],
  })
}
