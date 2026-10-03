import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { mutateSheetLocalState } from '#/lib/sheet-local-data'
import { searchSheetRecords } from '#/lib/sheet-record-search'
import type { SheetRecordSearchHit } from '#/lib/sheet-record-search'
import { validSheetInstanceState } from '#/lib/sheet-instance.test'
import type { SheetInstance } from '#/lib/sheet-instance-data'

import { AdHocSheetWorkspace } from './ad-hoc-sheet-workspace'
import type { SheetbaseGridCellChange } from './sheetbase-grid'
import { recordCellDisplayText } from './canonical-sheet-workspace'

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Element.prototype.scrollIntoView = () => {}

const gridRender = vi.hoisted(() => vi.fn())
const setDataAtCell = vi.hoisted(() => vi.fn())

vi.mock('#/lib/sheet-local-data', async (importOriginal) => ({
  ...(await importOriginal()),
  mutateSheetLocalState: vi.fn(),
}))

vi.mock('#/lib/sheet-record-search', async (importOriginal) => ({
  ...(await importOriginal()),
  searchSheetRecords: vi.fn(),
}))

vi.mock('./sheetbase-grid', () => {
  const Recorder = ({
    columns,
    onOpenRecordPicker,
    beforeCellsChange,
    onCellsChange,
    onReady,
  }: GridPropsCapture) => {
    gridRender({
      columns,
      onOpenRecordPicker,
      beforeCellsChange,
      onCellsChange,
    })
    // Stand-in neutral handle: the transitional vendor instance carries the
    // Handsontable write-back the workspace still supports.
    onReady?.({ vendor: { setDataAtCell } })
    return (
      <table>
        <thead>
          <tr>
            {(columns ?? []).map((column) => (
              <th key={column.id} scope="col">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
      </table>
    )
  }
  return { SheetbaseGrid: Recorder, SheetbaseTableGrid: Recorder }
})

interface GridPropsCapture {
  columns?: Array<{
    id: string
    label: string
    type: string
    readOnly?: boolean
    displayText?: (value: unknown) => string | undefined
  }>
  onOpenRecordPicker?: (
    cell: {
      rowIndex: number
      columnIndex: number
      columnId: string
    },
    editor?: { commit: (value: unknown) => void; cancel: () => void },
  ) => void
  beforeCellsChange?: (
    changes: SheetbaseGridCellChange[],
    source: string,
  ) => boolean | undefined
  onCellsChange?: (changes: SheetbaseGridCellChange[], source: string) => void
  onReady?: (instance: unknown) => void
}

const refFieldId = '15000000-0000-4000-8000-000000000001'
const textFieldId = '15000000-0000-4000-8000-000000000002'
const rowId = '10000000-0000-4000-8000-000000000005'
const recordUuid = '50000000-0000-4000-8000-000000000001'
const hit: SheetRecordSearchHit = {
  id: recordUuid,
  kind: 'sample',
  identifier: 'SMP-2026-0001',
  title: 'LV harvest',
  status: 'available',
  archived: false,
}

/** Instance with a local Model-scoped reference field (record-picker). */
function refInstance(): SheetInstance {
  const base = {
    id: '20000000-0000-4000-8000-000000000001',
    workspaceId: '20000000-0000-4000-8000-000000000002',
    projectId: '20000000-0000-4000-8000-000000000003',
    notebookRecordId: '20000000-0000-4000-8000-000000000004',
    sourceDefinitionVersionId: null,
    name: 'Notebook sheet',
    description: null,
    lifecycle: 'active' as const,
    revision: 1,
    state: validSheetInstanceState(),
    duplicatedFromInstanceId: null,
    createdAt: '2026-08-16T12:00:00.000Z',
    updatedAt: '2026-08-16T12:00:00.000Z',
    createdByUserId: 'u1',
    updatedByUserId: 'u1',
  }
  const observation = base.state.localFields[0]
  return {
    ...base,
    state: {
      ...base.state,
      localFields: [
        {
          ...observation,
          fieldId: refFieldId,
          key: 'sample_ref',
          label: 'Sample',
          logicalType: 'reference' as const,
          relationship: {
            target: { kind: 'model' as const, modelKey: 'sample' },
            cardinality: 'one' as const,
          },
        },
        observation,
      ],
      localValues: {
        [rowId]: { [refFieldId]: null, [textFieldId]: 'note' },
      },
    },
  }
}

function renderWorkspace(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function captureProps(): GridPropsCapture {
  return gridRender.mock.lastCall?.[0] as GridPropsCapture
}

/** Simulate the grid opening the Record picker for a cell edit. */
function openPicker(props: GridPropsCapture, columnIndex: number) {
  const column = props.columns?.[columnIndex]
  expect(column).toBeTruthy()
  act(() => {
    props.onOpenRecordPicker?.({
      rowIndex: 0,
      columnIndex,
      columnId: column!.id,
    })
  })
}

beforeEach(() => {
  vi.mocked(searchSheetRecords).mockReset()
  vi.mocked(mutateSheetLocalState).mockReset()
  gridRender.mockClear()
  setDataAtCell.mockClear()
})

afterEach(cleanup)

describe('GRID-03 canonical Record picker editor', () => {
  it('wires the Record picker editor and display renderer for record-picker columns', () => {
    renderWorkspace(<AdHocSheetWorkspace instance={refInstance()} />)
    const props = captureProps()
    expect(props.columns?.map((column) => column.label)).toEqual([
      'Sample',
      'Observation',
    ])
    expect(props.columns?.[0]).toEqual(
      expect.objectContaining({
        type: 'record',
        displayText: expect.any(Function),
        readOnly: false,
      }),
    )
    // Non-reference columns keep their plain text display.
    expect(props.columns?.[1]?.type).toBe('text')
    expect(props.onOpenRecordPicker).toEqual(expect.any(Function))
  })

  it('opens the shared model-scoped picker from the cell edit and writes the canonical UUID', async () => {
    const user = userEvent.setup()
    vi.mocked(searchSheetRecords).mockResolvedValue([hit])
    vi.mocked(mutateSheetLocalState).mockResolvedValue(refInstance())
    renderWorkspace(<AdHocSheetWorkspace instance={refInstance()} />)
    const props = captureProps()

    openPicker(props, 0)

    // The picker opens for the field's own relationship target, not a sheet
    // default, and the search is the bounded server-backed RPC.
    expect(await screen.findByRole('combobox')).toBeTruthy()
    expect(searchSheetRecords).toHaveBeenCalledWith(
      { modelKey: 'sample', query: '' },
      expect.anything(),
    )
    const combobox = screen.getByRole('combobox')
    act(() => {
      combobox.focus()
    })
    await user.keyboard('{Enter}')

    // Selection persists the canonical Record UUID through the grid pipeline.
    expect(setDataAtCell).toHaveBeenCalledWith(
      0,
      0,
      recordUuid,
      'sheetbase.record-picker',
    )
    expect(setDataAtCell).toHaveBeenCalledTimes(1)
  })

  it('writes the picked Record through the backend editor handle when one is supplied', async () => {
    const user = userEvent.setup()
    vi.mocked(searchSheetRecords).mockResolvedValue([hit])
    vi.mocked(mutateSheetLocalState).mockResolvedValue(refInstance())
    renderWorkspace(<AdHocSheetWorkspace instance={refInstance()} />)
    const props = captureProps()
    const commit = vi.fn()
    const cancel = vi.fn()
    const column = props.columns?.[0]

    // COMP-06 steps 2-3: the table backend owns the cell editor and hands the
    // workspace its commit/cancel, so the pick flows through the grid gate
    // instead of the vendor instance.
    act(() => {
      props.onOpenRecordPicker?.(
        { rowIndex: 0, columnIndex: 0, columnId: column!.id },
        { commit, cancel },
      )
    })
    expect(await screen.findByRole('combobox')).toBeTruthy()
    const combobox = screen.getByRole('combobox')
    act(() => {
      combobox.focus()
    })
    await user.keyboard('{Enter}')

    expect(commit).toHaveBeenCalledWith(recordUuid)
    expect(cancel).not.toHaveBeenCalled()
    expect(setDataAtCell).not.toHaveBeenCalled()
  })

  it('displays the human label after a pick and the raw UUID when unknown', () => {
    renderWorkspace(<AdHocSheetWorkspace instance={refInstance()} />)
    const props = captureProps()
    const displayText = props.columns?.[0]?.displayText
    expect(displayText).toEqual(expect.any(Function))
    // Before any pick the persisted UUID renders as-is.
    expect(displayText?.(recordUuid)).toBe(recordUuid)
    expect(displayText?.(null)).toBe('')
    expect(
      recordCellDisplayText(
        { [recordUuid]: { identifier: 'SMP-2026-0001', title: 'LV harvest' } },
        recordUuid,
      ),
    ).toBe('SMP-2026-0001 · LV harvest')
    expect(recordCellDisplayText({}, recordUuid)).toBe(recordUuid)
    expect(recordCellDisplayText({}, null)).toBe('')
  })

  it('accepts a canonical UUID edit through the validation pipeline', () => {
    renderWorkspace(<AdHocSheetWorkspace instance={refInstance()} />)
    const props = captureProps()
    const changes: SheetbaseGridCellChange[] = [
      {
        rowIndex: 0,
        rowId,
        columnId: props.columns![0].id,
        previous: null,
        next: recordUuid,
      },
    ]
    act(() => {
      expect(props.beforeCellsChange?.(changes, 'edit')).toBeUndefined()
    })
    // The UUID is already canonical — coercion leaves it untouched.
    expect(changes[0]?.next).toBe(recordUuid)
  })

  it('fails closed when a non-UUID value is typed into a record-picker cell', () => {
    renderWorkspace(<AdHocSheetWorkspace instance={refInstance()} />)
    const props = captureProps()
    act(() => {
      expect(
        props.beforeCellsChange?.(
          [
            {
              rowIndex: 0,
              rowId,
              columnId: props.columns![0].id,
              previous: null,
              next: 'SMP-2026-0001',
            },
          ],
          'edit',
        ),
      ).toBe(false)
    })
    const statuses = screen
      .getAllByRole('status')
      .map((element) => element.textContent)
      .join(' ')
    expect(statuses).toContain('Edit rejected: invalid_value in Sample')
    expect(statuses).toContain('kept its previous value')
    expect(setDataAtCell).not.toHaveBeenCalled()
  })

  it('clears the cell to a canonical null through the edit pipeline', async () => {
    vi.mocked(mutateSheetLocalState).mockResolvedValue(refInstance())
    renderWorkspace(<AdHocSheetWorkspace instance={refInstance()} />)
    const props = captureProps()
    const changes: SheetbaseGridCellChange[] = [
      {
        rowIndex: 0,
        rowId,
        columnId: props.columns![0].id,
        previous: recordUuid,
        next: null,
      },
    ]
    act(() => {
      // Clearing passes validation (nullable field)…
      expect(props.beforeCellsChange?.(changes, 'edit')).toBeUndefined()
      // …and the change writes it to the authoritative local target.
      props.onCellsChange?.(changes, 'edit')
    })
    await vi.waitFor(() => {
      expect(mutateSheetLocalState).toHaveBeenCalledWith(
        expect.objectContaining({
          instanceId: refInstance().id,
          cells: [
            expect.objectContaining({ fieldId: refFieldId, value: null }),
          ],
        }),
        expect.anything(),
      )
    })
  })
})
