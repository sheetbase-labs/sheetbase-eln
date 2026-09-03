/**
 * CanonicalSheetWorkspace integration tests (GRID-02). Exercises the
 * composed-Sheet edit pipeline end to end — engine cell writes through the
 * workspace's paged adapter — against a recording data client, so
 * regressions in the workspace-level rejection contract are caught at the
 * integration layer, not only in `sheet-write-back` unit tests.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DatasetQuery } from 'sheetbase-table/dev'

import { validSheetDefinitionConfiguration } from '../../../tests/fixtures/sheet-definition'
import type { DataClient } from '#/lib/data-client'
import type { SheetInstancePagedAdapter } from '#/lib/sheetbase-table/sheet-instance-paged-adapter'
import type { ComposedSheetSnapshot } from '#/lib/sheet-composition-data'
import { fetchComposedSheetRows } from '#/lib/sheet-composition-data'
import { validSheetInstanceState } from '#/lib/sheet-instance.test'
import type { SheetInstance } from '#/lib/sheet-instance-data'
import { SheetMixedAuthorityWriteError } from '#/lib/sheet-write-back'

import { CanonicalSheetEditor } from './canonical-sheet-workspace'

const rpcMock = vi.hoisted(() => vi.fn())
const gridProps = vi.hoisted(() => ({ current: null as null | GridPropsCapture }))

interface GridPropsCapture {
  adapter: SheetInstancePagedAdapter
  datasetId: string
  datasetHeader: {
    datasetId: string
    fields: Array<{ id: string; label: string }>
  }
  query: DatasetQuery
}

/**
 * The engine grid is replaced with a props recorder: cell writes are driven
 * directly through the workspace's paged adapter (`gridProps.current.adapter`),
 * exactly as the engine's commit coordinator would.
 */
vi.mock('sheetbase-table/dev', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('sheetbase-table/dev')>()
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

/**
 * A DataClient whose rpc is observable. The default handler records every
 * call on `rpcMock`; every client the component tree creates goes through
 * the mocked `createDataClient`, so the test can assert that no authoritative
 * RPC runs at all.
 */
function fakeClient(
  rpcImpl?: (name: string, args: Record<string, unknown>) => Promise<unknown>,
): DataClient {
  async function rpc<T>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    return (rpcImpl ? await rpcImpl(name, args) : await rpcMock(name, args)) as T
  }
  async function insert<T>(): Promise<T> {
    return {} as T
  }
  async function patch<T>(): Promise<T[]> {
    return []
  }
  return {
    list: () => Promise.resolve([]),
    count: async () => 0,
    rpc,
    insert,
    patch,
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
  mutateSheetInstanceCalculations: vi.fn(),
  readSheetInstanceCalculationResults: vi.fn().mockResolvedValue({
    results: [],
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  useNavigate: () => vi.fn(),
}))

afterEach(() => {
  cleanup()
  rpcMock.mockReset()
  gridProps.current = null
})

const INSTANCE = '21000000-0000-4000-8000-000000000001'
const DEFINITION_VERSION = '21000000-0000-4000-8000-000000000002'
const DATASET_A = '21000000-0000-4000-8000-000000000003'
const DATASET_B = '21000000-0000-4000-8000-000000000004'
const ROW_A = '21000000-0000-4000-8000-000000000005'
const ROW_B = '21000000-0000-4000-8000-000000000006'
const RECORD = '21000000-0000-4000-8000-000000000007'

/**
 * The shared fixture maps only column A to a Dataset write-back. Promote
 * column B (bound to the second Dataset binding) to a writable mapping too,
 * and unhide it, so a single range operation can span two authoritative
 * Dataset commit groups.
 */
function twoWritableDatasetConfiguration() {
  const configuration = validSheetDefinitionConfiguration()
  const [columnA, columnB] = configuration.columns
  if (
    columnA.source.kind !== 'bound' ||
    columnB.source.kind !== 'bound' ||
    columnB.source.bindingId === columnA.source.bindingId
  ) {
    throw new Error('invalid test fixture')
  }
  configuration.writeBackRules.push({
    id: '21000000-0000-4000-8000-000000000008',
    bindingId: columnB.source.bindingId,
    mode: 'update',
    mappings: [
      {
        columnId: columnB.id,
        targetFieldId: columnB.source.sourceFieldId,
      },
    ],
  })
  configuration.presentation.hiddenColumnIds = []
  return configuration
}

/**
 * One composed row whose columns resolve to two different Datasets — a paste
 * across them spans two (dataset, expected revision) commit groups.
 */
function twoDatasetWire() {
  const configuration = twoWritableDatasetConfiguration()
  const [columnA, columnB] = configuration.columns
  if (columnA.source.kind !== 'bound' || columnB.source.kind !== 'bound') {
    throw new Error('invalid test fixture')
  }
  return {
    instanceId: INSTANCE,
    definitionVersionId: DEFINITION_VERSION,
    definitionConfiguration: twoWritableDatasetConfiguration(),
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

async function composedSnapshot(): Promise<ComposedSheetSnapshot> {
  // Build the snapshot through the real composition loader so the wire
  // parsing, row keys and bound-column projection stay authoritative; only
  // the transport is a stub.
  return fetchComposedSheetRows(
    INSTANCE,
    {},
    fakeClient(async () => twoDatasetWire()),
  )
}

async function composedInstance(): Promise<SheetInstance> {
  const snapshot = await composedSnapshot()
  const base = validSheetInstanceState()
  // The composed row needs a local-state entry so the extra local column can
  // render against it without inventing an unmatched row.
  return {
    id: INSTANCE,
    workspaceId: '21000000-0000-4000-8000-000000000009',
    projectId: '21000000-0000-4000-8000-00000000000a',
    notebookRecordId: '21000000-0000-4000-8000-00000000000b',
    sourceDefinitionVersionId: DEFINITION_VERSION,
    name: 'Composed assay sheet',
    description: null,
    lifecycle: 'active',
    revision: 1,
    state: {
      ...base,
      localValues: { [snapshot.rows[0].rowKey]: {} },
    },
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

describe('CanonicalSheetWorkspace — GRID-02 mixed-authority regression', () => {
  it('rejects an adapter commit spanning two Dataset bindings before any RPC', async () => {
    const instance = await composedInstance()
    // The composed-sheet query runs through the shared recording client; the
    // wire is served here and the recording is cleared before the commit.
    rpcMock.mockResolvedValue(twoDatasetWire())

    renderWorkspace(
      <CanonicalSheetEditor instance={instance} projectId={instance.projectId} />,
    )

    // The composed Sheet carries both a local column and the two
    // Dataset-bound columns.
    await vi.waitFor(() => expect(gridProps.current).not.toBeNull())
    expect(
      gridProps.current!.datasetHeader.fields.map((field) => field.label),
    ).toEqual(['sample', 'comparison', 'Observation'])

    // The adapter the workspace handed the engine carries the composition, so
    // a write is addressed by the canonical composed row key and stable
    // column ids — the engine applies presentation before the write path and
    // there is no visual→physical mapping to resolve.
    const adapter = gridProps.current!.adapter
    const snapshot = await composedSnapshot()
    const [columnA, columnB] = snapshot.definitionConfiguration!.columns
    const rowKey = snapshot.rows[0].rowKey

    // A paste touching both governed columns, as ONE engine commit: both
    // values are UUID-shaped record references and type-valid, so the write
    // reaches the grouped dispatch — which spans two (dataset, expected
    // revision) commit groups.
    rpcMock.mockClear()
    await expect(
      adapter.commit([
        {
          datasetId: adapter.datasetId,
          recordId: rowKey,
          fieldId: columnA.id,
          after: '21000000-0000-4000-8000-0000000000c1',
        },
        {
          datasetId: adapter.datasetId,
          recordId: rowKey,
          fieldId: columnB.id,
          after: '21000000-0000-4000-8000-0000000000c2',
        },
      ]),
    ).rejects.toThrow(SheetMixedAuthorityWriteError)

    // The commit plan spans two (dataset, expected revision) groups, so the
    // mixed-authority rejection must fire before ANY RPC: no
    // commit_dataset_row_batch, no mutate_sheet_instance_local_state,
    // nothing at all.
    expect(rpcMock).not.toHaveBeenCalled()
    expect(rpcMock).not.toHaveBeenCalledWith(
      'commit_dataset_row_batch',
      expect.anything(),
    )
    expect(rpcMock).not.toHaveBeenCalledWith(
      'mutate_sheet_instance_local_state',
      expect.anything(),
    )
    expect(screen.queryByText(/nothing was written/i)).toBeNull()
  })
})
