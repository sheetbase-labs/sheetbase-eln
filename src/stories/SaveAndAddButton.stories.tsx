import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { SaveAndAddButton } from '#/components/viz/save-and-add-button'

/**
 * The primary action in the Analysis Studio when it was opened from an
 * experiment: it saves the analysis and puts it in that experiment's notebook.
 */
const meta = {
  title: 'Analysis/Save and add button',
  component: SaveAndAddButton,
  tags: ['autodocs'],
  args: {
    identifier: 'EXP-0121',
    ready: true,
    pending: false,
    onClick: () => undefined,
  },
} satisfies Meta<typeof SaveAndAddButton>

export default meta

type Story = StoryObj<typeof meta>

export const Ready: Story = {}

/** Nothing to save yet: no analysis, an invalid one, or no name. */
export const NotReady: Story = { args: { ready: false } }

export const Adding: Story = { args: { pending: true } }
