import {
  columnHeader,
  gridCell,
  instanceWire,
  mountWorkspace,
  openColumnMenu,
  resetWorkspaceHttp,
  workspaceHttp,
} from './canonical-workspace-test-support'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { validSheetInstanceState } from '#/lib/sheet-instance.test'
import { sheetInstanceStateSchema } from '#/lib/sheet-instance'
import type { SheetInstance } from '#/lib/sheet-instance-data'
import { canonicalSheetGridMatrix } from '#/lib/canonical-sheet-grid'
import type {
  SheetbaseGridCellChange,
  SheetbaseGridCellValue,
} from './sheetbase-grid'
import { canonicalWorkspaceGridColumn } from './canonical-workspace-fields'
import { prepareCanonicalWorkspaceWrite } from './canonical-workspace-write-policy'

import { AdHocSheetWorkspace } from './ad-hoc-sheet-workspace'

beforeEach(() => resetWorkspaceHttp(instance()))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
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

/** One neutral change targeting a display column index. */
function cellChange(
  columnIndex: number,
  previous: SheetbaseGridCellValue,
  next: SheetbaseGridCellValue,
): SheetbaseGridCellChange[] {
  return [
    {
      rowIndex: 0,
      columnId: canonicalSheetGridMatrix({
        instance: typedInstance(),
        composition: null,
      }).columns[columnIndex].id,
      previous,
      next,
    },
  ]
}

describe('AdHocSheetWorkspace', () => {
  it('adds a local row without calling Dataset composition', async () => {
    const user = userEvent.setup()
    await mountWorkspace(<AdHocSheetWorkspace instance={instance()} />)
    expect(
      screen.getByRole('columnheader', { name: 'A Observation' }),
    ).toBeTruthy()
    expect(
      canonicalSheetGridMatrix({
        instance: instance(),
        composition: null,
      }).columns.map((column) =>
        canonicalWorkspaceGridColumn(column, true, () => ({})),
      ),
    ).toEqual([expect.objectContaining({ readOnly: false })])
    await user.click(screen.getByRole('button', { name: 'More sheet tools' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Add row' }))
    expect(workspaceHttp.local).toHaveBeenCalledWith(
      expect.objectContaining({
        p_instance_id: instance().id,
        p_expected_revision: 1,
        p_rows: [expect.objectContaining({ kind: 'local' })],
        p_cells: [expect.objectContaining({ value: null })],
      }),
    )
    expect(workspaceHttp.rpc).not.toHaveBeenCalledWith(
      'compose_sheet_instance',
      expect.anything(),
    )
  })

  it('keeps the same canonical grid keyboard surface in read-only mode', async () => {
    await mountWorkspace(<AdHocSheetWorkspace instance={instance()} readOnly />)

    expect(
      screen.getByRole('columnheader', { name: 'A Observation' }),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add row' })).toBeNull()
    await userEvent.click(
      screen.getByRole('button', { name: 'More sheet tools' }),
    )
    expect(screen.queryByRole('menuitem', { name: 'Add row' })).toBeNull()
    expect(screen.getByText('Read-only')).toBeTruthy()
    expect(
      canonicalSheetGridMatrix({
        instance: instance(),
        composition: null,
      }).columns.map((column) =>
        canonicalWorkspaceGridColumn(column, false, () => ({})),
      ),
    ).toEqual([expect.objectContaining({ readOnly: true })])
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
      presentation: { ...base.state.presentation, filters: [], sorts: [] },
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
  it('wires typed editors, vocabulary dropdowns and storage-unit headers', async () => {
    await mountWorkspace(<AdHocSheetWorkspace instance={typedInstance()} />)

    const columns = canonicalSheetGridMatrix({
      instance: typedInstance(),
      composition: null,
    }).columns.map((column) =>
      canonicalWorkspaceGridColumn(column, true, () => ({})),
    )

    expect(columns.map((column) => column.label)).toEqual([
      'Count',
      'Observed',
      'Recorded',
      'Status',
      'Flag',
      'Observation',
    ])
    expect(columns).toEqual([
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
    const decision = prepareCanonicalWorkspaceWrite({
      columns: canonicalSheetGridMatrix({
        instance: typedInstance(),
        composition: null,
      }).columns,
      changes: cellChange(0, 100, 'not-a-number'),
      source: 'edit',
    })

    expect(decision.result).toBe(false)
    expect(decision.status).toContain('Edit rejected: invalid_value in Count')
    expect(decision.status).toContain('kept its previous value')
    expect(workspaceHttp.local).not.toHaveBeenCalled()
  })

  it('coerces single edits to canonical values before the commit', () => {
    const changes = cellChange(0, 100, '1,200')
    expect(
      prepareCanonicalWorkspaceWrite({
        columns: canonicalSheetGridMatrix({
          instance: typedInstance(),
          composition: null,
        }).columns,
        changes,
        source: 'edit',
      }).result,
    ).toBeUndefined()
    expect(changes[0]?.next).toBe(1200)
  })

  it('keeps the GRID-02 wholesale rejection for bulk paste sources', () => {
    const decision = prepareCanonicalWorkspaceWrite({
      columns: canonicalSheetGridMatrix({
        instance: typedInstance(),
        composition: null,
      }).columns,
      changes: cellChange(0, 100, 'oops'),
      source: 'paste',
    })

    expect(decision.result).toBe(false)
    expect(decision.status).toContain('Paste rejected: invalid_value in Count')
    expect(workspaceHttp.local).not.toHaveBeenCalled()
  })
})

describe('CanonicalSheetEditor sort, filter, freeze & view ergonomics (GRID-04)', () => {
  const countId = countFieldId
  const observedId = '15000000-0000-4000-8000-000000000003'
  const recordedId = '15000000-0000-4000-8000-000000000004'

  beforeEach(() => {
    workspaceHttp.update.mockImplementation(async (args) =>
      instanceWire({
        ...typedInstance(),
        revision: 2,
        state: sheetInstanceStateSchema.parse(args.p_state),
      }),
    )
  })

  it('wires freeze, widths, sort restore and column-menu settings', async () => {
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

    await mountWorkspace(<AdHocSheetWorkspace instance={withView} />)
    expect(gridCell(0, 0).classList.contains('frozen-column')).toBe(true)
    expect(columnHeader(0).getAttribute('draggable')).toBe('true')
    expect(
      screen.getByRole('separator', { name: 'Resize column A' }),
    ).toBeTruthy()
    // Persisted sorts restore as presentation state.
    openColumnMenu(0)
    expect(
      screen
        .getByRole('button', { name: '↓ Desc' })
        .classList.contains('active'),
    ).toBe(true)
    expect(screen.getByRole('button', { name: '↓ Desc' })).toBeTruthy()
    expect(screen.getByLabelText('Filter condition')).toBeTruthy()
    // The column menu keeps the freeze/hide surface for the wrapper to render.
    expect(
      screen.getByRole('button', { name: 'Freeze up to this column' }),
    ).toBeTruthy()
    expect(
      screen.getAllByRole('button', { name: 'Unfreeze columns' }),
    ).toHaveLength(2)
    expect(
      screen.getByRole('button', { name: 'Hide selected columns' }),
    ).toBeTruthy()
    // Widths resolve through the persisted per-column map.
    expect(
      screen
        .getByRole('separator', { name: 'Resize column A' })
        .getAttribute('aria-valuenow'),
    ).toBe('220')
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

    await mountWorkspace(<AdHocSheetWorkspace instance={withHidden} />)
    // Display-only concealment: the hidden column is not rendered.
    expect(
      screen.getAllByRole('columnheader').map((column) => column.textContent),
    ).not.toContain(expect.stringContaining('Count (cells)'))
    await user.click(
      screen.getByRole('button', { name: 'Show 1 hidden column' }),
    )
    expect(workspaceHttp.update).toHaveBeenCalledWith(
      expect.objectContaining({
        p_instance_id: withHidden.id,
        p_expected_revision: withHidden.revision,
        p_state: expect.objectContaining({
          presentation: expect.objectContaining({ hiddenColumnIds: [] }),
        }),
      }),
    )
  })

  it('freezes and unfreezes columns through the working-view controls', async () => {
    const user = userEvent.setup()
    // Frozen state starts at zero: freeze controls only the leftmost columns.
    const cold = typedInstance()
    await mountWorkspace(<AdHocSheetWorkspace instance={cold} />)
    await user.click(screen.getByRole('button', { name: 'Columns' }))
    expect(
      screen
        .getByRole('button', { name: 'Freeze one fewer column' })
        .hasAttribute('disabled'),
    ).toBe(true)
    await user.click(
      screen.getByRole('button', { name: 'Freeze one more column' }),
    )
    expect(workspaceHttp.update).toHaveBeenCalledWith(
      expect.objectContaining({
        p_instance_id: cold.id,
        p_expected_revision: cold.revision,
        p_state: expect.objectContaining({
          presentation: expect.objectContaining({ frozenColumnCount: 1 }),
        }),
      }),
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
    await mountWorkspace(<AdHocSheetWorkspace instance={frozen} />)
    await user.click(screen.getByRole('button', { name: 'Columns' }))
    await user.click(
      screen.getByRole('button', { name: 'Freeze one fewer column' }),
    )
    expect(workspaceHttp.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        p_instance_id: frozen.id,
        p_expected_revision: frozen.revision,
        p_state: expect.objectContaining({
          presentation: expect.objectContaining({ frozenColumnCount: 1 }),
        }),
      }),
    )
  })

  it('persists a resized column width against the column id', async () => {
    const current = typedInstance()
    await mountWorkspace(<AdHocSheetWorkspace instance={current} />)
    const resizer = screen.getByRole('separator', { name: 'Resize column A' })
    const delta = 300.4 - Number(resizer.getAttribute('aria-valuenow'))
    fireEvent.pointerDown(resizer, { button: 0, clientX: 0 })
    fireEvent.pointerMove(window, { clientX: delta })
    fireEvent.pointerUp(window, { clientX: delta })
    expect(Number(resizer.getAttribute('aria-valuenow'))).toBeCloseTo(300.4)
    await waitFor(() =>
      expect(workspaceHttp.update).toHaveBeenCalledWith(
        expect.objectContaining({
          p_instance_id: current.id,
          p_expected_revision: current.revision,
          p_state: expect.objectContaining({
            presentation: expect.objectContaining({
              columnWidths: expect.objectContaining({ [countId]: 300 }),
            }),
          }),
        }),
      ),
    )
  })

  it('persists a manual column move as stable ids and resets the index map', async () => {
    const current = typedInstance()

    const view = await mountWorkspace(
      <AdHocSheetWorkspace instance={current} />,
    )

    openColumnMenu(0)
    fireEvent.click(screen.getByRole('button', { name: 'Move right' }))
    await waitFor(() =>
      expect(workspaceHttp.update).toHaveBeenCalledWith(
        expect.objectContaining({
          p_instance_id: current.id,
          p_expected_revision: current.revision,
          p_state: expect.objectContaining({
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
        }),
      ),
    )
    const saved = await workspaceHttp.update.mock.results[0].value

    const state = sheetInstanceStateSchema.parse(
      saved && 'state' in saved ? saved.state : null,
    )

    await view.rerender(
      <AdHocSheetWorkspace instance={{ ...current, revision: 2, state }} />,
    )
    // The wrapper resets its own visual index map once the caller persists.
    await waitFor(() =>
      expect(columnHeader(0).textContent).toContain('Observed'),
    )
    expect(columnHeader(1).textContent).toContain('Count')
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

    workspaceHttp.update.mockResolvedValueOnce(instanceWire(updated))
    await mountWorkspace(<AdHocSheetWorkspace instance={current} />)
    openColumnMenu(0)
    fireEvent.click(screen.getByRole('button', { name: '↓ Desc' }))
    await waitFor(() =>
      expect(workspaceHttp.update).toHaveBeenCalledWith(
        expect.objectContaining({
          p_instance_id: current.id,
          p_expected_revision: current.revision,
          p_state: expect.objectContaining({
            presentation: expect.objectContaining({
              sorts: [{ columnId: countId, direction: 'desc' }],
            }),
          }),
        }),
      ),
    )
    const callsAfterFirst = workspaceHttp.update.mock.calls.length
    // The parent hands the saved instance back down, as it does in the app.
    cleanup()
    await mountWorkspace(<AdHocSheetWorkspace instance={updated} />)
    openColumnMenu(0)
    fireEvent.click(screen.getByRole('button', { name: '↓ Desc' }))
    expect(workspaceHttp.update.mock.calls).toHaveLength(callsAfterFirst)
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

    const view = await mountWorkspace(
      <AdHocSheetWorkspace instance={current} />,
    )

    openColumnMenu(0)
    fireEvent.change(screen.getByLabelText('Filter condition'), {
      target: { value: 'eq' },
    })
    fireEvent.change(screen.getByLabelText('Filter value'), {
      target: { value: '1200' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(workspaceHttp.update).toHaveBeenCalled())
    await view.rerender(
      <AdHocSheetWorkspace
        instance={{
          ...current,
          revision: 2,
          state: {
            ...current.state,
            presentation: {
              ...current.state.presentation,
              filters: [{ columnId: countId, operator: 'equals', value: 1200 }],
            },
          },
        }}
      />,
    )
    openColumnMenu(3)
    fireEvent.change(screen.getByLabelText('Filter condition'), {
      target: { value: 'notNull' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() =>
      expect(workspaceHttp.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          p_instance_id: current.id,
          p_expected_revision: updated.revision,
          p_state: expect.objectContaining({
            presentation: expect.objectContaining({
              filters: [
                { columnId: countId, operator: 'equals', value: 1_200 },
                { columnId: statusFieldId, operator: 'is-not-empty' },
              ],
            }),
          }),
        }),
      ),
    )
    const callsAfterFirst = workspaceHttp.update.mock.calls.length
    // The parent hands the saved instance back down, as it does in the app.
    cleanup()
    await mountWorkspace(<AdHocSheetWorkspace instance={updated} />)
    openColumnMenu(0)
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(workspaceHttp.update.mock.calls).toHaveLength(callsAfterFirst)
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
    await mountWorkspace(<AdHocSheetWorkspace instance={viewed} />)
    await user.click(screen.getByRole('button', { name: 'Columns' }))
    await user.click(screen.getByRole('button', { name: 'Save view' }))
    cleanup()
    // A fresh editor with canonical presentation restores the saved view.
    await mountWorkspace(<AdHocSheetWorkspace instance={typedInstance()} />)
    await user.click(screen.getByRole('button', { name: 'Columns' }))
    await user.click(screen.getByRole('button', { name: 'Restore view' }))
    expect(workspaceHttp.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        p_instance_id: viewed.id,
        p_expected_revision: viewed.revision,
        p_state: expect.objectContaining({
          presentation: expect.objectContaining({
            frozenColumnCount: 1,
            columnWidths: expect.objectContaining({ [countId]: 260 }),
            filters: [{ columnId: countId, operator: 'equals', value: 260 }],
          }),
        }),
      }),
    )
    localStorage.removeItem(`sheetbase-sheet-view-v1:${viewed.id}`)
  })
})
