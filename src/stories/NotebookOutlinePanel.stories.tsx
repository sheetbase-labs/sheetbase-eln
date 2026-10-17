import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { NotebookOutlinePanel } from '#/components/notebook/notebook-outline-panel'
import type { NotebookOutlineEntry } from '#/lib/notebook-outline'

/**
 * NOTE-02 outline. Headings come from the document's own blocks, so the
 * fixture entries are what `notebookOutline()` produces for a document with
 * two sections and a nested heading.
 */
const entries: NotebookOutlineEntry[] = [
  {
    blockId: '0198d970-e266-4000-8000-0000000000b1',
    order: 0,
    level: 2,
    text: 'Method',
    anchorId: 'block-0198d970-e266-4000-8000-0000000000b1-h0',
  },
  {
    blockId: '0198d970-e266-4000-8000-0000000000b2',
    order: 2,
    level: 3,
    text: 'Preparation',
    anchorId: 'block-0198d970-e266-4000-8000-0000000000b2-h0',
  },
  {
    blockId: '0198d970-e266-4000-8000-0000000000b3',
    order: 5,
    level: 2,
    text: 'Results',
    anchorId: 'block-0198d970-e266-4000-8000-0000000000b3-h0',
  },
]

const meta = {
  title: 'Notebook/Outline panel',
  component: NotebookOutlinePanel,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[280px] rounded-md border border-border p-3">
        <Story />
      </div>
    ),
  ],
  args: { entries },
} satisfies Meta<typeof NotebookOutlinePanel>
export default meta
type Story = StoryObj<typeof meta>

/** Headings at two levels, each one a link into the document. */
export const Default: Story = {}

/** A document with no headings has nothing to outline. */
export const Empty: Story = { args: { entries: [] } }

/** Live authoring adds collapse controls over the same entries. */
export const WithCollapseControls: Story = {
  args: {
    controls: {
      collapsedSections: new Set([entries[0].anchorId]),
      onToggleSection: () => {},
      onExpandAllSections: () => {},
      onCollapseAllSections: () => {},
    },
  },
}

/** A long heading wraps rather than truncating the destination. */
export const LongHeading: Story = {
  args: {
    entries: [
      {
        ...entries[0],
        text: 'Long-term stability of the lentiviral vector batch at 4 °C, 25 °C and −80 °C',
      },
    ],
  },
}
