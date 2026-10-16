import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ComposedSheetWorkspace } from '#/components/sheet/composed-sheet-workspace'

/**
 * The composed workspace is the canonical workspace under its composed name
 * (a record-linked Sheet), so it opens with the same instance read. With no
 * database behind that read the workspace reports that it could not load the
 * Sheet; `CanonicalSheetWorkspace.stories.tsx` carries the neighbouring
 * states.
 */
const meta = {
  title: 'Sheet/Composed sheet workspace',
  component: ComposedSheetWorkspace,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: {
              queries: { retry: false, queryFn: () => new Promise(() => {}) },
            },
          })
        }
      >
        <div className="h-[520px] w-[900px] max-w-full">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  args: {
    instanceId: '0198d970-e266-4000-8000-000000000030',
    projectId: null,
  },
} satisfies Meta<typeof ComposedSheetWorkspace>
export default meta
type Story = StoryObj<typeof meta>

export const InstanceUnavailable: Story = {}

/** The reporting surface for a linked record. */
export const ReadOnly: Story = { args: { readOnly: true } }
