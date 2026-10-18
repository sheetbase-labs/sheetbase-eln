import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { PipelineOutputBlockPreview } from '#/components/notebook/pipeline-output-block-preview'

/**
 * The pipeline-output block preview. When the payload pins a proposal the
 * preview reads it, so the stories seed that read (or leave it pending) with
 * a static client; the run links resolve through the Storybook router.
 */
const RUN_ID = '0198d970-e266-4000-8000-000000000148'

function client() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, queryFn: () => new Promise(() => {}) },
    },
  })
}

const meta = {
  title: 'Notebook/Pipeline output preview',
  component: PipelineOutputBlockPreview,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <QueryClientProvider client={client()}>
        <div className="w-[720px] max-w-full">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  args: {
    payload: {
      runId: RUN_ID,
      label: 'Plate read summary',
      datasetId: '0198d970-e266-4000-8000-0000000000d5',
      datasetVersionId: '0198d970-e266-4000-8000-0000000000v1'.replace(
        'v',
        'e',
      ),
    },
  },
} satisfies Meta<typeof PipelineOutputBlockPreview>
export default meta
type Story = StoryObj<typeof meta>

/** An attached run, its pinned Dataset Version and its destinations. */
export const AttachedRun: Story = {}

/** A block with no run attached states what to do next. */
export const NoRun: Story = {
  args: { payload: { label: 'Plate read summary' } },
}

/** Without a pinned Dataset Version the version line is omitted, not
 * invented. */
export const WithoutDatasetVersion: Story = {
  args: {
    payload: {
      runId: RUN_ID,
      label: 'Plate read summary',
      datasetId: '0198d970-e266-4000-8000-0000000000d5',
    },
  },
}

/** No label: the preview names the run by its id alone. */
export const UnlabelledRun: Story = {
  args: { payload: { runId: RUN_ID } },
}
