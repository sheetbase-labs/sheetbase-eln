import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { PreSignSummary } from '#/components/review/pre-sign-summary'

import { screenQueryClient } from './screen-stories'

/**
 * Shown above the signing form: what changed since the last version, and
 * anything worth a second look. It is advisory; the AI summary needs the
 * workspace's assistant, so a story shows the review as computed.
 */
const client = screenQueryClient()

const meta = {
  title: 'Review/Pre-sign summary',
  component: PreSignSummary,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <QueryClientProvider client={client}>
        <div className="w-[520px] max-w-full">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
} satisfies Meta<typeof PreSignSummary>

export default meta

type Story = StoryObj<typeof meta>

/** A revision with changes and three warnings. */
export const WithWarnings: Story = {
  args: {
    input: {
      diff: null,
      review: {
        compared: true,
        changes: [
          { area: 'text', count: 4 },
          { area: 'tables', count: 2 },
          { area: 'files', count: 1 },
        ],
        warnings: [
          {
            id: 'w1',
            kind: 'missing-unit',
            where: 'Results',
            field: 'Volume',
            count: 3,
          },
          {
            id: 'w2',
            kind: 'out-of-spec',
            where: 'Results',
            field: 'pH',
            count: 1,
            limit: '6.8 to 7.2',
          },
          {
            id: 'w3',
            kind: 'empty-required',
            where: 'Samples',
            field: 'Batch',
            count: 5,
          },
        ],
      },
    },
  },
}

/** Changes and nothing to flag. */
export const NoWarnings: Story = {
  args: {
    input: {
      diff: null,
      review: {
        compared: true,
        changes: [{ area: 'text', count: 2 }],
        warnings: [],
      },
    },
  },
}

/** A first version has nothing to compare against. */
export const FirstVersion: Story = {
  args: {
    input: {
      diff: null,
      review: {
        compared: false,
        changes: [{ area: 'first', count: 12 }],
        warnings: [],
      },
    },
  },
}
