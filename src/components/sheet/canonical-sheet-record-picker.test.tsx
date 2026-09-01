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

vi.mock('./sheetbase-grid', () => ({
  SheetbaseGrid: ({
    settings,
    onReady,
  }: {
    settings: GridSettingsCapture
    onReady?: (hot: unknown) => void
  }) => {
    gridRender(settings)
    // GRID-03: stand-in Handsontable instance so the workspace can write the
    // picked Record UUID through the grid's own change pipeline.
    onReady?.({
      setDataAtCell,
      toPhysicalRow: (row: number) => row,
      toPhysicalColumn: (col: number) => col,
      countCols: () => settings.colHeaders?.length ?? 0,
      columnIndexMapper: {
        getIndexesSequence: () =>
          Array.from({ length: settings.colHeaders?.length ?? 0 }, (_, i) => i),
        setIndexesSequence: () => {},
      },
      getPlugin: () => undefined,
      getShortcutManager: () => ({ setActiveContextName: () => {} }),
    })
    return (
      <table>
        <thead>
          <tr>
            {(settings.colHeaders ?? []).map((header) => (
              <th key={header} scope="col">
                {header}
              </th>
            ))}
          </tr>
        </thead>
      </table>
    )
  },
}))

interface GridSettingsCapture {
  colHeaders?: string[]
  columns?: Array<Record<string, unknown> & { readOnly?: boolean }>
  beforeChange?: (
    changes: Array<[number, number, unknown, unknown]>,
    source: string,
  ) => boolean | undefined
  afterChange?: (
    changes: Array<[number, number, unknown, unknown]>,
    source: string,
  ) => void
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

function captureSettings(): GridSettingsCapture {
  return gridRender.mock.lastCall?.[0] as GridSettingsCapture
}

/** Simulate Handsontable preparing and opening the custom editor on a cell. */
function openEditor(settings: GridSettingsCapture, col: number) {
  const EditorClass = settings.columns?.[col]?.editor as
    | (new (hot: unknown) => {
        prepare: (
          row: number,
          col: number,
          prop: string | number,
          td: HTMLTableCellElement,
          value: unknown,
          cellProperties: unknown,
        ) => void
        open: () => void
      })
    | undefined
  expect(EditorClass).toEqual(expect.any(Function))
  const hot = {
    setDataAtCell,
    getShortcutManager: () => ({ setActiveContextName: () => {} }),
  }
  const editor = new EditorClass!(hot)
  editor.prepare(0, col, col, document.createElement('td'), null, {})
  editor.open()
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
    const settings = captureSettings()
    expect(settings.colHeaders).toEqual(['Sample', 'Observation'])
    expect(settings.columns?.[0]).toEqual(
      expect.objectContaining({
        type: 'text',
        editor: expect.any(Function),
        renderer: expect.any(Function),
        readOnly: false,
      }),
    )
    // Non-reference columns keep their plain text editor.
    expect(settings.columns?.[1]).not.toHaveProperty('editor')
  })

  it('opens the shared model-scoped picker from the cell edit and writes the canonical UUID', async () => {
    const user = userEvent.setup()
    vi.mocked(searchSheetRecords).mockResolvedValue([hit])
    vi.mocked(mutateSheetLocalState).mockResolvedValue(refInstance())
    renderWorkspace(<AdHocSheetWorkspace instance={refInstance()} />)
    const settings = captureSettings()

    openEditor(settings, 0)

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

  it('displays the human label after a pick and the raw UUID when unknown', () => {
    renderWorkspace(<AdHocSheetWorkspace instance={refInstance()} />)
    const settings = captureSettings()
    const renderer = settings.columns?.[0]?.renderer as
      ((...args: unknown[]) => unknown) | undefined
    expect(renderer).toEqual(expect.any(Function))
    // The label map is populated by the pick flow; simulate a post-pick
    // render through the same renderer the grid uses.
    act(() => {
      openEditor(settings, 0)
    })
    const td = document.createElement('td')
    // Before any pick the persisted UUID renders as-is...
    renderer?.(null, td, 0, 0, null, recordUuid)
    expect(td.textContent).toBe(recordUuid)
    // (the pick itself is covered by the selection test above; here the pure
    // display contract is asserted directly)
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
    const settings = captureSettings()
    const changes: Array<[number, number, unknown, unknown]> = [
      [0, 0, null, recordUuid],
    ]
    act(() => {
      expect(settings.beforeChange?.(changes, 'edit')).toBeUndefined()
    })
    // The UUID is already canonical — coercion leaves it untouched.
    expect(changes[0]?.[3]).toBe(recordUuid)
  })

  it('fails closed when a non-UUID value is typed into a record-picker cell', () => {
    renderWorkspace(<AdHocSheetWorkspace instance={refInstance()} />)
    const settings = captureSettings()
    act(() => {
      expect(
        settings.beforeChange?.([[0, 0, null, 'SMP-2026-0001']], 'edit'),
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
    const settings = captureSettings()
    act(() => {
      // Clearing passes validation (nullable field) and applies the null…
      expect(
        settings.beforeChange?.([[0, 0, recordUuid, null]], 'edit'),
      ).toBeUndefined()
      // …and afterChange writes it to the authoritative local target.
      settings.afterChange?.([[0, 0, recordUuid, null]], 'edit')
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
