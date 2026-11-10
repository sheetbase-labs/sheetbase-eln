/**
 * SHEET-02.3 — the Promote wiring in the canonical Sheet. Promotion leaves the
 * Sheet, so the column menu may offer it only for a column the Sheet owns (an
 * active local field) and the dialog is opened from that entry rather than by
 * a control of its own. This exercises the wiring end to end: the workspace's
 * real column-menu entries, the package's own "hide a disabled entry" filter
 * and the two promotion surfaces — the request dialog and the returned banner —
 * mounted against a recording data client.
 */
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { validSheetDefinitionConfiguration } from '../../../tests/fixtures/sheet-definition'
import { createDataClient, dropSharedReads } from '#/lib/data-client'
import { fetchComposedSheetRows } from '#/lib/sheet-composition-data'
import type { SheetInstance } from '#/lib/sheet-instance-data'
import { validSheetInstanceState } from '#/lib/sheet-instance.test'
import type { ColumnPromotion } from '#/lib/schema-evolution'

import { CanonicalSheetEditor } from './canonical-sheet-workspace'
import { renderSheetRoute } from './sheet-test-router'

// Module-level DataClients capture this dispatcher; each test installs its HTTP handler.
const transport = vi.hoisted(() => {
  const dispatch = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', dispatch)

  return dispatch
})

const listRequests = vi.fn<(resource: string, query: string) => void>()

/** Mutable so a test can state what `column_promotions` holds. */
let promotionRows: ColumnPromotion[] = []

const INSTANCE = '21000000-0000-4000-8000-000000000001'
const DEFINITION_VERSION = '21000000-0000-4000-8000-000000000002'
const DATASET_A = '21000000-0000-4000-8000-000000000003'
const DATASET_B = '21000000-0000-4000-8000-000000000004'
const ROW_A = '21000000-0000-4000-8000-000000000005'
const ROW_B = '21000000-0000-4000-8000-000000000006'
const RECORD = '21000000-0000-4000-8000-000000000007'
const PROJECT = '21000000-0000-4000-8000-000000000009'
const WORKSPACE = '21000000-0000-4000-8000-00000000000a'

/** The Sheet's own stored column. */
const LOCAL_FIELD = validSheetInstanceState().localFields[0].fieldId

/** A derived column the Sheet also owns — but cannot give away. */
const CALCULATED_FIELD = '21000000-0000-4000-8000-00000000000b'

/** A bound column, from the same Definition the composition uses. */
const BOUND_FIELD = validSheetDefinitionConfiguration().columns[0].id

const DEFINITION = {
  id: '21000000-0000-4000-8000-00000000000c',
  key: 'ds-0311',
  name: 'DS-0311 Clarification',
  description: null,
  lifecycle: 'published',
  display_id: 'DS-0311',
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
  created_by_user_id: null,
}

/**
 * One composition window covering both of the fixture Definition's bound
 * columns; the local and calculated columns come from the Instance state.
 */
function composedWire() {
  const configuration = validSheetDefinitionConfiguration()
  const [columnA, columnB] = configuration.columns

  if (columnA.source.kind !== 'bound' || columnB.source.kind !== 'bound') {
    throw new Error('invalid test fixture')
  }

  return {
    instanceId: INSTANCE,
    definitionVersionId: DEFINITION_VERSION,
    definitionConfiguration: configuration,
    revision: 6,
    offset: 0,
    limit: 50,
    hasMore: false,
    localFieldIds: [],
    identity: {
      kind: 'source',
      columnIds: [columnA.id],
      logicalTypes: ['reference'],
    },
    rows: [
      {
        identityValues: [RECORD],
        sources: [
          {
            sourceKind: 'dataset',
            bindingId: columnA.source.bindingId,
            datasetId: DATASET_A,
            datasetRevision: 9,
            rowId: ROW_A,
            revision: 4,
            matched: true,
            values: { [columnA.source.sourceFieldId]: RECORD },
          },
          {
            sourceKind: 'dataset',
            bindingId: columnB.source.bindingId,
            datasetId: DATASET_B,
            datasetRevision: 8,
            rowId: ROW_B,
            revision: 7,
            matched: true,
            values: { [columnB.source.sourceFieldId]: 'b-value' },
          },
        ],
      },
    ],
  }
}

beforeEach(() => {
  dropSharedReads()
  vi.stubGlobal('fetch', transport)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1200)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(2400)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(2400)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(0, 0, 1200, 2400),
  )
  transport.mockImplementation(async (input) => {
    const url = new URL(
      input instanceof Request ? input.url : input.toString(),
      'http://localhost',
    )

    if (url.pathname.endsWith('/rpc/query_sheet_instance_rows'))
      return Response.json(composedWire())

    if (url.pathname.endsWith('/rpc/read_sheet_instance_calculation_results'))
      return Response.json({ instanceId: INSTANCE, revision: 1, results: [] })

    if (url.pathname.includes('/rpc/'))
      throw new Error(`Unexpected RPC: ${url.pathname}`)
    const resource = url.pathname.split('/').at(-1) ?? ''
    listRequests(resource, url.search)

    if (resource === 'dataset_schema_definitions')
      return Response.json([DEFINITION])

    if (resource === 'column_promotions') return Response.json(promotionRows)

    return Response.json([])
  })
})

async function composedInstance(): Promise<SheetInstance> {
  const base = validSheetInstanceState()
  const stored = base.localFields[0]

  const snapshot = await fetchComposedSheetRows(
    INSTANCE,
    {},
    createDataClient(transport),
  )

  return {
    id: INSTANCE,
    workspaceId: WORKSPACE,
    projectId: PROJECT,
    notebookRecordId: '21000000-0000-4000-8000-00000000000d',
    sourceDefinitionVersionId: DEFINITION_VERSION,
    name: 'Composed assay sheet',
    description: null,
    lifecycle: 'active',
    revision: 1,
    state: {
      ...base,
      localFields: [
        stored,
        {
          ...stored,
          fieldId: CALCULATED_FIELD,
          key: 'ratio',
          label: 'Ratio',
          computation: { mode: 'computed', expressionId: CALCULATED_FIELD },
        },
      ],
      localValues: { [snapshot.rows[0].rowKey]: { [stored.fieldId]: '91' } },
      presentation: {
        ...base.presentation,
        columnOrder: [],
        hiddenColumnIds: [],
        columnWidths: {},
        filters: [],
        sorts: [],
      },
    },
    duplicatedFromInstanceId: null,
    createdAt: '2026-08-16T12:00:00.000Z',
    updatedAt: '2026-08-16T12:00:00.000Z',
    createdByUserId: 'u1',
    updatedByUserId: 'u1',
  }
}

/** Select the actual cell, then open the package's real column menu. */
function selectColumn(columnId: string) {
  const index = columnId === BOUND_FIELD ? 0 : columnId === LOCAL_FIELD ? 2 : 3

  const cell = screen
    .getAllByRole('gridcell')
    .find(
      (node) =>
        node.getAttribute('aria-rowindex') === '1' &&
        node.getAttribute('aria-colindex') === String(index + 1),
    )

  if (!cell) throw new Error(`Missing column ${columnId}`)
  fireEvent.pointerDown(cell, { button: 0, pointerId: 1 })
}

async function openColumnMenu(columnId: string) {
  const index = columnId === BOUND_FIELD ? 0 : columnId === LOCAL_FIELD ? 2 : 3

  const header = screen.getByRole('columnheader', {
    name: new RegExp(`^${String.fromCharCode(65 + index)} `),
  })

  fireEvent.contextMenu(header)

  return screen.findByRole('menu', { name: /column menu/ })
}

async function choosePromote(columnId: string) {
  const menu = await openColumnMenu(columnId)
  const entry = within(menu).queryByRole('button', { name: /Add to dataset/ })

  if (entry) fireEvent.click(entry)
}

async function renderComposedEditor() {
  const instance = await composedInstance()
  await renderSheetRoute(
    <CanonicalSheetEditor instance={instance} projectId={PROJECT} />,
  )
  await screen.findByRole('grid')
  await screen.findByRole('columnheader', { name: /Observation/ })

  return instance
}

afterEach(() => {
  cleanup()
  transport.mockClear()
  listRequests.mockClear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  promotionRows = []
})

describe('CanonicalSheetEditor promote wiring', () => {
  it('offers Add to dataset only for an active local column', async () => {
    await renderComposedEditor()

    // A bound column already lives in a Dataset.
    selectColumn(BOUND_FIELD)
    expect(
      within(await openColumnMenu(BOUND_FIELD)).queryByRole('button', {
        name: /Add to dataset/,
      }),
    ).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Close menu' }))

    // A calculated column is derived, so there is no stored column to move.
    selectColumn(CALCULATED_FIELD)
    expect(
      within(await openColumnMenu(CALCULATED_FIELD)).queryByRole('button', {
        name: /Add to dataset/,
      }),
    ).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Close menu' }))

    // The Sheet's own stored column is the one that can be promoted.
    selectColumn(LOCAL_FIELD)
    expect(
      within(await openColumnMenu(LOCAL_FIELD)).getByRole('button', {
        name: /Add to dataset/,
      }),
    ).toBeTruthy()
  })

  it('opens the promote dialog for the chosen local column', async () => {
    await renderComposedEditor()
    selectColumn(LOCAL_FIELD)

    await choosePromote(LOCAL_FIELD)

    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('Add Observation to a dataset')
  })

  it('refuses to open the dialog for a column the Sheet does not own', async () => {
    await renderComposedEditor()
    selectColumn(BOUND_FIELD)

    await choosePromote(BOUND_FIELD)

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('announces a returned promotion against its column', async () => {
    promotionRows = [
      {
        id: '21000000-0000-4000-8000-00000000000e',
        sheet_instance_id: INSTANCE,
        field_id: LOCAL_FIELD,
        target: 'dataset_schema',
        schema_definition_id: DEFINITION.id,
        schema_version_id: null,
        model_key: null,
        state: 'returned',
        approval_request_id: '21000000-0000-4000-8000-00000000000f',
        reason: 'Observation is free text; it needs a defined scale first.',
        requested_by_user_id: 'u1',
        requested_at: '2026-09-24T09:00:00.000Z',
        decided_at: '2026-09-24T10:40:00.000Z',
      },
    ]
    await renderComposedEditor()

    selectColumn(LOCAL_FIELD)

    const banner = await screen.findByRole('alert')
    expect(banner.textContent).toContain(
      'Observation is free text; it needs a defined scale first.',
    )
    expect(banner.textContent).toMatch(/stays local/)
  })

  it('stays silent while the promotion is pending', async () => {
    promotionRows = [
      {
        id: '21000000-0000-4000-8000-000000000010',
        sheet_instance_id: INSTANCE,
        field_id: LOCAL_FIELD,
        target: 'dataset_schema',
        schema_definition_id: DEFINITION.id,
        schema_version_id: null,
        model_key: null,
        state: 'pending',
        approval_request_id: null,
        reason: null,
        requested_by_user_id: 'u1',
        requested_at: '2026-09-24T09:00:00.000Z',
        decided_at: null,
      },
    ]
    await renderComposedEditor()

    selectColumn(LOCAL_FIELD)

    // The banner's query has settled and returned a pending request, so its
    // silence is the answer rather than a race.
    await waitFor(() =>
      expect(listRequests).toHaveBeenCalledWith(
        'column_promotions',
        expect.stringContaining(`sheet_instance_id=eq.${INSTANCE}`),
      ),
    )
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })
})
