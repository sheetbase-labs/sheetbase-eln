import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DataClientError } from '#/lib/data-client'
import { ScientificSheetBlock } from './scientific-sheet-block'

const mocks = vi.hoisted(() => ({
  table: vi.fn(),
  rows: vi.fn(),
  apply: vi.fn(),
  settings: null as Record<string, any> | null,
}))
vi.mock('#/lib/scientific-sheet-data', async (load) => ({
  ...(await load<typeof import('#/lib/scientific-sheet-data')>()),
  scientificDataClient: {},
  fetchScientificTable: mocks.table,
  fetchScientificRows: mocks.rows,
  applyScientificRowChanges: mocks.apply,
}))
vi.mock('./sheetbase-grid', () => ({
  SheetbaseGrid: ({ settings }: { settings: Record<string, any> }) => {
    mocks.settings = settings
    return <div data-testid="grid" />
  },
}))

const columns = [
  {
    id: 'text',
    field_name: 'col_text',
    label: 'Name',
    display_order: 1,
    logical_type: 'text',
    nullable: true,
    unit: null,
    validation: {},
    width: null,
    options: [],
  },
  {
    id: 'number',
    field_name: 'col_number',
    label: 'Mass',
    display_order: 2,
    logical_type: 'decimal',
    nullable: true,
    unit: { symbol: 'mg' },
    validation: {},
    width: null,
    options: [],
  },
  {
    id: 'category',
    field_name: 'col_category',
    label: 'State',
    display_order: 3,
    logical_type: 'category',
    nullable: true,
    unit: null,
    validation: {},
    width: null,
    options: [{ id: 'option-id', label: 'Ready', display_order: 1 }],
  },
] as any
const table = {
  id: 'table-1',
  resource_name: `sheet_${'a'.repeat(26)}`,
  name: 'Results',
  schema_version: 2,
  lifecycle: 'active',
  columns,
}
const block = {
  id: 'block-1',
  recordId: 'record-1',
  type: 'sheet',
  payload: { tableId: 'table-1' },
  payloadSchemaVersion: 1,
  order: 1,
  version: 1,
} as any

function mount(props: { readOnly?: boolean; block?: any } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ScientificSheetBlock
        block={props.block ?? block}
        readOnly={props.readOnly}
      />
    </QueryClientProvider>,
  )
}
async function ready() {
  await screen.findByTestId('grid')
  return mocks.settings!
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.settings = null
})

describe('ScientificSheetBlock', () => {
  it('renders loading, load failures, and a missing table id', async () => {
    mocks.table.mockReturnValue(new Promise(() => {}))
    mount()
    expect(screen.getByRole('status').textContent).toContain(
      'Loading scientific sheet',
    )
    cleanup()
    mocks.table.mockRejectedValue(new Error('metadata'))
    mount()
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Could not load',
    )
    cleanup()
    mount({ block: { ...block, payload: {} } })
    expect(screen.getByRole('alert').textContent).toContain(
      'Invalid sheet block',
    )
  })

  it('maps column types, units, and category UUIDs to grid labels', async () => {
    mocks.table.mockResolvedValue(table)
    mocks.rows.mockResolvedValue([
      { id: 'r1', version: 1, col_category: 'option-id' },
    ])
    mount()
    const settings = await ready()
    expect(settings.columns.map((x: any) => x.type)).toEqual([
      'text',
      'numeric',
      'dropdown',
    ])
    expect(settings.colHeaders).toEqual(['Name', 'Mass (mg)', 'State'])
    expect(settings.data[0].col_category).toBe('Ready')
  })

  it('submits one batch for multiple existing cells and mixed spare rows', async () => {
    mocks.table.mockResolvedValue(table)
    mocks.rows.mockResolvedValue([{ id: 'r1', version: 4, col_text: 'old' }])
    mocks.apply.mockResolvedValue({ ok: true, schemaVersion: 2, rows: [] })
    mount()
    const settings = await ready()
    settings.afterChange(
      [
        [0, 'col_text', 'old', 'new'],
        [0, 'col_number', null, '2.5'],
        [1, 'col_text', null, 'insert'],
      ],
      'CopyPaste.paste',
    )
    await waitFor(() => expect(mocks.apply).toHaveBeenCalledTimes(1))
    expect(mocks.apply.mock.calls[0].slice(3)).toEqual([
      [
        {
          rowId: 'r1',
          expectedVersion: 4,
          values: { text: 'new', number: 2.5 },
        },
      ],
      [{ text: 'insert' }],
    ])
  })

  it('rejects an entire invalid batch locally and preserves its draft', async () => {
    mocks.table.mockResolvedValue(table)
    mocks.rows.mockResolvedValue([{ id: 'r1', version: 1 }])
    mount()
    const settings = await ready()
    settings.afterChange(
      [
        [0, 'col_number', null, 'not-number'],
        [0, 'col_text', null, 'draft'],
      ],
      'edit',
    )
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Mass must be a finite number.',
    )
    expect(mocks.apply).not.toHaveBeenCalled()
    expect(mocks.settings!.data[0].col_number).toBe('not-number')
  })

  it('preserves stale drafts, identifies the row, and refetches', async () => {
    mocks.table.mockResolvedValue(table)
    mocks.rows.mockResolvedValue([{ id: 'r1', version: 1 }])
    mocks.apply.mockRejectedValue(
      new DataClientError('stale_version', 'stale', 409),
    )
    mount()
    const settings = await ready()
    settings.afterChange([[0, 'col_text', null, 'raw']], 'edit')
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Row 1 changed elsewhere',
    )
    expect(mocks.settings!.data[0].col_text).toBe('raw')
    await waitFor(() => expect(mocks.rows.mock.calls.length).toBeGreaterThan(1))
  })

  it('serializes rapid edits and uses the first canonical version for the second', async () => {
    mocks.table.mockResolvedValue(table)
    mocks.rows.mockResolvedValue([{ id: 'r1', version: 1 }])
    let release!: () => void
    mocks.apply
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () =>
              resolve({
                ok: true,
                schemaVersion: 2,
                rows: [{ id: 'r1', version: 2, col_text: 'first' }],
              })
          }),
      )
      .mockResolvedValueOnce({
        ok: true,
        schemaVersion: 2,
        rows: [{ id: 'r1', version: 3 }],
      })
    mount()
    const settings = await ready()
    settings.afterChange([[0, 'col_text', null, 'first']], 'edit')
    settings.afterChange([[0, 'col_number', null, '2']], 'edit')
    await waitFor(() => expect(mocks.apply).toHaveBeenCalledTimes(1))
    release()
    await waitFor(() => expect(mocks.apply).toHaveBeenCalledTimes(2))
    expect(mocks.apply.mock.calls[1][3][0].expectedVersion).toBe(2)
  })

  it('fully disables mutation affordances in read-only mode', async () => {
    mocks.table.mockResolvedValue(table)
    mocks.rows.mockResolvedValue([])
    mount({ readOnly: true })
    const settings = await ready()
    expect(settings).toMatchObject({
      readOnly: true,
      minSpareRows: 0,
      fillHandle: false,
      contextMenu: false,
    })
    settings.afterChange([[0, 'col_text', null, 'x']], 'edit')
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it('pages and only provides a spare row on the terminal page', async () => {
    mocks.table.mockResolvedValue(table)
    mocks.rows.mockImplementation((_c: any, _t: any, page: number) =>
      Promise.resolve(
        page === 0
          ? Array.from({ length: 200 }, (_, i) => ({ id: `r${i}`, version: 1 }))
          : [],
      ),
    )
    mount()
    expect((await ready()).minSpareRows).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() =>
      expect(mocks.rows).toHaveBeenLastCalledWith({}, table, 1),
    )
    await waitFor(() => expect(mocks.settings!.minSpareRows).toBe(1))
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    await waitFor(() => expect(screen.getByText('Page 1')).toBeTruthy())
  })
})
