/**
 * PIPE-02.4 — the waiting run UI. A waiting run renders its confirm prompt and
 * the typed form controls to answer it; an answered prompt shows the answer and
 * who gave it; a run with no prompt renders nothing fabricated.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Route } from './$runId'
import type * as pipelineDataModule from '#/components/v3/pipelines/pipelines-data'
import type * as pipelineLibData from '#/lib/pipelines/data'
import type {
  PipelineRunPromptWire,
  PipelineRunWire,
} from '#/lib/pipelines/types'

const RunPage = Route.options.component as React.ComponentType

interface RunPageState {
  run: PipelineRunWire | null
  prompts: PipelineRunPromptWire[]
  memberNames: Record<string, string>
}

const state = vi.hoisted((): RunPageState => ({
  run: null,
  prompts: [],
  memberNames: {},
}))
const dataLayer = vi.hoisted(() => ({ answer: vi.fn() }))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    useParams: () => ({ pipelineId: 'PL-0003', runId: 'run-1' }),
    options: config,
  }),
  Link: ({ children }: { children: React.ReactNode }) => (
    <a href="#">{children}</a>
  ),
}))

vi.mock('#/components/v3/ui/sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}))

vi.mock('#/lib/pipelines/data', async (importOriginal) => ({
  ...(await importOriginal<typeof pipelineLibData>()),
  answerPipelineRunPrompt: dataLayer.answer,
}))

vi.mock('#/components/v3/pipelines/pipelines-data', async (importOriginal) => ({
  ...(await importOriginal<typeof pipelineDataModule>()),
  usePipelineRun: () => ({ data: state.run }),
  useRunLogs: () => ({ data: [] }),
  useRunOutputs: () => ({ data: [] }),
  useRunPrompts: () => ({ data: state.prompts }),
  useWorkspaceMemberNames: () => ({ data: state.memberNames }),
  usePipelineVersions: () => ({
    data: [{ id: 'v-1', version: 5 }],
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

afterEach(() => {
  cleanup()
  dataLayer.answer.mockReset()
  state.run = null
  state.prompts = []
  state.memberNames = {}
})

describe('a waiting run', () => {
  it('is readable as waiting and renders the prompt with its typed controls', () => {
    state.run = run({ status: 'waiting' })
    state.prompts = [prompt()]
    state.memberNames = { 'u-1': 'Tom H.' }
    const { getByText, getByRole, getByLabelText } = renderRun()

    // The run's own status is waiting, not running or failed.
    expect(getByText('Waiting for a person')).toBeTruthy()
    expect(getByText('This run is waiting for you.')).toBeTruthy()

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
    expect(queryByText(/This run is waiting for you\./)).toBeNull()
    expect(queryByText('Running')).toBeTruthy()
  })
})
