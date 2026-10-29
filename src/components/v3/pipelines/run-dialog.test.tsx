/**
 * "Run with…" pins each declared input to a Dataset version and supplies the
 * declared parameters; Run stays unavailable until the database would accept
 * the request. A started run is then executed, since starting only records it.
 */
import { choose } from '../../../../tests/unit/picker'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
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
    list: async (resource: string) => {
      switch (resource) {
        case 'dataset_versions':
          return [
            {
              id: 'dv-1',
              dataset_id: 'ds-1',
              schema_version_id: 'sv-1',
              label: 'Weekly',
              created_at: '2026-10-01T00:00:00Z',
            },
            {
              id: 'dv-2',
              dataset_id: 'ds-2',
              schema_version_id: 'sv-2',
              label: 'Batch 7',
              created_at: '2026-10-02T00:00:00Z',
            },
          ]
        case 'dataset_schema_versions':
          return [
            { id: 'sv-1', schema_id: 'sch-1' },
            { id: 'sv-2', schema_id: 'sch-2' },
          ]
        case 'dataset_schema_definitions':
          return [
            { id: 'sch-1', name: 'Plate reader' },
            { id: 'sch-2', name: 'Bioreactor' },
          ]
        default:
          return [
            { id: 'ds-1', name: 'Readings', display_id: 'DS-0001' },
            { id: 'ds-2', name: 'Run data', display_id: 'DS-0002' },
          ]
      }
    },
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

/** Open the Dataset Version picker and list what it offers. */
async function offeredVersions() {
  await userEvent.click(
    await screen.findByRole('button', { name: 'Dataset version for readings' }),
  )
  const dialogs = await screen.findAllByRole('dialog')
  const list = dialogs[dialogs.length - 1]
  await within(list).findAllByRole('option')
  return within(list)
    .getAllByRole('option')
    .map((o) => o.textContent)
}

describe('RunDialog', () => {
  it('needs every input pinned and a valid required parameter before it runs', async () => {
    const onSubmit = vi.fn()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RunDialog
          pipelineName="glucose_trend"
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

    await choose(
      userEvent.setup(),
      'Dataset version for readings',
      /DS-0001 · Readings — Weekly/,
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

describe('RunDialog schema filter', () => {
  const renderDialog = (inputSchema?: string) =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RunDialog
          pipelineName="glucose_trend"
          version={version({
            inputs: [
              {
                name: 'readings',
                required: true,
                ...(inputSchema ? { schemaId: inputSchema } : {}),
              },
            ],
          })}
          busy={false}
          onClose={() => {}}
          onSubmit={() => {}}
        />
      </QueryClientProvider>,
    )

  it('offers only Dataset versions that follow the schema the input declares', async () => {
    renderDialog('sch-1')
    const options = await offeredVersions()
    expect(options.some((o) => /DS-0001 · Readings — Weekly/.test(o))).toBe(
      true,
    )
    expect(options.some((o) => /Batch 7/.test(o))).toBe(false)
  })

  it('lets the person widen the list to any schema', async () => {
    renderDialog('sch-1')
    await userEvent.selectOptions(
      await screen.findByLabelText('Schema for readings'),
      '',
    )
    expect((await offeredVersions()).join('|')).toMatch(
      /DS-0002 · Run data — Batch 7/,
    )
  })

  it('shows everything when the input declares no schema', async () => {
    renderDialog()
    const offered = (await offeredVersions()).join('|')
    expect(offered).toMatch(/DS-0001 · Readings — Weekly/)
    expect(offered).toMatch(/DS-0002 · Run data — Batch 7/)
  })

  it('says it is a trial, with nothing kept, when trying a draft', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RunDialog
          trial
          pipelineName="glucose_trend"
          version={version({ inputs: [], parameters: [] })}
          busy={false}
          onClose={() => {}}
          onSubmit={() => {}}
        />
      </QueryClientProvider>,
    )
    expect(
      screen.getByText(/Nothing is saved, published or recorded/),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try draft' })).toBeTruthy()
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
