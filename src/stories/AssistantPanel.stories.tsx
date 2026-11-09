import { useEffect } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { AssistantPanel } from '#/components/assist/assistant-panel'
import { openAssistant } from '#/lib/assistant-context'
import { AI_WORKSPACE_ID } from './assist-fixtures'
import { screenQueryClient, screenRoutes } from './screen-stories'

/**
 * The global assistant surface: one panel, on every page. It opens from the
 * shell trigger, from ⌘J, from any "Ask AI" button, or from the floating
 * button on a phone, and sends the conversation with the current page's stable
 * id, never page text. The chat body mounts only while the panel is open, so
 * closed it is inert.
 */
const WORKSPACE_ID = AI_WORKSPACE_ID.slice(0, -2) + 'd1'
const READY_WORKSPACE_ID = AI_WORKSPACE_ID.slice(0, -2) + 'd2'

const client = screenQueryClient({
  data: [
    {
      key: ['ai-settings', WORKSPACE_ID],
      value: { readiness: { ready: false, reason: 'disabled' } },
    },
    {
      key: ['ai-settings', READY_WORKSPACE_ID],
      value: {
        readiness: {
          ready: true,
          mode: 'provider',
          profileId: 'workspace-model',
          dataClass: 'cloud',
        },
      },
    },
  ],
})

function OpenOnMount() {
  useEffect(() => {
    openAssistant()
  }, [])

  return null
}

const meta = {
  title: 'Assistant/Panel',
  component: AssistantPanel,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    tanstack: { router: { route: screenRoutes('/'), path: '/' } },
  },
  args: { workspaceId: WORKSPACE_ID, role: 'owner' },
  decorators: [
    (Story) => (
      <QueryClientProvider client={client}>
        <div className="h-[560px] p-6 text-body text-fg-muted">
          A page. Press ⌘J (or Ctrl+J) to open the assistant.
        </div>
        <Story />
      </QueryClientProvider>
    ),
  ],
} satisfies Meta<typeof AssistantPanel>

export default meta

type Story = StoryObj<typeof meta>

/** Closed: on a phone the floating button shows, elsewhere nothing does. */
export const Closed: Story = {}

/** Opened, with AI off for the workspace so the panel explains why. */
export const Open: Story = {
  render: (args) => (
    <>
      <AssistantPanel {...args} />
      {/* After the panel, so its listener is in place when this fires. */}
      <OpenOnMount />
    </>
  ),
}

/**
 * Opened with AI on, so the message box shows. Check it at phone size: below
 * desktop width the panel is a bottom sheet, and its message box and note must
 * sit clear of the iPhone home indicator and, with the keyboard up, of the
 * keyboard's accessory bar.
 */
export const OpenReady: Story = {
  args: { workspaceId: READY_WORKSPACE_ID },
  render: (args) => (
    <>
      <AssistantPanel {...args} />
      {/* After the panel, so its listener is in place when this fires. */}
      <OpenOnMount />
    </>
  ),
}

/** No workspace yet: the button is not offered. */
export const NoWorkspace: Story = { args: { workspaceId: null } }
