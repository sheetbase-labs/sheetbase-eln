import type { Meta, StoryObj } from '@storybook/tanstack-react'
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
