import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { CollaborationRoom } from '#/components/collaboration/collaboration-room'
import { RemoteSelectionChips } from '#/components/collaboration/presence-selection-chips'

/**
 * COLLAB-01 remote selection chips.
 *
 * Chips are built from other users' live presence, so a connected Liveblocks
 * room is required for the populated state that a storybook build cannot
 * provide. Covered here is the reachable contract: with no room the chips
 * render nothing, whether or not a click affordance is supplied — which is
 * also the state surfaces broadcast no selection in.
 * `remoteSelectionChips` (the pure chip builder) is an exported helper with
 * no rendered surface and is recorded as a skip in
 * docs/development/storybook-coverage.md.
 */
const meta = {
  title: 'Collaboration/Remote selection chips',
  component: RemoteSelectionChips,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <CollaborationRoom roomId={null}>
        <div className="w-96 rounded-md border border-dashed border-border p-3">
          <p className="mb-2 text-xs text-fg-muted">
            Sheet toolbar · one chip per remote selection once a room is
            connected
          </p>
          <Story />
        </div>
      </CollaborationRoom>
    ),
  ],
} satisfies Meta<typeof RemoteSelectionChips>
export default meta
type Story = StoryObj<typeof meta>

export const AwaitingRoom: Story = {}

/** With a click affordance the chips would be buttons; still nothing to show. */
export const AwaitingRoomWithAffordance: Story = {
  args: { onSelect: () => {} },
}
