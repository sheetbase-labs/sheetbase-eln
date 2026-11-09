import { createContext, useContext } from 'react'
import {
  QueryClient,
  QueryClientContext,
  useQuery,
} from '@tanstack/react-query'

import type { PageAiInput, PageAiResult } from './page-ai'

/**
 * Client side of in-page AI. The shell provides the workspace once; any page
 * control asks `usePageAi()` whether AI is available and, if so, how to run a
 * call. When the workspace switch or the assistant flag is off the hook says
 * `available: false` and a control renders nothing.
 */

/** Used only where no query client is mounted (isolated component tests). */
let idleClient: QueryClient | null = null

function getIdleClient(): QueryClient {
  idleClient ??= new QueryClient()

  return idleClient
}

const WorkspaceIdContext = createContext<string | null>(null)

export const PageAiWorkspaceProvider = WorkspaceIdContext.Provider

export interface PageAi {
  /** The workspace has AI on, the assistant flag on and something ready to answer. */
  available: boolean
  /**
   * A real model is connected, not just the built-in one. Anything that
   * writes words for the person (rewording, drafting) needs this: the
   * built-in model only gives canned replies.
   */
  live: boolean
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
  const client = useContext(QueryClientContext) ?? getIdleClient()

  const settings = useQuery(
    {
      queryKey: ['ai-settings', workspaceId],
      queryFn: async () => {
        const { getAiSettingsFn } = await import('#/lib/ai-settings-actions')

        return getAiSettingsFn({ data: { workspaceId: workspaceId ?? '' } })
      },
      enabled: Boolean(workspaceId),
    },
    client,
  )

  const data = settings.data
  const ready = Boolean(workspaceId) && data?.readiness.ready === true
  const available = ready

  return {
    available,
    live: ready && data.readiness.ready && data.readiness.mode === 'provider',
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
