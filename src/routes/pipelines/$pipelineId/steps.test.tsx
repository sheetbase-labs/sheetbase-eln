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
const RUNTIME = `registry.example/sheetbase-python@sha256:${'a'.repeat(64)}`
const pythonRuntime = vi.hoisted(() => {
  const current: { isLoading: boolean; data: unknown } = {
    isLoading: false,
    data: undefined,
  }
  return { current }
})

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
  useWorkspaceMemberNames: () => ({ data: { 'u-1': 'Ada Lovelace' } }),
  usePythonRuntime: () => pythonRuntime.current,
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
  pythonRuntime.current = { isLoading: false, data: undefined }
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
    expect(screen.getByText('This version can’t be saved yet')).toBeTruthy()

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

describe('Steps editor Python', () => {
  const runtimeUp = {
    isLoading: false,
    data: { available: true, runtime: RUNTIME, packages: {} },
  }

  function choosePythonForTransform() {
    fireEvent.change(screen.getByLabelText('Transform language'), {
      target: { value: 'python' },
    })
  }

  it('pins the installed runtime so a Python transform can be saved', async () => {
    pythonRuntime.current = runtimeUp
    renderSteps()
    choosePythonForTransform()
    // The untouched SQL starter is replaced by a Python one, not left as SQL.
    expect(
      screen.getByLabelText<HTMLTextAreaElement>('Transform code').value,
    ).toContain('def transform(inputs, parameters)')
    fireEvent.change(screen.getByLabelText('Output mode'), {
      target: { value: 'none' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create draft v1' }))
    await waitFor(() => expect(rpc).toHaveBeenCalled())
    const config = (rpc.mock.calls[0][1] as { p_configuration: unknown })
      .p_configuration as {
      pythonRuntime: string
      transform: { language: string }
    }
    expect(config.transform.language).toBe('python')
    expect(config.pythonRuntime).toBe(RUNTIME)
  })

  it('pins the runtime for a Python further step too', async () => {
    pythonRuntime.current = runtimeUp
    renderSteps()
    fireEvent.change(document.querySelector('textarea')!, {
      target: { value: 'select 1' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add step' }))
    fireEvent.change(screen.getByLabelText('Step 1 language'), {
      target: { value: 'python' },
    })
    fireEvent.change(screen.getByLabelText('Output mode'), {
      target: { value: 'none' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create draft v1' }))
    await waitFor(() => expect(rpc).toHaveBeenCalled())
    const config = (rpc.mock.calls[0][1] as { p_configuration: unknown })
      .p_configuration as { pythonRuntime: string }
    expect(config.pythonRuntime).toBe(RUNTIME)
  })

  it('says why it cannot save when no Python runner is connected', () => {
    pythonRuntime.current = {
      isLoading: false,
      data: { available: false, message: 'No runner here.' },
    }
    renderSteps()
    choosePythonForTransform()
    expect(screen.getByText('No runner here.')).toBeTruthy()
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'Create draft v1',
      }).disabled,
    ).toBe(true)
  })

  it('does not pin a runtime for a SQL-only pipeline', async () => {
    pythonRuntime.current = runtimeUp
    renderSteps()
    fireEvent.change(document.querySelector('textarea')!, {
      target: { value: 'select 1' },
    })
    fireEvent.change(screen.getByLabelText('Output mode'), {
      target: { value: 'none' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create draft v1' }))
    await waitFor(() => expect(rpc).toHaveBeenCalled())
    const config = (rpc.mock.calls[0][1] as { p_configuration: object })
      .p_configuration
    expect(config).toMatchObject({ pythonRuntime: undefined })
  })

  it('saves pinned packages and a data contract with the Python step', async () => {
    pythonRuntime.current = {
      isLoading: false,
      data: {
        available: true,
        runtime: RUNTIME,
        packages: { scipy: '1.15.3', numpy: '2.2.6' },
      },
    }
    renderSteps()
    choosePythonForTransform()
    fireEvent.change(screen.getByLabelText('Python package requirements'), {
      target: { value: 'scipy==1.15.3' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Add Transform output column' }),
    )
    fireEvent.change(screen.getByLabelText('Transform output column 1 name'), {
      target: { value: 'mean' },
    })
    fireEvent.change(screen.getByLabelText('Output mode'), {
      target: { value: 'none' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create draft v1' }))
    await waitFor(() => expect(rpc).toHaveBeenCalled())
    const config = (rpc.mock.calls[0][1] as { p_configuration: unknown })
      .p_configuration as {
      pythonRequirements: string[]
      transform: { contract: unknown }
    }
    expect(config.pythonRequirements).toEqual(['scipy==1.15.3'])
    expect(config.transform.contract).toEqual({
      output: { columns: [{ name: 'mean', type: 'text' }] },
    })
  })

  it('will not save a package the runtime cannot provide', () => {
    pythonRuntime.current = {
      isLoading: false,
      data: { available: true, runtime: RUNTIME, packages: { numpy: '2.2.6' } },
    }
    renderSteps()
    choosePythonForTransform()
    fireEvent.change(screen.getByLabelText('Python package requirements'), {
      target: { value: 'scipy==1.15.3' },
    })
    expect(screen.getByText('This version can’t be saved yet')).toBeTruthy()
    expect(
      screen.getAllByText('scipy==1.15.3 is not in this runtime.').length,
    ).toBeGreaterThan(0)
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'Create draft v1',
      }).disabled,
    ).toBe(true)
  })

  it('drops packages and the contract when the pipeline goes back to SQL', async () => {
    pythonRuntime.current = runtimeUp
    renderSteps()
    choosePythonForTransform()
    fireEvent.change(screen.getByLabelText('Python package requirements'), {
      target: { value: 'numpy==2.2.6' },
    })
    fireEvent.change(screen.getByLabelText('Transform language'), {
      target: { value: 'sql' },
    })
    fireEvent.change(screen.getByLabelText('Transform code'), {
      target: { value: 'select 1' },
    })
    fireEvent.change(screen.getByLabelText('Output mode'), {
      target: { value: 'none' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create draft v1' }))
    await waitFor(() => expect(rpc).toHaveBeenCalled())
    const config = (rpc.mock.calls[0][1] as { p_configuration: object })
      .p_configuration
    expect(config).toMatchObject({
      pythonRequirements: undefined,
      pythonRuntime: undefined,
    })
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
    fireEvent.change(screen.getByLabelText('Pipeline section'), {
      target: { value: 'inputs' },
    })
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

  it('keeps edits with the selected step through navigation, reordering and removal', async () => {
    renderSteps()
    fireEvent.change(screen.getByRole('textbox', { name: 'Transform code' }), {
      target: { value: 'select 5' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add step' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Step 1 code' }), {
      target: { value: 'select 11' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add step' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Step 2 code' }), {
      target: { value: 'select 22' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Move step 2 up' }))
    expect(
      screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Step 1 code' })
        .value,
    ).toBe('select 22')
    fireEvent.change(screen.getByRole('textbox', { name: 'Step 1 code' }), {
      target: { value: 'select 23' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Move step 1 down' }))
    expect(
      screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Step 2 code' })
        .value,
    ).toBe('select 23')
    fireEvent.click(screen.getByRole('button', { name: 'Remove step 2' }))
    expect(
      screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Step 1 code' })
        .value,
    ).toBe('select 11')
    fireEvent.change(screen.getByLabelText('Pipeline section'), {
      target: { value: 'transform' },
    })
    expect(
      screen.getByRole<HTMLTextAreaElement>('textbox', {
        name: 'Transform code',
      }).value,
    ).toBe('select 5')
    fireEvent.click(screen.getByRole('button', { name: 'Create draft v1' }))
    await waitFor(() => expect(rpc).toHaveBeenCalled())
    expect(rpc.mock.calls[0][1].p_configuration).toMatchObject({
      transform: { statement: 'select 5' },
      steps: [{ name: 'step_1', statement: 'select 11' }],
    })
  })
})

describe('Steps editor Try draft', () => {
  const answer = {
    ok: true,
    preview: {
      columns: ['n'],
      rows: [[1]],
      rowCount: 1,
      truncated: false,
    },
    logs: [],
    durationMs: 120,
    wouldWrite: 'none',
  }

  it('runs the unsaved draft, shows the result inline and says when it is out of date', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(answer))
    vi.stubGlobal('fetch', fetchMock)
    renderSteps()
    const sql = document.querySelector<HTMLTextAreaElement>('textarea')!
    fireEvent.change(sql, { target: { value: 'select 1 as n' } })
    fireEvent.click(screen.getByRole('button', { name: 'Try draft' }))

    await screen.findByText('Try draft result')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/pipelines/try-draft')
    const body = JSON.parse(init.body as string) as {
      workspaceId: string
      configuration: { transform: { statement: string } }
    }
    expect(body.workspaceId).toBe('ws-1')
    expect(body.configuration.transform.statement).toBe('select 1 as n')
    expect(screen.getByText(/Nothing was saved/)).toBeTruthy()
    // Nothing was saved or published to get this answer.
    expect(rpc).not.toHaveBeenCalled()
    expect(screen.queryByText(/You changed the draft/)).toBeNull()

    fireEvent.change(sql, { target: { value: 'select 2 as n' } })
    expect(screen.getByText(/You changed the draft/)).toBeTruthy()
    vi.unstubAllGlobals()
  })

  it('asks which Dataset Versions to use when the draft declares inputs', async () => {
    renderSteps()
    fireEvent.change(document.querySelector('textarea')!, {
      target: { value: 'select * from readings' },
    })
    fireEvent.change(screen.getByLabelText('Pipeline section'), {
      target: { value: 'inputs' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add input' }))
    fireEvent.change(screen.getByLabelText('Input 1 name'), {
      target: { value: 'readings' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Try draft' }))
    expect(await screen.findByText(/Try Viability summary with…/)).toBeTruthy()
  })

  it('shows the reason when the draft does not run', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          ok: false,
          errorCode: 'transform_failed',
          errorMessage: 'Transform failed: column "x" does not exist',
          logs: [],
        }),
      ),
    )
    renderSteps()
    fireEvent.change(document.querySelector('textarea')!, {
      target: { value: 'select x' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Try draft' }))
    expect(await screen.findByText(/column "x" does not exist/)).toBeTruthy()
    vi.unstubAllGlobals()
  })
})
