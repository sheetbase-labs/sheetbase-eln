import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { RecordHeader } from '#/components/record/record-header'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'

const meta = {
  title: 'Features/RecordHeader',
  component: RecordHeader,
  tags: ['autodocs'],
  args: {
    recordType: 'Experiment',
    title: 'Protein stability study',
    identifier: 'EXP-2026-014',
  },
} satisfies Meta<typeof RecordHeader>
export default meta
type Story = StoryObj<typeof meta>
export const Minimal: Story = {}
export const Complete: Story = {
  args: {
    status: <Badge variant="success">Active</Badge>,
    phase: <Badge variant="outline">Phase 2</Badge>,
    owner: { name: 'Alex Morgan', initials: 'AM' },
    updatedAt: '5 minutes ago',
    contributors: [
      { name: 'Priya Shah', initials: 'PS' },
      { name: 'Lee Chen', initials: 'LC' },
    ],
    tags: (
      <>
        <Badge variant="secondary">stability</Badge>
        <Badge variant="secondary">protein</Badge>
      </>
    ),
    starred: true,
    onToggleStar: () => undefined,
    actions: <Button size="sm">Edit</Button>,
  },
}
export const LongTitle: Story = {
  args: {
    title:
      'Longitudinal protein stability and aggregation assessment under accelerated storage conditions',
    owner: { name: 'Alex Morgan' },
  },
  render: (args) => (
    <div className="w-full max-w-4xl p-4">
      <RecordHeader {...args} />
    </div>
  ),
}
