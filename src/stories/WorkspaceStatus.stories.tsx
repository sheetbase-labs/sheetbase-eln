import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  WorkspaceStatus,
  statusHints,
} from '#/components/workspace/workspace-status'

/**
 * The workspace status bar: the layout's name and whether it is saved, the link
 * group the focused pane belongs to, and up to five key hints chosen for the
 * focused pane (`statusHints`).
 */
const meta = {
  title: 'Workspace/Status bar',
  component: WorkspaceStatus,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: {
    layoutName: 'Stability review',
    saved: true,
    hints: statusHints({
      hasTrail: false,
      linked: false,
      primary: true,
      paneCount: 1,
    }),
  },
} satisfies Meta<typeof WorkspaceStatus>

export default meta

type Story = StoryObj<typeof meta>

export const Saved: Story = {}

export const Unsaved: Story = { args: { saved: false } }

/** Two panes, one of them read-only with a trail and a link group. */
export const LinkedPanes: Story = {
  args: {
    link: { letter: 'a', driverLabel: 'EXP-2026-0042', followers: 1 },
    hints: statusHints({
      hasTrail: true,
      linked: true,
      primary: false,
      paneCount: 2,
    }),
  },
}
