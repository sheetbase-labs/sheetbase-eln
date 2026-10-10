import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DataClient } from '#/lib/data-client'

import { PrintLabelButton, SampleLabelPrint } from './sample-label-print'

/**
 * LAB-05.2 — browser print of a sample label.
 *
 * The print document is asserted field by field, and the print itself is
 * asserted on the call the action makes to the sample's event path
 * (`record_sample_label_print`, the sample-event RPC) rather than on a
 * fabricated event row.
 */

const sonner = vi.hoisted(() => ({ toast: vi.fn(), error: vi.fn() }))
vi.mock('#/components/v3/ui/sonner', () => ({
  toast: Object.assign(sonner.toast, { error: sonner.error }),
  Toaster: () => null,
}))

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
const EDITED_ROW = {
  id: 's-1',
  workspace_id: 'ws-1',
  project_id: null,
  folder_id: null,
  kind: 'sample',
  identifier: 'SMP-2231',
  title: 'Harvest lot HL-0934',
  status: 'available',
  tags: [],
  structure_version: 1,
  metadata_version: 8,
  created_at: '2026-09-20T00:00:00.000Z',
  updated_at: '2026-10-10T00:00:00.000Z',
  archived_at: null,
  deleted_at: null,
  created_by_user_id: 'user-1',
  updated_by_user_id: 'user-1',
  properties: {},
  custom_fields: {},
  locked_at: null,
  locked_by_revision_id: null,
  source_notebook_template_version_id: null,
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

function renderWithQuery(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe('SampleLabelPrint', () => {
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
  it('opens the browser print for the label document and records the print through the sample event path', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    const calls: Array<{ name: string; args: Record<string, unknown> }> = []
    const client = {
      rpc: (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args })
        return Promise.resolve(EDITED_ROW)
      },
    } as unknown as DataClient
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
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].name).toBe('record_sample_label_print')
    expect(calls[0].args).toMatchObject({
      p_record_id: 's-1',
      p_expected_metadata_version: 7,
      p_note: 'Printed label SMP-2231',
    })
    await waitFor(() => expect(onPrinted).toHaveBeenCalledTimes(1))
    expect(sonner.toast).toHaveBeenCalledWith('Label sent to print')
  })

  it('surfaces a refused print instead of an unhandled error', async () => {
    vi.spyOn(window, 'print').mockImplementation(() => {})
    const client = {
      rpc: () => Promise.reject(new Error('record not found')),
    } as unknown as DataClient
    const user = userEvent.setup()

    renderWithQuery(<PrintLabelButton record={SAMPLE} client={client} />)
    await user.click(screen.getByRole('button', { name: 'Print label' }))

    await waitFor(() => expect(sonner.error).toHaveBeenCalledTimes(1))
  })
})
