import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { AnalysisBlockPreview } from '#/components/notebook/block-preview'

/**
 * The analysis block's read view (SCI-03). Its payload names a saved
 * analysis; the preview renders what the block carries — the cited method,
 * the frozen numbers when they exist, and an honest state when none is
 * configured. A named analysis is read from its definition, so the stories
 * supply that read: in flight on first paint, and refused when it fails.
 */
function client(behaviour: 'pending' | 'refused') {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn:
          behaviour === 'pending'
            ? () => new Promise(() => {})
            : () => Promise.reject(new Error('offline')),
      },
    },
  })
}

const meta = {
  title: 'Notebook/Analysis block preview',
  component: AnalysisBlockPreview,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <QueryClientProvider client={client('pending')}>
        <div className="w-[680px] max-w-full">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  args: {},
} satisfies Meta<typeof AnalysisBlockPreview>
export default meta
type Story = StoryObj<typeof meta>

/** Nothing configured yet: the block says what to do. */
export const Unconfigured: Story = { args: { payload: {} } }

/** A named analysis: its definition read is in flight, as on first paint. */
export const NamedAnalysis: Story = {
  args: {
    payload: {
      title: 'Recovery by storage condition',
      provenance: 'Grouped descriptive statistics · ANOVA',
      definitionId: 'analysis-1',
    },
  },
}

/** The saved analysis cannot be read: the block says so instead of guessing. */
export const ReadRefused: Story = {
  args: {
    payload: {
      title: 'Recovery by storage condition',
      provenance: 'Grouped descriptive statistics · ANOVA',
      definitionId: 'analysis-1',
    },
  },
  decorators: [
    (Story) => (
      <QueryClientProvider client={client('refused')}>
        <div className="w-[680px] max-w-full">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
}
