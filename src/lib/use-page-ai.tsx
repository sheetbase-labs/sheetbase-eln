import { createContext, useContext } from 'react'
import { useQuery } from '@tanstack/react-query'

import type { PageAiInput, PageAiResult } from './page-ai'

/**
 * Client side of in-page AI. The shell provides the workspace once; any page
 * control asks `usePageAi()` whether AI is available and, if so, how to run a
 * call. When the workspace switch or the assistant flag is off the hook says
 * `available: false` and a control renders nothing.
 */

const WorkspaceIdContext = createContext<string | null>(null)

export const PageAiWorkspaceProvider = WorkspaceIdContext.Provider

export interface PageAi {
  /** True once the workspace has AI on, the assistant flag on and a ready model. */
  available: boolean
  workspaceId: string | null
  run: (
    input: Omit<
      PageAiInput,
      'workspaceId' | 'objectRefs' | 'instruction' | 'text'
    > &
      Partial<Pick<PageAiInput, 'objectRefs' | 'instruction' | 'text'>>,
  ) => Promise<PageAiResult>
}

export function usePageAi(): PageAi {
  const workspaceId = useContext(WorkspaceIdContext)
  const settings = useQuery({
    queryKey: ['ai-settings', workspaceId],
    queryFn: async () => {
      const { getAiSettingsFn } = await import('#/lib/ai-settings-actions')
      return getAiSettingsFn({ data: { workspaceId: workspaceId ?? '' } })
    },
    enabled: Boolean(workspaceId),
  })
  return {
    available: Boolean(workspaceId) && settings.data?.readiness.ready === true,
    workspaceId,
    run: async (input) => {
      const { runPageAiFn } = await import('#/lib/assistant-actions')
      return runPageAiFn({
        data: {
          instruction: '',
          text: '',
          objectRefs: [],
          ...input,
          workspaceId: workspaceId ?? '',
        },
      })
    },
  }
}
