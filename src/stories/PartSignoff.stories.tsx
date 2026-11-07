import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  PartSignoffReviewSection,
  SignOffPartCard,
  SignedPartBanner,
} from '#/components/notebook/part-signoff'
import { partsProgress } from '#/lib/experiment-parts'
import type { PartSignoffStatus } from '#/lib/part-signoff'

/**
 * A part that needs a signature. When its steps are done the Now card asks for
 * the sign-off; once signed the part is locked behind a banner until someone
 * amends it with a reason. The writes are only sent from the dialogs.
 */
const parts = partsProgress(
  [1, 2].map((position) => ({
    id: `p${position}`,
    recordId: 'r',
    position,
    title: position === 1 ? 'Seed cells' : 'Dose with compound',
    dayOffset: position - 1,
    assigneeUserId: null,
    openedAt: null,
    completedAt: null,
    completedByUserId: null,
    requiresSignOff: true,
    signedOffAt: null,
    signedOffByUserId: null,
    signoffId: null,
  })),
  [],
)

const signed: PartSignoffStatus = {
  partId: 'p1',
  partNumber: 1,
  title: 'Seed cells',
  requiresSignOff: true,
  workDone: true,
  awaitingSignOff: false,
  signed: true,
  signoffId: 's',
  signedAt: '2026-11-03T10:00:00Z',
  signedByUserId: 'u1',
  signerName: 'Priya Shah',
  snapshotDigest: 'abc',
  countersignedBy: [],
  countersignRequestedFrom: [],
  signRequestedFrom: [],
  amendmentCount: 0,
  lastAmendedAt: null,
  lastAmendmentReason: null,
}

const meta = {
  title: 'Notebook/Part sign-off',
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <QueryClientProvider client={new QueryClient()}>
        <div className="max-w-[720px] p-6">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** The Now card once the steps of Part 1 are done. */
export const AwaitingSignature: Story = {
  render: () => (
    <SignOffPartCard
      recordId="r"
      part={parts[0]}
      next={parts[1]}
      status={{ ...signed, signed: false, awaitingSignOff: true }}
      canEdit
      currentUserName="Gareth"
    />
  ),
}

/** A signed part: locked, with the way to amend it. */
export const Signed: Story = {
  render: () => (
    <SignedPartBanner
      recordId="r"
      part={parts[0]}
      status={signed}
      canEdit
      currentUserName="Gareth"
      hasCountersignRequest={false}
    />
  ),
}

/** The review list loads its own data, so with none it shows nothing. */
export const ReviewList: Story = {
  render: () => <PartSignoffReviewSection recordId="r" />,
}
