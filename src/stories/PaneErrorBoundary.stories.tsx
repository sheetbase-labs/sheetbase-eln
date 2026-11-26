import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { PaneFailure } from '#/components/workspace/pane-error-boundary'

/**
 * What a pane shows when something inside it breaks. Only that pane is
 * replaced, so the others stay usable, and Try again re-renders it.
 */
const meta = {
  title: 'Workspace/Pane failure',
  component: PaneFailure,
  args: { onRetry: () => {} },
} satisfies Meta<typeof PaneFailure>

export default meta

type Story = StoryObj<typeof meta>

export const Failed: Story = {}
