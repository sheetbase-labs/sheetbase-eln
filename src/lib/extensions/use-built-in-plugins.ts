import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { extensionQueryKeys } from './client'

/**
 * Owners and administrators install or update the plugins that ship with
 * Sheetbase the first time they open the app in a browser session. The server
 * does nothing when they are already current, and leaves a plugin alone that an
 * administrator turned off.
 */
export function useBuiltInPlugins(workspaceId: string | null, role: string) {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!workspaceId || (role !== 'owner' && role !== 'admin')) return
    const key = `sheetbase.built-in-plugins.${workspaceId}`
    try {
      if (window.sessionStorage.getItem(key)) return
      window.sessionStorage.setItem(key, '1')
    } catch {
      // No session storage: run it, once per page load.
    }
    void fetch('/api/plugins/built-in', { method: 'POST' })
      .then(async (response) => {
        if (!response.ok) throw new Error('refused')
        const body = (await response.json()) as {
          plugins?: Array<{ action: string }>
        }
        if (body.plugins?.some((plugin) => plugin.action !== 'unchanged'))
          await queryClient.invalidateQueries({
            queryKey: extensionQueryKeys.extensions,
          })
      })
      .catch(() => {
        try {
          window.sessionStorage.removeItem(key)
        } catch {
          // Nothing to undo.
        }
      })
  }, [workspaceId, role, queryClient])
}
