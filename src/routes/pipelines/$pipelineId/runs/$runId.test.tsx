/**
 * PIPE-02.4 — the waiting run UI. A waiting run renders its confirm prompt and
 * the typed form controls to answer it; an answered prompt shows the answer and
 * who gave it; a run with no prompt renders nothing fabricated.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Route } from './$runId'
import type * as pipelineDataModule from '#/components/v3/pipelines/pipelines-data'
import type { PipelineRunDeliveryWire } from '#/components/v3/pipelines/pipelines-data'
import type * as pipelineLibData from '#/lib/pipelines/data'
import type {
  PipelineRunOutputWire,
  PipelineRunPromptWire,
  PipelineRunWire,
} from '#/lib/pipelines/types'

const RunPage = Route.options.component as React.ComponentType

interface RunPageState {
  run: PipelineRunWire | null
  prompts: PipelineRunPromptWire[]
  promptsLoading?: boolean
  memberNames: Record<string, string>
  deliveries: PipelineRunDeliveryWire[]
  outputs: PipelineRunOutputWire[]
  runError: boolean
  refetch: () => void
  versions: Array<{ id: string; version: number; lifecycle?: string }>
}

const state = vi.hoisted((): RunPageState => ({
  run: null,
  prompts: [],
  memberNames: {},
  deliveries: [],
  outputs: [],
  runError: false,
  refetch: () => {},
  versions: [{ id: 'v-1', version: 5 }],
}))
const dataLayer = vi.hoisted(() => ({
  answer: vi.fn(),
  cancel: vi.fn(),
  launch: vi.fn(),
}))
const notifications = vi.hoisted(() => ({
  toast: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    useParams: () => ({ pipelineId: 'PL-0003', runId: 'run-1' }),
    options: config,
  }),
  Link: ({ children }: { children: React.ReactNode }) => (
    <a href="#">{children}</a>
  ),
  useNavigate: () => vi.fn(),
}))

vi.mock('#/components/v3/pipelines/use-run-launcher', () => ({
  useRunLauncher: () => ({
    launch: dataLayer.launch,
    pending: false,
    dialog: null,
  }),
}))

vi.mock('#/components/v3/ui/sonner', () => ({
  toast: Object.assign(notifications.toast, { error: notifications.error }),
}))

vi.mock('#/lib/pipelines/data', async (importOriginal) => ({
  ...(await importOriginal<typeof pipelineLibData>()),
  answerPipelineRunPrompt: dataLayer.answer,
  cancelPipelineRun: dataLayer.cancel,
}))

vi.mock('#/components/v3/pipelines/pipelines-data', async (importOriginal) => ({
  ...(await importOriginal<typeof pipelineDataModule>()),
  usePipelineRun: () => ({
    data: state.run,
    isLoading: false,
    isError: state.runError,
    error: state.runError ? new Error('network') : null,
    refetch: state.refetch,
  }),
  useRunLogs: () => ({ data: [] }),
  useRunOutputs: () => ({ data: state.outputs }),
  useDatasetNames: () => ({
    data: { 'ds-1': 'DS-0001 · Viability summary' },
  }),
  useRunPrompts: () => ({
    data: state.prompts,
    isLoading: state.promptsLoading,
  }),
  useRunDeliveries: () => ({
    data: state.deliveries,
    isLoading: false,
  }),
  useWorkspaceMemberNames: () => ({ data: state.memberNames }),
  usePipelineDefinition: () => ({ data: { key: 'qc-daily' } }),
  usePipelineVersions: () => ({
    data: state.versions,
  }),
}))

function run(overrides: Partial<PipelineRunWire> = {}): PipelineRunWire {
  return {
    id: 'run-1',
    workspace_id: 'ws-1',
    definition_version_id: 'v-1',
    trigger_kind: 'scheduled',
    status: 'waiting',
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
    started_at: '2026-10-10T09:10:00.000Z',
    finished_at: null,
    actor_user_id: null,
    actor_credential_id: null,
    created_at: '2026-10-10T09:10:00.000Z',
    ...overrides,
  }
}

function prompt(
  overrides: Partial<PipelineRunPromptWire> = {},
): PipelineRunPromptWire {
  return {
    id: 'prompt-1',
    workspace_id: 'ws-1',
    run_id: 'run-1',
    step_id: 'confirm-units',
    form_schema: {
      title: 'Confirm units for DS-0298',
      description: 'It found values without units and will not guess them.',
      fields: [
        {
          key: 'glucose',
          label: 'Glucose',
          type: 'text',
          options: ['g/L', 'mg/L'],
        },
        { key: 'osmolality', label: 'Osmolality', type: 'decimal' },
      ],
      proposal: {
        step: 'confirm-units',
        rows: [
          {
            column: 'Glucose',
            rows: 84,
            values_seen: '2.2–3.4',
            suggested_unit: 'g/L',
          },
        ],
      },
    },
    asked_user_ids: ['u-1'],
    answer: null,
    answered_by_user_id: null,
    answered_at: null,
    expires_at: '2026-10-11T09:10:00.000Z',
    created_at: '2026-10-10T09:12:00.000Z',
    ...overrides,
  }
}

function renderRun() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RunPage />
    </QueryClientProvider>,
  )
}

function delivery(
  overrides: Partial<PipelineRunDeliveryWire> = {},
): PipelineRunDeliveryWire {
  return {
    id: 'delivery-1',
    subscription_id: 'sub-1',
    event_type: 'pipeline.run.completed',
    status: 'delivered',
    attempt: 1,
    response_status: 200,
    error_code: null,
    error_message: null,
    delivered_at: '2026-10-10T10:13:00.000Z',
    created_at: '2026-10-10T10:12:50.000Z',
    destination: { key: 'aav9-process', description: '#aav9-process' },
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  dataLayer.answer.mockReset()
  dataLayer.cancel.mockReset()
  notifications.toast.mockReset()
  notifications.error.mockReset()
  state.run = null
  state.versions = [{ id: 'v-1', version: 5 }]
  state.prompts = []
  state.promptsLoading = undefined
  state.memberNames = {}
  state.deliveries = []
  state.outputs = []
  state.runError = false
  dataLayer.launch.mockReset()
})

describe('a waiting run', () => {
  it('is readable as waiting and renders the prompt with its typed controls', () => {
    state.run = run({ status: 'waiting' })
    state.prompts = [prompt()]
    state.memberNames = { 'u-1': 'Tom H.' }
    const { getByText, getByRole, getByLabelText } = renderRun()

    // The run's own status is waiting, not running or failed.
    expect(getByText('Waiting for a person')).toBeTruthy()
    expect(getByText('This run is waiting for you')).toBeTruthy()

    // The prompt title, the proposal, and the typed form controls.
    expect(getByText('Confirm units for DS-0298')).toBeTruthy()
    expect(getByText('2.2–3.4')).toBeTruthy()
    expect(getByRole('combobox', { name: 'Glucose' })).toBeTruthy()
    expect(getByLabelText('Osmolality')).toBeTruthy()
    expect(getByLabelText('Reason')).toBeTruthy()

    // The controls that answer, and who was asked.
    expect(getByRole('button', { name: 'Confirm and continue' })).toBeTruthy()
    expect(getByRole('button', { name: 'Skip this step' })).toBeTruthy()
    expect(getByRole('button', { name: 'Stop run' })).toBeTruthy()
    expect(getByText(/Asked: Tom H\./)).toBeTruthy()
  })

  it('submits the decision, the values and the reason', async () => {
    state.run = run({ status: 'waiting' })
    state.prompts = [prompt()]
    const { getByRole, getByLabelText } = renderRun()

    fireEvent.change(getByRole('combobox', { name: 'Glucose' }), {
      target: { value: 'g/L' },
    })
    fireEvent.change(getByLabelText('Osmolality'), {
      target: { value: '300' },
    })
    fireEvent.change(getByLabelText('Reason'), {
      target: { value: 'Units dropped by the parser.' },
    })
    fireEvent.click(getByRole('button', { name: 'Confirm and continue' }))

    await waitFor(() =>
      expect(dataLayer.answer).toHaveBeenCalledWith('run-1', {
        decision: 'confirm',
        values: { glucose: 'g/L', osmolality: '300' },
        reason: 'Units dropped by the parser.',
      }),
    )
    // A confirm decision resumes the run.
    await waitFor(() =>
      expect(notifications.toast).toHaveBeenCalledWith(
        'Answer recorded — the run is resuming.',
      ),
    )
  })

  it('says the run stopped when the decision is Stop', async () => {
    state.run = run({ status: 'waiting' })
    state.prompts = [prompt()]
    const { getByRole } = renderRun()

    fireEvent.click(getByRole('button', { name: 'Stop run' }))

    await waitFor(() =>
      expect(dataLayer.answer).toHaveBeenCalledWith('run-1', {
        decision: 'stop',
        values: {},
        reason: undefined,
      }),
    )
    await waitFor(() =>
      expect(notifications.toast).toHaveBeenCalledWith(
        'Answer recorded — the run stopped',
      ),
    )
  })
})

describe('an answered prompt', () => {
  it('shows the answer, the values and who gave it', () => {
    state.run = run({ status: 'succeeded' })
    state.prompts = [
      prompt({
        answer: {
          decision: 'confirm',
          values: { glucose: 'g/L' },
          reason: 'Confirmed against AMB-25-112.',
        },
        answered_by_user_id: 'u-2',
        answered_at: '2026-10-10T10:00:00.000Z',
      }),
    ]
    state.memberNames = { 'u-2': 'Anna B.' }
    const { getByText, queryByRole } = renderRun()

    expect(getByText('Confirmed')).toBeTruthy()
    expect(getByText(/Glucose: g\/L/)).toBeTruthy()
    expect(getByText('Confirmed against AMB-25-112.')).toBeTruthy()
    expect(getByText(/Answered by Anna B\./)).toBeTruthy()
    // The answer is shown, not offered for editing again.
    expect(queryByRole('button', { name: 'Confirm and continue' })).toBeNull()
  })
})

describe('a run with no prompt', () => {
  it('renders no fabricated prompt', () => {
    state.run = run({ status: 'running' })
    state.prompts = []
    const { queryByText, queryByRole } = renderRun()

    expect(queryByText('Waiting prompt')).toBeNull()
    expect(queryByRole('button', { name: 'Confirm and continue' })).toBeNull()
    expect(queryByText(/This run is waiting for you/)).toBeNull()
    expect(queryByText('Running')).toBeTruthy()
  })
})

describe('a waiting run whose prompt is not readable', () => {
  it('states why there is no control instead of promising one', () => {
    state.run = run({ status: 'waiting' })
    state.prompts = []
    const { getByText, queryByRole } = renderRun()

    expect(getByText('This run is waiting for you')).toBeTruthy()
    expect(getByText(/no prompt could be read for it/)).toBeTruthy()
    expect(queryByRole('button', { name: 'Confirm and continue' })).toBeNull()
  })

  it('says the prompt is still loading while the read is in flight', () => {
    state.run = run({ status: 'waiting' })
    state.prompts = []
    state.promptsLoading = true
    const { getByText, queryByText } = renderRun()

    expect(getByText('Loading the decision prompt…')).toBeTruthy()
    expect(queryByText(/no prompt could be read for it/)).toBeNull()
  })
})

describe('stopping a run', () => {
  it('cancels a running run through api.cancel_pipeline_run once confirmed', async () => {
    state.run = run({ status: 'running', workspace_id: 'ws-7' })
    const { getByRole } = renderRun()

    fireEvent.click(getByRole('button', { name: 'Cancel run' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel run' }))

    await waitFor(() =>
      expect(dataLayer.cancel).toHaveBeenCalledWith(expect.anything(), {
        workspaceId: 'ws-7',
        runId: 'run-1',
      }),
    )
  })

  it('offers no cancel control for a waiting run, which is answered instead', () => {
    state.run = run({ status: 'waiting' })
    state.prompts = [prompt()]
    const { getByRole, queryByRole } = renderRun()

    expect(queryByRole('button', { name: 'Cancel run' })).toBeNull()
    expect(getByRole('button', { name: 'Stop run' })).toBeTruthy()
  })

  it('offers no cancel control for a run that already ended', () => {
    state.run = run({
      status: 'succeeded',
      finished_at: '2026-10-10T10:13:00.000Z',
    })
    const { queryByRole } = renderRun()

    expect(queryByRole('button', { name: 'Cancel run' })).toBeNull()
  })
})

describe('the run’s notification deliveries', () => {
  it('renders each delivery with its destination, status and outcome', () => {
    state.run = run({
      status: 'succeeded',
      result: { notificationDeliveryIds: ['delivery-1'] },
    })
    state.deliveries = [delivery()]
    const { getByText, getByRole } = renderRun()

    expect(
      getByRole('table', { name: 'Run notification deliveries' }),
    ).toBeTruthy()
    expect(getByText('#aav9-process')).toBeTruthy()
    expect(getByText('Delivered')).toBeTruthy()
    expect(getByText(/Sent 10 Oct 2026, (10:13 UTC|11:13 BST)/)).toBeTruthy()
  })

  it('shows why a failed delivery did not arrive', () => {
    state.run = run({
      status: 'succeeded',
      result: { notificationDeliveryIds: ['delivery-1'] },
    })
    state.deliveries = [
      delivery({
        status: 'dead_letter',
        attempt: 5,
        delivered_at: null,
        response_status: 500,
        error_code: 'http_500',
        error_message: 'The endpoint replied 500 after 5 attempts.',
      }),
    ]
    const { getByText } = renderRun()

    expect(getByText('Failed after retries')).toBeTruthy()
    expect(getByText('The endpoint replied 500 after 5 attempts.')).toBeTruthy()
  })

  it('renders an honest empty state, not a blank panel, when nothing was queued', () => {
    state.run = run({ status: 'succeeded', result: {} })
    state.deliveries = []
    const { getByText, queryByRole } = renderRun()

    expect(getByText('Notifications')).toBeTruthy()
    expect(
      getByText(
        'This run queued no notifications — the published version configured no destinations.',
      ),
    ).toBeTruthy()
    expect(
      queryByRole('table', { name: 'Run notification deliveries' }),
    ).toBeNull()
  })

  it('retries a failed run as a linked run on the same version and inputs', () => {
    state.run = run({
      status: 'failed',
      error_code: 'missing_input',
      error_message: 'missing input: readings',
      input_versions: { readings: 'dv-1' },
    })
    renderRun()
    expect(screen.getByText(/missing input: readings/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try this run again' }))
    expect(dataLayer.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        version: { id: 'v-1', version: 5 },
        retryOf: expect.objectContaining({
          id: 'run-1',
          input_versions: { readings: 'dv-1' },
        }),
      }),
    )
  })

  it('offers the same inputs on the current version when a newer one is published', () => {
    state.versions = [
      { id: 'v-2', version: 6, lifecycle: 'published' },
      { id: 'v-1', version: 5, lifecycle: 'retired' },
    ]
    state.run = run({
      status: 'failed',
      input_versions: { readings: 'dv-1' },
    })
    renderRun()
    expect(screen.getByRole('button', { name: 'Try again on v5' })).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', { name: 'Try again on current version (v6)' }),
    )
    expect(dataLayer.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        version: expect.objectContaining({ id: 'v-2' }),
        rerunOn: expect.objectContaining({
          input_versions: { readings: 'dv-1' },
        }),
      }),
    )
    expect(dataLayer.launch.mock.calls[0]?.[0]).not.toHaveProperty('retryOf')
  })

  it('offers to add a succeeded run to a notebook, and not a failed one', () => {
    state.run = run({ status: 'succeeded' })
    const { unmount } = renderRun()
    expect(screen.getByRole('button', { name: 'Add to notebook' })).toBeTruthy()
    unmount()
    state.run = run({ status: 'failed' })
    renderRun()
    expect(screen.queryByRole('button', { name: 'Add to notebook' })).toBeNull()
  })

  it('still explains a failed run that recorded no error message', () => {
    state.run = run({ status: 'failed' })
    renderRun()
    expect(screen.getByText('The run failed')).toBeTruthy()
    expect(screen.getByText(/No error message was recorded/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'See the log' })).toBeTruthy()
  })

  it('shows the rows a run computed and where they were saved', () => {
    state.run = run({
      status: 'succeeded',
      result: {
        rowCount: 2,
        resultPreview: {
          columns: ['sample', 'viability'],
          rows: [
            ['A', 0.91],
            ['B', null],
          ],
          rowCount: 2,
          truncated: false,
        },
      },
    })
    state.outputs = [
      {
        id: 'out-1',
        workspace_id: 'ws-1',
        run_id: 'run-1',
        dataset_id: 'ds-1',
        dataset_version_id: 'dv-9',
        label: 'Weekly viability',
        created_at: '2026-10-10T09:11:00.000Z',
      },
    ]
    renderRun()
    expect(screen.getByRole('table', { name: 'Result preview' })).toBeTruthy()
    expect(screen.getByText('0.91')).toBeTruthy()
    expect(screen.getByText(/2 rows saved/)).toBeTruthy()
    expect(screen.getByText('DS-0001 · Viability summary')).toBeTruthy()
    expect(screen.getByText(/Weekly viability/)).toBeTruthy()
    expect(screen.getByText('Open dataset')).toBeTruthy()
  })

  it('says plainly when a succeeded run saved nothing, and still shows the answer', () => {
    state.run = run({
      status: 'succeeded',
      result: {
        rowCount: 1,
        resultPreview: {
          columns: ['n'],
          rows: [[4]],
          rowCount: 1,
          truncated: false,
        },
      },
    })
    state.outputs = []
    renderRun()
    expect(screen.getByText('Nothing was saved')).toBeTruthy()
    expect(screen.getByRole('table', { name: 'Result preview' })).toBeTruthy()
    expect(screen.getByText('Set an output')).toBeTruthy()
  })

  it('sends a failed SQL run to the editor instead of offering a retry that cannot work', () => {
    state.run = run({
      status: 'failed',
      error_code: 'transform_failed',
      error_message: 'Transform failed: column "x" does not exist',
    })
    renderRun()
    expect(screen.getByText('The transform couldn’t run')).toBeTruthy()
    expect(screen.getByText('Edit pipeline')).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: 'Try this run again' }),
    ).toBeNull()
  })

  it('offers no retry for a succeeded run', () => {
    state.run = run({ status: 'succeeded' })
    renderRun()
    expect(
      screen.queryByRole('button', { name: 'Try this run again' }),
    ).toBeNull()
  })

  it('says a missing run was not found, and a failed read can be retried', () => {
    renderRun()
    expect(screen.getByText('This run wasn’t found.')).toBeTruthy()
    cleanup()
    state.runError = true
    const refetch = vi.fn()
    state.refetch = refetch
    renderRun()
    expect(screen.queryByText('This run wasn’t found.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalled()
  })
})
