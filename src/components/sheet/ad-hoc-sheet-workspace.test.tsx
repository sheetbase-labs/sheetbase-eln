import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { mutateSheetLocalState } from '#/lib/sheet-local-data'
import { updateSheetInstance } from '#/lib/sheet-instance-data'
import { validSheetInstanceState } from '#/lib/sheet-instance.test'
import type { SheetInstance } from '#/lib/sheet-instance-data'

import { AdHocSheetWorkspace } from './ad-hoc-sheet-workspace'

const gridRender = vi.hoisted(() => vi.fn())

vi.mock('#/lib/sheet-local-data', async (importOriginal) => ({
  ...(await importOriginal()),
  mutateSheetLocalState: vi.fn(),
}))

// GRID-04: presentation writes go through the existing sheet-instance state
// mutation path; the tests assert on that contract.
vi.mock('#/lib/sheet-instance-data', async (importOriginal) => ({
  ...(await importOriginal()),
  updateSheetInstance: vi.fn(),
}))

// The grid is replaced with a props recorder: the workspace is exercised
// through the neutral Sheetbase contract (columns, rows, write callbacks and
// presentation callbacks), never through engine settings. The ad-hoc surface
// now renders `SheetbaseTableGrid`, so the recorder serves both exports.
vi.mock('./sheetbase-grid', () => {
  const Recorder = (props: Record<string, any>) => {
    gridRender(props)
    return (
      <table>
        <thead>
          <tr>
            {(props.columns as Array<{ id: string; label: string }>).map(
              (column) => (
                <th key={column.id} scope="col">
                  {column.label}
                </th>
              ),
            )}
          </tr>
        </thead>
      </table>
    )
  }
  return { SheetbaseGrid: Recorder, SheetbaseTableGrid: Recorder }
})

afterEach(() => {
  cleanup()
  gridRender.mockClear()
})

function instance(): SheetInstance {
  return {
    id: '20000000-0000-4000-8000-000000000001',
    workspaceId: '20000000-0000-4000-8000-000000000002',
    projectId: '20000000-0000-4000-8000-000000000003',
    notebookRecordId: '20000000-0000-4000-8000-000000000004',
    sourceDefinitionVersionId: null,
    name: 'Notebook sheet',
    description: null,
    lifecycle: 'active',
    revision: 1,
    state: validSheetInstanceState(),
    duplicatedFromInstanceId: null,
    createdAt: '2026-08-16T12:00:00.000Z',
    updatedAt: '2026-08-16T12:00:00.000Z',
    createdByUserId: 'u1',
    updatedByUserId: 'u1',
  }
}

function renderWorkspace(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function lastProps(): Record<string, any> {
  return gridRender.mock.lastCall?.[0] as Record<string, any>
}

/** One neutral change targeting a display column index. */
function cellChange(
  props: Record<string, any>,
  columnIndex: number,
  previous: unknown,
  next: unknown,
) {
  return [
    {
      rowIndex: 0,
      columnId: (props.columns as Array<{ id: string }>)[columnIndex].id,
      previous,
      next,
    },
  ]
}

describe('AdHocSheetWorkspace', () => {
  it('adds a local row without calling Dataset composition', async () => {
    const user = userEvent.setup()
    vi.mocked(mutateSheetLocalState).mockResolvedValue(instance())
    renderWorkspace(<AdHocSheetWorkspace instance={instance()} />)
    expect(
      screen.getByRole('columnheader', { name: 'Observation' }),
    ).toBeTruthy()
    expect(lastProps().columns).toEqual([
      expect.objectContaining({ readOnly: false }),
    ])
    await user.click(screen.getByRole('button', { name: 'Add row' }))
    expect(mutateSheetLocalState).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceId: instance().id,
        expectedRevision: 1,
        rows: [expect.objectContaining({ kind: 'local' })],
        cells: [expect.objectContaining({ value: null })],
      }),
      expect.anything(),
    )
  })

  it('keeps the same canonical grid keyboard surface in read-only mode', () => {
    renderWorkspace(<AdHocSheetWorkspace instance={instance()} readOnly />)

    expect(
      screen.getByRole('columnheader', { name: 'Observation' }),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add row' })).toBeNull()
    expect(lastProps().columns).toEqual([
      expect.objectContaining({ readOnly: true }),
    ])
  })
})

const countFieldId = '15000000-0000-4000-8000-000000000001'
const statusFieldId = '15000000-0000-4000-8000-000000000002'

/** Typed fixture covering the GRID-03 editor surface. */
function typedInstance(): SheetInstance {
  const base = instance()
  return {
    ...base,
    state: {
      ...base.state,
      localFields: [
        {
          ...base.state.localFields[0],
          fieldId: countFieldId,
          key: 'count',
          label: 'Count',
          logicalType: 'integer',
          quantity: {
            kind: 'cell-count',
            dimension: 'amount',
            storageUnit: 'cells',
          },
        },
        {
          ...base.state.localFields[0],
          fieldId: '15000000-0000-4000-8000-000000000003',
          key: 'observed',
          label: 'Observed',
          logicalType: 'date',
        },
        {
          ...base.state.localFields[0],
          fieldId: '15000000-0000-4000-8000-000000000004',
          key: 'recorded',
          label: 'Recorded',
          logicalType: 'timestamp',
        },
        {
          ...base.state.localFields[0],
          fieldId: statusFieldId,
          key: 'status',
          label: 'Status',
          logicalType: 'category',
          category: {
            kind: 'embedded',
            options: [
              {
                id: '40000000-0000-4000-8000-000000000001',
                key: 'active',
                label: 'Active',
                displayOrder: 0,
                lifecycle: 'active',
              },
              {
                id: '40000000-0000-4000-8000-000000000002',
                key: 'paused',
                label: 'Paused',
                displayOrder: 1,
                lifecycle: 'active',
              },
              {
                id: '40000000-0000-4000-8000-000000000003',
                key: 'retired',
                label: 'Retired label',
                displayOrder: 2,
                lifecycle: 'retired',
              },
            ],
          },
        },
        {
          ...base.state.localFields[0],
          fieldId: '15000000-0000-4000-8000-000000000005',
          key: 'flag',
          label: 'Flag',
          logicalType: 'boolean',
        },
        base.state.localFields[0],
      ],
    },
  }
}

describe('CanonicalSheetEditor typed editing and validation UX (GRID-03)', () => {
  beforeEach(() => {
    vi.mocked(mutateSheetLocalState).mockClear()
  })

  it('wires typed editors, vocabulary dropdowns and storage-unit headers', () => {
    renderWorkspace(<AdHocSheetWorkspace instance={typedInstance()} />)
    const props = lastProps()
    expect(
      (props.columns as Array<{ label: string }>).map((column) => column.label),
    ).toEqual([
      'Count (cells)',
      'Observed',
      'Recorded',
      'Status',
      'Flag',
      'Observation',
    ])
    expect(props.columns).toEqual([
      expect.objectContaining({ type: 'number' }),
      expect.objectContaining({ type: 'date' }),
      // GRID-03 review fix: HT 18's date editor is date-only and rejects
      // canonical …Z instants; timestamps keep a text editor + UTC coercion.
      expect.objectContaining({ type: 'datetime' }),
      expect.objectContaining({
        type: 'select',
        // Canonical vocabulary: active options only, displayed by label.
        options: ['Active', 'Paused'],
        displayText: expect.any(Function),
      }),
      expect.objectContaining({ type: 'checkbox' }),
      expect.objectContaining({ type: 'text' }),
    ])
  })

  it('reverts an invalid single edit and announces the canonical reason', () => {
    renderWorkspace(<AdHocSheetWorkspace instance={typedInstance()} />)
    const props = lastProps()
    act(() => {
      expect(
        props.beforeCellsChange(
          cellChange(props, 0, 100, 'not-a-number'),
          'edit',
        ),
      ).toBe(false)
    })
    const statuses = screen
      .getAllByRole('status')
      .map((element) => element.textContent)
      .join(' ')
    expect(statuses).toContain('Edit rejected: invalid_value in Count')
    expect(statuses).toContain('kept its previous value')
    expect(mutateSheetLocalState).not.toHaveBeenCalled()
  })

  it('coerces single edits to canonical values before the commit', () => {
    renderWorkspace(<AdHocSheetWorkspace instance={typedInstance()} />)
    const props = lastProps()
    const changes = cellChange(props, 0, 100, '1,200')
    act(() => {
      expect(props.beforeCellsChange(changes, 'edit')).toBeUndefined()
    })
    expect(changes[0]?.next).toBe(1200)
  })

  it('keeps the GRID-02 wholesale rejection for bulk paste sources', () => {
    renderWorkspace(<AdHocSheetWorkspace instance={typedInstance()} />)
    const props = lastProps()
    act(() => {
      expect(
        props.beforeCellsChange(cellChange(props, 0, 100, 'oops'), 'paste'),
      ).toBe(false)
    })
    const statuses = screen
      .getAllByRole('status')
      .map((element) => element.textContent)
      .join(' ')
    expect(statuses).toContain('Paste rejected: invalid_value in Count')
    expect(mutateSheetLocalState).not.toHaveBeenCalled()
  })
})

describe('CanonicalSheetEditor sort, filter, freeze & view ergonomics (GRID-04)', () => {
  const countId = countFieldId
  const observedId = '15000000-0000-4000-8000-000000000003'
  const recordedId = '15000000-0000-4000-8000-000000000004'

  beforeEach(() => {
    vi.mocked(updateSheetInstance).mockReset()
    vi.mocked(updateSheetInstance).mockResolvedValue(typedInstance())
  })

  it('wires freeze, widths, sort restore and column-menu settings', () => {
    const base = typedInstance()
    const withView: SheetInstance = {
      ...base,
      state: {
        ...base.state,
        presentation: {
          ...base.state.presentation,
          frozenColumnCount: 1,
          columnWidths: { [countId]: 220 },
          sorts: [{ columnId: countId, direction: 'desc' }],
        },
      },
    }
    renderWorkspace(<AdHocSheetWorkspace instance={withView} />)
    const props = lastProps()
    expect(props.frozenColumns).toBe(1)
    expect(props.reorderable).toBe(true)
    expect(props.resizable).toBe(true)
    // Widths resolve through the persisted per-column map.
    expect(props.columnWidth(countId)).toBe(220)
    // Persisted sorts restore as presentation state.
    expect(props.sorts).toEqual([{ columnId: countId, direction: 'desc' }])
    expect(props.sorting).toBe(true)
    expect(props.filtering).toBe(true)
    // The column menu keeps the freeze/hide surface for the wrapper to render.
    expect(
      (props.columnMenuItems as Array<{ id?: string }>).map((item) => item.id),
    ).toEqual(
      expect.arrayContaining([
        'freeze-to-column',
        'unfreeze-columns',
        'hide-columns',
      ]),
    )
  })

  it('hides presentation-hidden columns and restores them via the toolbar', async () => {
    const user = userEvent.setup()
    const base = typedInstance()
    const withHidden: SheetInstance = {
      ...base,
      state: {
        ...base.state,
        presentation: {
          ...base.state.presentation,
          hiddenColumnIds: [countId],
        },
      },
    }
    renderWorkspace(<AdHocSheetWorkspace instance={withHidden} />)
    // Display-only concealment: the hidden column is not rendered.
    expect(
      (lastProps().columns as Array<{ label: string }>).map(
        (column) => column.label,
      ),
    ).not.toContain('Count (cells)')
    await user.click(
      screen.getByRole('button', { name: 'Show 1 hidden column' }),
    )
    expect(updateSheetInstance).toHaveBeenCalledWith(
      withHidden.id,
      withHidden.revision,
      expect.objectContaining({
        presentation: expect.objectContaining({ hiddenColumnIds: [] }),
      }),
      expect.anything(),
    )
  })

  it('freezes and unfreezes columns through the working-view controls', async () => {
    const user = userEvent.setup()
    // Frozen state starts at zero: freeze controls only the leftmost columns.
    const cold = typedInstance()
    renderWorkspace(<AdHocSheetWorkspace instance={cold} />)
    expect(
      screen
        .getByRole('button', { name: 'Freeze one fewer column' })
        .hasAttribute('disabled'),
    ).toBe(true)
    await user.click(
      screen.getByRole('button', { name: 'Freeze one more column' }),
    )
    expect(updateSheetInstance).toHaveBeenCalledWith(
      cold.id,
      cold.revision,
      expect.objectContaining({
        presentation: expect.objectContaining({ frozenColumnCount: 1 }),
      }),
      expect.anything(),
    )
    // Start frozen: unfreezing decrements through the same state path.
    cleanup()
    const frozen = typedInstance()
    frozen.state = {
      ...frozen.state,
      presentation: {
        ...frozen.state.presentation,
        frozenColumnCount: 2,
      },
    }
    renderWorkspace(<AdHocSheetWorkspace instance={frozen} />)
    await user.click(
      screen.getByRole('button', { name: 'Freeze one fewer column' }),
    )
    expect(updateSheetInstance).toHaveBeenLastCalledWith(
      frozen.id,
      frozen.revision,
      expect.objectContaining({
        presentation: expect.objectContaining({ frozenColumnCount: 1 }),
      }),
      expect.anything(),
    )
  })

  it('persists a resized column width against the column id', async () => {
    const current = typedInstance()
    renderWorkspace(<AdHocSheetWorkspace instance={current} />)
    const props = lastProps()
    await act(async () => {
      props.onColumnResize(countId, 300.4)
    })
    expect(updateSheetInstance).toHaveBeenCalledWith(
      current.id,
      current.revision,
      expect.objectContaining({
        presentation: expect.objectContaining({
          columnWidths: expect.objectContaining({ [countId]: 300 }),
        }),
      }),
      expect.anything(),
    )
  })

  it('persists a manual column move as stable ids and resets the index map', async () => {
    const current = typedInstance()
    renderWorkspace(<AdHocSheetWorkspace instance={current} />)
    const props = lastProps()
    await act(async () => {
      props.onColumnOrderChange([
        observedId,
        countId,
        recordedId,
        statusFieldId,
        '15000000-0000-4000-8000-000000000005',
        '10000000-0000-4000-8000-000000000004',
      ])
    })
    expect(updateSheetInstance).toHaveBeenCalledWith(
      current.id,
      current.revision,
      expect.objectContaining({
        presentation: expect.objectContaining({
          columnOrder: [
            observedId,
            countId,
            recordedId,
            statusFieldId,
            '15000000-0000-4000-8000-000000000005',
            '10000000-0000-4000-8000-000000000004',
          ],
        }),
      }),
      expect.anything(),
    )
    // The wrapper resets its own visual index map once the caller persists.
    expect(props.resetColumnOrderOnChange).toBe(true)
  })

  it('persists a sort as presentation state and guards identical restores', async () => {
    const current = typedInstance()
    // The first persist resolves to state that already carries the new sort,
    // so the restored state must not re-write identical state.
    const updated: SheetInstance = {
      ...current,
      revision: 2,
      state: {
        ...current.state,
        presentation: {
          ...current.state.presentation,
          sorts: [{ columnId: countId, direction: 'desc' }],
        },
      },
    }
    vi.mocked(updateSheetInstance).mockResolvedValueOnce(updated)
    renderWorkspace(<AdHocSheetWorkspace instance={current} />)
    const props = lastProps()
    await act(async () => {
      props.onSortsChange([{ columnId: countId, direction: 'desc' }])
    })
    expect(updateSheetInstance).toHaveBeenCalledWith(
      current.id,
      current.revision,
      expect.objectContaining({
        presentation: expect.objectContaining({
          sorts: [{ columnId: countId, direction: 'desc' }],
        }),
      }),
      expect.anything(),
    )
    const callsAfterFirst = vi.mocked(updateSheetInstance).mock.calls.length
    await act(async () => {
      props.onSortsChange([{ columnId: countId, direction: 'desc' }])
    })
    expect(vi.mocked(updateSheetInstance).mock.calls).toHaveLength(
      callsAfterFirst,
    )
  })

  it('persists filters as canonical presentation state and guards identical restores', async () => {
    const current = typedInstance()
    const updated: SheetInstance = {
      ...current,
      revision: 2,
      state: {
        ...current.state,
        presentation: {
          ...current.state.presentation,
          filters: [
            { columnId: countId, operator: 'equals', value: 1_200 },
            { columnId: statusFieldId, operator: 'is-not-empty' },
          ],
        },
      },
    }
    vi.mocked(updateSheetInstance).mockResolvedValueOnce(updated)
    renderWorkspace(<AdHocSheetWorkspace instance={current} />)
    const props = lastProps()
    const filters = [
      { columnId: countId, operator: 'equals', value: 1_200 },
      { columnId: statusFieldId, operator: 'is-not-empty' },
    ]
    await act(async () => {
      props.onFiltersChange(filters)
    })
    expect(updateSheetInstance).toHaveBeenCalledWith(
      current.id,
      current.revision,
      expect.objectContaining({
        presentation: expect.objectContaining({
          filters: [
            { columnId: countId, operator: 'equals', value: 1_200 },
            { columnId: statusFieldId, operator: 'is-not-empty' },
          ],
        }),
      }),
      expect.anything(),
    )
    const callsAfterFirst = vi.mocked(updateSheetInstance).mock.calls.length
    await act(async () => {
      props.onFiltersChange(filters)
    })
    expect(vi.mocked(updateSheetInstance).mock.calls).toHaveLength(
      callsAfterFirst,
    )
  })

  it('restores a saved working view after re-validating it', async () => {
    const user = userEvent.setup()
    const viewed = typedInstance()
    viewed.state = {
      ...viewed.state,
      presentation: {
        ...viewed.state.presentation,
        frozenColumnCount: 1,
        columnWidths: { [countId]: 260 },
        filters: [{ columnId: countId, operator: 'equals', value: 260 }],
      },
    }
    renderWorkspace(<AdHocSheetWorkspace instance={viewed} />)
    await user.click(screen.getByRole('button', { name: 'Save view' }))
    cleanup()
    // A fresh editor with canonical presentation restores the saved view.
    renderWorkspace(<AdHocSheetWorkspace instance={typedInstance()} />)
    await user.click(screen.getByRole('button', { name: 'Restore view' }))
    expect(updateSheetInstance).toHaveBeenLastCalledWith(
      viewed.id,
      viewed.revision,
      expect.objectContaining({
        presentation: expect.objectContaining({
          frozenColumnCount: 1,
          columnWidths: expect.objectContaining({ [countId]: 260 }),
          filters: [{ columnId: countId, operator: 'equals', value: 260 }],
        }),
      }),
      expect.anything(),
    )
    localStorage.removeItem(`sheetbase-sheet-view-v1:${viewed.id}`)
  })
})
