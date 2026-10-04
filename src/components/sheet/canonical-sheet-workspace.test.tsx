/**
 * CanonicalSheetWorkspace integration tests (GRID-02). Exercises the
 * composed-Sheet edit pipeline end to end — grid change simulation → pending
 * values → the explicit Write-back commit — against a recording data client,
 * so regressions in the workspace-level rejection contract are caught at the
 * integration layer, not only in `sheet-write-back` unit tests.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { validSheetDefinitionConfiguration } from '../../../tests/fixtures/sheet-definition'
import type { DataClient } from '#/lib/data-client'
import type { ComposedSheetSnapshot } from '#/lib/sheet-composition-data'
import { fetchComposedSheetRows } from '#/lib/sheet-composition-data'
import { validSheetInstanceState } from '#/lib/sheet-instance.test'
import type { SheetInstance } from '#/lib/sheet-instance-data'
import { mutateSheetLocalState } from '#/lib/sheet-local-data'

import type {
  SheetbaseGridCellChange,
  SheetbaseGridProps,
} from './sheetbase-grid'
import { CanonicalSheetEditor } from './canonical-sheet-workspace'

const rpcMock = vi.hoisted(() => vi.fn())
const gridRender = vi.hoisted(() => vi.fn())

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
    return (
      rpcImpl ? await rpcImpl(name, args) : await rpcMock(name, args)
    ) as T
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

// The grid is replaced with a props recorder: change flows are simulated by
// invoking the captured Sheetbase write callbacks exactly as the grid would.
// COMP-06 step 2: CanonicalSheetEditor renders the `sheetbase-table` backend.
vi.mock('./sheetbase-grid', () => ({
  SheetbaseTableGrid: (props: SheetbaseGridProps) => {
    const { columns } = props
    gridRender(props)
    return (
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
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

afterEach(() => {
  cleanup()
  rpcMock.mockReset()
  gridRender.mockClear()
  vi.mocked(mutateSheetLocalState).mockReset()
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

describe('Sheet comment inspector', () => {
  it('opens a stable range and creates an Instance-only thread even without a project or editable data', async () => {
    const user = userEvent.setup()
    const base = await composedInstance()
    const state = validSheetInstanceState()
    const field = state.localFields[0].fieldId
    const instance: SheetInstance = {
      ...base,
      projectId: null,
      notebookRecordId: null,
      sourceDefinitionVersionId: null,
      state: {
        ...state,
        bindings: [],
        localValues: { [ROW_A]: { [field]: '91' }, [ROW_B]: { [field]: '13' } },
        presentation: { ...state.presentation, filters: [], sorts: [] },
      },
    }
    renderWorkspace(
      <CanonicalSheetEditor
        instance={instance}
        projectId={null}
        readOnly
        commentActor={{
          user: {
            id: 'member',
            name: 'Scientist',
            email: 'member@test.invalid',
          },
          workspace: {
            id: instance.workspaceId,
            slug: 'lab',
            name: 'Lab',
            role: 'member',
          },
        }}
      />,
    )
    const button = screen.getByRole('button', { name: 'Comment on selection' })
    expect(button.hasAttribute('disabled')).toBe(true)
    const props: SheetbaseGridProps = gridRender.mock.lastCall?.[0]
    act(() =>
      props.onSelectionChange?.({
        rowIndex: 1,
        rowId: ROW_B,
        columnId: field,
        rowIds: [ROW_B, ROW_A],
        columnIds: [field],
        input: '13',
      }),
    )
    await user.click(button)
    expect(
      screen.getByRole('complementary', { name: 'Sheet comments inspector' }),
    ).toBeTruthy()
    expect(
      screen.getByText(/New comment target: range · 2 rows · 1 fields/),
    ).toBeTruthy()
    await user.type(
      screen.getByRole('textbox', { name: 'New comment body' }),
      'Explain asymmetric recoveries',
    )
    await user.click(screen.getByRole('button', { name: 'Add comment' }))
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith('create_sheet_comment', {
        p_instance_id: instance.id,
        p_expected_instance_revision: instance.revision,
        p_target_kind: 'sheet_range',
        p_target: {
          instanceId: instance.id,
          rowKeys: [ROW_B, ROW_A],
          fieldIds: [field],
        },
        p_body: 'Explain asymmetric recoveries',
        p_mentions: [],
      }),
    )
    expect(rpcMock.mock.calls.some(([name]) => name === 'create_comment')).toBe(
      false,
    )
    await user.click(screen.getByRole('button', { name: 'Row' }))
    expect(screen.getByText(/New comment target: row · 1 row/)).toBeTruthy()
  })

  it('denies the composer for a viewer even with a selected stable cell', async () => {
    const instance = await composedInstance()
    rpcMock.mockResolvedValue(twoDatasetWire())
    renderWorkspace(
      <CanonicalSheetEditor
        instance={instance}
        projectId={instance.projectId}
        commentActor={{
          user: { id: 'viewer', name: 'Viewer', email: 'viewer@test.invalid' },
          workspace: {
            id: instance.workspaceId,
            slug: 'lab',
            name: 'Lab',
            role: 'viewer',
          },
        }}
      />,
    )
    await waitFor(() => expect(gridRender).toHaveBeenCalled())
    const props: SheetbaseGridProps = gridRender.mock.lastCall?.[0]
    act(() =>
      props.onSelectionChange?.({
        rowIndex: 0,
        rowId: props.rows[0].id,
        columnId: props.columns[0].id,
      }),
    )
    expect(
      screen
        .getByRole('button', { name: 'Comment on selection' })
        .hasAttribute('disabled'),
    ).toBe(true)
    expect(
      screen.queryByRole('textbox', { name: 'New comment body' }),
    ).toBeNull()
  })
})

describe('Canonical local write row proofs', () => {
  it('sends an existing local UUID once for multiple edited fields rather than only proving new spare rows', async () => {
    const base = await composedInstance()
    const state = validSheetInstanceState()
    state.localFields.push({
      ...state.localFields[0],
      fieldId: ROW_B,
      key: 'second_observation',
      label: 'Second observation',
    })
    const instance = {
      ...base,
      sourceDefinitionVersionId: null,
      state: {
        ...state,
        bindings: [],
        presentation: { ...state.presentation, filters: [], sorts: [] },
      },
    }
    vi.mocked(mutateSheetLocalState).mockResolvedValue(instance)
    renderWorkspace(
      <CanonicalSheetEditor
        instance={instance}
        projectId={instance.projectId}
      />,
    )
    const props: SheetbaseGridProps = gridRender.mock.lastCall?.[0]
    const rowId = props.rows[0].id
    const columnId = props.columns[0].id
    act(() =>
      props.onCellsChange?.(
        [
          {
            rowIndex: 0,
            rowId,
            columnId,
            previous: 'independent value',
            next: 'changed',
          },
          {
            rowIndex: 0,
            rowId,
            columnId: ROW_B,
            previous: null,
            next: 'second',
          },
        ],
        'paste',
      ),
    )
    await waitFor(() =>
      expect(mutateSheetLocalState).toHaveBeenCalledWith(
        expect.objectContaining({
          rows: [{ kind: 'local', rowKey: rowId }],
          cells: [
            { rowKey: rowId, fieldId: columnId, value: 'changed' },
            { rowKey: rowId, fieldId: ROW_B, value: 'second' },
          ],
        }),
        expect.anything(),
      ),
    )
  })

  it('sends server-proven composed identity values and page offset for a local field edit on a bound row', async () => {
    const instance = await composedInstance()
    rpcMock.mockResolvedValue(twoDatasetWire())
    vi.mocked(mutateSheetLocalState).mockResolvedValue(instance)
    renderWorkspace(
      <CanonicalSheetEditor
        instance={instance}
        projectId={instance.projectId}
      />,
    )
    await waitFor(() => expect(gridRender).toHaveBeenCalled())
    const props: SheetbaseGridProps = gridRender.mock.lastCall?.[0]
    const rowId = props.rows[0].id
    const columnId = instance.state.localFields[0].fieldId
    act(() =>
      props.onCellsChange?.(
        [
          {
            rowIndex: 0,
            rowId,
            columnId,
            previous: null,
            next: 'source annotation',
          },
        ],
        'edit',
      ),
    )
    await waitFor(() =>
      expect(mutateSheetLocalState).toHaveBeenCalledWith(
        expect.objectContaining({
          rows: [
            {
              kind: 'composed',
              rowKey: rowId,
              identityValues: [RECORD],
              compositionOffset: 0,
            },
          ],
          cells: [
            { rowKey: rowId, fieldId: columnId, value: 'source annotation' },
          ],
        }),
        expect.anything(),
      ),
    )
  })
})

describe('CanonicalSheetWorkspace — GRID-02 mixed-authority regression', () => {
  it('rejects a paste spanning two Dataset bindings at Write-back before any RPC', async () => {
    const user = userEvent.setup()
    const instance = await composedInstance()
    // The composed-sheet query runs through the shared recording client; the
    // wire is served here and the recording is cleared before Write-back.
    rpcMock.mockResolvedValue(twoDatasetWire())

    renderWorkspace(
      <CanonicalSheetEditor
        instance={instance}
        projectId={instance.projectId}
      />,
    )

    // The composed Sheet carries both a local column and the two
    // Dataset-bound columns.
    await waitFor(() => expect(gridRender).toHaveBeenCalled())
    const props = gridRender.mock.lastCall?.[0] as {
      columns: Array<{ id: string; label: string }>
      rows: Array<{ id?: string }>
      beforeCellsChange: (
        changes: SheetbaseGridCellChange[],
        source: string,
      ) => boolean | undefined
      onCellsChange: (
        changes: SheetbaseGridCellChange[],
        source: string,
      ) => void
    }
    expect(props.columns.map((column) => column.label)).toEqual([
      'sample',
      'comparison',
      'Observation',
    ])

    // A paste touching both governed columns: the typed bulk-write gate
    // accepts both values (UUID-shaped record references, type-valid), so
    // the change reaches the edit pipeline.
    const paste = [
      {
        rowIndex: 0,
        rowId: props.rows[0].id,
        columnId: props.columns[0].id,
        previous: 'old-a',
        next: '21000000-0000-4000-8000-0000000000c1',
      },
      {
        rowIndex: 0,
        rowId: props.rows[0].id,
        columnId: props.columns[1].id,
        previous: 'old-b',
        next: '21000000-0000-4000-8000-0000000000c2',
      },
    ]
    expect(props.beforeCellsChange(paste, 'paste')).toBeUndefined()
    props.onCellsChange(paste, 'paste')

    const writeBack = await screen.findByRole('button', { name: 'Write back' })
    await waitFor(() => expect(writeBack.hasAttribute('disabled')).toBe(false))
    rpcMock.mockClear()
    await user.click(writeBack)

    // The write-back plan spans two (dataset, expected revision) commit
    // groups, so the mixed-authority rejection must fire before ANY RPC:
    // no commit_dataset_row_batch, no mutate_sheet_instance_local_state,
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

    // The status says the operation was not attempted and nothing was
    // written, and the pending values survive so the edit can be split.
    expect(screen.getByText(/nothing was written/i)).toBeTruthy()
    expect(writeBack.hasAttribute('disabled')).toBe(false)
  })
})

describe('CanonicalSheetEditor — GRID-05 incremental paging', () => {
  const RECORD_B = '21000000-0000-4000-8000-00000000000c'

  function pageWire(
    offset: number,
    options: { revision: number; hasMore: boolean },
  ) {
    const wire = twoDatasetWire()
    return {
      ...wire,
      offset,
      limit: 200,
      hasMore: options.hasMore,
      revision: options.revision,
      rows:
        offset === 0
          ? wire.rows
          : wire.rows.map((row) => ({ ...row, identityValues: [RECORD_B] })),
    }
  }

  it('loads the next window with a single fetch — never pages 1..N again', async () => {
    const user = userEvent.setup()
    const instance = await composedInstance()
    rpcMock.mockImplementation(
      async (_name: string, args: Record<string, unknown>) =>
        pageWire(Number(args.p_offset ?? 0), {
          revision: 6,
          hasMore: Number(args.p_offset ?? 0) === 0,
        }),
    )

    renderWorkspace(
      <CanonicalSheetEditor
        instance={instance}
        projectId={instance.projectId}
      />,
    )

    const loadMore = await screen.findByRole('button', { name: 'Load more' })
    expect(rpcMock.mock.calls.map((call) => call[1])).toEqual([
      { p_instance_id: INSTANCE, p_limit: 200, p_offset: 0 },
    ])

    await user.click(loadMore)
    await waitFor(() =>
      expect(screen.getByText('Showing all 2 rows.')).toBeTruthy(),
    )

    // Two pages cost exactly two window fetches: the second page fetched
    // ONLY offset 200 instead of refetching pages 1..2.
    expect(rpcMock.mock.calls.map((call) => call[1])).toEqual([
      { p_instance_id: INSTANCE, p_limit: 200, p_offset: 0 },
      { p_instance_id: INSTANCE, p_limit: 200, p_offset: 200 },
    ])
  })

  it('restarts from the first rows with a notice when the revision moves mid-paging', async () => {
    const user = userEvent.setup()
    const instance = await composedInstance()
    let zeroCalls = 0
    rpcMock.mockImplementation(
      async (_name: string, args: Record<string, unknown>) => {
        const offset = Number(args.p_offset ?? 0)
        if (offset === 0 && zeroCalls++ === 0) {
          return pageWire(0, { revision: 6, hasMore: true })
        }
        return pageWire(offset, {
          revision: 7,
          hasMore: offset === 0,
        })
      },
    )

    renderWorkspace(
      <CanonicalSheetEditor
        instance={instance}
        projectId={instance.projectId}
      />,
    )

    await user.click(await screen.findByRole('button', { name: 'Load more' }))
    await waitFor(() =>
      expect(screen.getByText(/changed while loading/i)).toBeTruthy(),
    )

    // Coherent new-revision rows only — the stale first window is discarded,
    // never merged across revisions.
    await waitFor(() =>
      expect(screen.getByText('Showing all 2 rows.')).toBeTruthy(),
    )
    expect(
      rpcMock.mock.calls.map(
        (call) => (call[1] as Record<string, unknown>).p_offset,
      ),
    ).toEqual([0, 200, 0, 200])
  })
})
describe('CanonicalSheetWorkspace — explain surface (ASSIST-01)', () => {
  it('explains a mixed-authority rejection with a cited, read-only panel', async () => {
    const user = userEvent.setup()
    const instance = await composedInstance()
    rpcMock.mockResolvedValue(twoDatasetWire())

    renderWorkspace(
      <CanonicalSheetEditor
        instance={instance}
        projectId={instance.projectId}
      />,
    )

    await waitFor(() => expect(gridRender).toHaveBeenCalled())
    const props = gridRender.mock.lastCall?.[0] as {
      columns: Array<{ id: string; label: string }>
      rows: Array<{ id?: string }>
      beforeCellsChange: (
        changes: SheetbaseGridCellChange[],
        source: string,
      ) => boolean | undefined
      onCellsChange: (
        changes: SheetbaseGridCellChange[],
        source: string,
      ) => void
    }
    const paste = [
      {
        rowIndex: 0,
        rowId: props.rows[0].id,
        columnId: props.columns[0].id,
        previous: 'old-a',
        next: '21000000-0000-4000-8000-0000000000c1',
      },
      {
        rowIndex: 0,
        rowId: props.rows[0].id,
        columnId: props.columns[1].id,
        previous: 'old-b',
        next: '21000000-0000-4000-8000-0000000000c2',
      },
    ]
    expect(props.beforeCellsChange(paste, 'paste')).toBeUndefined()
    props.onCellsChange(paste, 'paste')

    const writeBack = await screen.findByRole('button', { name: 'Write back' })
    await waitFor(() => expect(writeBack.hasAttribute('disabled')).toBe(false))
    await user.click(writeBack)
    expect(await screen.findByText(/nothing was written/i)).toBeTruthy()

    // The rejection carries structured state, so Explain opens a grounded,
    // read-only panel: what failed, why with a citation, and how to
    // resolve — marked as assistance, with no mutation path.
    await user.click(await screen.findByRole('button', { name: 'Explain' }))
    expect(await screen.findByText(/Why write-back was rejected/)).toBeTruthy()
    expect(screen.getByText(/write back each part separately/)).toBeTruthy()
    expect(
      screen.getAllByText(/\[Write-back rule mixed_authority_write\]/).length,
    ).toBeGreaterThan(0)
    expect(screen.getByText(/Not authoritative/)).toBeTruthy()
  })
})
