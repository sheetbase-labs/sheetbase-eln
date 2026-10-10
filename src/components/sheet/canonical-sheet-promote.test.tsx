/**
 * SHEET-02.3 — the Promote wiring in the canonical Sheet. Promotion leaves the
 * Sheet, so the column menu may offer it only for a column the Sheet owns (an
 * active local field) and the dialog is opened from that entry rather than by
 * a control of its own. This exercises the wiring end to end: the workspace's
 * real column-menu entries, the package's own "hide a disabled entry" filter
 * and the two promotion surfaces — the request dialog and the returned banner —
 * mounted against a recording data client.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { enabledMenuActions } from '@sheetbase-labs/sheetbase-table'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { validSheetDefinitionConfiguration } from '../../../tests/fixtures/sheet-definition'
import type { DataClient } from '#/lib/data-client'
import { fetchComposedSheetRows } from '#/lib/sheet-composition-data'
import type { SheetInstance } from '#/lib/sheet-instance-data'
import { validSheetInstanceState } from '#/lib/sheet-instance.test'
import type { ColumnPromotion } from '#/lib/schema-evolution'

import { CanonicalSheetEditor } from './canonical-sheet-workspace'
import type {
  SheetbaseGridMenuItem,
  SheetbaseGridProps,
} from './sheetbase-grid'

const rpcMock = vi.hoisted(() => vi.fn())
const listMock = vi.hoisted(() => vi.fn())
const gridRender = vi.hoisted(() => vi.fn())
/** Mutable so a test can state what `column_promotions` holds. */
const promotionState = vi.hoisted(() => ({ rows: [] as ColumnPromotion[] }))

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

/**
 * A DataClient that answers the composition with one bound row and the two
 * promotion surfaces from `promotionState`. Every client in the tree comes from
 * this factory, so `list` stays observable and no request escapes the test.
 */
function fakeClient(): DataClient {
  return {
    list: (async (resource: string, query?: string) => {
      listMock(resource, query)
      if (resource === 'dataset_schema_definitions') return [DEFINITION]
      if (resource === 'column_promotions') return promotionState.rows
      return []
    }) as DataClient['list'],
    count: async () => 0,
    rpc: (async (name: string, args: Record<string, unknown>) =>
      name === 'query_sheet_instance_rows'
        ? composedWire()
        : await rpcMock(name, args)) as DataClient['rpc'],
    insert: async () => ({}) as never,
    patch: async () => [],
    remove: () => Promise.resolve([]),
  }
}

vi.mock('#/lib/data-client', async () =>
  Object.assign({}, await vi.importActual('#/lib/data-client'), {
    createDataClient: () => fakeClient(),
  }),
)

vi.mock('#/lib/sheet-local-data', async (importOriginal) => ({
  ...(await importOriginal()),
  mutateSheetLocalState: vi.fn(),
  readSheetInstanceCalculationResults: vi.fn().mockResolvedValue({
    results: [],
  }),
}))

// The grid is replaced with a props recorder: the menu entries are the real
// workspace entries, and change flows are simulated by invoking the captured
// callbacks exactly as the grid would.
vi.mock('./sheetbase-grid', () => ({
  SheetbaseTableGrid: (props: SheetbaseGridProps) => {
    gridRender(props)
    return (
      <table>
        <thead>
          <tr>
            {props.columns.map((column) => (
              <th key={column.id} scope="col">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
      </table>
    )
  },
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))

async function composedInstance(): Promise<SheetInstance> {
  const base = validSheetInstanceState()
  const stored = base.localFields[0]
  const snapshot = await fetchComposedSheetRows(INSTANCE, {}, fakeClient())
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

function renderEditor(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

/** The most recent props the grid received. */
function gridProps(): SheetbaseGridProps {
  return gridRender.mock.lastCall?.[0] as SheetbaseGridProps
}

/**
 * The promote entry as the engine sees it: `enabledMenuActions` is the
 * package's own filter, and a disabled entry never reaches the menu. A
 * column the Sheet does not own therefore has no promote affordance at all.
 */
function visiblePromoteEntry(): SheetbaseGridMenuItem | undefined {
  const entries = (gridProps().columnMenuItems ?? []).filter(
    (entry): entry is SheetbaseGridMenuItem => typeof entry === 'object',
  )
  return enabledMenuActions(entries).find(
    (entry) => entry.id === 'promote-column',
  )
}

/** Select a column the way the grid does — by its stable id. */
function selectColumn(columnId: string) {
  act(() =>
    gridProps().onSelectionChange?.({
      rowIndex: 0,
      rowId: ROW_A,
      columnId,
      input: '',
      rowIds: [ROW_A],
      columnIds: [columnId],
    }),
  )
}

/** Choose the promote entry for a column, as the menu would. */
function choosePromote(columnId: string) {
  const entry = (gridProps().columnMenuItems ?? []).find(
    (candidate): candidate is SheetbaseGridMenuItem =>
      typeof candidate === 'object' && candidate.id === 'promote-column',
  )
  act(() =>
    entry?.onSelect?.({
      ranges: [{ rowStart: 0, rowEnd: 0, columnIds: [columnId] }],
    }),
  )
}

async function renderComposedEditor() {
  const instance = await composedInstance()
  renderEditor(<CanonicalSheetEditor instance={instance} projectId={PROJECT} />)
  await waitFor(() => expect(gridRender).toHaveBeenCalled())
  return instance
}

afterEach(() => {
  cleanup()
  rpcMock.mockReset()
  listMock.mockReset()
  gridRender.mockClear()
  promotionState.rows = []
})

describe('CanonicalSheetEditor promote wiring', () => {
  it('offers Promote column only for an active local column', async () => {
    await renderComposedEditor()

    // A bound column already lives in a Dataset.
    selectColumn(BOUND_FIELD)
    expect(visiblePromoteEntry()).toBeUndefined()

    // A calculated column is derived, so there is no stored column to move.
    selectColumn(CALCULATED_FIELD)
    expect(visiblePromoteEntry()).toBeUndefined()

    // The Sheet's own stored column is the one that can be promoted.
    selectColumn(LOCAL_FIELD)
    expect(visiblePromoteEntry()?.id).toBe('promote-column')
  })

  it('opens the promote dialog for the chosen local column', async () => {
    await renderComposedEditor()
    selectColumn(LOCAL_FIELD)

    choosePromote(LOCAL_FIELD)

    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('Promote Observation')
  })

  it('refuses to open the dialog for a column the Sheet does not own', async () => {
    await renderComposedEditor()
    selectColumn(BOUND_FIELD)

    choosePromote(BOUND_FIELD)

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('announces a returned promotion against its column', async () => {
    promotionState.rows = [
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
    promotionState.rows = [
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
      expect(listMock).toHaveBeenCalledWith(
        'column_promotions',
        expect.stringContaining(`sheet_instance_id=eq.${INSTANCE}`),
      ),
    )
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })
})
