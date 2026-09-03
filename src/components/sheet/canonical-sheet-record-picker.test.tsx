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

import type { SheetInstancePagedAdapter } from '#/lib/sheetbase-table/sheet-instance-paged-adapter'
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

const gridProps = vi.hoisted(() => ({ current: null as null | GridPropsCapture }))

interface GridPropsCapture {
  adapter: SheetInstancePagedAdapter
  datasetId: string
  datasetHeader: {
    datasetId: string
    fields: Array<{ id: string; label: string; writable: boolean }>
  }
  query: DatasetQuery
  renderCell(context: SpreadsheetCellRenderContext): ReactNode | undefined
  customEditors: readonly SpreadsheetCustomEditor[]
}

vi.mock('#/lib/sheet-local-data', async (importOriginal) => ({
  ...(await importOriginal()),
  mutateSheetLocalState: vi.fn(),
}))

vi.mock('#/lib/sheet-record-search', async (importOriginal) => ({
  ...(await importOriginal()),
  searchSheetRecords: vi.fn(),
}))

/**
 * The engine grid is replaced with a props recorder: cell edits are driven
 * through the workspace's paged adapter and the GRID-03 editor/display seams
 * (`customEditors`, `renderCell`) are exercised directly, exactly as the
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

function gridPropsCapture(): GridPropsCapture {
  const props = gridProps.current
  if (!props) throw new Error('the engine grid props were not captured')
  return props
}

/** The relationship-field custom editor the workspace hands the engine. */
function recordPickerEditor(): SpreadsheetCustomEditor {
  const editor = gridPropsCapture().customEditors.at(0)
  if (!editor) throw new Error('the record picker custom editor was not wired')
  return editor
}

function cellContext(
  column: number,
  display: string,
): SpreadsheetCellRenderContext {
  return {
    address: 'A1',
    point: { row: 0, column },
    display,
    selected: false,
    active: false,
    loading: false,
  }
}

/**
 * Mount the workspace's custom-editor surface inside the test tree and open
 * the shared picker, exactly as the engine would when the user edits a
 * record-picker cell.
 */
async function openPickerFromCellEditor(
  user: ReturnType<typeof userEvent.setup>,
) {
  render(
    <div>
      {recordPickerEditor().render({
        point: { row: 0, column: 0 },
        address: 'A1',
        initialDraft: '',
        commit: () => {},
        cancel: () => {},
      })}
    </div>,
  )
  await user.click(screen.getByRole('button', { name: 'Choose a record…' }))
}

beforeEach(() => {
  vi.mocked(searchSheetRecords).mockReset()
  vi.mocked(mutateSheetLocalState).mockReset()
  gridProps.current = null
})

afterEach(cleanup)

describe('GRID-03 canonical Record picker editor', () => {
  it('wires the Record picker editor and display renderer for record-picker columns', () => {
    renderWorkspace(<AdHocSheetWorkspace instance={refInstance()} />)
    const props = gridPropsCapture()
    expect(props.datasetHeader.fields.map((field) => field.label)).toEqual([
      'Sample',
      'Observation',
    ])
    // The record-picker column stays writable and edits through the
    // relationship custom editor…
    expect(props.datasetHeader.fields[0]).toEqual(
      expect.objectContaining({ id: refFieldId, writable: true }),
    )
    const editor = recordPickerEditor()
    expect(
      editor.matches({
        point: { row: 0, column: 0 },
        field: {
          id: refFieldId,
          label: 'Sample',
          column: 0,
          dataType: 'relationship',
        },
      }),
    ).toBe(true)
    // …while plain text fields keep the engine's built-in editor.
    expect(
      editor.matches({
        point: { row: 0, column: 1 },
        field: {
          id: textFieldId,
          label: 'Observation',
          column: 1,
          dataType: 'text',
        },
      }),
    ).toBe(false)
    // The display-renderer seam is wired: unknown values resolve through it.
    expect(props.renderCell(cellContext(0, recordUuid))).toBe(recordUuid)
  })

  it('opens the shared model-scoped picker from the cell edit and writes the canonical UUID', async () => {
    const user = userEvent.setup()
    vi.mocked(searchSheetRecords).mockResolvedValue([hit])
    vi.mocked(mutateSheetLocalState).mockResolvedValue(refInstance())
    renderWorkspace(<AdHocSheetWorkspace instance={refInstance()} />)

    await openPickerFromCellEditor(user)

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

    // Selection persists the canonical Record UUID through the cell's
    // authoritative write path — the local-state mutation for a local column.
    await vi.waitFor(() => {
      expect(mutateSheetLocalState).toHaveBeenCalledWith(
        expect.objectContaining({
          instanceId: refInstance().id,
          cells: [
            expect.objectContaining({ fieldId: refFieldId, value: recordUuid }),
          ],
        }),
        expect.anything(),
      )
    })
  })

  it('displays the human label after a pick and the raw UUID when unknown', async () => {
    const user = userEvent.setup()
    vi.mocked(searchSheetRecords).mockResolvedValue([hit])
    vi.mocked(mutateSheetLocalState).mockResolvedValue(refInstance())
    renderWorkspace(<AdHocSheetWorkspace instance={refInstance()} />)
    // Before any pick the persisted UUID renders as-is…
    expect(gridPropsCapture().renderCell(cellContext(0, recordUuid))).toBe(
      recordUuid,
    )

    // …then the pick flow records the human label for the display renderer.
    await openPickerFromCellEditor(user)
    expect(await screen.findByRole('combobox')).toBeTruthy()
    const combobox = screen.getByRole('combobox')
    act(() => {
      combobox.focus()
    })
    await user.keyboard('{Enter}')
    await vi.waitFor(() => expect(mutateSheetLocalState).toHaveBeenCalled())

    const renderCell = gridPropsCapture().renderCell
    expect(renderCell(cellContext(0, recordUuid))).toBe(
      'SMP-2026-0001 · LV harvest',
    )
    // An unknown UUID never invents identity the server did not confirm.
    expect(
      renderCell(
        cellContext(0, '50000000-0000-4000-8000-000000000099'),
      ),
    ).toBe('50000000-0000-4000-8000-000000000099')
    expect(recordCellDisplayText({}, null)).toBe('')
  })

  it('accepts a canonical UUID edit through the validation pipeline', async () => {
    vi.mocked(mutateSheetLocalState).mockResolvedValue(refInstance())
    renderWorkspace(<AdHocSheetWorkspace instance={refInstance()} />)
    const adapter = gridPropsCapture().adapter
    let rejected: readonly unknown[] = []
    await act(async () => {
      const result = await adapter.commit([
        {
          datasetId: adapter.datasetId,
          recordId: rowId,
          fieldId: refFieldId,
          after: recordUuid,
        },
      ])
      rejected = result.rejected
    })
    // The UUID is already canonical — coercion leaves it untouched.
    expect(rejected).toEqual([])
    await vi.waitFor(() => {
      expect(mutateSheetLocalState).toHaveBeenCalledWith(
        expect.objectContaining({
          instanceId: refInstance().id,
          cells: [
            expect.objectContaining({ fieldId: refFieldId, value: recordUuid }),
          ],
        }),
        expect.anything(),
      )
    })
  })

  it('fails closed when a non-UUID value is typed into a record-picker cell', async () => {
    renderWorkspace(<AdHocSheetWorkspace instance={refInstance()} />)
    const adapter = gridPropsCapture().adapter
    let result: Awaited<ReturnType<typeof adapter.commit>> | null = null
    await act(async () => {
      result = await adapter.commit([
        {
          datasetId: adapter.datasetId,
          recordId: rowId,
          fieldId: refFieldId,
          after: 'SMP-2026-0001',
        },
      ])
    })
    // The display identifier is not the canonical UUID: the write is
    // rejected fail-closed and nothing reaches the authoritative target.
    expect(result!.accepted).toEqual([])
    expect(result!.rejected).toEqual([
      expect.objectContaining({ reason: 'invalid_value' }),
    ])
    expect(mutateSheetLocalState).not.toHaveBeenCalled()
  })

  it('clears the cell to a canonical null through the edit pipeline', async () => {
    vi.mocked(mutateSheetLocalState).mockResolvedValue(refInstance())
    renderWorkspace(<AdHocSheetWorkspace instance={refInstance()} />)
    const adapter = gridPropsCapture().adapter
    let rejected: readonly unknown[] = []
    await act(async () => {
      // Clearing passes validation (nullable field) and commits the null…
      const result = await adapter.commit([
        {
          datasetId: adapter.datasetId,
          recordId: rowId,
          fieldId: refFieldId,
          after: '',
        },
      ])
      rejected = result.rejected
    })
    expect(rejected).toEqual([])
    // …onto the authoritative local target.
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
