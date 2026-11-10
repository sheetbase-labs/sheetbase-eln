import { useState } from 'react'
import type { ReactNode } from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import {
  scientificQueryKeys,
  scientificTableSchema,
} from '#/lib/scientific-sheet-data'
import type { FormulaDefinitionWire } from '#/lib/scientific-sheet-data'
import type { WorkbookCellAddress } from '#/lib/scientific-workbook'
import { useScientificEditCoordinator } from './scientific-sheet-edit-coordinator'
import type { ScientificDraftCell } from './scientific-sheet-edit-coordinator'

// The canonical singleton captures its transport when its module loads.
const fetcher = vi.hoisted(() => {
  const transport = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', transport)

  return transport
})

const table = scientificTableSchema.parse({
  id: '10000000-0000-4000-8000-000000000001',
  name: 'Results',
  resource_name: 'sheet_results',
  schema_version: 1,
  lifecycle: 'active',
  columns: [
    {
      id: '10000000-0000-4000-8000-000000000002',
      field_name: 'result',
      label: 'Result',
      display_order: 1,
      logical_type: 'text',
      nullable: true,
      unit: null,
      validation: {},
      width: 120,
      options: [],
    },
  ],
})

const target = {
  tableId: table.id,
  rowId: 'prov:1',
  columnId: table.columns[0].id,
}

const draft: ScientificDraftCell = {
  rowIndex: 0,
  rowId: target.rowId,
  columnId: target.columnId,
  fieldName: 'result',
  raw: 'new',
  generation: 1,
}

const formulaByCell = new Map<string, FormulaDefinitionWire>()
const onCalculate = vi.fn(async (_reconcile: boolean) => {})
const setIssues = vi.fn()
const setSaveStatus = vi.fn()

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  client.setQueryData(scientificQueryKeys.allRows(table.id), [
    { id: target.rowId, version: 0 },
  ])

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }

  return renderHook(
    ({ readOnly, calculate }) => {
      const [selected, setSelected] = useState<WorkbookCellAddress | null>(
        target,
      )

      const [drafts, setDrafts] = useState<Record<string, ScientificDraftCell>>(
        { [`${target.rowId}:${target.columnId}`]: draft },
      )

      const edits = useScientificEditCoordinator({
        tableId: table.id,
        table,
        readOnly,
        formulaByCell,
        workbook: null,
        onCalculate: calculate,
        setSelected,
        setDrafts,
        setIssues,
        setSaveStatus,
      })

      return { ...edits, selected, drafts, setDrafts }
    },
    {
      wrapper: Wrapper,
      initialProps: { readOnly: false, calculate: onCalculate },
    },
  )
}

it('keeps coordinator identity while callbacks read the latest committed authority', async () => {
  const hook = setup()
  const original = hook.result.current.coordinator
  const calculate = vi.fn(async (_reconcile: boolean) => {})
  hook.rerender({ readOnly: true, calculate })
  expect(hook.result.current.coordinator).toBe(original)
  await act(async () => {
    original.enqueue([draft])
    await original.flush()
    await hook.result.current.recalculate(false)
  })
  expect(fetcher).not.toHaveBeenCalled()
  expect(calculate).toHaveBeenCalledWith(false)
  expect(onCalculate).not.toHaveBeenCalled()
})

it.each([1, 2])(
  'migrates provisional identities and clears only matching draft generation %s',
  async (generation) => {
    const realId = '10000000-0000-4000-8000-000000000003'
    const hook = setup()
    fetcher.mockImplementation(async () => {
      // A newer edit may arrive while the insert is in flight.
      hook.result.current.setDrafts({
        [`${target.rowId}:${target.columnId}`]: { ...draft, generation },
      })

      return Response.json({
        ok: true,
        schemaVersion: 1,
        rows: [{ id: realId, version: 1, result: 'new' }],
      })
    })
    await act(async () => {
      hook.result.current.coordinator.registerProvisionalRow(target.rowId)
      hook.result.current.coordinator.enqueue([draft])
      await hook.result.current.coordinator.flush()
    })
    expect(hook.result.current.selected?.rowId).toBe(realId)
    expect(hook.result.current.drafts).toEqual(
      generation === 1
        ? {}
        : {
            [`${realId}:${target.columnId}`]: {
              ...draft,
              rowId: realId,
              generation,
            },
          },
    )
  },
)
