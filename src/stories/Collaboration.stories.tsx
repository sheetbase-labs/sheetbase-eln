import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { PresenceSync } from '#/components/collaboration/use-set-presence'

/**
 * The presence sync reports where someone is, and renders nothing at all. It
 * needs a room to do more, and a story has no collaboration server, so this
 * shows the reachable contract: nothing throws outside a room.
 */
const meta = {
  title: 'Collaboration/Presence sync',
  tags: ['autodocs'],
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** Outside a room the presence sync renders nothing and does not throw. */
export const PresenceOutsideRoom: Story = {
  render: () => (
    <div className="rounded-md border p-3 text-body">
      <PresenceSync activeBlockId="block-1" mode="editing" />
      Presence is reported only inside a room.
    </div>
  ),
}
