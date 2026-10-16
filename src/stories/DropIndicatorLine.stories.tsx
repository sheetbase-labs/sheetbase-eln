import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { DropIndicatorLine } from '#/components/notebook/notebook-block-reorder'
import { NotebookBlock } from '#/components/notebook/notebook-block'

/**
 * The reorder affordances: the line that shows where a dragged block will
 * land, and the block chrome carrying the drag handle. Written against the
 * current public API.
 */
const meta = {
  title: 'Notebook/Drop indicator line',
  component: DropIndicatorLine,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[560px] space-y-3 p-6">
        <Story />
      </div>
    ),
  ],
  args: { position: 'above' },
} satisfies Meta<typeof DropIndicatorLine>
export default meta
type Story = StoryObj<typeof meta>

/** The line sits above the block it will precede. */
export const Above: Story = {}

/** Below the last block, which is how a drop at the end reads. */
export const Below: Story = { args: { position: 'below' } }

/** Between two blocks, which is where it is actually drawn. */
export const BetweenBlocks: Story = {
  render: (args) => (
    <>
      <NotebookBlock label="Text" title="Method">
        <p className="text-sm text-fg">Cells were incubated at 37 °C.</p>
      </NotebookBlock>
      <DropIndicatorLine {...args} />
      <NotebookBlock label="Results" title="Plate read">
        <p className="text-sm text-fg">OD₆₀₀ rose from 0.05 to 0.82.</p>
      </NotebookBlock>
    </>
  ),
}
