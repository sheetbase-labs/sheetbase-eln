import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ReviewNextStepPanel } from '#/components/review/review-next-step'
import { workItemsQueryKeys } from '#/lib/work-items/data'

import { holdRead, screenQueryClient, screenRoutes } from './screen-stories'

/**
 * What happens next on a review, and the next review waiting on the reader. The
 * waiting reviews come from the Inbox read, which a story seeds.
 */
const waiting = {
  kind: 'review_requested',
  recordId: 'record-2',
  identifier: 'EXP-0043',
  title: 'Cloning attempt',
  projectId: null,
  reason: 'Review requested',
  dueAt: null,
  state: 'needs_action',
  createdAt: '2026-10-21T09:00:00Z',
  revisionId: 'revision-2',
}

const withNext = screenQueryClient({
  data: [{ key: workItemsQueryKeys.list(), value: [waiting] }],
})

const loading = screenQueryClient()

holdRead(loading, workItemsQueryKeys.list())

const none = screenQueryClient({
  data: [{ key: workItemsQueryKeys.list(), value: [] }],
})

const meta = {
  title: 'Review/Next step panel',
  component: ReviewNextStepPanel,
  tags: ['autodocs'],
  args: {
    step: {
      headline: 'Waiting for your review',
      detail:
        'Priya Shah submitted this notebook on 20 Oct. Sign to approve it.',
    },
    currentRevisionId: 'revision-1',
  },
  parameters: {
    tanstack: {
      router: {
        route: screenRoutes('/review/$revisionId', [
          '/inbox',
          '/records/$recordId',
        ]),
        path: '/review/revision-1',
        params: { revisionId: 'revision-1' },
      },
    },
  },
  decorators: [
    (Story, context) => (
      <QueryClientProvider
        // SAFETY: Storybook parameters are untyped by design; this story sets
        // `client` to a screenQueryClient() in its own parameters above.
        client={
          context.parameters.client as ReturnType<typeof screenQueryClient>
        }
      >
        <div className="w-[720px] max-w-full">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
} satisfies Meta<typeof ReviewNextStepPanel>

export default meta

type Story = StoryObj<typeof meta>

/** With an action for the reader and another review waiting. */
export const ActionAndNextReview: Story = {
  parameters: { client: withNext },
  args: { action: { label: 'Sign now', onClick: () => {} } },
}

/** Nothing else is waiting on the reader. */
export const NoOtherReviews: Story = { parameters: { client: none } }

/** The Inbox read is still loading, so no next review is offered. */
export const Loading: Story = { parameters: { client: loading } }
