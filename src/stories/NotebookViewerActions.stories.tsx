import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { NotebookViewerActions } from '#/components/notebook/notebook-viewer-actions'

/**
 * The view-only bar above a notebook a reader cannot edit. Copy is offered
 * only when there is a selection to copy, and the access request needs a
 * project, so the stories vary those two inputs.
 */
const meta = {
  title: 'Notebook/Viewer actions',
  component: NotebookViewerActions,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[640px] max-w-full rounded-md border border-border p-3">
        <Story />
      </div>
    ),
  ],
  args: {
    projectId: '0198d970-e266-4000-8000-0000000000b1',
    commentEnabled: true,
    selectedBlockId: null,
  },
} satisfies Meta<typeof NotebookViewerActions>
export default meta
type Story = StoryObj<typeof meta>

/** Comments enabled and a project to request access to. */
export const Default: Story = {}

/** With a block selected, the comment affordance targets that block. */
export const BlockSelected: Story = {
  args: {
    selectedBlockId: '0198d970-e266-4000-8000-0000000020b1'.replace(
      '0b1',
      'b1',
    ),
  },
}

/** Comments are off (collaboration disabled or room not ready). */
export const CommentsDisabled: Story = { args: { commentEnabled: false } }

/** No project: there is nothing to request access to. */
export const NoProject: Story = { args: { projectId: null } }
