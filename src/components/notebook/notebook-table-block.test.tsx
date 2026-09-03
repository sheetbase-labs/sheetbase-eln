import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NotebookTableBlock, tableIdFromPayload } from './notebook-table-block'
import type { NotebookBlock } from '#/lib/notebook-data'

const TABLE_ID = vi.hoisted(() => '41000000-0000-4000-8000-000000000001')

vi.mock('#/lib/scientific-sheet-data', async () => ({
  scientificDataClient: {} as object,
  fetchScientificTable: vi.fn().mockResolvedValue({
    id: TABLE_ID,
    resource_name: 'sheet_test',
    schema_version: 1,
    name: 'Virus Stability Assay',
    columns: [
      {
        field_name: 'col_a',
        label: 'Sample',
        logical_type: 'text',
        nullable: false,
        options: [],
      },
      {
        field_name: 'col_b',
        label: 'Recovery (%)',
        logical_type: 'decimal',
        nullable: true,
        options: [],
        unit: { symbol: 'IU/mL' },
        format: '0.0',
      },
    ],
  }),
}))

const gridProps = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }))

vi.mock('sheetbase-table/dev', async () => {
  const actual = await vi.importActual<typeof import('sheetbase-table/dev')>(
    'sheetbase-table/dev',
  )
  return {
    ...actual,
    PagedSpreadsheet: (props: Record<string, unknown>) => {
      gridProps.current = props
      return <div data-testid="engine-grid" />
    },
    TableSurface: ({
      table,
      objects,
    }: {
      table: ReactNode
      objects?: Array<{ id: string; placement: string; content: ReactNode }>
    }) => (
      <div data-testid="table-surface">
        {table}
        {(objects ?? []).map((object) => (
          <div key={object.id} data-placement={object.placement}>
            {object.content}
          </div>
        ))}
      </div>
    ),
    TableControls: () => <div data-testid="table-controls" />,
  }
})

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))

afterEach(() => {
  cleanup()
  gridProps.current = null
})

function block(payload: Record<string, unknown>): NotebookBlock {
  return {
    id: 'block-1',
    type: 'table',
    payload,
    payloadSchemaVersion: 1,
  } as unknown as NotebookBlock
}

function renderBlock(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe('NotebookTableBlock', () => {
  it('reads the embedded table id from the payload', () => {
    expect(tableIdFromPayload(block({ tableId: TABLE_ID }))).toBe(TABLE_ID)
    expect(tableIdFromPayload(block({ tableId: 5 }))).toBe('')
    expect(tableIdFromPayload(block({}))).toBe('')
  })

  it('collects the table id through the form before any engine mount', async () => {
    const user = userEvent.setup()
    const onSavePayload = vi.fn().mockResolvedValue(undefined)
    renderBlock(
      <NotebookTableBlock
        block={block({})}
        onSavePayload={onSavePayload}
      />,
    )
    expect(screen.queryByTestId('engine-grid')).toBeNull()
    await user.type(
      screen.getByLabelText('Scientific table ID'),
      '41000000-0000-4000-8000-000000000001',
    )
    await user.click(screen.getByRole('button', { name: 'Embed table' }))
    expect(onSavePayload).toHaveBeenCalledWith({
      tableId: '41000000-0000-4000-8000-000000000001',
    })
  })

  it('renders the engine grid under host authority with the controls inspector', async () => {
    renderBlock(
      <NotebookTableBlock
        block={block({ tableId: TABLE_ID })}
        onSavePayload={vi.fn()}
      />,
    )
    await vi.waitFor(() => expect(gridProps.current).not.toBeNull())
    const props = gridProps.current as {
      datasetId: string
      calculationAuthority: string
      datasetHeader?: {
        fields: Array<{
          id: string
          label: string
          writable?: boolean
          unit?: string
          precision?: number
          numberFormat?: 'general' | 'number' | 'currency' | 'percent' | 'date'
        }>
      }
      query?: unknown
      onQueryChange?: unknown
    }
    expect(props.datasetId).toBe(TABLE_ID)
    expect(props.calculationAuthority).toBe('host')
    expect(
      props.datasetHeader?.fields.map((field) => ({
        id: field.id,
        label: field.label,
        unit: field.unit,
        precision: field.precision,
        numberFormat: field.numberFormat,
      })),
    ).toEqual([
      { id: 'col_a', label: 'Sample', unit: undefined, precision: undefined, numberFormat: undefined },
      { id: 'col_b', label: 'Recovery (%)', unit: 'IU/mL', precision: 1, numberFormat: 'number' },
    ])
    // The typed filter controls ride the bottom inspector surface object.
    expect(screen.getByTestId('table-controls')).toBeTruthy()
  })

  it('locks editing in read-only notebooks', async () => {
    renderBlock(
      <NotebookTableBlock
        block={block({ tableId: TABLE_ID })}
        readOnly
        onSavePayload={vi.fn()}
      />,
    )
    await vi.waitFor(() => expect(gridProps.current).not.toBeNull())
    expect(
      screen.getByRole('status').textContent,
    ).toContain('read-only')
    const fields = (gridProps.current as {
      datasetHeader?: { fields: Array<{ writable?: boolean }> }
    }).datasetHeader?.fields
    expect(fields?.every((field) => field.writable === false)).toBe(true)
  })
})
