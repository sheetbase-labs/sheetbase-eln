import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { KindBadge } from '#/components/review/revision-diff-review'
import { Badge } from '#/components/v3/ui/badge'

/**
 * The badge naming what a change did. The four kinds are the canonical set,
 * each with its own icon and tone.
 */
const meta = {
  title: 'Review/Kind badge',
  component: KindBadge,
  tags: ['autodocs'],
  args: { kind: 'modified' },
} satisfies Meta<typeof KindBadge>
export default meta
type Story = StoryObj<typeof meta>

export const Modified: Story = {}

/** All four kinds together, which is how a diff legend reads. */
export const AllKinds: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <KindBadge kind="added" />
      <KindBadge kind="removed" />
      <KindBadge kind="modified" />
      <KindBadge kind="moved" />
      <Badge variant="kind">unchanged</Badge>
    </div>
  ),
}
