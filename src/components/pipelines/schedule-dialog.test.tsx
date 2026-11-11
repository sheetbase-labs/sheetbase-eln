import type { ComponentProps } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { ScheduleDialog } from './schedule-dialog'
import { defaultTimeZone, knownTimeZones } from './schedule-form'
import { setDisplayTimeZone } from '#/lib/display-time-zone'
import { createDataClient } from '#/lib/data-client'
import type { PipelineScheduleWire } from '#/lib/pipelines/types'

const schedule: PipelineScheduleWire = {
  id: 'sched-1',
  workspace_id: 'ws-1',
  definition_id: 'p-1',
  kind: 'daily',
  spec: {
    dailyAt: '06:00',
    timeZone: 'America/New_York',
    inputs: { readings: { mode: 'latest', datasetId: 'ds-1' } },
    parameters: { dose: 9 },
    missedRunPolicy: 'skip',
  },
  enabled: true,
  input_watermarks: {},
  last_run_at: null,
  next_run_at: null,
  last_evaluated_at: null,
  last_evaluated_sequence: null,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  created_by_user_id: null,
}

const clients = new Set<QueryClient>()

beforeEach(() => setDisplayTimeZone('Europe/London'))

afterEach(() => {
  cleanup()

  for (const client of clients) client.clear()
  clients.clear()
  setDisplayTimeZone(undefined)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function show(overrides: Partial<ComponentProps<typeof ScheduleDialog>> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })

  clients.add(client)
  client.setQueryData(
    ['ui-port', 'pipelines', 'trigger-dataset-options'],
    [{ id: 'ds-1', label: 'DS-0001 · Readings' }],
  )
  client.setQueryData(
    ['ui-port', 'pipelines', 'trigger-instruments'],
    [{ id: 'instrument-1', name: 'Plate reader' }],
  )
  client.setQueryData(
    ['ui-port', 'pipelines', 'dataset-version-choices'],
    [{ id: 'dv-1', label: 'Readings · Version 1' }],
  )

  const props: ComponentProps<typeof ScheduleDialog> = {
    open: true,
    onOpenChange: vi.fn(),
    client: createDataClient(),
    definitionId: 'p-1',
    workspaceId: 'ws-1',
    inputs: [{ name: 'readings', required: true }],
    parameters: [
      { name: 'dose', type: 'integer', required: false, default: 5 },
    ],
    ...overrides,
  }

  const view = render(<ScheduleDialog {...props} />, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  })

  return {
    client,
    rerender: (next: Partial<ComponentProps<typeof ScheduleDialog>>) =>
      view.rerender(<ScheduleDialog {...props} {...next} />),
  }
}

function selectRepeat(value: string) {
  fireEvent.change(screen.getByRole('combobox', { name: /^Runs/ }), {
    target: { value },
  })
}

describe('schedule time zones', () => {
  it('prefers the display zone and otherwise uses the browser zone', () => {
    expect(defaultTimeZone()).toBe('Europe/London')
    setDisplayTimeZone(undefined)
    expect(defaultTimeZone()).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    )
  })

  it('offers the browser zones and keeps UTC when supportedValuesOf is unavailable', () => {
    expect(knownTimeZones()).toEqual(Intl.supportedValuesOf('timeZone'))
    vi.spyOn(Intl, 'supportedValuesOf').mockImplementation(() => {
      throw new TypeError('supportedValuesOf is unavailable')
    })
    expect(knownTimeZones()).toEqual(['UTC'])
  })
})

describe('ScheduleDialog', () => {
  it('starts with latest inputs and defaults, then discards edits and validation on reopen', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    vi.stubGlobal('fetch', fetch)
    const view = show()
    expect(
      screen.getByRole<HTMLSelectElement>('combobox', {
        name: 'How readings picks its data',
      }).value,
    ).toBe('latest')
    expect(
      screen.getByLabelText<HTMLInputElement>('Parameter dose').value,
    ).toBe('5')
    expect(screen.getByLabelText<HTMLInputElement>(/^Time zone/).value).toBe(
      'Europe/London',
    )

    selectRepeat('monthly')
    fireEvent.change(screen.getByLabelText('Parameter dose'), {
      target: { value: 'invalid' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add trigger' }))
    expect(
      screen.getByText('Choose which Dataset readings follows.'),
    ).toBeTruthy()
    expect(screen.getByText('Enter a whole number')).toBeTruthy()
    expect(fetch).not.toHaveBeenCalled()

    view.rerender({ open: false })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    view.rerender({ open: true })
    expect(
      screen.getByRole<HTMLSelectElement>('combobox', { name: /^Runs/ }).value,
    ).toBe('daily')
    expect(
      screen.getByLabelText<HTMLInputElement>('Parameter dose').value,
    ).toBe('5')
    expect(
      screen.queryByText('Choose which Dataset readings follows.'),
    ).toBeNull()
    expect(screen.queryByText('Enter a whole number')).toBeNull()
  })

  it('keeps edits across equivalent props and resets when the edited schedule changes', () => {
    const view = show({ schedule })
    expect(screen.getByLabelText<HTMLInputElement>(/^At/).value).toBe('06:00')
    expect(screen.getByLabelText<HTMLInputElement>(/^Time zone/).value).toBe(
      'America/New_York',
    )
    expect(
      screen.getByLabelText<HTMLInputElement>('Parameter dose').value,
    ).toBe('9')
    fireEvent.change(screen.getByLabelText('Parameter dose'), {
      target: { value: '11' },
    })
    view.rerender({ schedule: { ...schedule } })
    expect(
      screen.getByLabelText<HTMLInputElement>('Parameter dose').value,
    ).toBe('11')
    view.rerender({
      schedule: {
        ...schedule,
        id: 'sched-2',
        spec: { ...schedule.spec, parameters: { dose: 12 } },
      },
    })
    expect(
      screen.getByLabelText<HTMLInputElement>('Parameter dose').value,
    ).toBe('12')
    view.rerender({ open: false })
    view.rerender({ open: true })
    expect(
      screen.getByLabelText<HTMLInputElement>('Parameter dose').value,
    ).toBe('9')
  })

  it('creates an interval with incremental and pinned inputs and typed parameters', async () => {
    const transport = vi.fn<typeof fetch>(async () => Response.json(schedule))
    vi.stubGlobal('fetch', transport)
    const onOpenChange = vi.fn()
    show({
      onOpenChange,
      inputs: [
        { name: 'readings', required: true },
        { name: 'reference', required: true },
      ],
      parameters: [
        { name: 'dose', type: 'integer', required: true },
        { name: 'enabled', type: 'boolean', required: false, default: true },
      ],
    })
    selectRepeat('interval')
    fireEvent.change(screen.getByLabelText(/^Every/), {
      target: { value: '2' },
    })
    fireEvent.change(screen.getByLabelText('How readings picks its data'), {
      target: { value: 'incremental' },
    })
    fireEvent.change(screen.getByLabelText('Dataset for readings'), {
      target: { value: 'ds-1' },
    })
    fireEvent.change(screen.getByLabelText('How reference picks its data'), {
      target: { value: 'pinned' },
    })
    fireEvent.change(screen.getByLabelText('Dataset version for reference'), {
      target: { value: 'dv-1' },
    })
    fireEvent.change(screen.getByLabelText('Parameter dose'), {
      target: { value: '7' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add trigger' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    const [url, init] = transport.mock.calls[0]
    expect(url).toBe('/api/db/rpc/create_pipeline_schedule')
    expect(JSON.parse(z.string().parse(init?.body))).toEqual({
      p_workspace_id: 'ws-1',
      p_definition_id: 'p-1',
      p_kind: 'interval',
      p_spec: {
        intervalMinutes: 120,
        inputs: {
          readings: { mode: 'incremental', datasetId: 'ds-1' },
          reference: { mode: 'pinned', versionId: 'dv-1' },
        },
        parameters: { dose: 7, enabled: true },
        missedRunPolicy: 'run_once',
      },
      p_enabled: true,
    })
  })

  it('keeps calendar controls, cron validation, zone validation and preview connected', async () => {
    const transport = vi.fn<typeof fetch>(async () => Response.json(schedule))
    const onOpenChange = vi.fn()

    vi.stubGlobal('fetch', transport)
    show({ onOpenChange, inputs: [], parameters: [] })
    expect(
      screen.getByText(/^Next runs, on the Europe\/London clock:/),
    ).toBeTruthy()
    selectRepeat('weekdays')
    expect(screen.queryByLabelText(/^On day of the month/)).toBeNull()
    selectRepeat('weekly')
    fireEvent.change(screen.getByLabelText(/^On$/), { target: { value: '3' } })
    expect(
      screen.getByRole<HTMLOptionElement>('option', { name: 'Wednesday' })
        .selected,
    ).toBe(true)
    selectRepeat('monthly')
    fireEvent.change(screen.getByLabelText(/^On day of the month/), {
      target: { value: '31' },
    })
    expect(
      screen.getByLabelText<HTMLInputElement>(/^On day of the month/).value,
    ).toBe('31')
    selectRepeat('cron')
    fireEvent.change(screen.getByLabelText(/^Cron expression/), {
      target: { value: 'invalid' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add trigger' }))
    expect(
      screen.getByText(
        'A cron expression has five fields: minute, hour, day of month, month, day of week.',
      ),
    ).toBeTruthy()
    expect(
      screen.getByLabelText(/^Cron expression/).getAttribute('aria-invalid'),
    ).toBe('true')
    expect(transport).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(/^Cron expression/), {
      target: { value: '15 10 * * 1-5' },
    })
    fireEvent.change(screen.getByLabelText(/^Time zone/), {
      target: { value: 'Not/AZone' },
    })
    expect(
      screen.getByText('Enter a valid time zone, e.g. Europe/London.'),
    ).toBeTruthy()
    expect(screen.queryByText(/^Next runs,/)).toBeNull()
    fireEvent.change(screen.getByLabelText(/^Time zone/), {
      target: { value: 'UTC' },
    })
    expect(screen.getByText(/^Next runs, on the UTC clock:/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add trigger' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(
      JSON.parse(z.string().parse(transport.mock.calls[0][1]?.body)),
    ).toMatchObject({
      p_kind: 'cron',
      p_spec: {
        cron: '15 10 * * 1-5',
        timeZone: 'UTC',
        missedRunPolicy: 'run_once',
      },
    })
  })

  it('binds an event to one input and saves filters while keeping other inputs explicit', async () => {
    const transport = vi.fn<typeof fetch>(async () => Response.json(schedule))
    vi.stubGlobal('fetch', transport)
    const onOpenChange = vi.fn()
    show({
      onOpenChange,
      inputs: [
        { name: 'readings', required: true },
        { name: 'reference', required: true },
      ],
    })
    selectRepeat('event')
    expect(screen.getByRole('dialog').textContent).toContain(
      'readings reads the dataset version that started the run.',
    )
    expect(screen.queryByLabelText('How readings picks its data')).toBeNull()
    fireEvent.change(screen.getByLabelText(/^Bind the new version to/), {
      target: { value: 'reference' },
    })
    fireEvent.change(screen.getByLabelText('Dataset for readings'), {
      target: { value: 'ds-1' },
    })
    fireEvent.change(screen.getByLabelText(/^Only this dataset/), {
      target: { value: 'ds-1' },
    })
    fireEvent.change(
      screen.getByLabelText(/^Only imports from this instrument/),
      { target: { value: 'instrument-1' } },
    )
    fireEvent.change(
      screen.getByLabelText('Events that arrive while the trigger is paused'),
      { target: { value: 'skip' } },
    )
    expect(
      screen.queryByText('Only when the dataset has a new version'),
    ).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add trigger' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(
      JSON.parse(z.string().parse(transport.mock.calls[0][1]?.body)),
    ).toMatchObject({
      p_kind: 'event',
      p_spec: {
        eventType: 'dataset.versioned',
        datasetId: 'ds-1',
        instrumentId: 'instrument-1',
        inputName: 'reference',
        inputs: { readings: { mode: 'latest', datasetId: 'ds-1' } },
        parameters: { dose: 5 },
        missedRunPolicy: 'skip',
      },
    })
  })

  it('updates an existing trigger, reports a refusal, and clears it on reopen', async () => {
    const transport = vi.fn<typeof fetch>(async () =>
      Response.json(
        { message: 'The trigger cannot be saved.', code: 'P0001' },
        { status: 400 },
      ),
    )

    vi.stubGlobal('fetch', transport)

    const view = show({ schedule })
    fireEvent.click(screen.getByRole('button', { name: 'Save trigger' }))
    expect(await screen.findByText('The trigger cannot be saved.')).toBeTruthy()
    const [url, init] = transport.mock.calls[0]
    expect(url).toBe('/api/db/rpc/update_pipeline_schedule')
    expect(JSON.parse(z.string().parse(init?.body))).toEqual({
      p_workspace_id: 'ws-1',
      p_schedule_id: 'sched-1',
      p_kind: 'daily',
      p_spec: schedule.spec,
      p_enabled: null,
    })
    view.rerender({ open: false })
    view.rerender({ open: true })
    expect(screen.queryByText('The trigger cannot be saved.')).toBeNull()
  })
})
