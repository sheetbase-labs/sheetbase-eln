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
let gridReady: ((hot: unknown) => void) | undefined | null = null

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

vi.mock('./sheetbase-grid', () => ({
  SheetbaseGrid: ({
    settings,
    onReady,
  }: {
    settings: Record<string, unknown>
    onReady?: (instance: unknown) => void
  }) => {
    gridRender(settings)
    gridReady = onReady
    return (
      <table>
        <thead>
          <tr>
            {((settings.colHeaders as string[] | undefined) ?? []).map(
              (header) => (
                <th key={header} scope="col">
                  {header}
                </th>
              ),
            )}
          </tr>
        </thead>
      </table>
    )
  },
}))

afterEach(() => {
  cleanup()
  gridRender.mockClear()
  gridReady = null
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

describe('AdHocSheetWorkspace', () => {
  it('adds a local row without calling Dataset composition', async () => {
    const user = userEvent.setup()
    vi.mocked(mutateSheetLocalState).mockResolvedValue(instance())
    renderWorkspace(<AdHocSheetWorkspace instance={instance()} />)
    expect(
      screen.getByRole('columnheader', { name: 'Observation' }),
    ).toBeTruthy()
    expect(gridRender.mock.lastCall?.[0].columns).toEqual([
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
    expect(gridRender.mock.lastCall?.[0].columns).toEqual([
      expect.objectContaining({ readOnly: true }),
    ])
  })
})

interface GridSettingsCapture {
  colHeaders?: string[]
  columns?: Array<Record<string, unknown> & { readOnly?: boolean }>
  beforeChange?: (
    changes: Array<[number, number, unknown, unknown]>,
    source: string,
  ) => boolean | undefined
}

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
    const settings = gridRender.mock.lastCall?.[0] as GridSettingsCapture
    expect(settings.colHeaders).toEqual([
      'Count (cells)',
      'Observed',
      'Recorded',
      'Status',
      'Flag',
      'Observation',
    ])
    expect(settings.columns).toEqual([
      expect.objectContaining({ type: 'numeric' }),
      expect.objectContaining({ type: 'date' }),
      // GRID-03 review fix: HT 18's date editor is date-only and rejects
      // canonical …Z instants; timestamps keep a text editor + UTC coercion.
      expect.objectContaining({ type: 'text' }),
      expect.objectContaining({
        type: 'dropdown',
        // Canonical vocabulary: active options only, displayed by label.
        source: ['Active', 'Paused'],
        renderer: expect.any(Function),
      }),
      expect.objectContaining({ type: 'checkbox' }),
      expect.objectContaining({ type: 'text' }),
    ])
  })

  it('reverts an invalid single edit and announces the canonical reason', () => {
    renderWorkspace(<AdHocSheetWorkspace instance={typedInstance()} />)
    const settings = gridRender.mock.lastCall?.[0] as GridSettingsCapture
    act(() => {
      expect(
        settings.beforeChange?.([[0, 0, 100, 'not-a-number']], 'edit'),
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
    const settings = gridRender.mock.lastCall?.[0] as GridSettingsCapture
    const changes: Array<[number, number, unknown, unknown]> = [
      [0, 0, 100, '1,200'],
    ]
    act(() => {
      expect(settings.beforeChange?.(changes, 'edit')).toBeUndefined()
    })
    expect(changes[0]?.[3]).toBe(1200)
  })

  it('keeps the GRID-02 wholesale rejection for bulk paste sources', () => {
    renderWorkspace(<AdHocSheetWorkspace instance={typedInstance()} />)
    const settings = gridRender.mock.lastCall?.[0] as GridSettingsCapture
    act(() => {
      expect(
        settings.beforeChange?.([[0, 0, 100, 'oops']], 'CopyPaste.paste'),
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

  function presentationInstance(): SheetInstance {
    const base = typedInstance()
    return base
  }

  function lastSettings(): Record<string, any> {
    return gridRender.mock.lastCall?.[0] as Record<string, any>
  }

  function fakeHot(physicalForVisual: (visual: number) => number) {
    return {
      toPhysicalRow: (visual: number) => visual,
      toPhysicalColumn: physicalForVisual,
      countCols: () => 6,
      columnIndexMapper: {
        setIndexesSequence: vi.fn(),
        getIndexesSequence: () => [],
      },
    }
  }

  beforeEach(() => {
    vi.mocked(updateSheetInstance).mockReset()
    vi.mocked(updateSheetInstance).mockResolvedValue(presentationInstance())
  })

  it('wires freeze, widths, sort restore and drag-reorder settings', () => {
    const base = presentationInstance()
    const instance: SheetInstance = {
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
    renderWorkspace(<AdHocSheetWorkspace instance={instance} />)
    const settings = lastSettings()
    expect(settings.fixedColumnsStart).toBe(1)
    expect(settings.manualColumnMove).toBe(true)
    expect(settings.manualColumnResize).toBe(true)
    // Widths resolve through the persisted per-column map.
    expect(settings.colWidths(0)).toBe(220)
    // Persisted sorts restore as the columnSorting initial config.
    expect(settings.columnSorting).toEqual({
      initialConfig: [{ column: 0, sortOrder: 'desc' }],
    })
    // The column menu keeps the filter surface and adds freeze/hide items.
    const menu = settings.dropdownMenu.items
    expect(Object.keys(menu)).toEqual(
      expect.arrayContaining([
        'filter_by_condition',
        'filter_by_value',
        'freeze_to_column',
        'unfreeze_columns',
        'hide_column',
      ]),
    )
  })

  it('hides presentation-hidden columns and restores them via the toolbar', async () => {
    const user = userEvent.setup()
    const base = typedInstance()
    const instance: SheetInstance = {
      ...base,
      state: {
        ...base.state,
        presentation: {
          ...base.state.presentation,
          hiddenColumnIds: [countId],
        },
      },
    }
    renderWorkspace(<AdHocSheetWorkspace instance={instance} />)
    // Display-only concealment: the hidden column is not rendered.
    expect(lastSettings().colHeaders).not.toContain('Count (cells)')
    await user.click(
      screen.getByRole('button', { name: 'Show 1 hidden column' }),
    )
    expect(updateSheetInstance).toHaveBeenCalledWith(
      instance.id,
      instance.revision,
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

  it('persists a resized column width against the physical column', async () => {
    const instance = presentationInstance()
    renderWorkspace(<AdHocSheetWorkspace instance={instance} />)
    const settings = lastSettings()
    await act(async () => {
      settings.afterColumnResize(300.4, 0)
    })
    expect(updateSheetInstance).toHaveBeenCalledWith(
      instance.id,
      instance.revision,
      expect.objectContaining({
        presentation: expect.objectContaining({
          columnWidths: expect.objectContaining({ [countId]: 300 }),
        }),
      }),
      expect.anything(),
    )
  })

  it('persists a manual column move as stable ids and resets the index map', async () => {
    const instance = presentationInstance()
    renderWorkspace(<AdHocSheetWorkspace instance={instance} />)
    const hot = fakeHot((visual) =>
      visual === 0 ? 1 : visual === 1 ? 0 : visual,
    )
    act(() => {
      gridReady?.(hot)
    })
    const settings = lastSettings()
    await act(async () => {
      settings.afterColumnMove([0], 1, 1, true, true)
    })
    // Visual column 0 showed the physical column 1 (Observed) after the drag.
    expect(updateSheetInstance).toHaveBeenCalledWith(
      instance.id,
      instance.revision,
      expect.objectContaining({
        presentation: expect.objectContaining({
          columnOrder: [
            observedId,
            countId,
            '15000000-0000-4000-8000-000000000004',
            '15000000-0000-4000-8000-000000000002',
            '15000000-0000-4000-8000-000000000005',
            '10000000-0000-4000-8000-000000000004',
          ],
        }),
      }),
      expect.anything(),
    )
    expect(hot.columnIndexMapper.setIndexesSequence).toHaveBeenCalled()
  })

  it('persists a sort as presentation state and guards identical restores', async () => {
    const instance = presentationInstance()
    // The first persist resolves to state that already carries the new sort,
    // so the restored initialConfig must not re-write identical state.
    const updated: SheetInstance = {
      ...instance,
      revision: 2,
      state: {
        ...instance.state,
        presentation: {
          ...instance.state.presentation,
          sorts: [{ columnId: countId, direction: 'desc' }],
        },
      },
    }
    vi.mocked(updateSheetInstance).mockResolvedValueOnce(updated)
    renderWorkspace(<AdHocSheetWorkspace instance={instance} />)
    const settings = lastSettings()
    await act(async () => {
      settings.afterColumnSort([], [{ column: 0, sortOrder: 'desc' }])
    })
    expect(updateSheetInstance).toHaveBeenCalledWith(
      instance.id,
      instance.revision,
      expect.objectContaining({
        presentation: expect.objectContaining({
          sorts: [{ columnId: countId, direction: 'desc' }],
        }),
      }),
      expect.anything(),
    )
    const callsAfterFirst = vi.mocked(updateSheetInstance).mock.calls.length
    await act(async () => {
      settings.afterColumnSort([], [{ column: 0, sortOrder: 'desc' }])
    })
    expect(vi.mocked(updateSheetInstance).mock.calls).toHaveLength(
      callsAfterFirst,
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
        }),
      }),
      expect.anything(),
    )
    localStorage.removeItem(`sheetbase-sheet-view-v1:${viewed.id}`)
  })

  it('maps beforeChange columns through the visual→physical move map', async () => {
    const instance = presentationInstance()
    renderWorkspace(<AdHocSheetWorkspace instance={instance} />)
    // Visual column 0 currently shows the physical column 1 (Observed, date).
    act(() => {
      gridReady?.(fakeHot((visual) => (visual === 0 ? 1 : 0)))
    })
    const settings = lastSettings()
    act(() => {
      expect(settings.beforeChange([[0, 0, 100, 'not-a-date']], 'edit')).toBe(
        false,
      )
    })
    const statuses = screen
      .getAllByRole('status')
      .map((element) => element.textContent)
      .join(' ')
    // The rejection names the column the visual position actually resolves
    // to — not the neighbouring column the user sees in that slot.
    expect(statuses).toContain('invalid_value in Observed')
    expect(mutateSheetLocalState).not.toHaveBeenCalled()
  })
})
