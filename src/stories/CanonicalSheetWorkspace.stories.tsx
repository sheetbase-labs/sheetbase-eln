import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  CanonicalSheetWorkspace,
  ComposedSheetWorkspace,
} from '#/components/sheet/canonical-sheet-workspace'

/**
 * The canonical Sheet workspace is route-level work: it reads the instance by
 * id and then its rows. A storybook build has no database behind that read,
 * so every state below is the workspace's own failure path — the instance
 * could not be loaded — and the populated states need a live Sheet Instance.
 * The editor itself is covered by `CanonicalSheetEditor.stories.tsx` with a
 * static instance, which renders the real grid.
 */
const INSTANCE_ID = '0198d970-e266-4000-8000-000000000030'

function client(run: () => Promise<never>) {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: run } },
  })
}

const pending = client(() => new Promise<never>(() => {}))
const refused = client(() => Promise.reject(new Error('offline')))

const meta = {
  title: 'Sheet/Canonical sheet workspace',
  component: CanonicalSheetWorkspace,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <QueryClientProvider client={pending}>
        <div className="h-[520px] w-[900px] max-w-full">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  args: { instanceId: INSTANCE_ID, projectId: null },
} satisfies Meta<typeof CanonicalSheetWorkspace>
export default meta
type Story = StoryObj<typeof meta>

/** An instance read that cannot complete is reported, not shown as an empty
 * sheet. */
export const InstanceUnavailable: Story = {}

/** A refused instance read takes the same path. */
export const ReadRefused: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider client={refused}>
        <div className="h-[520px] w-[900px] max-w-full">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
}

/** A read-only workspace (the reporting surface). */
export const ReadOnly: Story = { args: { readOnly: true } }

/** The composed wrapper renders the same workspace for a linked record. */
export const ComposedWrapper: Story = {
  render: (args) => (
    <ComposedSheetWorkspace
      instanceId={args.instanceId}
      projectId={args.projectId}
      readOnly={args.readOnly}
    />
  ),
}
