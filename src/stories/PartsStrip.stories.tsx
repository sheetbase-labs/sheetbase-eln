import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  PartFooter,
  PartsStrip,
  UpNextBanner,
} from '#/components/notebook/parts-strip'
import { partsProgress } from '#/lib/experiment-parts'

/**
 * An experiment that runs over several days, one part per page. The strip sits
 * at the top of the notebook (a progress bar and a picker on a phone), the
 * cards at the foot go to the part before and after, and the banner shows over
 * a part that is not the one to work on yet.
 */
const parts = partsProgress(
  [
    {
      id: 'p1',
      recordId: 'r',
      position: 1,
      title: 'Seed cells',
      dayOffset: 0,
      assigneeUserId: null,
      openedAt: '2026-11-02T09:00:00Z',
      completedAt: '2026-11-02T15:00:00Z',
      completedByUserId: 'user-mei',
      requiresSignOff: false,
      signedOffAt: null,
      signedOffByUserId: null,
      signoffId: null,
    },
    {
      id: 'p2',
      recordId: 'r',
      position: 2,
      title: 'Dose with compound',
      dayOffset: 1,
      assigneeUserId: null,
      openedAt: '2026-11-03T09:00:00Z',
      completedAt: null,
      completedByUserId: null,
      requiresSignOff: false,
      signedOffAt: null,
      signedOffByUserId: null,
      signoffId: null,
    },
    {
      id: 'p3',
      recordId: 'r',
      position: 3,
      title: 'Read the plate',
      dayOffset: 4,
      assigneeUserId: null,
      openedAt: null,
      completedAt: null,
      completedByUserId: null,
      requiresSignOff: false,
      signedOffAt: null,
      signedOffByUserId: null,
      signoffId: null,
    },
  ],
  [],
)

const meta = {
  title: 'Notebook/Parts strip',
  component: PartsStrip,
  tags: ['autodocs'],
  args: {
    expId: '0198d970-e266-4000-8000-0000000000a1',
    parts,
    shown: parts[1],
    startedAt: '2026-11-02T09:00:00Z',
  },
  decorators: [
    (Story) => (
      <div className="p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PartsStrip>
export default meta
type Story = StoryObj<typeof meta>

/** The part to work on now is the one shown. */
export const Now: Story = {}

/** A part up next, read ahead of its day. */
export const UpNext: Story = {
  args: { shown: parts[2] },
  render: (args) => (
    <>
      <PartsStrip {...args} />
      <UpNextBanner expId={args.expId} shown={parts[2]} current={parts[1]} />
    </>
  ),
}

/** The cards at the foot of a part. */
export const Footer: Story = {
  render: (args) => (
    <PartFooter
      expId={args.expId}
      parts={parts}
      shown={parts[1]}
      startedAt={args.startedAt}
      nameOf={() => 'Mei L.'}
    />
  ),
}
