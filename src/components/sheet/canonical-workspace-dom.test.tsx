import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { parseSheetInstanceState } from '#/lib/sheet-instance'
import type {
  SheetInstance,
  SheetInstanceWire,
} from '#/lib/sheet-instance-data'
import { dropSharedReads } from '#/lib/data-client'
import { pipelineJsonObjectSchema } from '#/lib/pipelines/types'
import { AdHocSheetWorkspace } from './ad-hoc-sheet-workspace'
import { renderSheetRoute } from './sheet-test-router'

const transport = vi.hoisted(() => {
  const fetch = vi.fn<typeof globalThis.fetch>()
  vi.stubGlobal('fetch', fetch)

  return fetch
})

const FIELD = '10000000-0000-4000-8000-000000000004'
const ROW = '10000000-0000-4000-8000-000000000005'

function numericInstance(): SheetInstance {
  const state = parseSheetInstanceState({
    bindings: [],
    localFields: [
      {
        fieldId: FIELD,
        key: 'count',
        label: 'Count',
        description: null,
        logicalType: 'integer',
        nullable: true,
        defaultValue: null,
        cardinality: 'one',
        quantity: null,
        validation: {},
        category: null,
        relationship: null,
        computation: { mode: 'stored' },
        lifecycle: 'active',
      },
    ],
    localValues: { [ROW]: { [FIELD]: 100 } },
    calculationOverrides: {},
    presentation: {
      columnOrder: [],
      hiddenColumnIds: [],
      columnWidths: { [FIELD]: 180 },
      frozenColumnCount: 0,
      density: 'standard',
      filters: [],
      sorts: [],
    },
    provenance: { createdFrom: 'ad_hoc' },
  })

  return {
    id: '20000000-0000-4000-8000-000000000001',
    workspaceId: '20000000-0000-4000-8000-000000000002',
    projectId: '20000000-0000-4000-8000-000000000003',
    notebookRecordId: null,
    sourceDefinitionVersionId: null,
    name: 'Notebook sheet',
    description: null,
    lifecycle: 'active',
    revision: 1,
    state,
    duplicatedFromInstanceId: null,
    createdAt: '2026-08-16T12:00:00.000Z',
    updatedAt: '2026-08-16T12:00:00.000Z',
    createdByUserId: 'u1',
    updatedByUserId: 'u1',
  }
}

function wire(instance: SheetInstance): SheetInstanceWire {
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

const writes: z.infer<typeof pipelineJsonObjectSchema>[] = []

beforeEach(() => {
  dropSharedReads()
  writes.length = 0
  transport.mockReset()
  transport.mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : input.toString()

    if (url.includes('/rpc/mutate_sheet_instance_local_state')) {
      const body = pipelineJsonObjectSchema.parse(
        JSON.parse(z.string().parse(init?.body)),
      )

      writes.push(body)

      return Response.json(wire(numericInstance()))
    }

    if (url.includes('/rpc/read_sheet_instance_calculation_results')) {
      return Response.json({
        instanceId: numericInstance().id,
        revision: 1,
        results: [],
      })
    }

    return Response.json([])
  })
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1200)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(0, 0, 1200, 800),
  )
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function liveNumericGrid() {
  await renderSheetRoute(<AdHocSheetWorkspace instance={numericInstance()} />)
  const grid = await screen.findByRole('grid')

  const cell = await waitFor(() => {
    const node = grid.querySelector<HTMLElement>(
      '[role="gridcell"][aria-rowindex="1"][aria-colindex="1"]',
    )

    if (!node) throw new Error('Missing first cell')

    return node
  })

  fireEvent.pointerDown(cell, { button: 0 })

  return { grid, cell }
}

describe('Canonical workspace with the real grid and HTTP DataClient', () => {
  it('preserves raw grouped numeric clipboard input until canonical coercion', async () => {
    const { grid } = await liveNumericGrid()
    fireEvent.paste(grid, {
      clipboardData: { getData: () => '1,200' },
    })

    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]).toMatchObject({
      p_expected_revision: 1,
      p_cells: [{ rowKey: ROW, fieldId: FIELD, value: 1200 }],
    })
  })

  it('refuses invalid numeric clipboard input without losing the previous value', async () => {
    const { grid, cell } = await liveNumericGrid()
    fireEvent.paste(grid, {
      clipboardData: { getData: () => 'not-a-number' },
    })

    expect(
      screen
        .getAllByRole('status')
        .map((node) => node.textContent)
        .join(' '),
    ).toContain('Paste rejected: invalid_value in Count')
    expect(cell.textContent).toContain('100')
    expect(writes).toHaveLength(0)
  })

  it('stops invalid typed numbers in the package before the workspace edit gate', async () => {
    const { grid, cell } = await liveNumericGrid()
    fireEvent.keyDown(grid, { key: 'x' })
    const editor = screen.getByRole('spinbutton', { name: 'Edit A1' })
    fireEvent.keyDown(editor, { key: 'Enter' })

    // Spreadsheet validates typed numeric input before beforeCellsChange.
    // The raw paste path above, unlike this path, reaches canonical validation.
    expect(editor.getAttribute('aria-invalid')).toBe('true')
    expect(
      screen
        .getAllByRole('status')
        .map((node) => node.textContent)
        .join(' '),
    ).not.toContain('Edit rejected: invalid_value in Count')
    expect(cell.textContent).toContain('100')
    expect(writes).toHaveLength(0)
  })
})
