/**
 * "Run with…" pins each declared input to a Dataset Version and supplies the
 * declared parameters; Run stays unavailable until the database would accept
 * the request. A started run is then executed, since starting only records it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PipelineDefinitionVersionWire } from '#/lib/pipelines/types'

import { RunDialog } from './run-dialog'
import { startAndExecuteRun } from './pipelines-data'

const mocks = vi.hoisted(() => ({
  startPipelineRun: vi.fn(),
  executePipelineRun: vi.fn(),
}))

vi.mock('#/lib/notebook-data', () => ({
  notebookDataClient: {
    list: async (resource: string) =>
      resource === 'dataset_versions'
        ? [
            {
              id: 'dv-1',
              dataset_id: 'ds-1',
              label: 'Weekly',
              created_at: '2026-10-01T00:00:00Z',
            },
          ]
        : [{ id: 'ds-1', name: 'Readings', display_id: 'DS-0001' }],
  },
}))

vi.mock('#/lib/pipelines/data', () => ({
  startPipelineRun: (...args: unknown[]) => mocks.startPipelineRun(...args),
  executePipelineRun: (...args: unknown[]) => mocks.executePipelineRun(...args),
}))

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

function version(configuration: Record<string, unknown>) {
  return {
    id: 'v-1',
    version: 2,
    configuration,
  } as unknown as PipelineDefinitionVersionWire
}

describe('RunDialog', () => {
  it('needs every input pinned and a valid required parameter before it runs', async () => {
    const onSubmit = vi.fn()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RunDialog
          pipelineKey="glucose_trend"
          version={version({
            inputs: [{ name: 'readings', required: true }],
            parameters: [
              { name: 'threshold', type: 'integer', required: true },
            ],
          })}
          busy={false}
          onClose={() => {}}
          onSubmit={onSubmit}
        />
      </QueryClientProvider>,
    )
    const run = await screen.findByRole<HTMLButtonElement>('button', {
      name: 'Run',
    })
    expect(run.disabled).toBe(true)

    await userEvent.selectOptions(
      await screen.findByLabelText('Dataset Version for readings'),
      await screen.findByRole('option', {
        name: /DS-0001 · Readings — Weekly/,
      }),
    )
    expect(run.disabled).toBe(true)
    await userEvent.type(screen.getByLabelText('Parameter threshold'), '5')
    expect(run.disabled).toBe(false)

    await userEvent.click(run)
    expect(onSubmit).toHaveBeenCalledWith({
      inputVersions: { readings: 'dv-1' },
      parameters: { threshold: 5 },
    })
  })
})

describe('startAndExecuteRun', () => {
  it('starts the run, then asks the server to execute it', async () => {
    mocks.startPipelineRun.mockResolvedValue({ id: 'run-1' })
    mocks.executePipelineRun.mockResolvedValue({ id: 'run-1' })
    const onSettled = vi.fn()
    const started = await startAndExecuteRun(
      { workspaceId: 'ws', definitionVersionId: 'v-1', triggerKind: 'manual' },
      onSettled,
    )
    expect(started.id).toBe('run-1')
    expect(mocks.executePipelineRun).toHaveBeenCalledWith('run-1')
    await waitFor(() => expect(onSettled).toHaveBeenCalledWith({}))
  })

  it('reports an execution failure after the run has started', async () => {
    mocks.startPipelineRun.mockResolvedValue({ id: 'run-1' })
    mocks.executePipelineRun.mockRejectedValue(new Error('sandbox refused'))
    const onSettled = vi.fn()
    await startAndExecuteRun(
      { workspaceId: 'ws', definitionVersionId: 'v-1' },
      onSettled,
    )
    await waitFor(() =>
      expect(onSettled).toHaveBeenCalledWith({
        error: expect.objectContaining({ message: 'sandbox refused' }),
      }),
    )
  })
})
