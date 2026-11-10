import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MarkOutOfRangeDialog, ValueActions } from './value-actions'
import { FLAG_REASON_CATEGORIES } from './value-action-labels'
import type {
  DatasetValueFlag,
  DatasetValueFlagWire,
  RequestRepeatResult,
} from '#/lib/dataset-flags'
import { createDataClient } from '#/lib/data-client'
import { Toaster, toast } from '#/components/ui/sonner'

const queryClients: QueryClient[] = []

afterEach(() => {
  cleanup()
  toast.dismiss()

  for (const client of queryClients) client.clear()
  queryClients.length = 0
})

const systemFlag: DatasetValueFlag = {
  id: 'flag-1',
  datasetId: 'ds-1',
  rowId: 'row-1',
  fieldId: 'field-1',
  kind: 'out_of_range',
  source: 'system',
  systemRule: 'out_of_range',
  reason: 'Value 61.5 is above the maximum 50',
  comment: 'Rule: turbidity range',
  evaluatedValue: 61.5,
  threshold: { min: 0, max: 50 },
  evaluatedAt: '2026-10-01T09:00:00.000Z',
  setAt: '2026-10-01T09:00:00.000Z',
}

function renderActions(
  props: Partial<React.ComponentProps<typeof ValueActions>> = {},
  response?: Response,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  queryClients.push(queryClient)

  const http = vi.fn<typeof fetch>((input) => {
    if (response) return Promise.resolve(response)

    if (input === '/api/db/rpc/request_repeat') {
      return Promise.resolve(
        Response.json({
          sample: { id: 'repeat-sample', identifier: 'SMP-2249' },
          plannedRowIds: ['row-p1', 'row-p2'],
          plannedRows: [{ id: 'row-p1', plannedKey: 'repeat:sample:1' }],
          datasetId: 'ds-1',
          idempotent: false,
        } satisfies RequestRepeatResult),
      )
    }

    if (
      input === '/api/db/rpc/flag_dataset_value' ||
      input === '/api/db/rpc/clear_dataset_value_flag'
    ) {
      return Promise.resolve(
        Response.json({
          id: systemFlag.id,
          dataset_id: systemFlag.datasetId,
          row_id: systemFlag.rowId,
          field_id: systemFlag.fieldId,
          kind: systemFlag.kind,
          source: systemFlag.source ?? 'manual',
          system_rule: systemFlag.systemRule ?? null,
          reason: systemFlag.reason,
          comment: systemFlag.comment,
          evaluated_value: systemFlag.evaluatedValue,
          threshold: systemFlag.threshold,
          evaluated_at: systemFlag.evaluatedAt ?? null,
          set_at: systemFlag.setAt,
          cleared_at: null,
          cleared_reason: null,
        } satisfies DatasetValueFlagWire),
      )
    }

    return Promise.reject(new Error('Unexpected value-action HTTP request'))
  })

  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory(),
  })

  render(
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={router}>
        <ValueActions
          client={createDataClient(http)}
          datasetId="ds-1"
          rowId="row-1"
          fieldId="field-1"
          fieldLabel="Turbidity"
          value={61.5}
          canWrite
          sourceSample={{ id: 'smp-1', identifier: 'SMP-2249' }}
          {...props}
        />
        <Toaster />
      </RouterContextProvider>
    </QueryClientProvider>,
  )

  return http
}

describe('ValueActions', () => {
  it('shows a flagged value state and clears a system flag with a reason', async () => {
    const user = userEvent.setup()
    const http = renderActions({ flags: [systemFlag] })

    expect(screen.getByText('Out of range')).toBeTruthy()
    expect(screen.getByText(systemFlag.reason)).toBeTruthy()
    expect(screen.getByText('Rule: turbidity range')).toBeTruthy()
    expect(screen.getByText('System rule')).toBeTruthy()
    // Provenance, not just the fact that a rule fired.
    expect(screen.getByText(/Evaluated 61.5/)).toBeTruthy()
    expect(screen.getByText(/expected 0–50/)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Clear flag' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeTruthy()
    // The reason is required: the submit stays disabled until one is entered.
    const submit = within(dialog).getByRole('button', { name: 'Clear flag' })
    expect(submit.hasAttribute('disabled')).toBe(true)
    await user.type(
      within(dialog).getByRole('textbox'),
      'Reviewed: instrument drift',
    )
    await user.click(submit)
    await waitFor(() =>
      expect(http).toHaveBeenCalledWith(
        '/api/db/rpc/clear_dataset_value_flag',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            p_flag_id: 'flag-1',
            p_reason: 'Reviewed: instrument drift',
          }),
        }),
      ),
    )
  })

  it('clears a manual flag in one step without a reason', async () => {
    const user = userEvent.setup()

    const manual: DatasetValueFlag = {
      ...systemFlag,
      id: 'flag-manual',
      kind: 'missing_unit',
      source: 'manual',
      systemRule: null,
      reason: 'Unit was not recorded',
      comment: null,
      evaluatedValue: null,
      threshold: null,
      evaluatedAt: null,
    }

    const http = renderActions({ flags: [manual] })

    await user.click(screen.getByRole('button', { name: 'Clear flag' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() =>
      expect(http).toHaveBeenCalledWith(
        '/api/db/rpc/clear_dataset_value_flag',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ p_flag_id: 'flag-manual', p_reason: null }),
        }),
      ),
    )
  })

  it('shows a system and manual flag on the same value separately', () => {
    const manual: DatasetValueFlag = {
      ...systemFlag,
      id: 'flag-2',
      kind: 'missing_unit',
      source: 'manual',
      reason: 'Unit was not recorded',
      comment: null,
    }

    renderActions({ flags: [systemFlag, manual] })
    expect(screen.getByText('Out of range')).toBeTruthy()
    expect(screen.getByText('Missing unit')).toBeTruthy()
    expect(screen.getByText('Unit was not recorded')).toBeTruthy()
    expect(screen.getByText(/System rule/)).toBeTruthy()
    expect(screen.getByText(/Set manually/)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Clear flag' })).toHaveLength(
      2,
    )
  })

  it('marks a value out of range with a reason category and optional comment', async () => {
    const user = userEvent.setup()
    const http = renderActions()

    expect(screen.queryByRole('button', { name: 'Clear flag' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Mark out of range…' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeTruthy()
    expect(screen.getByText(FLAG_REASON_CATEGORIES[0])).toBeTruthy()

    await user.click(
      screen.getByRole('radio', {
        name: 'Instrument or handling error',
      }),
    )
    await user.type(screen.getByRole('textbox'), 'Repeat queued as SMP-2249')
    await user.click(screen.getByRole('button', { name: 'Mark out of range' }))

    await waitFor(() =>
      expect(http).toHaveBeenCalledWith(
        '/api/db/rpc/flag_dataset_value',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            p_dataset_id: 'ds-1',
            p_row_id: 'row-1',
            p_field_id: 'field-1',
            p_kind: 'out_of_range',
            p_reason: 'Instrument or handling error',
            p_comment: 'Repeat queued as SMP-2249',
          }),
        }),
      ),
    )
  })

  it('requests a repeat and reports the derived sample and planned rows', async () => {
    const user = userEvent.setup()
    const http = renderActions()

    await user.click(screen.getByRole('button', { name: 'Request repeat' }))

    await waitFor(() =>
      expect(http).toHaveBeenCalledWith(
        '/api/db/rpc/request_repeat',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            p_source_record_id: 'smp-1',
            p_dataset_id: 'ds-1',
            p_scheduled_at: null,
            p_planned_row_count: 1,
            p_source_row_id: 'row-1',
            p_source_field_id: 'field-1',
            p_title: null,
            p_properties: {},
          }),
        }),
      ),
    )
    expect(
      await screen.findByText('Request repeat queued · SMP-2249'),
    ).toBeTruthy()
    expect(screen.getByText(/2 planned rows/)).toBeTruthy()

    const href = (
      await screen.findByRole('button', { name: 'Record repeat reading' })
    ).getAttribute('href')

    expect(href).not.toBeNull()

    if (href === null) throw new Error('Repeat reading link has no href')
    const search = new URL(href, 'http://test.invalid').searchParams
    expect(search.get('sample')).toBe('repeat-sample')
    expect(search.get('dataset')).toBe('ds-1')
    expect(search.get('plannedKey')).toBe('repeat:sample:1')
    expect(search.get('returnTo')).toBe(
      '/datasets/ds-1/rows?row=row-1&field=field-1&live=true',
    )
  })

  it('surfaces an RPC refusal as a toast instead of crashing', async () => {
    const user = userEvent.setup()
    renderActions(
      {},
      Response.json(
        {
          error: {
            code: 'refused',
            message: 'flag not found in active workspace',
          },
        },
        { status: 403 },
      ),
    )

    await user.click(screen.getByRole('button', { name: 'Mark out of range…' }))
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: 'Mark out of range' }))

    expect(
      await screen.findByText('Couldn’t mark the value out of range'),
    ).toBeTruthy()
    expect(screen.getByText('flag not found in active workspace')).toBeTruthy()
    // The dialog stays mounted rather than taking down the page.
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('disables write actions for a non-writer', () => {
    renderActions({ canWrite: false })
    expect(
      screen.getByText(/You have read access to this dataset/),
    ).toBeTruthy()
    const mark = screen.getByRole('button', { name: 'Mark out of range…' })
    const repeat = screen.getByRole('button', { name: 'Request repeat' })
    expect(mark.hasAttribute('disabled')).toBe(true)
    expect(repeat.hasAttribute('disabled')).toBe(true)
  })

  it('disables Request repeat when no source sample is linked', () => {
    renderActions({ sourceSample: null })
    const repeat = screen.getByRole('button', { name: 'Request repeat' })
    expect(repeat.hasAttribute('disabled')).toBe(true)
  })
})

interface SelectedValueCase {
  value: React.ComponentProps<typeof MarkOutOfRangeDialog>['value']
  shown: string
}

const selectedValueCases: SelectedValueCase[] = [
  { value: null, shown: '—' },
  { value: '', shown: '' },
  { value: ['<0.1', 2], shown: '<0.1,2' },
  { value: { concentration: '<0.1' }, shown: '[object Object]' },
  { value: Symbol('below detection'), shown: 'Symbol(below detection)' },
  { value: 10n, shown: '10' },
  {
    value: { toString: () => 'native scientific value' },
    shown: 'native scientific value',
  },
]

describe('MarkOutOfRangeDialog', () => {
  it.each(selectedValueCases)(
    'retains native selected-value display $shown',
    ({ value, shown }) => {
      render(
        <MarkOutOfRangeDialog
          open
          onOpenChange={vi.fn()}
          fieldLabel="Turbidity"
          value={value}
          onSubmit={vi.fn()}
        />,
      )
      expect(
        screen.getByText(`Turbidity · ${shown}`, { exact: true, trim: false }),
      ).toBeTruthy()
    },
  )

  it('keeps the value untouched and offers the design reason categories', () => {
    render(
      <MarkOutOfRangeDialog
        open
        onOpenChange={vi.fn()}
        fieldLabel="Turbidity"
        value={61.5}
        onSubmit={vi.fn()}
      />,
    )
    expect(screen.getByRole('dialog')).toBeTruthy()

    for (const category of FLAG_REASON_CATEGORIES) {
      expect(screen.getByRole('radio', { name: category })).toBeTruthy()
    }

    expect(screen.getByText(/The value stays as recorded/)).toBeTruthy()
  })
})
