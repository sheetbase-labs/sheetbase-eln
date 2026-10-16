import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { CollaborationProvider } from '#/components/collaboration/collaboration-provider'

/**
 * The root collaboration boundary. A storybook build has no Liveblocks
 * secret, so the deployment is collaboration-disabled and the provider
 * renders children unchanged — the same branch a production deployment
 * without a secret takes. The enabled branch needs a connected room.
 */
const meta = {
  title: 'Collaboration/Provider',
  component: CollaborationProvider,
  tags: ['autodocs'],
  args: {
    children: (
      <div className="w-80 space-y-1 rounded-md border border-border p-3">
        <p className="text-xs font-medium text-fg">Notebook canvas</p>
        <p className="text-xs text-fg-muted">
          Children render unchanged while collaboration is disabled: no
          Liveblocks client is created and no room connects.
        </p>
      </div>
    ),
  },
} satisfies Meta<typeof CollaborationProvider>
export default meta
type Story = StoryObj<typeof meta>

export const Disabled: Story = {}
