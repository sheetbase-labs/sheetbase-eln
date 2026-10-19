import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DataClient } from '#/lib/data-client'

import {
  LABEL_SHEET_LIMIT,
  PrintLabelsDialog,
  SampleLabelSheet,
  recordBatchPrints,
} from './sample-label-sheet'
import type { BatchLabelRecord } from './sample-label-sheet'

afterEach(cleanup)

function record(n: number): BatchLabelRecord {
  return {
    id: `s-${n}`,
    identifier: `SMP-${n}`,
    title: `Sample ${n}`,
    metadataVersion: n,
  }
}

describe('SampleLabelSheet', () => {
  it('renders one label per sample in the print slot', () => {
    render(<SampleLabelSheet records={[record(1), record(2)]} host="x.test" />)
    const slot = document.querySelector('[data-slot="sample-label-print"]')!
    expect(slot.querySelectorAll('[data-slot="sample-label"]')).toHaveLength(2)
    expect(slot.textContent).toContain('SMP-1')
    expect(slot.textContent).toContain('SMP-2')
  })
})

describe('recordBatchPrints', () => {
  it('records every print and reports the ones that were refused', async () => {
    const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => {
      if (args.p_record_id === 's-2') throw new Error('stale')
      return { id: 'ev', operation: 'print', notes: null, created_at: '' }
    })
    const outcome = await recordBatchPrints({ rpc } as unknown as DataClient, [
      record(1),
      record(2),
      record(3),
    ])
    expect(rpc).toHaveBeenCalledTimes(3)
    expect(rpc).toHaveBeenCalledWith('record_sample_label_print', {
      p_record_id: 's-1',
      p_expected_metadata_version: 1,
      p_note: 'Printed label SMP-1',
    })
    expect(outcome.recorded).toBe(2)
    expect(outcome.failed.map((f) => f.identifier)).toEqual(['SMP-2'])
  })
})

describe('PrintLabelsDialog', () => {
  it('prints the sheet after recording, and says how many labels', async () => {
    const rpc = vi.fn(async () => ({}))
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    const onOpenChange = vi.fn()
    render(
      <PrintLabelsDialog
        open
        onOpenChange={onOpenChange}
        records={[record(1), record(2)]}
        scope="the 2 samples shown"
        client={{ rpc } as unknown as DataClient}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Print 2 labels' }))
    await vi.waitFor(() => expect(print).toHaveBeenCalledTimes(1))
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(onOpenChange).toHaveBeenCalledWith(false)
    print.mockRestore()
  })

  it('caps the sheet and says so', () => {
    const many = Array.from({ length: LABEL_SHEET_LIMIT + 4 }, (_, i) =>
      record(i),
    )
    render(
      <PrintLabelsDialog
        open
        onOpenChange={() => {}}
        records={many}
        scope="the samples shown"
        client={{ rpc: vi.fn() } as unknown as DataClient}
      />,
    )
    expect(
      screen.getByRole('button', { name: `Print ${LABEL_SHEET_LIMIT} labels` }),
    ).toBeTruthy()
    expect(screen.getByText(/only the first 96 are included/)).toBeTruthy()
  })

  it('offers no print when there is nothing to label', () => {
    render(
      <PrintLabelsDialog
        open
        onOpenChange={() => {}}
        records={[]}
        scope="no samples"
        client={{ rpc: vi.fn() } as unknown as DataClient}
      />,
    )
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Print 0 labels' })
        .disabled,
    ).toBe(true)
  })
})
