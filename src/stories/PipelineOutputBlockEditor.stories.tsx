import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { PipelineOutputBlockEditor } from '#/components/notebook/pipeline-output-block-editor'
import type { SaveResult } from '#/components/notebook/use-autosave'
import { pipelineQueryKeys } from '#/lib/pipelines/data'
import type {
  PipelineRunOutputWire,
  PipelineRunWire,
} from '#/lib/pipelines/types'

/**
 * The pipeline-output block's editor. It writes only through `save`, so the
 * stories supply a save that resolves — an honest stand-in for the route's
 * persist call, and the one input the editor cannot supply itself. It also
 * reads the recent runs and the attached run's outputs, so the stories seed
 * those two reads the way the route's cache would hold them.
 */
const RUN_ID = '0198d970-e266-4000-8000-000000000148'
const DATASET_ID = '0198d970-e266-4000-8000-0000000000d5'
const WORKSPACE_ID = '0198d970-e266-4000-8000-00000000ffff'

const run: PipelineRunWire = {
  id: RUN_ID,
  workspace_id: WORKSPACE_ID,
  definition_version_id: '0198d970-e266-4000-8000-000000000077',
  trigger_kind: 'manual',
  status: 'succeeded',
  attempt: 1,
  retry_of_run_id: null,
  trigger_occurrence_id: null,
  schedule_id: null,
  input_digest: null,
  parameters: {},
  input_versions: {},
  result: {},
  error_code: null,
  error_message: null,
  started_at: '2026-10-15T08:40:00Z',
  finished_at: '2026-10-15T08:44:00Z',
  actor_user_id: 'user-1',
  actor_credential_id: null,
  created_at: '2026-10-15T08:40:00Z',
}

const outputs: PipelineRunOutputWire[] = [
  {
    id: '0198d970-e266-4000-8000-0000000000e1',
    workspace_id: WORKSPACE_ID,
    run_id: RUN_ID,
    dataset_id: DATASET_ID,
    dataset_version_id: '0198d970-e266-4000-8000-0000000000e2',
    label: 'Plate read summary',
    created_at: '2026-10-15T08:44:00Z',
  },
]

function client() {
  const instance = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  instance.setQueryData(['pipelines', 'recent-runs'], [run])
  instance.setQueryData(pipelineQueryKeys.runOutputs(RUN_ID), outputs)
  return instance
}

async function save(): Promise<SaveResult<Record<string, unknown>>> {
  return { ok: true }
}

const meta = {
  title: 'Notebook/Pipeline output block editor',
  component: PipelineOutputBlockEditor,
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
