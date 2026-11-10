import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ConnectionRequired } from '#/components/offline/connection-required'
import { CONNECTION_REQUIRED_REASONS } from '#/components/offline/connection-reasons'
import { Button } from '#/components/ui/button'

/**
 * An action that cannot run offline, disabled with its reason stated beside it
 * rather than silently inert. The child is a render function so a button or a
 * link can take the two things it must carry while offline: `disabled`, and the
 * id the reason is announced at. Online, the reason is not rendered and nothing
 * about the action changes.
 */
const meta = {
  title: 'Offline/Connection required',
  component: ConnectionRequired,
  tags: ['autodocs'],
  args: {
    online: false,
    reason: CONNECTION_REQUIRED_REASONS.submit,
    children: ({ disabled, describedBy }) => (
      <Button
        variant="primary"
        disabled={disabled}
        aria-describedby={describedBy}
      >
        Submit for review
      </Button>
    ),
  },
} satisfies Meta<typeof ConnectionRequired>

export default meta

type Story = StoryObj<typeof meta>

/** Offline: the action is disabled and the reason sits beside it. */
export const Offline: Story = {}

/** Online: no reason is rendered and the action is live. */
export const Online: Story = { args: { online: true } }

/** The reason each action that cannot run offline gives. */
export const EveryReason: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {Object.entries(CONNECTION_REQUIRED_REASONS).map(([action, reason]) => (
        <ConnectionRequired key={action} online={false} reason={reason}>
          {({ disabled, describedBy }) => (
            <Button disabled={disabled} aria-describedby={describedBy}>
              {action}
            </Button>
          )}
        </ConnectionRequired>
      ))}
    </div>
  ),
}
