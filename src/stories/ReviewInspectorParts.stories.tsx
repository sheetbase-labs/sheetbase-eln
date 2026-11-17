import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  ReviewProgress,
  ReviewReviewers,
} from '#/components/review/review-inspector-parts'

/** The review side panel's progress and reviewers, in the shared list style. */
const meta = {
  title: 'Review/Inspector parts',
  component: ReviewProgress,
  args: {
    steps: [
      {
        id: 'submitted',
        title: 'Submitted',
        state: 'completed',
        actor: 'Mei L.',
        at: '14 Nov 2026',
      },
      {
        id: 'review',
        title: 'Scientific review',
        state: 'completed',
        actor: 'Gareth P.',
      },
      {
        id: 'signed',
        title: 'Signed and locked',
        state: 'active',
      },
    ],
  },
} satisfies Meta<typeof ReviewProgress>

export default meta

type Story = StoryObj<typeof meta>

export const Progress: Story = {}

export const Returned: Story = {
  args: {
    steps: [
      { id: 'submitted', title: 'Submitted', state: 'completed' },
      { id: 'review', title: 'Scientific review', state: 'returned' },
      { id: 'signed', title: 'Signed and locked', state: 'pending' },
    ],
  },
}

export const Reviewers: Story = {
  render: () => (
    <ReviewReviewers
      reviewers={[
        { id: 'u1', name: 'Gareth P.', you: true },
        { id: 'u2', name: 'Mei L.', you: false },
      ]}
    />
  ),
}
