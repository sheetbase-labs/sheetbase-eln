import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { CollaborationRoom } from '#/components/collaboration/collaboration-room'
import { PresenceStack } from '#/components/collaboration/presence-avatars'

/**
 * COLLAB-01 presence avatars.
 *
 * The stack renders avatars only from a connected Liveblocks room, which a
 * storybook build cannot provide (no websocket, no token endpoint). What is
 * covered here is the contract that makes the component safe to mount
 * anywhere: before the room is ready — and outside a room boundary
 * altogether — it renders nothing rather than throwing. `presenceStackEntries`
 * (the pure splitter behind the visible stack) is an exported helper with no
 * rendered surface and is recorded as a skip in
 * docs/development/storybook-coverage.md.
 */
const meta = {
  title: 'Collaboration/Presence stack',
  component: PresenceStack,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <CollaborationRoom roomId={null}>
        <div className="w-80 rounded-md border border-dashed border-border p-3">
          <p className="mb-2 text-xs text-fg-muted">
            Record header row · avatars appear here once a room is connected
          </p>
          <Story />
        </div>
      </CollaborationRoom>
    ),
  ],
  args: { max: 4 },
} satisfies Meta<typeof PresenceStack>
export default meta
type Story = StoryObj<typeof meta>

/** No room: the stack renders nothing and the header stays intact. */
export const AwaitingRoom: Story = {}
