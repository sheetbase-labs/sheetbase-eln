/**
 * The trigger Spec column reads a stored schedule spec as the schedule reads:
 * minutes or hours, a daily wall-clock time in its zone, or the event name with
 * its Dataset filter. A spec this build cannot read renders as a gap, never as
 * raw jsonb — and a timed trigger whose spec cannot be read has no next run, so
 * the page states that it will not fire instead of showing a blank cell.
 */
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Route, scheduleParametersLabel, scheduleSpecLabel } from './triggers'
import { formatNotebookDateTime } from '#/lib/notebook-data'
import type * as pipelinesDataModule from '#/components/v3/pipelines/pipelines-data'
import type * as PipelineData from '#/lib/pipelines/data'
import type {
  PipelineDefinitionVersionWire,
  PipelineScheduleWire,
} from '#/lib/pipelines/types'

const PipelineTriggers = Route.options.component as React.ComponentType

const state = vi.hoisted(() => ({
  schedules: [] as PipelineScheduleWire[],
  // A published version by default: a trigger on such a pipeline can fire.
  published: true,
  inputNames: [] as string[],
  parameters: [] as Array<Record<string, unknown>>,
  created: [] as Array<Record<string, unknown>>,
  updated: [] as Array<Record<string, unknown>>,
  latestRuns: new Map<string, Record<string, unknown>>(),
}))

// jsdom reports no layout, so the grid's virtualiser would render no rows: give
// every element the viewport a browser would report for the list area.
for (const prop of ['offsetHeight', 'clientHeight'] as const) {
  Object.defineProperty(HTMLElement.prototype, prop, {
    configurable: true,
    get: () => 600,
  })
}

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    useParams: () => ({ pipelineId: 'def-1' }),
    useRouteContext: () => ({ context: { workspace: { id: 'ws-1' } } }),
    options: config,
  }),
  Link: ({
    children,
    params,
  }: {
    children: React.ReactNode
    params?: { runId?: string }
  }) => createElement('a', { href: `/runs/${params?.runId}` }, children),
}))

vi.mock('#/lib/pipelines/data', async (importOriginal) => ({
  ...(await importOriginal<typeof PipelineData>()),
  createPipelineSchedule: (
    _client: unknown,
    input: Record<string, unknown>,
  ) => {
    state.created.push(input)
    return Promise.resolve({})
  },
  updatePipelineSchedule: (
    _client: unknown,
    input: Record<string, unknown>,
  ) => {
    state.updated.push(input)
    return Promise.resolve({ enabled: input.enabled ?? true })
  },
}))

vi.mock('#/components/v3/pipelines/pipelines-data', async (importOriginal) => ({
  ...(await importOriginal<typeof pipelinesDataModule>()),
  useSchedules: () => ({ data: state.schedules }),
  useLatestScheduleRuns: () => ({ data: state.latestRuns }),
  useScheduleRuns: () => ({ data: [], isLoading: false }),
  useScheduleActivity: () => ({ data: [], isLoading: false }),
  useDatasetVersionChoices: () => ({ data: [] }),
  usePipelineVersions: () => ({
    isSuccess: true,
    data: [
      {
        lifecycle: state.published ? 'published' : 'draft',
        configuration: {
          inputs: state.inputNames.map((name) => ({ name })),
          parameters: state.parameters,
        },
      },
    ] as unknown as PipelineDefinitionVersionWire[],
  }),
}))

function schedule(
  overrides: Partial<PipelineScheduleWire> = {},
): PipelineScheduleWire {
  return {
    id: 'sched-1',
    workspace_id: 'ws-1',
    definition_id: 'def-1',
    kind: 'daily',
    spec: { dailyAt: '09:10', timeZone: 'Europe/London' },
    enabled: true,
    last_run_at: null,
    next_run_at: '2026-10-14T08:10:00.000Z',
    last_evaluated_at: null,
    last_evaluated_sequence: null,
    input_watermarks: {},
    created_at: '2026-10-01T09:00:00.000Z',
    updated_at: '2026-10-01T09:00:00.000Z',
    created_by_user_id: null,
    ...overrides,
  }
}

function renderTriggers() {
  return render(
    createElement(
      QueryClientProvider,
      {
        client: new QueryClient({
          defaultOptions: { queries: { retry: false } },
        }),
      },
      createElement(PipelineTriggers),
    ) as ReactNode,
  )
}

afterEach(() => {
  cleanup()
  state.schedules = []
  state.published = true
  state.inputNames = []
  state.parameters = []
  state.created = []
  state.updated = []
  state.latestRuns = new Map()
})

const noDatasets = new Map<string, string>()

describe('scheduleSpecLabel', () => {
  it('reads an interval spec as a duration', () => {
    expect(
      scheduleSpecLabel('interval', { intervalMinutes: 60 }, noDatasets),
    ).toBe('Every hour')
    expect(
      scheduleSpecLabel('interval', { intervalMinutes: 15 }, noDatasets),
    ).toBe('Every 15 minutes')
  })

  it('reads a daily spec as a time in its zone', () => {
    expect(
      scheduleSpecLabel(
        'daily',
        { dailyAt: '09:10', timeZone: 'Europe/London' },
        noDatasets,
      ),
    ).toBe('Daily at 09:10 (Europe/London)')
    // No zone stored means UTC, which is how the schedule is evaluated.
    expect(scheduleSpecLabel('daily', { dailyAt: '09:10' }, noDatasets)).toBe(
      'Daily at 09:10 (UTC)',
    )
  })

  it('reads an event spec as its event, naming the filtered dataset', () => {
    expect(
      scheduleSpecLabel(
        'event',
        { eventType: 'dataset.versioned' },
        noDatasets,
      ),
    ).toBe('A Dataset gets a new version')
    expect(
      scheduleSpecLabel(
        'event',
        { eventType: 'dataset.versioned', datasetId: 'ds-1' },
        new Map([['ds-1', 'Plate reader readings']]),
      ),
    ).toBe('A Dataset gets a new version · Plate reader readings')
  })

  it('renders a gap rather than raw jsonb when the spec cannot be read', () => {
    expect(scheduleSpecLabel('interval', {}, noDatasets)).toBe('—')
    expect(scheduleSpecLabel('daily', {}, noDatasets)).toBe('—')
    expect(scheduleSpecLabel('event', {}, noDatasets)).toBe('—')
  })

  it('never prints a raw dataset uuid it cannot resolve to a name', () => {
    const label = scheduleSpecLabel(
      'event',
      { eventType: 'dataset.versioned', datasetId: 'ds-unreadable' },
      noDatasets,
    )

    expect(label).not.toContain('ds-unreadable')
    expect(label).toBe(
      'A Dataset gets a new version · Dataset no longer readable',
    )
  })
})

describe('a schedule the sweep can never fire', () => {
  it('says the stored specification cannot be interpreted and it will not fire', () => {
    // A pre-0140 row: the legacy shape has no dailyAt, so no next run exists.
    state.schedules = [
      schedule({
        kind: 'daily',
        spec: { time: '09:10', timezone: 'Europe/London' },
        next_run_at: null,
      }),
    ]
    const { getByText } = renderTriggers()

    expect(getByText(/cannot be interpreted/)).toBeTruthy()
    expect(getByText(/will not fire/)).toBeTruthy()
    // The Next run cell states the outcome; the Spec cell keeps its own gap.
    expect(getByText('Never fires')).toBeTruthy()
    expect(getByText(/add a new trigger to restore the schedule/)).toBeTruthy()
  })

  it('keeps a readable schedule quiet', () => {
    state.schedules = [schedule()]
    const { getByText, queryByText } = renderTriggers()

    expect(getByText('Daily at 09:10 (Europe/London)')).toBeTruthy()
    expect(
      getByText(
        formatNotebookDateTime('2026-10-14T08:10:00.000Z', { zone: true }),
      ),
    ).toBeTruthy()
    expect(queryByText(/cannot be interpreted/)).toBeNull()
  })

  it('states why a trigger will not fire when the pipeline has no published version', () => {
    // The sweep runs the latest PUBLISHED version, so an enabled trigger on a
    // draft-only pipeline is inert; the row must not keep advertising the
    // stale next run that was stored when the trigger was created.
    state.published = false
    state.schedules = [
      schedule({
        kind: 'interval',
        spec: { intervalMinutes: 45 },
        next_run_at: '2026-10-14T11:20:00.000Z',
      }),
    ]
    const { getByText, queryByText } = renderTriggers()

    expect(getByText(/so its triggers will not fire/)).toBeTruthy()
    expect(getByText('No published version')).toBeTruthy()
    expect(
      queryByText(
        formatNotebookDateTime('2026-10-14T11:20:00.000Z', { zone: true }),
      ),
    ).toBeNull()
  })

  it('does not call an event trigger broken for having no wall-clock next run', () => {
    state.schedules = [
      schedule({
        kind: 'event',
        spec: { eventType: 'dataset.versioned' },
        next_run_at: null,
      }),
    ]
    const { getByText, queryByText } = renderTriggers()

    expect(getByText('On its event')).toBeTruthy()
    expect(queryByText(/cannot be interpreted/)).toBeNull()
    expect(queryByText('Never fires')).toBeNull()
  })

  it('offers to bind a dataset-version trigger to a declared input', () => {
    state.inputNames = ['raw', 'calibration']
    renderTriggers()

    fireEvent.click(screen.getAllByText('New trigger')[0])
    fireEvent.change(screen.getByLabelText(/^Runs/), {
      target: { value: 'event' },
    })
    expect(screen.getByText('Bind the new version to')).toBeTruthy()
    expect(screen.getByRole('option', { name: 'calibration' })).toBeTruthy()
    // The bound input reads the version that started the run; the other follows its Dataset.
    expect(screen.getByText(/reads the Dataset/)).toBeTruthy()
    expect(screen.getByLabelText('How calibration picks its data')).toBeTruthy()
  })

  it('passes the parameter values to the runs a trigger starts', async () => {
    state.parameters = [
      { name: 'plate_size', type: 'integer', required: true, default: 96 },
    ]
    renderTriggers()

    fireEvent.click(screen.getAllByText('New trigger')[0])
    const field = screen.getByLabelText('Parameter plate_size')
    expect((field as HTMLInputElement).value).toBe('96')
    fireEvent.change(field, { target: { value: '384' } })
    fireEvent.click(screen.getByText('Add trigger'))

    await vi.waitFor(() => expect(state.created).toHaveLength(1))
    expect(state.created[0]).toMatchObject({
      kind: 'daily',
      spec: { dailyAt: '09:00', parameters: { plate_size: 384 } },
    })
  })

  it('refuses a trigger whose required parameter is empty', () => {
    state.parameters = [{ name: 'plate_size', type: 'integer', required: true }]
    renderTriggers()

    fireEvent.click(screen.getAllByText('New trigger')[0])
    fireEvent.click(screen.getByText('Add trigger'))

    expect(screen.getByText('Required.')).toBeTruthy()
    expect(state.created).toHaveLength(0)
  })

  it('reads the parameters a trigger passes on its row', () => {
    expect(
      scheduleParametersLabel({
        dailyAt: '09:00',
        parameters: { plate_size: 384 },
      }),
    ).toBe('plate_size=384')
    expect(scheduleParametersLabel({ dailyAt: '09:00' })).toBe('')
  })

  it('offers an instrument filter on a dataset-version trigger', () => {
    renderTriggers()

    fireEvent.click(screen.getAllByText('New trigger')[0])
    fireEvent.change(screen.getByLabelText(/^Runs/), {
      target: { value: 'event' },
    })
    expect(screen.getByText('Only imports from this instrument')).toBeTruthy()
    expect(screen.getByText('Any instrument')).toBeTruthy()
  })

  it('reads a weekday cron trigger in plain words with its zone', () => {
    state.schedules = [
      schedule({
        kind: 'cron',
        spec: { cron: '30 7 * * 1-5', timeZone: 'Europe/London' },
      }),
    ]
    const { getByText } = renderTriggers()

    expect(getByText('Weekdays at 07:30 (Europe/London)')).toBeTruthy()
  })

  it('shows what an input follows and the missed-run policy on the row', () => {
    state.schedules = [
      schedule({
        spec: {
          dailyAt: '06:00',
          timeZone: 'UTC',
          missedRunPolicy: 'skip',
          inputs: {
            readings: { mode: 'incremental', datasetId: 'ds-1' },
          },
        },
      }),
    ]
    const { getByText } = renderTriggers()

    expect(getByText(/readings: new versions of a Dataset only/)).toBeTruthy()
    expect(getByText('Skips runs it misses')).toBeTruthy()
  })

  it('shows the last run and a paused trigger as paused', () => {
    state.schedules = [schedule({ enabled: false })]
    state.latestRuns = new Map([
      [
        'sched-1',
        {
          id: 'run-9',
          status: 'failed',
          started_at: '2026-10-13T09:10:00.000Z',
        },
      ],
    ])
    const { getByText, getAllByText } = renderTriggers()

    expect(getByText('Failed')).toBeTruthy()
    expect(getAllByText('Paused').length).toBeGreaterThanOrEqual(2)
    expect(getByText('Resume')).toBeTruthy()
  })

  it('adds a trigger that follows the latest data, in the person’s own zone', async () => {
    state.inputNames = ['readings']
    renderTriggers()

    fireEvent.click(screen.getAllByText('New trigger')[0])
    const mode = screen.getByLabelText<HTMLSelectElement>(
      'How readings picks its data',
    )
    // Following the latest version is the default; pinning is the opt-in.
    expect(mode.value).toBe('latest')
    fireEvent.click(screen.getByText('Add trigger'))
    // A Dataset must be chosen, or the trigger is refused before it is sent.
    expect(screen.getByText('Choose a Dataset.')).toBeTruthy()
    expect(state.created).toHaveLength(0)
  })

  it('opens a stored trigger to edit and saves its new rule', async () => {
    state.schedules = [
      schedule({
        kind: 'cron',
        spec: { cron: '0 9 * * 1', timeZone: 'UTC' },
      }),
    ]
    renderTriggers()

    fireEvent.click(screen.getByText('Edit'))
    const repeat = screen.getByLabelText<HTMLSelectElement>(/^Runs/)
    expect(repeat.value).toBe('weekly')
    fireEvent.change(screen.getByLabelText(/^On$/), { target: { value: '3' } })
    fireEvent.click(screen.getByText('Save trigger'))

    await vi.waitFor(() => expect(state.updated).toHaveLength(1))
    expect(state.updated[0]).toMatchObject({
      scheduleId: 'sched-1',
      kind: 'cron',
      spec: { cron: '0 9 * * 3', timeZone: 'UTC', missedRunPolicy: 'run_once' },
    })
  })
})
