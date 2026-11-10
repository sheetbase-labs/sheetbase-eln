import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDataClient } from '#/lib/data-client'
import { Toaster, toast } from '#/components/ui/sonner'
import type { SampleLabelPrintEvent } from '#/lib/samples'

import { PrintLabelButton, SampleLabelPrint } from './sample-label-print'

/**
 * LAB-05.2 — browser print of a sample label.
 *
 * The print document is asserted field by field, and the print itself is
 * asserted on the call the action makes to the sample's event path
 * (`record_sample_label_print`, the sample-event RPC) rather than on a
 * fabricated event row.
 */

const HOST = 'app.sheetbase.test'

const LABEL_RECORD = {
  identifier: 'SMP-2231',
  title: 'Harvest lot HL-0934',
  sampleType: 'Cell harvest',
  createdAt: '2026-09-20T00:00:00.000Z',
  customFields: { batch: 'HL-0934' },
  properties: { holdCondition: '2–8 °C', holdUntil: '2026-10-04' },
}

const SAMPLE = { id: 's-1', identifier: 'SMP-2231', metadataVersion: 7 }

/** The sample_events row the print RPC appends. */
const PRINT_EVENT = {
  id: 'event-1',
  operation: 'print',
  notes: 'Printed label SMP-2231',
  created_at: '2026-10-10T00:00:00.000Z',
} satisfies SampleLabelPrintEvent

const queryClients: QueryClient[] = []

afterEach(() => {
  toast.dismiss()
  cleanup()
  queryClients.forEach((client) => client.clear())
  queryClients.length = 0
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

function renderWithQuery(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  queryClients.push(client)

  return render(
    <QueryClientProvider client={client}>
      {ui}
      <Toaster />
    </QueryClientProvider>,
  )
}

describe('SampleLabelPrint', () => {
  it('uses the chosen dimensions for both the printed card and the page', () => {
    const { container } = render(
      <SampleLabelPrint
        record={LABEL_RECORD}
        host={HOST}
        template={{ widthMm: 30, heightMm: 15 }}
      />,
    )

    expect(screen.getByRole('group').getAttribute('style')).toContain(
      'width: 30mm; height: 15mm',
    )
    expect(container.querySelector('style')?.textContent).toContain(
      'size: 30mm 15mm;',
    )
    expect(container.querySelector('style')?.textContent).toContain(
      'margin: 0;',
    )
  })

  it('renders the print document as the label template: code, identifier, lot and storage line', () => {
    render(<SampleLabelPrint record={LABEL_RECORD} host={HOST} />)

    const document_ = document.querySelector('[data-slot="sample-label-print"]')
    expect(document_).toBeTruthy()
    expect(
      screen.getByRole('img', {
        name: `Label code resolving to https://${HOST}/r/SMP-2231`,
      }),
    ).toBeTruthy()
    expect(screen.getByText('SMP-2231')).toBeTruthy()
    expect(screen.getByText('HL-0934')).toBeTruthy()
    expect(screen.getByText('2–8 °C · use by 04-Oct')).toBeTruthy()
    expect(
      screen.getByRole('group', { name: 'Printable label for SMP-2231' }),
    ).toBeTruthy()
  })

  it('prints the label document alone', () => {
    const { container } = render(
      <SampleLabelPrint record={LABEL_RECORD} host={HOST} />,
    )

    const css = container.querySelector('style')?.textContent ?? ''
    expect(css).toContain('@media print')
    expect(css).toContain('@page')
    expect(css).toContain('[data-slot="sample-label-print"]')
    expect(css).toContain('visibility: hidden')
  })
})

describe('PrintLabelButton', () => {
  it('opens print while recording is pending, then calls back only after success', async () => {
    let settle: ((response: Response) => void) | undefined

    const pending = new Promise<Response>((resolve) => {
      settle = resolve
    })

    const http = vi.fn<typeof fetch>(() => pending)
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    const onPrinted = vi.fn()
    renderWithQuery(
      <PrintLabelButton
        record={SAMPLE}
        client={createDataClient(http)}
        onPrinted={onPrinted}
      />,
    )
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Print label' }))
    expect(print).toHaveBeenCalledTimes(1)
    expect(onPrinted).not.toHaveBeenCalled()
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Print label' })
        .disabled,
    ).toBe(true)
    expect(screen.queryByText('Label sent to print')).toBeNull()
    settle?.(
      Response.json({
        id: 'event-1',
        operation: 'print',
        notes: 'Printed label SMP-2231',
        created_at: '2026-10-10T00:00:00Z',
      }),
    )
    expect(await screen.findByText('Label sent to print')).toBeTruthy()
    expect(onPrinted).toHaveBeenCalledTimes(1)
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Print label' })
        .disabled,
    ).toBe(false)
  })

  it('opens the browser print for the label document and records the print through the sample event path', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    const http = vi.fn<typeof fetch>(async () => Response.json(PRINT_EVENT))
    const client = createDataClient(http)

    const onPrinted = vi.fn()
    const user = userEvent.setup()

    renderWithQuery(
      <>
        <SampleLabelPrint record={LABEL_RECORD} host={HOST} />
        <PrintLabelButton
          record={SAMPLE}
          client={client}
          onPrinted={onPrinted}
        />
      </>,
    )

    await user.click(screen.getByRole('button', { name: 'Print label' }))

    // The browser prints the document, which carries the label's fields.
    expect(print).toHaveBeenCalledTimes(1)
    expect(screen.getByText('SMP-2231')).toBeTruthy()
    expect(screen.getByText('2–8 °C · use by 04-Oct')).toBeTruthy()

    // The print is recorded on the sample through the existing sample-event
    // RPC, with the print note — not a direct insert into the event table.
    await waitFor(() => expect(http).toHaveBeenCalledTimes(1))
    expect(http.mock.calls[0][0]).toBe('/api/db/rpc/record_sample_label_print')
    expect(http.mock.calls[0][1]?.method).toBe('POST')
    expect(
      await new Response(http.mock.calls[0][1]?.body).json(),
    ).toMatchObject({
      p_record_id: 's-1',
      p_expected_metadata_version: 7,
      p_note: 'Printed label SMP-2231',
    })
    await waitFor(() => expect(onPrinted).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Label sent to print')).toBeTruthy()
  })

  it('surfaces a refused print instead of an unhandled error', async () => {
    vi.spyOn(window, 'print').mockImplementation(() => {})

    const http = vi.fn<typeof fetch>(async () =>
      Response.json(
        { code: 'not_found', message: 'record not found' },
        { status: 404 },
      ),
    )

    const client = createDataClient(http)

    const user = userEvent.setup()

    const onPrinted = vi.fn()
    renderWithQuery(
      <PrintLabelButton
        record={SAMPLE}
        client={client}
        onPrinted={onPrinted}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Print label' }))

    expect(await screen.findByText('record not found')).toBeTruthy()
    expect(
      document.querySelector('[data-sonner-toast][data-type="error"]'),
    ).toBeTruthy()
    expect(onPrinted).not.toHaveBeenCalled()
  })
})
