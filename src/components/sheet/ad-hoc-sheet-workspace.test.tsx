import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { mutateSheetLocalState } from '#/lib/sheet-local-data'
import { validSheetInstanceState } from '#/lib/sheet-instance.test'
import type { SheetInstance } from '#/lib/sheet-instance-data'

import { AdHocSheetWorkspace } from './ad-hoc-sheet-workspace'

const gridRender = vi.hoisted(() => vi.fn())

vi.mock('#/lib/sheet-local-data', async (importOriginal) => ({
  ...(await importOriginal()),
  mutateSheetLocalState: vi.fn(),
}))

vi.mock('./sheetbase-grid', () => ({
  SheetbaseGrid: ({
    settings,
  }: {
    settings: {
      colHeaders?: string[]
      columns?: Array<{ readOnly?: boolean }>
    }
  }) => {
    gridRender(settings)
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
