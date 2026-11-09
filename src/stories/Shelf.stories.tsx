import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Shelf } from '#/components/workspace/shelf'

/**
 * Records kept for later. Nothing on the shelf is open or editable; promoting a
 * card opens it as a pane beside the focused one. A record can be dragged onto
 * the shelf from any link.
 */
const meta = {
  title: 'Workspace/Shelf',
  component: Shelf,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: {
    dropActive: false,
    onPromote: () => {},
    onRemove: () => {},
    onClose: () => {},
    onDropLink: () => {},
    items: [
      {
        id: 's1',
        href: '/experiments/exp-2',
        title: 'Buffer exchange optimisation',
        identifier: 'EXP-2026-0043',
        from: 'EXP-2026-0042',
      },
      {
        id: 's2',
        href: '/protocols/prt-1',
        title: 'Cell seeding',
        identifier: 'PRT-2026-0012',
      },
      { id: 's3', href: '/samples/smp-1', title: 'Clarification harvest' },
    ],
  },
  decorators: [
    (Story) => (
      <div className="relative flex h-[520px] justify-end">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Shelf>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Empty: Story = { args: { items: [] } }

/** A link is being dragged over the shelf. */
export const DropActive: Story = { args: { dropActive: true } }
