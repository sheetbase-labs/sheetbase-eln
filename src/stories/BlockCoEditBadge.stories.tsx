import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { CollaborationRoom } from '#/components/collaboration/collaboration-room'
import { BlockCoEditBadge } from '#/components/collaboration/presence-co-editing'

/**
 * COLLAB-01 co-editing awareness badge.
 *
 * The badge needs other users' live presence, so the populated state
 * requires a connected Liveblocks room. Covered here is the reachable
 * contract: nothing renders before the room is ready, and nothing renders
 * for a block the local user is not editing. `coEditingPeerNames` (the pure
 * name extractor) is an exported helper with no rendered surface and is
 * recorded as a skip in docs/development/storybook-coverage.md.
 */
const BLOCK_ID = '0198d970-e266-4000-8000-000000000042'

const meta = {
  title: 'Collaboration/Block co-edit badge',
  component: BlockCoEditBadge,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <CollaborationRoom roomId={null}>
        <div className="flex w-96 items-center justify-between gap-3 rounded-md border border-dashed border-border px-3 py-2">
          <span className="text-xs font-medium text-fg">Results</span>
          <Story />
        </div>
      </CollaborationRoom>
    ),
  ],
  args: { blockId: BLOCK_ID, active: true },
} satisfies Meta<typeof BlockCoEditBadge>
export default meta
type Story = StoryObj<typeof meta>

/** Editing locally, but no room: awareness stays silent. */
export const AwaitingRoom: Story = {}

/** Not editing: the badge is silent even once a room is connected. */
export const NotEditing: Story = { args: { active: false } }
