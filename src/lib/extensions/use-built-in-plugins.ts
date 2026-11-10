import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { z } from 'zod'

import { extensionQueryKeys } from './client'

const builtInAnswer = z.object({
  plugins: z.array(
    z.object({ action: z.enum(['installed', 'updated', 'unchanged']) }),
  ),
})

/**
 * Owners and administrators install or update the plugins that ship with
 * Sheetbase the first time they open the app in a browser session. The server
 * does nothing when they are already current, and leaves a plugin alone that an
 * administrator turned off.
 */
export function useBuiltInPlugins(workspaceId: string | null, role: string) {
  const queryClient = useQueryClient()

  const { mutate } = useMutation({
    mutationFn: async (_workspaceId: string) => {
      const response = await fetch('/api/plugins/built-in', { method: 'POST' })

      if (!response.ok) throw new Error('refused')
      const body = builtInAnswer.parse(await response.json())

      return body.plugins.some((plugin) => plugin.action !== 'unchanged')
    },
    onSuccess: async (changed) => {
      if (changed)
        await queryClient.invalidateQueries({
          queryKey: extensionQueryKeys.extensions,
        })
    },
    onError: (_error, failedWorkspaceId) => {
      try {
        window.sessionStorage.removeItem(
          `sheetbase.built-in-plugins.${failedWorkspaceId}`,
        )
      } catch {
        // Nothing to undo.
      }
    },
  })

  useEffect(() => {
    if (!workspaceId || (role !== 'owner' && role !== 'admin')) return
    const key = `sheetbase.built-in-plugins.${workspaceId}`

    try {
      if (window.sessionStorage.getItem(key)) return
      window.sessionStorage.setItem(key, '1')
    } catch {
      // No session storage: run it, once per page load.
    }

    mutate(workspaceId)
  }, [workspaceId, role, mutate])
}
