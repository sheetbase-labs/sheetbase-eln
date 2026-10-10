import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Chip } from '#/components/ui/chip'
import { Tag } from '#/components/ui/tag'
import { Diff } from '#/components/scientific/diff'
import { Source } from '#/components/scientific/source'

const meta = {
  title: 'UI/SourceDiffTagChip',
  component: Chip,
  tags: ['autodocs'],
} satisfies Meta<typeof Chip>

export default meta
type Story = StoryObj<typeof meta>

export const Set: Story = {
  args: { children: 'Example' },
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <Source kind="dataset" />
        <Source kind="record" />
        <Source kind="calc" />
        <Source kind="local" />
      </div>
      <div className="flex items-center gap-4 text-body">
        <Diff before="6.9 × 10¹⁰" after="7.2 × 10¹⁰" />
        <Tag kind="add" />
        <Tag kind="chg" />
        <Tag kind="del" />
      </div>
      <div className="flex items-center gap-2">
        <Chip onRemove={() => {}}>Lifecycle: Published</Chip>
        <Chip onRemove={() => {}}>Project: AAV9</Chip>
      </div>
    </div>
  ),
}
