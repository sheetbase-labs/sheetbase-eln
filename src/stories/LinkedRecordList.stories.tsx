import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { LinkedRecordList } from '#/components/record/inspector-sections'
import type { LinkedRecordItem } from '#/components/record/inspector-sections'

const items: LinkedRecordItem[] = [
  {
    id: 'l1',
    type: 'Sample',
    title: 'LVV-CAR-T drug substance',
    meta: 'SMP-2026-0142',
    href: '/samples/sample-1',
    icon: 'tube',
  },
  {
    id: 'l2',
    type: 'Protocol',
    title: 'Titration assay',
    meta: 'PRT-2026-0012',
    href: '/protocols/protocol-1',
    icon: 'protocol',
  },
  {
    id: 'l3',
    type: 'Dataset',
    title: 'Plate reader kinetics',
    icon: 'database',
  },
]

const meta = {
  title: 'Record/Inspector sections/Linked record list',
  component: LinkedRecordList,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
  args: { items },
} satisfies Meta<typeof LinkedRecordList>
export default meta
type Story = StoryObj<typeof meta>

/** The Storybook TanStack framework supplies the router, so the linked rows
 * render as real destinations. */
export const Default: Story = {}

export const Empty: Story = { args: { items: [] } }

/** A row with no `href` is a plain row, not a link. */
export const WithoutDestination: Story = {
  args: { items: items.filter((item) => !item.href) },
}

/** Long titles and metadata truncate on one line each. */
export const LongContent: Story = {
  args: {
    items: [
      {
        id: 'long',
        type: 'Sample',
        title:
          'Lentiviral vector harvest lot, clarified, 0.45 µm filtered, frozen at −80 °C',
        meta: 'SMP-2026-0142 · stored in box OPS-002-A3',
        href: '/samples/sample-2',
        icon: 'tube',
      },
    ],
  },
}
