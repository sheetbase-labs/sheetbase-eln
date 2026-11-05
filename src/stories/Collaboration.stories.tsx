import type { Meta, StoryObj } from '@storybook/tanstack-react'

import LiveblocksBoundary from '#/components/collaboration/liveblocks-boundary'
import { PresenceSync } from '#/components/collaboration/use-set-presence'

/**
 * The two collaboration pieces that have no surface of their own. The boundary
 * mounts the Liveblocks client around its children; the presence sync reports
 * where someone is, and renders nothing at all. Both need a room to do more,
 * and a story has no websocket or token endpoint, so these show the reachable
 * contract: children pass through, and nothing throws outside a room.
 */
const meta = {
  title: 'Collaboration/Boundary and presence',
  tags: ['autodocs'],
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** The boundary renders its children unchanged. */
export const Boundary: Story = {
  render: () => (
    <LiveblocksBoundary>
      <p className="rounded-md border p-3 text-body">
        Content inside the collaboration boundary.
      </p>
    </LiveblocksBoundary>
  ),
}

/** Outside a room the presence sync renders nothing and does not throw. */
export const PresenceOutsideRoom: Story = {
  render: () => (
    <div className="rounded-md border p-3 text-body">
      <PresenceSync activeBlockId="block-1" mode="editing" />
      Presence is reported only inside a room.
    </div>
  ),
}
