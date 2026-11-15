import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import AgentPage from '#/components/assist/agent-page'
import { AgentHistory } from '#/components/assist/agent-history'
import { conversationKeys } from '#/lib/agent-conversations'
import { AI_WORKSPACE_ID } from './assist-fixtures'
import { screenQueryClient, screenRoutes } from './screen-stories'

/**
 * The Agent page: the assistant as a page of its own. The person's chats are
 * listed on the left (Today, Yesterday, Previous 7 days, Earlier), the open
 * chat and its message box beside them. Below desktop width the list moves
 * into a sheet behind the history button.
 */
const WORKSPACE_ID = AI_WORKSPACE_ID.slice(0, -2) + 'e1'

const day = 86_400_000

const row = (id: string, title: string, daysAgo: number) => ({
  id,
  title,
  created_at: new Date(Date.now() - daysAgo * day).toISOString(),
  updated_at: new Date(Date.now() - daysAgo * day).toISOString(),
})

const client = screenQueryClient({
  data: [
    {
      key: ['ai-settings', WORKSPACE_ID],
      value: { readiness: { ready: true, mode: 'built-in' } },
    },
    {
      key: conversationKeys.all(WORKSPACE_ID),
      value: [
        row(
          '00000000-0000-4000-8000-0000000000a1',
          'What is on my schedule this week?',
          0,
        ),
        row(
          '00000000-0000-4000-8000-0000000000a2',
          'Set up a nightly export of titre results',
          1,
        ),
        row(
          '00000000-0000-4000-8000-0000000000a3',
          'Which reagents are running low?',
          3,
        ),
        row(
          '00000000-0000-4000-8000-0000000000a4',
          'Draft a stocktake plan for the -80 freezers',
          40,
        ),
      ],
    },
  ],
})

const meta = {
  title: 'Assistant/Agent page',
  component: AgentPage,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    tanstack: { router: { route: screenRoutes('/agent'), path: '/agent' } },
  },
  args: {
    workspaceId: WORKSPACE_ID,
    role: 'owner',
    chatId: null,
    onOpenChat: () => undefined,
    onNewChat: () => undefined,
  },
  decorators: [
    (Story) => (
      <QueryClientProvider client={client}>
        <div className="h-[640px]">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
} satisfies Meta<typeof AgentPage>

export default meta

type Story = StoryObj<typeof meta>

/** A fresh chat: what the agent is for, and four things to start with. */
export const NewChat: Story = {}

/** The list of chats on its own, as the phone sheet shows it. */
export const ChatList: Story = {
  render: () => (
    <div className="h-[520px] w-[300px] border border-border">
      <AgentHistory
        workspaceId={WORKSPACE_ID}
        activeId="00000000-0000-4000-8000-0000000000a2"
        onNewChat={() => undefined}
        onDeleted={() => undefined}
      />
    </div>
  ),
}
