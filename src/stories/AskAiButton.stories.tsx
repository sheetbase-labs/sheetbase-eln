import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  AskAiButton,
  AssistantTrigger,
} from '#/components/assist/ask-ai-button'
import { withPageAi } from './assist-fixtures'

/**
 * The in-context entry points to the assistant. Both dispatch the shared open
 * event rather than owning assistant state, so a page header can mount one
 * without a provider. When AI is off for the workspace they render nothing.
 * The page-header button is hidden on a phone, where the assistant opens from
 * the navigation drawer.
 */
const meta = {
  title: 'Assistant/Ask AI button',
  component: AskAiButton,
  tags: ['autodocs'],
  decorators: [withPageAi('live')],
} satisfies Meta<typeof AskAiButton>

export default meta

type Story = StoryObj<typeof meta>

export const PageHeaderButton: Story = {}

/** The shell-level trigger, next to search and help. */
export const ShellTrigger: Story = {
  render: () => <AssistantTrigger />,
}

/** AI is off: neither control renders. */
export const SilentWhenOff: Story = {
  decorators: [withPageAi('off')],
  render: () => (
    <div className="flex items-center gap-2 text-label text-fg-muted">
      <AskAiButton />
      <AssistantTrigger />
      (nothing renders while AI is off)
    </div>
  ),
}
