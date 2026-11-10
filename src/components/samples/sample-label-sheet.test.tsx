import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render as rtlRender,
  screen,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createDataClient } from '#/lib/data-client'
import { Toaster, toast } from '#/components/ui/sonner'

import { PrintLabelsDialog, SampleLabelSheet } from './sample-label-sheet'
import {
  LABEL_SHEET_LIMIT,
  batchLabelKind,
  recordBatchPrints,
} from './label-sheet-data'
import type { BatchLabelRecord } from './label-sheet-data'

const queryClients: QueryClient[] = []

afterEach(() => {
  toast.dismiss()
  cleanup()
  queryClients.forEach((client) => client.clear())
  queryClients.length = 0
  vi.restoreAllMocks()
})

function labelClient() {
  const http = vi.fn<typeof fetch>(async (_input, init) =>
    Response.json(init?.method === 'POST' ? {} : []),
  )

  return { http, client: createDataClient(http) }
}

// The print dialog reads the workspace's label templates.
function render(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  queryClients.push(client)

  return rtlRender(
    <QueryClientProvider client={client}>
      {ui}
      <Toaster />
    </QueryClientProvider>,
  )
}

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
  it('classifies mixed kinds and records only samples, including legacy records without a kind', async () => {
    const { client, http } = labelClient()

    const records = [
      record(1),
      { ...record(2), kind: 'material' },
      { ...record(3), kind: 'sample' },
    ]

    expect(batchLabelKind(records)).toBe('record')
    expect(batchLabelKind([])).toBe('record')
    expect(batchLabelKind([record(1)])).toBe('sample')
    expect(batchLabelKind([{ ...record(2), kind: 'material' }])).toBe(
      'material',
    )
    expect(await recordBatchPrints(client, records)).toEqual({
      recorded: 2,
      failed: [],
    })
    expect(http).toHaveBeenCalledTimes(2)
    expect(
      http.mock.calls.some(
        ([, init]) =>
          init?.body ===
          JSON.stringify({
            p_record_id: 's-2',
            p_expected_metadata_version: 2,
            p_note: 'Printed label SMP-2',
          }),
      ),
    ).toBe(false)
  })

  it('records every print and reports the ones that were refused', async () => {
    const http = vi.fn<typeof fetch>(async (_input, init) => {
      const args = z
        .object({ p_record_id: z.string() })
        .parse(await new Response(init?.body).json())

      if (args.p_record_id === 's-2')
        return Response.json(
          { code: 'SB001', message: 'stale' },
          { status: 409 },
        )

      return Response.json({
        id: 'ev',
        operation: 'print',
        notes: null,
        created_at: '',
      })
    })

    const outcome = await recordBatchPrints(createDataClient(http), [
      record(1),
      record(2),
      record(3),
    ])

    expect(http).toHaveBeenCalledTimes(3)
    expect(http.mock.calls[0][0]).toBe('/api/db/rpc/record_sample_label_print')
    expect(await new Response(http.mock.calls[0][1]?.body).json()).toEqual({
      p_record_id: 's-1',
      p_expected_metadata_version: 1,
      p_note: 'Printed label SMP-1',
    })
    expect(outcome.recorded).toBe(2)
    expect(outcome.failed.map((f) => f.identifier)).toEqual(['SMP-2'])
  })
})

describe('PrintLabelsDialog', () => {
  it('settles every recording before the callback, failure notice, browser print and close', async () => {
    let settle: ((response: Response) => void) | undefined

    const pending = new Promise<Response>((resolve) => {
      settle = resolve
    })

    const order: string[] = []

    const http = vi.fn<typeof fetch>(async (_url, init) => {
      if (init?.method !== 'POST') return Response.json([])

      const args = z
        .object({ p_record_id: z.string() })
        .parse(await new Response(init.body).json())

      return args.p_record_id === 's-2' ? pending : Response.json({})
    })

    const onPrinted = vi.fn(() => {
      order.push('callback')
    })

    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      order.push('print')
    })

    const onOpenChange = vi.fn(() => {
      order.push('close')
    })

    render(
      <PrintLabelsDialog
        open
        records={[record(1), record(2)]}
        scope="the samples"
        client={createDataClient(http)}
        onPrinted={onPrinted}
        onOpenChange={onOpenChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Print 2 labels' }))
    await vi.waitFor(() =>
      expect(
        http.mock.calls.filter(([, init]) => init?.method === 'POST'),
      ).toHaveLength(2),
    )
    expect(print).not.toHaveBeenCalled()
    expect(onPrinted).not.toHaveBeenCalled()
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Preparing…' })
        .disabled,
    ).toBe(true)
    settle?.(
      Response.json(
        { code: '42501', message: 'workspace writer required' },
        { status: 403 },
      ),
    )
    expect(
      await screen.findByText('1 of 2 prints couldn’t be recorded.'),
    ).toBeTruthy()
    expect(
      document.querySelector('[data-sonner-toast][data-type="error"]')
        ?.textContent,
    ).toContain('SMP-2')
    expect(order).toEqual(['callback', 'print', 'close'])
  })

  it('prints the sheet after recording, and says how many labels', async () => {
    const { http, client } = labelClient()
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    const onOpenChange = vi.fn()
    render(
      <PrintLabelsDialog
        open
        onOpenChange={onOpenChange}
        records={[record(1), record(2)]}
        scope="the 2 samples shown"
        client={client}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Print 2 labels' }))
    await vi.waitFor(() => expect(print).toHaveBeenCalledTimes(1))
    expect(
      http.mock.calls.filter(
        ([url]) => url === '/api/db/rpc/record_sample_label_print',
      ),
    ).toHaveLength(2)
    expect(await screen.findByText('2 labels sent to print')).toBeTruthy()
    expect(onOpenChange).toHaveBeenCalledWith(false)
    print.mockRestore()
  })

  it('caps the sheet and says so', () => {
    const { client } = labelClient()

    const many = Array.from({ length: LABEL_SHEET_LIMIT + 4 }, (_, i) =>
      record(i),
    )

    render(
      <PrintLabelsDialog
        open
        onOpenChange={() => {}}
        records={many}
        scope="the samples shown"
        client={client}
      />,
    )
    expect(
      screen.getByRole('button', { name: `Print ${LABEL_SHEET_LIMIT} labels` }),
    ).toBeTruthy()
    expect(screen.getByText(/only the first 96 are included/)).toBeTruthy()
  })

  it('offers no print when there is nothing to label', () => {
    const { client } = labelClient()
    render(
      <PrintLabelsDialog
        open
        onOpenChange={() => {}}
        records={[]}
        scope="no samples"
        client={client}
      />,
    )
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Print 0 labels' })
        .disabled,
    ).toBe(true)
  })
})
