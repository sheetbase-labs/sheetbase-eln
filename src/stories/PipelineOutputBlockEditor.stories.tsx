import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { PipelineOutputBlockEditor } from '#/components/notebook/pipeline-output-block-editor'
import type { SaveResult } from '#/components/notebook/use-autosave'

/**
 * The pipeline-output block's editor. It writes only through `save`, so the
 * stories supply a save that resolves — an honest stand-in for the route's
 * persist call, and the one input the editor cannot supply itself.
 */
const RUN_ID = '0198d970-e266-4000-8000-000000000148'

async function save(): Promise<SaveResult<Record<string, unknown>>> {
  return { ok: true }
}

const meta = {
  title: 'Notebook/Pipeline output block editor',
  component: PipelineOutputBlockEditor,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[720px] max-w-full">
        <Story />
      </div>
    ),
  ],
  args: {
    block: {
      payload: {
        runId: RUN_ID,
        label: 'Plate read summary',
        datasetId: '0198d970-e266-4000-8000-0000000000d5',
      },
      payloadSchemaVersion: 1,
    },
    save,
    onStatusChange: () => {},
  },
} satisfies Meta<typeof PipelineOutputBlockEditor>
export default meta
type Story = StoryObj<typeof meta>

/** An attached run: the editor states it and offers to change it. */
export const AttachedRun: Story = {}

/** Nothing attached yet: the block invites a run to be pinned. */
export const Empty: Story = {
  args: { block: { payload: {}, payloadSchemaVersion: 1 } },
}

/** Offline: saves are held, and the status says so. */
export const Offline: Story = { args: { offline: true } }

/** Read-only: a viewer may inspect the attachment but not change it. */
export const ReadOnly: Story = { args: { readOnly: true } }
