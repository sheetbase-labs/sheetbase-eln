import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { CollaborationRoom } from '#/components/collaboration/collaboration-room'
import { ThreadPanel } from '#/components/collaboration/thread-panel'
import type { ThreadAnchor } from '#/lib/collaboration/types'

/**
 * COLLAB-02 anchored discussion panel.
 *
 * The panel renders Liveblocks threads, so the populated state needs a
 * connected room and a room id matching the anchor — neither available in a
 * storybook build (no websocket, no token endpoint). Covered here is the
 * reachable contract: outside a ready room the panel renders nothing for
 * every anchor type and role, which is what SSR and collaboration-disabled
 * deployments rely on.
 */
const WORKSPACE_ID = '0198d970-e266-4000-8000-00000000ffff'
const RECORD_ID = '0198d970-e266-4000-8000-0000000000a1'

const blockAnchor: ThreadAnchor = {
  anchorType: 'notebook-block',
  workspaceId: WORKSPACE_ID,
  recordId: RECORD_ID,
  blockId: '0198d970-e266-4000-8000-000000000042',
}

const recordAnchor: ThreadAnchor = {
  anchorType: 'record',
  workspaceId: WORKSPACE_ID,
  recordId: RECORD_ID,
}

const meta = {
  title: 'Collaboration/Thread panel',
  component: ThreadPanel,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <CollaborationRoom roomId={null}>
        <div className="w-96 rounded-md border border-dashed border-border p-3">
          <p className="mb-2 text-xs text-fg-muted">
            Discussion popover · threads appear here once a room is connected
          </p>
          <Story />
        </div>
      </CollaborationRoom>
    ),
  ],
  args: { anchor: blockAnchor, currentRole: 'member' },
} satisfies Meta<typeof ThreadPanel>
export default meta
type Story = StoryObj<typeof meta>

export const AwaitingRoom: Story = {}

/** The record-level anchor takes the same pre-ready path. */
export const RecordAnchor: Story = { args: { anchor: recordAnchor } }

/** A read-only role changes only the composer hint, which is also gated. */
export const ReadOnlyRole: Story = { args: { currentRole: 'viewer' } }
