import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import type { DataClient } from '#/lib/data-client'
import type { PipelineConfig } from '#/lib/pipelines/config'
import type { PipelineRunWire } from '#/lib/pipelines/types'
import { startPipelineRun } from '#/lib/pipelines/data'
import { RunPipelineDialog } from './run-pipeline-dialog'

vi.mock('#/lib/pipelines/data', () => ({
  startPipelineRun: vi.fn(async () => ({ id: 'run', status: 'succeeded' })),
  executePipelineRun: vi.fn(),
  pipelineQueryKeys: { runs: () => ['runs'] },
}))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
it('runs without dataset inputs and leaves omitted parameters to their declared defaults', async () => {
  const config: PipelineConfig = {
    configVersion: 1,
    inputs: [],
    parameters: [
      { name: 'threshold', type: 'decimal', required: false, default: 7 },
    ],
    transform: {
      language: 'sql',
      statement: 'SELECT {{threshold}} AS threshold',
    },
    output: { mode: 'none', datasetLabel: 'result' },
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RunPipelineDialog
        dataClient={{} as DataClient}
        workspaceId="workspace"
        definitionVersionId="version"
        config={config}
        open
        onOpenChange={() => {}}
        onRunStarted={() => {}}
      />
    </QueryClientProvider>,
  )
  expect(
    screen.getByText('This pipeline runs without dataset inputs.'),
  ).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Run' }))
  await waitFor(() => expect(startPipelineRun).toHaveBeenCalled())
  expect(vi.mocked(startPipelineRun).mock.calls[0][1]).toMatchObject({
    parameters: {},
    inputVersions: {},
  })
})

const workflowConfig: PipelineConfig = {
  configVersion: 1,
  inputs: [],
  parameters: [],
  transform: { language: 'none', statement: '' },
  output: { mode: 'none', datasetLabel: 'result' },
  actions: [
    {
      name: 'project',
      operation: 'create_project',
      arguments: { p_title: 'Study' },
    },
  ],
}
it('reuses an invocation identity for submission recovery and creates a fresh one on the next open', async () => {
  vi.mocked(startPipelineRun).mockRejectedValueOnce(
    new Error('temporary failure'),
  )
  const queryClient = new QueryClient()
  const dialog = (open: boolean) => (
    <QueryClientProvider client={queryClient}>
      <RunPipelineDialog
        dataClient={{} as DataClient}
        workspaceId="workspace"
        definitionVersionId="version"
        config={workflowConfig}
        open={open}
        onOpenChange={() => {}}
        onRunStarted={() => {}}
      />
    </QueryClientProvider>
  )
  const { rerender } = render(dialog(true))
  fireEvent.click(screen.getByRole('button', { name: 'Run' }))
  await screen.findByRole('alert')
  const original =
    vi.mocked(startPipelineRun).mock.calls[0][1].triggerOccurrenceId
  expect(original).toMatch(/^manual:[0-9a-f-]{36}$/)
  fireEvent.click(screen.getByRole('button', { name: 'Run' }))
  await waitFor(() => expect(startPipelineRun).toHaveBeenCalledTimes(2))
  expect(vi.mocked(startPipelineRun).mock.calls[1][1].triggerOccurrenceId).toBe(
    original,
  )
  rerender(dialog(false))
  rerender(dialog(true))
  fireEvent.click(screen.getByRole('button', { name: 'Run' }))
  await waitFor(() => expect(startPipelineRun).toHaveBeenCalledTimes(3))
  expect(
    vi.mocked(startPipelineRun).mock.calls[2][1].triggerOccurrenceId,
  ).not.toBe(original)
})
it.each(['manual', 'scheduled', 'event'] as const)(
  'preserves the full original %s trigger and inputs when retrying',
  async (trigger) => {
    const retryRun: PipelineRunWire = {
      id: 'original-run',
      workspace_id: 'workspace',
      definition_version_id: 'original-version',
      trigger_kind: trigger,
      status: 'failed',
      attempt: 1,
      retry_of_run_id: null,
      trigger_occurrence_id:
        trigger === 'manual' ? 'manual:original' : 'occurrence-42',
      schedule_id: trigger === 'manual' ? null : 'schedule-42',
      input_digest: 'digest',
      parameters: { threshold: 3 },
      input_versions: { input: '00000000-0000-4000-8000-000000000222' },
      result: {},
      error_code: 'failure',
      error_message: 'Original failure',
      started_at: '2026-09-07T12:00:00Z',
      finished_at: '2026-09-07T12:00:01Z',
      actor_user_id: 'user',
      actor_credential_id: null,
      created_at: '2026-09-07T12:00:00Z',
    }
    const config: PipelineConfig = {
      ...workflowConfig,
      inputs: [{ name: 'input', required: true }],
      parameters: [{ name: 'threshold', type: 'decimal', required: true }],
    }
    const client = { list: async () => [] } as unknown as DataClient
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RunPipelineDialog
          dataClient={client}
          workspaceId="workspace"
          definitionVersionId="newest-version"
          config={config}
          open
          retryRun={retryRun}
          onOpenChange={() => {}}
          onRunStarted={() => {}}
        />
      </QueryClientProvider>,
    )
    expect(screen.getByDisplayValue('3').closest('fieldset')?.disabled).toBe(
      true,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(startPipelineRun).toHaveBeenCalled())
    expect(vi.mocked(startPipelineRun).mock.calls[0][1]).toEqual({
      workspaceId: 'workspace',
      definitionVersionId: 'original-version',
      triggerKind: trigger,
      parameters: retryRun.parameters,
      inputVersions: retryRun.input_versions,
      retryOfRunId: 'original-run',
      triggerOccurrenceId: retryRun.trigger_occurrence_id,
      scheduleId: retryRun.schedule_id,
    })
  },
)
