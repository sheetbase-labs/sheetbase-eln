/**
 * The Steps editor lets an author keep a dataset: the output mode offers the
 * target (schema version or dataset) and the version label the shared contract
 * validator requires, and the saved configuration carries them.
 */
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Route } from './steps'
import type * as pipelinesDataModule from '#/components/v3/pipelines/pipelines-data'
import type { PipelineDefinitionVersionWire } from '#/lib/pipelines/types'

const PipelineSteps = Route.options.component as React.ComponentType

const SCHEMA_VERSION = '11111111-1111-4111-8111-111111111111'
const DATASET = '22222222-2222-4222-8222-222222222222'

const rpc = vi.hoisted(() => vi.fn().mockResolvedValue({}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    useParams: () => ({ pipelineId: 'def-1' }),
    useRouteContext: () => ({ context: { workspace: { id: 'ws-1' } } }),
    options: config,
  }),
  redirect: vi.fn(),
  Link: ({ children }: { children?: ReactNode }) => children,
}))

vi.mock('#/lib/notebook-data', () => ({ notebookDataClient: { rpc } }))

vi.mock('#/components/v3/pipelines/pipelines-data', async (importOriginal) => ({
  ...(await importOriginal<typeof pipelinesDataModule>()),
  usePipelineVersions: () => ({
    isLoading: false,
    data: [] as PipelineDefinitionVersionWire[],
  }),
  useWorkspaceMemberNames: () => ({ data: {} }),
  usePipelineDefinition: () => ({ data: { name: 'Viability summary' } }),
  useDefinitionRuns: () => ({ data: [] }),
  useSchemaVersionFields: (id: string) => ({
    isLoading: false,
    data: id
      ? [
          { key: 'sample', label: 'Sample', type: 'text', required: true },
          { key: 'od', label: 'OD', type: 'decimal', required: true },
        ]
      : [],
  }),
  useDatasetVersionChoices: () => ({
    data: [{ id: 'dv-1', label: 'DS-0001 · Readings — import' }],
  }),
  useDatasetVersionFields: (id: string) => ({
    isLoading: false,
    data: id
      ? [
          { key: 'batch', label: 'Batch', type: 'text', required: false },
          { key: 'value', label: 'Value', type: 'decimal', required: false },
        ]
      : [],
  }),
  usePipelineOutputTargets: () => ({
    isError: false,
    data: {
      datasets: [
        {
          id: DATASET,
          name: 'Readings',
          displayId: 'DS-0001',
          schemaVersionId: SCHEMA_VERSION,
        },
      ],
      schemaVersions: [{ id: SCHEMA_VERSION, label: 'Plate reader v2' }],
    },
  }),
}))

afterEach(() => {
  cleanup()
  rpc.mockClear()
})

function renderSteps() {
  render(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(PipelineSteps),
    ) as ReactNode,
  )
}

describe('Steps editor output', () => {
  it('can save a create output once schema version and label are chosen', async () => {
    renderSteps()
    fireEvent.change(document.querySelector('textarea')!, {
      target: { value: 'select 1' },
    })
    fireEvent.change(screen.getByLabelText('Output mode'), {
      target: { value: 'create' },
    })
    const save = screen.getByRole('button', { name: 'Create draft v1' })
    expect((save as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('This version cannot be saved yet')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Dataset name'), {
      target: { value: 'Weekly readings' },
    })
    fireEvent.change(screen.getByLabelText('Dataset schema version'), {
      target: { value: SCHEMA_VERSION },
    })
    fireEvent.change(screen.getByLabelText('Dataset version label'), {
      target: { value: 'Weekly' },
    })
    expect((save as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(save)

    await waitFor(() => expect(rpc).toHaveBeenCalled())
    const args = rpc.mock.calls[0][1] as {
      p_configuration: { output: Record<string, unknown> }
    }
    expect(args.p_configuration.output).toMatchObject({
      mode: 'create',
      schemaVersionId: SCHEMA_VERSION,
      datasetName: 'Weekly readings',
      datasetLabel: 'Weekly',
    })
  })

  it('saves declared parameters and a confirm step in the configuration', async () => {
    renderSteps()
    fireEvent.change(document.querySelector('textarea')!, {
      target: { value: 'select 1' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add parameter' }))
    fireEvent.change(screen.getByLabelText('Parameter 1 name'), {
      target: { value: 'dose' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add step' }))
    fireEvent.click(screen.getByLabelText('Step 1 waits for a person'))
    fireEvent.change(screen.getByLabelText('Output mode'), {
      target: { value: 'none' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create draft v1' }))
    await waitFor(() => expect(rpc).toHaveBeenCalled())
    const args = rpc.mock.calls[0][1] as {
      p_configuration: {
        parameters: unknown[]
        steps: { name: string; confirm?: unknown }[]
      }
    }
    expect(args.p_configuration.parameters).toMatchObject([{ name: 'dose' }])
    expect(args.p_configuration.steps[0].name).toBe('step_1')
    expect(args.p_configuration.steps[0].confirm).toBeTruthy()
  })

  it('can save an append output once a dataset and label are chosen', () => {
    renderSteps()
    fireEvent.change(document.querySelector('textarea')!, {
      target: { value: 'select 1' },
    })
    fireEvent.change(screen.getByLabelText('Output mode'), {
      target: { value: 'append' },
    })
    fireEvent.change(screen.getByLabelText('Dataset'), {
      target: { value: DATASET },
    })
    fireEvent.change(screen.getByLabelText('Dataset version label'), {
      target: { value: 'Weekly' },
    })
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'Create draft v1',
      }).disabled,
    ).toBe(false)
  })
})

describe('Steps editor guided building', () => {
  it('starts a new dataset output from the pipeline’s own name', () => {
    renderSteps()
    fireEvent.change(screen.getByLabelText('Output mode'), {
      target: { value: 'create' },
    })
    expect(screen.getByLabelText<HTMLInputElement>('Dataset name').value).toBe(
      'Viability summary',
    )
    expect(
      screen.getByLabelText<HTMLInputElement>('Dataset version label').value,
    ).toBe('Viability summary')
  })

  it('shows the columns the result must produce and saves a column matching', async () => {
    renderSteps()
    fireEvent.change(document.querySelector('textarea')!, {
      target: { value: 'select 1' },
    })
    fireEvent.change(screen.getByLabelText('Output mode'), {
      target: { value: 'create' },
    })
    fireEvent.change(screen.getByLabelText('Dataset schema version'), {
      target: { value: SCHEMA_VERSION },
    })
    expect(screen.getByLabelText('Result column for sample')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Result column for od'), {
      target: { value: 'optical_density' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create draft v1' }))
    await waitFor(() => expect(rpc).toHaveBeenCalled())
    const args = rpc.mock.calls[0][1] as {
      p_configuration: { output: Record<string, unknown> }
    }
    expect(args.p_configuration.output.fieldMapping).toEqual({
      optical_density: 'od',
    })
  })

  it('lets an author see an example dataset’s columns and put one in the SQL', () => {
    renderSteps()
    const sql = document.querySelector<HTMLTextAreaElement>('textarea')!
    fireEvent.change(sql, { target: { value: 'select  from readings' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add input' }))
    fireEvent.change(screen.getByLabelText('Input 1 name'), {
      target: { value: 'readings' },
    })
    fireEvent.change(screen.getByLabelText('Input 1 example dataset'), {
      target: { value: 'dv-1' },
    })
    sql.setSelectionRange(7, 7)
    fireEvent.click(screen.getByRole('button', { name: /^batch/ }))
    expect(sql.value).toBe('select readings.batch from readings')
  })
})
