import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Badge } from '#/components/ui/badge'
import { Chip } from '#/components/ui/chip'
import { Diff } from '#/components/scientific/diff'
import { Source } from '#/components/scientific/source'

const meta = {
  title: 'Scientific/Source, diff and chips',
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
        <Badge variant="add">Added</Badge>
        <Badge variant="chg">Changed</Badge>
        <Badge variant="del">Removed</Badge>
      </div>
      <div className="flex items-center gap-2">
        <Chip variant="remove" onRemove={() => {}}>
          Lifecycle: Published
        </Chip>
        <Chip variant="remove" onRemove={() => {}}>
          Project: AAV9
        </Chip>
      </div>
    </div>
  ),
}
