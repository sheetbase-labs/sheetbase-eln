import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { dropSharedReads } from '#/lib/data-client'
import { sheetLocalCellSchema } from '#/lib/sheet-local-data'
import type { SheetRecordSearchHit } from '#/lib/sheet-record-search'
import { validSheetInstanceState } from '#/lib/sheet-instance.test'
import { sheetInstanceStateSchema } from '#/lib/sheet-instance'
import type {
  SheetInstance,
  SheetInstanceWire,
} from '#/lib/sheet-instance-data'
import { AdHocSheetWorkspace } from './ad-hoc-sheet-workspace'
import { recordCellDisplayText } from './canonical-workspace-fields'
import { renderSheetRoute } from './sheet-test-router'

// DataClients created during module evaluation retain the same typed dispatcher.
const transport = vi.hoisted(() => {
  const dispatch = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', dispatch)

  return dispatch
})

const mutationRequestSchema = z.object({
  p_instance_id: z.string(),
  p_expected_revision: z.number(),
  p_cells: z.array(sheetLocalCellSchema),
})

const mutations: Array<z.infer<typeof mutationRequestSchema>> = []
const refFieldId = '15000000-0000-4000-8000-000000000001'
const textFieldId = validSheetInstanceState().localFields[0].fieldId
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

function refInstance(value: string | null = null): SheetInstance {
  const state = validSheetInstanceState()
  const observation = state.localFields[0]

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
    duplicatedFromInstanceId: null,
    createdAt: '2026-08-16T12:00:00.000Z',
    updatedAt: '2026-08-16T12:00:00.000Z',
    createdByUserId: 'u1',
    updatedByUserId: 'u1',
    state: {
      ...state,
      localFields: [
        {
          ...observation,
          fieldId: refFieldId,
          key: 'sample_ref',
          label: 'Sample',
          logicalType: 'reference',
          relationship: {
            target: { kind: 'model', modelKey: 'sample' },
            cardinality: 'one',
          },
        },
        observation,
      ],
      localValues: { [rowId]: { [refFieldId]: value, [textFieldId]: 'note' } },
      presentation: { ...state.presentation, filters: [], sorts: [] },
    },
  }
}

function instanceWire(instance: SheetInstance): SheetInstanceWire {
  return {
    id: instance.id,
    workspace_id: instance.workspaceId,
    project_id: instance.projectId,
    notebook_record_id: instance.notebookRecordId,
    source_definition_version_id: instance.sourceDefinitionVersionId,
    name: instance.name,
    description: instance.description,
    lifecycle: instance.lifecycle,
    revision: instance.revision,
    state: instance.state,
    duplicated_from_instance_id: instance.duplicatedFromInstanceId,
    created_at: instance.createdAt,
    updated_at: instance.updatedAt,
    created_by_user_id: instance.createdByUserId,
    updated_by_user_id: instance.updatedByUserId,
  }
}

beforeEach(() => {
  dropSharedReads()
  vi.stubGlobal('fetch', transport)
  mutations.length = 0
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1200)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(2400)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(2400)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(0, 0, 1200, 2400),
  )
  transport.mockImplementation(async (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : input.toString(),
      'http://localhost',
    )

    if (url.pathname.endsWith('/rpc/search_sheet_records'))
      return Response.json([hit])

    if (url.pathname.endsWith('/rpc/read_sheet_instance_calculation_results'))
      return Response.json({
        instanceId: refInstance().id,
        revision: 1,
        results: [],
      })

    if (url.pathname.endsWith('/rpc/mutate_sheet_instance_local_state')) {
      const args = mutationRequestSchema.parse(
        await new Response(init?.body).json(),
      )

      mutations.push(args)
      const instance = refInstance()

      const state = sheetInstanceStateSchema.parse({
        ...instance.state,
        localValues: {
          [rowId]: {
            ...instance.state.localValues[rowId],
            ...Object.fromEntries(
              args.p_cells.map((change) => [change.fieldId, change.value]),
            ),
          },
        },
      })

      return Response.json(instanceWire({ ...instance, state, revision: 2 }))
    }

    if (url.pathname.includes('/rpc/'))
      throw new Error(`Unexpected RPC: ${url.pathname}`)

    return Response.json([])
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  transport.mockClear()
})

async function renderWorkspace(value: string | null = null) {
  await renderSheetRoute(<AdHocSheetWorkspace instance={refInstance(value)} />)
  await screen.findByRole('grid')
  await screen.findByRole('columnheader', { name: /Sample/ })
}

function cell(column = 1) {
  const node = screen
    .getAllByRole('gridcell')
    .find(
      (element) =>
        element.getAttribute('aria-rowindex') === '1' &&
        element.getAttribute('aria-colindex') === String(column),
    )

  if (!node) throw new Error(`Missing row 1, column ${column}`)

  return node
}

function pasteRecord(text: string) {
  fireEvent.pointerDown(cell(), { button: 0, pointerId: 1 })
  fireEvent.paste(screen.getByRole('grid'), {
    clipboardData: {
      getData: (type: string) => (type === 'text/plain' ? text : ''),
    },
  })
}

describe('GRID-03 canonical Record picker editor', () => {
  it('wires the Record picker editor and display renderer for record-picker columns', async () => {
    await renderWorkspace()
    expect(
      screen
        .getAllByRole('columnheader')
        .map((column) => column.getAttribute('aria-label')),
    ).toEqual(['A Sample', 'B Observation'])
    expect(cell(2).textContent).toBe('note')
    expect(cell().classList.contains('read-only')).toBe(false)
    fireEvent.doubleClick(cell())
    expect(
      await screen.findByRole('combobox', {
        name: /Search sample records by ID or name/,
      }),
    ).toBeTruthy()
    expect(mutations).toEqual([])
  })

  it('writes the picked Record through the backend editor handle', async () => {
    const user = userEvent.setup()
    await renderWorkspace()
    fireEvent.doubleClick(cell())

    const combobox = await screen.findByRole('combobox', {
      name: /Search sample records by ID or name/,
    })

    await screen.findByRole('option', { name: /LV harvest/ })
    combobox.focus()
    await user.keyboard('{Enter}')
    await waitFor(() =>
      expect(mutations).toEqual([
        expect.objectContaining({
          p_instance_id: refInstance().id,
          p_cells: [
            expect.objectContaining({ fieldId: refFieldId, value: recordUuid }),
          ],
        }),
      ]),
    )
    expect(
      screen.queryByRole('combobox', { name: /Search sample records/ }),
    ).toBeNull()
    expect(cell().textContent).toBe('SMP-2026-0001 · LV harvest')
  })

  it('displays the human label after a pick and the raw UUID when unknown', async () => {
    await renderWorkspace(recordUuid)
    expect(cell().textContent).toBe(recordUuid)
    expect(
      recordCellDisplayText(
        { [recordUuid]: { identifier: 'SMP-2026-0001', title: 'LV harvest' } },
        recordUuid,
      ),
    ).toBe('SMP-2026-0001 · LV harvest')
    expect(recordCellDisplayText({}, recordUuid)).toBe(recordUuid)
    expect(recordCellDisplayText({}, null)).toBe('')
  })

  it('accepts a canonical UUID edit through the validation pipeline', async () => {
    await renderWorkspace()
    pasteRecord(recordUuid)
    await waitFor(() =>
      expect(mutations).toEqual([
        expect.objectContaining({
          p_cells: [
            expect.objectContaining({ fieldId: refFieldId, value: recordUuid }),
          ],
        }),
      ]),
    )
    expect(cell().textContent).toBe(recordUuid)
  })

  it('fails closed when a non-UUID value is pasted into a record-picker cell', async () => {
    await renderWorkspace()
    pasteRecord('SMP-2026-0001')

    const statuses = screen
      .getAllByRole('status')
      .map((element) => element.textContent)
      .join(' ')

    expect(statuses).toContain('Paste rejected: invalid_value in Sample')
    expect(statuses).toContain('kept its previous value')
    expect(cell().textContent).toBe('')
    expect(mutations).toEqual([])
  })

  it('clears the cell to a canonical null through the edit pipeline', async () => {
    await renderWorkspace(recordUuid)
    fireEvent.pointerDown(cell(), { button: 0, pointerId: 1 })
    fireEvent.keyDown(screen.getByRole('grid'), { key: 'Delete' })
    await waitFor(() =>
      expect(mutations).toEqual([
        expect.objectContaining({
          p_instance_id: refInstance().id,
          p_cells: [
            expect.objectContaining({ fieldId: refFieldId, value: null }),
          ],
        }),
      ]),
    )
    expect(cell().textContent).toBe('')
  })
})
