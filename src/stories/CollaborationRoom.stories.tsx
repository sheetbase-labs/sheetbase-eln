import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { CollaborationRoom } from '#/components/collaboration/collaboration-room'

/**
 * COLLAB-02 room boundary.
 *
 * The populated case needs a connected Liveblocks room, which a storybook
 * build has no way to provide (no websocket, no token endpoint), so the
 * stories below cover the boundary's reachable static contract: with no room
 * id the subtree renders unchanged and room hooks stay unready — the state
 * every SSR shell and collaboration-free deployment runs in.
 */
const roomId = 'ws_0198d970-e266-4000-8000-00000000ffff__record__rec-1'

const meta = {
  title: 'Collaboration/Room',
  component: CollaborationRoom,
  tags: ['autodocs'],
  args: {
    roomId: null,
    children: (
      <div className="w-80 space-y-1 rounded-md border border-border p-3">
        <p className="text-xs font-medium text-fg">Virus stability at 4 °C</p>
        <p className="text-xs text-fg-muted">
          Collaboration is off for this surface, so the room boundary is
          transparent and the page renders unchanged.
        </p>
      </div>
    ),
  },
} satisfies Meta<typeof CollaborationRoom>
export default meta
type Story = StoryObj<typeof meta>

/** No room id: children render unchanged, nothing connects. */
export const NoRoom: Story = {}

/**
 * With a room id the boundary mounts its provider after hydration and
 * suspends the room subtree until the room is available. A storybook build
 * has no Liveblocks backend to connect to, so this story renders nothing —
 * the same fallback a suspended room shows in the app, and the reason the
 * outage never takes the page down. The surrounding surface, outside the
 * boundary, is unaffected.
 */
export const WithRoomId: Story = { args: { roomId } }
