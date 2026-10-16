import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { RelatedWorkList } from '#/components/related-work/related-work-panel'
import type { RelatedWorkItem } from '#/lib/related-work'

/**
 * FIND-03 item rendering. The list is the pure half of the panel, so it
 * takes resolved items with no query involved; the icon follows the item's
 * kind and record kind.
 */
const items: RelatedWorkItem[] = [
  {
    kind: 'record',
    id: 'rec-2',
    recordKind: 'experiment',
    label: 'Virus stability at 25 °C',
    identifier: 'EXP-2026-0043',
    reason: 'Linked to EXP-2026-0042',
    destination: '/records/rec-2',
  },
  {
    kind: 'record',
    id: 'rec-3',
    recordKind: 'sample',
    label: 'LVV-CAR-T drug substance',
    identifier: 'SMP-2026-0142',
    reason: 'Shares a sample with this experiment',
    destination: '/records/rec-3',
  },
  {
    kind: 'dataset',
    id: 'ds-1',
    recordKind: null,
    label: 'Plate reader kinetics',
    identifier: null,
    reason: 'Captured by this experiment',
    destination: '/datasets/ds-1',
  },
  {
    kind: 'template',
    id: 'tpl-1',
    recordKind: null,
    label: 'Titration assay',
    identifier: null,
    reason: 'Same template revision',
    destination: '/templates/tpl-1',
  },
]

const meta = {
  title: 'Related work/List',
  component: RelatedWorkList,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
  args: { items },
} satisfies Meta<typeof RelatedWorkList>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** A record kind with no dedicated icon falls back to the record icon. */
export const UnknownRecordKind: Story = {
  args: {
    items: [
      { ...items[0], recordKind: 'compound', label: 'Compound batch 17' },
    ],
  },
}

export const LongLabels: Story = {
  args: {
    items: [
      {
        ...items[0],
        label:
          'Lentiviral vector harvest, clarified and concentrated, stability arm at −80 °C',
        reason:
          'Linked through the shared protocol revision PRT-2026-0012 and the storage map OPS-002',
      },
    ],
  },
}
