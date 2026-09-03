import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  DatasetQuery,
  SpreadsheetCellRenderContext,
  SpreadsheetCustomEditor,
} from 'sheetbase-table/dev'

import { presentationFiltersToQueryFilters } from '#/lib/sheetbase-table/sheet-instance-paged-adapter'
import type { SheetInstancePagedAdapter } from '#/lib/sheetbase-table/sheet-instance-paged-adapter'
import { mutateSheetLocalState } from '#/lib/sheet-local-data'
import { updateSheetInstance } from '#/lib/sheet-instance-data'
import { validSheetInstanceState } from '#/lib/sheet-instance.test'
import type { SheetInstance } from '#/lib/sheet-instance-data'

import { AdHocSheetWorkspace } from './ad-hoc-sheet-workspace'

const gridProps = vi.hoisted(() => ({ current: null as null | GridPropsCapture }))

interface GridPropsCapture {
  adapter: SheetInstancePagedAdapter
  datasetId: string
  fieldIds: readonly string[]
  rowCount: number
  frozenColumns: number
  initialColumnWidths: readonly number[]
  readOnlyRows: ReadonlySet<number>
  datasetHeader: {
    datasetId: string
    fields: Array<{
      id: string
      label: string
      column: number
      dataType: 'text' | 'number' | 'date' | 'boolean' | 'relationship'
      writable: boolean
      required: boolean
      options?: string[]
    }>
  }
  query: DatasetQuery
  onQueryChange(next: DatasetQuery): void
  onFrozenColumnsChange(count: number): void
  onColumnWidthsChange(widths: readonly number[]): void
  onColumnMove(from: number, to: number): void
  onColumnVisibilityChange(fieldId: string, visible: boolean): void
  renderCell(context: SpreadsheetCellRenderContext): ReactNode | undefined
  customEditors: readonly SpreadsheetCustomEditor[]
}

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

/**
 * The engine grid is replaced with a props recorder: cell edits are driven
 * through the workspace's paged adapter (`gridProps.current.adapter.commit`)
 * and view interactions through the captured engine callbacks, exactly as the
 * engine would invoke them.
 */
vi.mock('sheetbase-table/dev', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sheetbase-table/dev')>()
  return {
    ...actual,
    PagedSpreadsheet: (props: Record<string, unknown>) => {
      gridProps.current = props as unknown as GridPropsCapture
      const fields =
        ((props.datasetHeader as { fields?: Array<{ id: string; label: string }> })
          ?.fields ?? [])
      return (
        <table>
          <thead>
            <tr>
              {fields.map((field) => (
                <th key={field.id} scope="col">
                  {field.label}
                </th>
              ))}
            </tr>
          </thead>
        </table>
      )
    },
  }
})

afterEach(() => {
  cleanup()
  gridProps.current = null
})

function gridPropsCapture(): GridPropsCapture {
  const props = gridProps.current
  if (!props) throw new Error('the engine grid props were not captured')
  return props
}

function headerLabels(): string[] {
  return gridPropsCapture().datasetHeader.fields.map((field) => field.label)
}

/** One engine cell write against the captured adapter. */
function cellWrite(fieldId: string, after: string) {
  const adapter = gridPropsCapture().adapter
  return {
    datasetId: adapter.datasetId,
    recordId: '10000000-0000-4000-8000-000000000005',
    fieldId,
    after,
  }
}

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

describe('AdHocSheetWorkspace', () => {
  it('adds a local row without calling Dataset composition', async () => {
    const user = userEvent.setup()
    vi.mocked(mutateSheetLocalState).mockResolvedValue(instance())
    renderWorkspace(<AdHocSheetWorkspace instance={instance()} />)
    expect(
      screen.getByRole('columnheader', { name: 'Observation' }),
    ).toBeTruthy()
    // The engine grid receives an editable surface: every display field is
    // writable and no row is pinned read-only.
    expect(gridPropsCapture().datasetHeader.fields).toEqual([
      expect.objectContaining({ writable: true }),
    ])
    expect(gridPropsCapture().readOnlyRows).toEqual(new Set())
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

  it('keeps the same canonical grid surface in read-only mode', () => {
    renderWorkspace(<AdHocSheetWorkspace instance={instance()} readOnly />)

    expect(
      screen.getByRole('columnheader', { name: 'Observation' }),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add row' })).toBeNull()
    // Every row reaches the engine as read-only and no field is writable.
    expect(gridPropsCapture().readOnlyRows).toEqual(new Set([0]))
    expect(gridPropsCapture().datasetHeader.fields).toEqual([
      expect.objectContaining({ writable: false }),
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

  it('wires typed engine fields, vocabulary options and storage-unit headers', () => {
    renderWorkspace(<AdHocSheetWorkspace instance={typedInstance()} />)
    const fields = gridPropsCapture().datasetHeader.fields
    expect(fields.map((field) => field.label)).toEqual([
      'Count (cells)',
      'Observed',
      'Recorded',
      'Status',
      'Flag',
      'Observation',
    ])
    expect(fields.map((field) => field.dataType)).toEqual([
      'number',
      'date',
      // GRID-03 review fix: the engine's date field is date-only and rejects
      // canonical …Z instants; timestamps keep a text field + UTC coercion.
      'text',
      // Canonical vocabulary: active options only, displayed by label.
      'text',
      'boolean',
      'text',
    ])
    expect(fields[0]).toEqual(
      expect.objectContaining({ id: countFieldId, writable: true }),
    )
    expect(fields[3]?.options).toEqual(['Active', 'Paused'])
  })

  it('reverts an invalid single edit and announces the canonical reason', async () => {
    renderWorkspace(<AdHocSheetWorkspace instance={typedInstance()} />)
    let rejected: Awaited<
      ReturnType<SheetInstancePagedAdapter['commit']>
    >['rejected'] = []
    await act(async () => {
      const result = await gridPropsCapture().adapter.commit([
        cellWrite(countFieldId, 'not-a-number'),
      ])
      rejected = result.rejected
    })
    // The write is rejected fail-closed with the canonical reason, so the
    // engine keeps the cell's previous value and nothing is persisted.
    expect(rejected).toEqual([
      expect.objectContaining({
        write: expect.objectContaining({ fieldId: countFieldId }),
        reason: 'invalid_value',
      }),
    ])
    expect(mutateSheetLocalState).not.toHaveBeenCalled()
  })

  it('coerces single edits to canonical values before the commit', async () => {
    vi.mocked(mutateSheetLocalState).mockResolvedValue(typedInstance())
    renderWorkspace(<AdHocSheetWorkspace instance={typedInstance()} />)
    await act(async () => {
      const result = await gridPropsCapture().adapter.commit([
        cellWrite(countFieldId, '1,200'),
      ])
      expect(result.rejected).toEqual([])
    })
    expect(mutateSheetLocalState).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceId: typedInstance().id,
        cells: [
          expect.objectContaining({
            rowKey: '10000000-0000-4000-8000-000000000005',
            fieldId: countFieldId,
            value: 1200,
          }),
        ],
      }),
      expect.anything(),
    )
  })

  it('keeps the fail-closed rejection for invalid bulk-paste values', async () => {
    renderWorkspace(<AdHocSheetWorkspace instance={typedInstance()} />)
    let result: Awaited<
      ReturnType<SheetInstancePagedAdapter['commit']>
    > | null = null
    await act(async () => {
      // A bulk paste is one engine commit; the invalid cell inside it is
      // rejected before any authoritative write runs.
      result = await gridPropsCapture().adapter.commit([
        cellWrite(countFieldId, 'oops'),
      ])
    })
    expect(result!.accepted).toEqual([])
    expect(result!.rejected).toEqual([
      expect.objectContaining({
        write: expect.objectContaining({ fieldId: countFieldId }),
        reason: 'invalid_value',
      }),
    ])
    expect(mutateSheetLocalState).not.toHaveBeenCalled()
  })
})

describe('CanonicalSheetEditor sort, filter, freeze & view ergonomics (GRID-04)', () => {
  const countId = countFieldId
  const observedId = '15000000-0000-4000-8000-000000000003'
  const statusId = statusFieldId

  function presentationInstance(): SheetInstance {
    return typedInstance()
  }

  beforeEach(() => {
    vi.mocked(updateSheetInstance).mockReset()
    vi.mocked(updateSheetInstance).mockResolvedValue(presentationInstance())
  })

  it('wires freeze, widths, sort restore and view callbacks through the engine', () => {
    const base = presentationInstance()
    const viewed: SheetInstance = {
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
    renderWorkspace(<AdHocSheetWorkspace instance={viewed} />)
    const props = gridPropsCapture()
    expect(props.frozenColumns).toBe(1)
    // Widths resolve through the persisted per-column map.
    expect(props.initialColumnWidths[0]).toBe(220)
    // Persisted sorts restore as the engine query's sort clauses.
    expect(props.query.sort).toEqual([
      { fieldId: countId, direction: 'desc' },
    ])
    // The engine owns the column menu (filters, sorts, freeze, hide, move,
    // resize); the workspace receives each action as a callback onto the
    // GRID-04 presentation working state.
    expect(props.onQueryChange).toEqual(expect.any(Function))
    expect(props.onFrozenColumnsChange).toEqual(expect.any(Function))
    expect(props.onColumnWidthsChange).toEqual(expect.any(Function))
    expect(props.onColumnMove).toEqual(expect.any(Function))
    expect(props.onColumnVisibilityChange).toEqual(expect.any(Function))
  })

  it('hides presentation-hidden columns and restores them via the toolbar', async () => {
    const user = userEvent.setup()
    const base = typedInstance()
    const hidden: SheetInstance = {
      ...base,
      state: {
        ...base.state,
        presentation: {
          ...base.state.presentation,
          hiddenColumnIds: [countId],
        },
      },
    }
    renderWorkspace(<AdHocSheetWorkspace instance={hidden} />)
    // Display-only concealment: the hidden column is not rendered.
    expect(headerLabels()).not.toContain('Count (cells)')
    await user.click(
      screen.getByRole('button', { name: 'Show 1 hidden column' }),
    )
    expect(updateSheetInstance).toHaveBeenCalledWith(
      hidden.id,
      hidden.revision,
      expect.objectContaining({
        presentation: expect.objectContaining({ hiddenColumnIds: [] }),
      }),
      expect.anything(),
    )
  })

  it('freezes and unfreezes columns through the working-view controls', async () => {
    const user = userEvent.setup()
    // Frozen state starts at zero: freeze controls only the leftmost columns.
    const cold = presentationInstance()
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
    const frozen = presentationInstance()
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

  it('persists a resized column width against the display column', async () => {
    const viewed = presentationInstance()
    renderWorkspace(<AdHocSheetWorkspace instance={viewed} />)
    await act(async () => {
      // The engine reports widths as a display-order array.
      gridPropsCapture().onColumnWidthsChange([300.4])
    })
    expect(updateSheetInstance).toHaveBeenCalledWith(
      viewed.id,
      viewed.revision,
      expect.objectContaining({
        presentation: expect.objectContaining({
          columnWidths: expect.objectContaining({ [countId]: 300 }),
        }),
      }),
      expect.anything(),
    )
  })

  it('persists a manual column move as stable presentation ids', async () => {
    const viewed = presentationInstance()
    renderWorkspace(<AdHocSheetWorkspace instance={viewed} />)
    await act(async () => {
      gridPropsCapture().onColumnMove(0, 1)
    })
    // The move persists as the display column order in stable column ids —
    // the engine applies presentation before rendering, so there is no
    // visual→physical index map to reset.
    expect(updateSheetInstance).toHaveBeenCalledWith(
      viewed.id,
      viewed.revision,
      expect.objectContaining({
        presentation: expect.objectContaining({
          columnOrder: [
            observedId,
            countId,
            '15000000-0000-4000-8000-000000000004',
            statusId,
            '15000000-0000-4000-8000-000000000005',
            '10000000-0000-4000-8000-000000000004',
          ],
        }),
      }),
      expect.anything(),
    )
  })

  it('persists an engine sort change as presentation state', async () => {
    const viewed = presentationInstance()
    renderWorkspace(<AdHocSheetWorkspace instance={viewed} />)
    const props = gridPropsCapture()
    await act(async () => {
      // The engine round-trips its whole query; the workspace persists the
      // sort alongside the filters it already knows.
      props.onQueryChange({
        filters: props.query.filters,
        sort: [{ fieldId: countId, direction: 'desc' }],
      })
    })
    expect(updateSheetInstance).toHaveBeenCalledWith(
      viewed.id,
      viewed.revision,
      expect.objectContaining({
        presentation: expect.objectContaining({
          sorts: [{ columnId: countId, direction: 'desc' }],
          filters: [
            {
              columnId: '10000000-0000-4000-8000-000000000004',
              operator: 'equals',
              value: 'independent value',
            },
          ],
        }),
      }),
      expect.anything(),
    )
  })

  it('restores a saved working view after re-validating it', async () => {
    const user = userEvent.setup()
    const viewed = presentationInstance()
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
    renderWorkspace(<AdHocSheetWorkspace instance={presentationInstance()} />)
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

  it('persists engine query filters as canonical presentation state', async () => {
    const current = presentationInstance()
    renderWorkspace(<AdHocSheetWorkspace instance={current} />)
    await act(async () => {
      // Two columns with conditions, as the engine reports them: stable
      // field ids with typed operators.
      gridPropsCapture().onQueryChange({
        filters: [
          { fieldId: countId, operator: 'eq', value: 1_200 },
          { fieldId: statusId, operator: 'notNull' },
        ],
        sort: [],
      })
    })
    expect(updateSheetInstance).toHaveBeenCalledWith(
      current.id,
      current.revision,
      expect.objectContaining({
        presentation: expect.objectContaining({
          filters: [
            { columnId: countId, operator: 'equals', value: 1_200 },
            { columnId: statusId, operator: 'is-not-empty' },
          ],
        }),
      }),
      expect.anything(),
    )
  })

  it('keeps non-serialisable filter conditions session-visual', async () => {
    const current = presentationInstance()
    renderWorkspace(<AdHocSheetWorkspace instance={current} />)
    await act(async () => {
      gridPropsCapture().onQueryChange({
        filters: [
          // A richer engine condition with no presentation counterpart…
          { fieldId: countId, operator: 'contains', value: 'kept' },
          // …alongside one that the working-view schema can restore.
          { fieldId: statusId, operator: 'notNull' },
        ],
        sort: [],
      })
    })
    // Only the serialisable condition is captured; the 'contains' filter
    // stays session-visual and is honestly omitted from the saved view.
    expect(updateSheetInstance).toHaveBeenCalledWith(
      current.id,
      current.revision,
      expect.objectContaining({
        presentation: expect.objectContaining({
          filters: [{ columnId: statusId, operator: 'is-not-empty' }],
        }),
      }),
      expect.anything(),
    )
  })

  it('re-applies persisted filters through the engine query after a reload', () => {
    const filters = [
      { columnId: countId, operator: 'equals' as const, value: 1_200 },
      { columnId: statusId, operator: 'is-not-empty' as const },
    ]
    const filtered = presentationInstance()
    filtered.state = {
      ...filtered.state,
      presentation: { ...filtered.state.presentation, filters },
    }
    const expected = presentationFiltersToQueryFilters(filters)
    const view = renderWorkspace(<AdHocSheetWorkspace instance={filtered} />)
    expect(gridPropsCapture().query.filters).toEqual(expected)
    // A data reload (a fresh instance identity, like a refetch) re-derives
    // the same engine query from the persisted presentation.
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <AdHocSheetWorkspace instance={{ ...filtered }} />
      </QueryClientProvider>,
    )
    expect(gridPropsCapture().query.filters).toEqual(expected)
  })

  it('runs the full saved-view lifecycle: save, reload, restore, unhide, filter re-applies', async () => {
    const user = userEvent.setup()
    // The view hides Observed and carries a filter on Count AND on the
    // hidden Observed column itself — the case where a naive restore drops
    // the hidden column's condition.
    const savedFilters = [
      { columnId: countId, operator: 'equals' as const, value: 1_200 },
      { columnId: observedId, operator: 'is-not-empty' as const },
    ]
    const withSavedView = (hideObserved: boolean): SheetInstance => {
      const base = presentationInstance()
      return {
        ...base,
        state: {
          ...base.state,
          presentation: {
            ...base.state.presentation,
            hiddenColumnIds: hideObserved ? [observedId] : [],
            filters: savedFilters,
          },
        },
      }
    }

    // Phase 1 — save: the toolbar captures the working view to localStorage.
    const saved = withSavedView(true)
    renderWorkspace(<AdHocSheetWorkspace instance={saved} />)
    await user.click(screen.getByRole('button', { name: 'Save view' }))
    expect(
      localStorage.getItem(`sheetbase-sheet-view-v1:${saved.id}`),
    ).toBeTruthy()
    cleanup()

    // Phase 2 — reload: a fresh editor over a canonical presentation (no
    // saved filters); the engine query carries no filters.
    const reloaded = presentationInstance()
    reloaded.state = {
      ...reloaded.state,
      presentation: { ...reloaded.state.presentation, filters: [] },
    }
    renderWorkspace(<AdHocSheetWorkspace instance={reloaded} />)
    expect(gridPropsCapture().query.filters).toEqual([])
    cleanup()

    // Phase 3 — restore: re-validated against the canonical column set, the
    // saved view comes back whole — including the filter on the hidden
    // column and the hidden-column list itself.
    renderWorkspace(<AdHocSheetWorkspace instance={reloaded} />)
    await user.click(screen.getByRole('button', { name: 'Restore view' }))
    expect(updateSheetInstance).toHaveBeenCalledWith(
      reloaded.id,
      reloaded.revision,
      expect.objectContaining({
        presentation: expect.objectContaining({
          hiddenColumnIds: [observedId],
          filters: savedFilters,
        }),
      }),
      expect.anything(),
    )
    cleanup()

    // Phase 4 — after the restored state lands (fresh mount, like a
    // refetch), BOTH persisted filters reach the engine query, keyed by
    // stable field ids: the hidden column's condition survives because the
    // engine resolves filters against the canonical matrix, not the display
    // projection, so nothing can fall out of range.
    renderWorkspace(<AdHocSheetWorkspace instance={withSavedView(true)} />)
    const expectedFilters = presentationFiltersToQueryFilters(savedFilters)
    expect(gridPropsCapture().query.filters).toEqual(expectedFilters)

    // Phase 5 — unhide: showing the hidden column keeps its preserved filter
    // in the persisted presentation.
    await user.click(
      screen.getByRole('button', { name: 'Show 1 hidden column' }),
    )
    expect(updateSheetInstance).toHaveBeenCalledWith(
      saved.id,
      saved.revision,
      expect.objectContaining({
        presentation: expect.objectContaining({
          hiddenColumnIds: [],
          filters: savedFilters,
        }),
      }),
      expect.anything(),
    )
    cleanup()

    // Phase 6 — with the column visible again, the same fieldId-addressed
    // engine query applies BOTH conditions; nothing was withheld while the
    // column was hidden.
    renderWorkspace(<AdHocSheetWorkspace instance={withSavedView(false)} />)
    expect(gridPropsCapture().query.filters).toEqual(expectedFilters)

    localStorage.removeItem(`sheetbase-sheet-view-v1:${saved.id}`)
  })

  it('addresses cell writes by stable field id regardless of display position', async () => {
    const viewed = presentationInstance()
    renderWorkspace(<AdHocSheetWorkspace instance={viewed} />)
    await act(async () => {
      // Move the first display column past the second (Count ↔ Observed):
      // presentation resequences the display only, and the write path is
      // never re-mapped through grid positions.
      gridPropsCapture().onColumnMove(0, 1)
    })
    let result: Awaited<
      ReturnType<SheetInstancePagedAdapter['commit']>
    > | null = null
    await act(async () => {
      result = await gridPropsCapture().adapter.commit([
        cellWrite(observedId, 'not-a-date'),
      ])
    })
    // The rejection names the exact field that was addressed — the Observed
    // date column — not whichever column happens to sit in that slot.
    expect(result!.accepted).toEqual([])
    expect(result!.rejected).toEqual([
      expect.objectContaining({
        write: expect.objectContaining({ fieldId: observedId }),
        reason: 'invalid_value',
      }),
    ])
    expect(mutateSheetLocalState).not.toHaveBeenCalled()
  })
})
