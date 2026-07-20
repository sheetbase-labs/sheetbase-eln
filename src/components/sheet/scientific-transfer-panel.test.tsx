import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ScientificTransferPanel } from './scientific-transfer-panel'
import type * as ScientificSheetData from '#/lib/scientific-sheet-data'

const mocks = vi.hoisted(() => ({ importRows: vi.fn(), recordExport: vi.fn() }))
vi.mock('#/lib/scientific-sheet-data', async (load) => ({
  ...(await load<typeof ScientificSheetData>()),
  scientificDataClient: {},
  importScientificRows: mocks.importRows,
  recordScientificExport: mocks.recordExport,
}))

const table = {
  id: '10000000-0000-4000-8000-000000000001',
  resource_name: 'sheet_aaaaaaaaaaaaaaaaaaaaaaaaaa',
  name: 'Measurements',
  schema_version: 2,
  lifecycle: 'active',
  columns: [
    {
      id: '10000000-0000-4000-8000-000000000002',
      field_name: 'col_result',
      label: 'Result',
      display_order: 1,
      logical_type: 'decimal',
      nullable: true,
      unit: { code: 'mg/L', symbol: 'mg/L' },
      validation: { min: 0 },
      width: null,
      options: [],
    },
  ],
} as const

beforeEach(() => {
  mocks.importRows.mockResolvedValue({ importedRows: 2, skippedDuplicates: 0 })
  mocks.recordExport.mockResolvedValue({})
  vi.stubGlobal('crypto', {
    subtle: { digest: vi.fn().mockResolvedValue(new Uint8Array(32).buffer) },
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('ScientificTransferPanel', () => {
  it('previews, maps, validates and submits a complete atomic import', async () => {
    const onImported = vi.fn().mockResolvedValue(undefined)
    render(
      <ScientificTransferPanel
        table={table as never}
        rows={[]}
        readOnly={false}
        onImported={onImported}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Import CSV' }))
    const bytes = new TextEncoder().encode(
      'Result,Note\n1.5,first\n2.5,second',
    ).buffer
    const file = {
      name: 'results.csv',
      size: bytes.byteLength,
      arrayBuffer: vi.fn().mockResolvedValue(bytes),
    }
    fireEvent.change(screen.getByLabelText('CSV file'), {
      target: { files: [file] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Preview CSV' }))
    await screen.findByText(/Previewed 2 rows and 2 columns/)
    expect(screen.getByLabelText<HTMLSelectElement>('Map Result').value).toBe(
      `existing:${table.columns[0].id}`,
    )
    expect(screen.getByLabelText<HTMLSelectElement>('Map Note').value).toBe(
      'new:text',
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Import all rows atomically' }),
    )
    await waitFor(() => expect(mocks.importRows).toHaveBeenCalledTimes(1))
    expect(mocks.importRows.mock.calls[0][1]).toMatchObject({
      tableId: table.id,
      schemaVersion: 2,
      duplicateStrategy: 'reject_file',
      rows: [
        { Result: 1.5, Note: 'first' },
        { Result: 2.5, Note: 'second' },
      ],
    })
    expect(onImported).toHaveBeenCalled()
  })

  it('reports all invalid rows and requires an explicit duplicate choice', async () => {
    render(
      <ScientificTransferPanel
        table={table as never}
        rows={[]}
        readOnly={false}
        onImported={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Import CSV' }))
    const bytes = new TextEncoder().encode('Result\nbad\nbad').buffer
    fireEvent.change(screen.getByLabelText('CSV file'), {
      target: {
        files: [
          {
            name: 'bad.csv',
            size: bytes.byteLength,
            arrayBuffer: vi.fn().mockResolvedValue(bytes),
          },
        ],
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Preview CSV' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Row 1')
    expect(screen.getByRole('alert').textContent).toContain('Row 2')
    expect(screen.getByText('1 duplicate rows detected.')).toBeTruthy()
    expect(
      screen
        .getByRole('button', { name: 'Import all rows atomically' })
        .hasAttribute('disabled'),
    ).toBe(true)
  })
})
