import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  FLAG_REASON_CATEGORIES,
  MarkOutOfRangeDialog,
  ValueActions,
} from './value-actions'
import type { DatasetValueFlag } from '#/lib/dataset-flags'
import type * as DatasetFlagsModule from '#/lib/dataset-flags'

const datasetFlags = vi.hoisted(() => ({
  flagDatasetValue: vi.fn(),
  clearDatasetValueFlag: vi.fn(),
  requestRepeat: vi.fn(),
}))

vi.mock('#/lib/dataset-flags', async (importOriginal) => {
  const actual = await importOriginal<typeof DatasetFlagsModule>()
  return { ...actual, ...datasetFlags }
})

const sonner = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('#/components/v3/ui/sonner', () => ({
  toast: sonner.toast,
  Toaster: () => null,
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  datasetFlags.flagDatasetValue.mockResolvedValue({})
  datasetFlags.clearDatasetValueFlag.mockResolvedValue({})
  datasetFlags.requestRepeat.mockResolvedValue({
    sample: { identifier: 'SMP-2249' },
    plannedRowIds: ['row-p1', 'row-p2'],
    idempotent: false,
  })
})

const systemFlag: DatasetValueFlag = {
  id: 'flag-1',
  datasetId: 'ds-1',
  rowId: 'row-1',
  fieldId: 'field-1',
  kind: 'out_of_range',
  source: 'system',
  reason: 'Value 61.5 is above the maximum 50',
  comment: 'Rule: turbidity range',
  setAt: '2026-10-01T09:00:00.000Z',
}

function renderActions(
  props: Partial<React.ComponentProps<typeof ValueActions>> = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ValueActions
        datasetId="ds-1"
        rowId="row-1"
        fieldId="field-1"
        fieldLabel="Turbidity"
        value={61.5}
        canWrite
        sourceSample={{ id: 'smp-1', identifier: 'SMP-2249' }}
        {...props}
      />
    </QueryClientProvider>,
  )
}

describe('ValueActions', () => {
  it('shows a flagged value state and clears a system flag by hand', async () => {
    const user = userEvent.setup()
    renderActions({ flags: [systemFlag] })

    expect(screen.getByText('Out of range')).toBeTruthy()
    expect(screen.getByText(systemFlag.reason)).toBeTruthy()
    expect(screen.getByText('Rule: turbidity range')).toBeTruthy()
    expect(screen.getByText(/System rule/)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Clear flag' }))
    await waitFor(() =>
      expect(datasetFlags.clearDatasetValueFlag).toHaveBeenCalledWith(
        expect.anything(),
        'flag-1',
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
    renderActions()

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
      expect(datasetFlags.flagDatasetValue).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          datasetId: 'ds-1',
          rowId: 'row-1',
          fieldId: 'field-1',
          kind: 'out_of_range',
          reason: 'Instrument or handling error',
          comment: 'Repeat queued as SMP-2249',
        }),
      ),
    )
  })

  it('requests a repeat and reports the derived sample and planned rows', async () => {
    const user = userEvent.setup()
    renderActions()

    await user.click(screen.getByRole('button', { name: 'Request repeat' }))

    await waitFor(() =>
      expect(datasetFlags.requestRepeat).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          sourceRecordId: 'smp-1',
          datasetId: 'ds-1',
          sourceRowId: 'row-1',
          sourceFieldId: 'field-1',
        }),
      ),
    )
    expect(sonner.toast).toHaveBeenCalledWith(
      expect.stringContaining('SMP-2249'),
      expect.objectContaining({
        description: expect.stringContaining('2 planned rows'),
      }),
    )
  })

  it('surfaces an RPC refusal as a toast instead of crashing', async () => {
    datasetFlags.flagDatasetValue.mockRejectedValueOnce(
      new Error('flag not found in active workspace'),
    )
    const user = userEvent.setup()
    renderActions()

    await user.click(screen.getByRole('button', { name: 'Mark out of range…' }))
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: 'Mark out of range' }))

    await waitFor(() =>
      expect(sonner.toast).toHaveBeenCalledWith(
        'Could not mark the value out of range',
        { description: 'flag not found in active workspace' },
      ),
    )
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
    expect((mark as HTMLButtonElement).disabled).toBe(true)
    expect((repeat as HTMLButtonElement).disabled).toBe(true)
  })

  it('disables Request repeat when no source sample is linked', () => {
    renderActions({ sourceSample: null })
    const repeat = screen.getByRole('button', { name: 'Request repeat' })
    expect((repeat as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('MarkOutOfRangeDialog', () => {
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
