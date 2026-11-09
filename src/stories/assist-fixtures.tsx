import { QueryClientProvider } from '@tanstack/react-query'

import { PageAiWorkspaceProvider } from '#/lib/use-page-ai'
import { screenQueryClient } from './screen-stories'

/**
 * What the in-page AI controls ask of the shell: a workspace, and whether AI is
 * on for it. The settings read is seeded in the query cache, so a story shows
 * the control in the state it names and never reaches a server. Pressing a
 * control that runs the model shows its failed state, because a story has no
 * model to answer.
 */
export const AI_WORKSPACE_ID = '0198d970-e266-4000-8000-0000000000a1'

export type PageAiState = 'live' | 'built-in' | 'off'

const READINESS = {
  live: {
    ready: true,
    mode: 'provider',
    profileId: 'workspace-model',
    dataClass: 'cloud',
  },
  'built-in': { ready: true, mode: 'built-in' },
  off: { ready: false, reason: 'disabled' },
} as const

export function withPageAi(
  state: PageAiState,
  extraData: Array<{ key: readonly unknown[]; value: unknown }> = [],
) {
  const client = screenQueryClient({
    data: [
      {
        key: ['ai-settings', AI_WORKSPACE_ID],
        value: { readiness: READINESS[state] },
      },
      ...extraData,
    ],
  })

  return (Story: () => React.ReactNode) => (
    <QueryClientProvider client={client}>
      <PageAiWorkspaceProvider value={AI_WORKSPACE_ID}>
        <Story />
      </PageAiWorkspaceProvider>
    </QueryClientProvider>
  )
}
