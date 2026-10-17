import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { expect, userEvent, within } from 'storybook/test'
import { RevisionDiffReview } from '#/components/review/revision-diff-review'
import type { CanonicalRevisionEnvelope } from '#/lib/revision-diff'

const base = {
  formatVersion: 1,
  record: { id: 'record', title: 'Protein assay', status: 'draft' },
  blocks: [
    { id: 'block-1', type: 'text', order: 0, content: 'Initial protocol' },
  ],
  links: [],
  scientificTables: [],
  formulas: [],
  files: [],
} as unknown as CanonicalRevisionEnvelope
const changed = {
  ...base,
  record: { id: 'record', title: 'Protein stability assay', status: 'active' },
  blocks: [
    {
      id: 'block-1',
      type: 'text',
      order: 0,
      content: 'Updated protocol and observations',
    },
    { id: 'block-2', type: 'text', order: 1, content: 'New results' },
  ],
} as unknown as CanonicalRevisionEnvelope
const meta = {
  title: 'Features/RevisionDiffReview',
  component: RevisionDiffReview,
  tags: ['autodocs'],
  args: {
    before: base,
    after: changed,
    beforeLabel: 'Revision 1',
    afterLabel: 'Revision 2',
  },
} satisfies Meta<typeof RevisionDiffReview>
export default meta
type Story = StoryObj<typeof meta>
export const Changes: Story = {}
export const Unchanged: Story = { args: { after: base } }

/**
 * The filters can hide every change the diff holds. The play function reaches
 * the state the way a reader does — by turning each change type off — so the
 * story shows the empty state and the way back.
 */
export const FiltersHideEverything: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    for (const kind of ['added', 'removed', 'modified', 'moved']) {
      await userEvent.click(
        canvas.getByRole('button', { name: `Hide ${kind} changes` }),
      )
    }

    await expect(
      await canvas.findByText('No changes match the selected change types.'),
    ).toBeInTheDocument()
  },
}

/**
 * Clear filters is a real control, not decoration: the same play function
 * turns every type off, uses it, and checks the changes come back.
 */
export const ClearFiltersRestoresChanges: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    for (const kind of ['added', 'removed', 'modified', 'moved']) {
      await userEvent.click(
        canvas.getByRole('button', { name: `Hide ${kind} changes` }),
      )
    }

    await userEvent.click(canvas.getByRole('button', { name: 'Clear filters' }))

    await expect(
      await canvas.findByRole('list', { name: 'Revision changes' }),
    ).toBeInTheDocument()
  },
}
