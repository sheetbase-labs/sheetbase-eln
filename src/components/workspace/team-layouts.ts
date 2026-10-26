import { useCallback, useEffect, useState } from 'react'

import { notebookDataClient } from '#/lib/notebook-data'
import { restoreSavedLayouts } from '#/lib/workspace-state'
import type { SavedLayout } from '#/lib/workspace-state'

interface TeamLayoutWire {
  id: string
  name: string
  layout: Record<string, unknown>
  updated_at: string
}

/** The workspace's shared layouts as the pane layouts they hold. A row whose
 * layout can no longer be read (a destination that moved) is left out rather
 * than opened half-broken. */
export function teamLayoutsFromRows(
  rows: TeamLayoutWire[],
  origin: string,
): SavedLayout[] {
  return restoreSavedLayouts(
    JSON.stringify(
      rows.map((row) => ({
        ...row.layout,
        id: row.id,
        name: row.name,
        savedAt: row.updated_at,
      })),
    ),
    origin,
  )
}

/** Layouts shared with the whole workspace, saved and removed on the server. */
export function useTeamLayouts(enabled: boolean) {
  const [layouts, setLayouts] = useState<SavedLayout[]>([])

  const refresh = useCallback(async () => {
    try {
      const rows = await notebookDataClient.list<TeamLayoutWire>(
        'workspace_layouts',
        '?select=id,name,layout,updated_at&order=name.asc',
      )
      setLayouts(teamLayoutsFromRows(rows, location.origin))
    } catch {
      // Shared layouts are a convenience; the personal ones still work.
    }
  }, [])

  useEffect(() => {
    if (enabled) void refresh()
  }, [enabled, refresh])

  const share = useCallback(
    async (layout: SavedLayout) => {
      await notebookDataClient.rpc('save_team_layout', {
        p_name: layout.name,
        p_layout: layout,
      })
      await refresh()
    },
    [refresh],
  )

  const remove = useCallback(
    async (id: string) => {
      await notebookDataClient.rpc('delete_team_layout', { p_id: id })
      await refresh()
    },
    [refresh],
  )

  return { layouts, share, remove }
}
