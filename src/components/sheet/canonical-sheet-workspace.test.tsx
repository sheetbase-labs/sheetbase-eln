/**
 * CanonicalSheetWorkspace integration tests (GRID-02). Exercises the
 * composed-Sheet edit pipeline end to end — grid change simulation → pending
 * values → the explicit Write-back commit — against a recording data client,
 * so regressions in the workspace-level rejection contract are caught at the
 * integration layer, not only in `sheet-write-back` unit tests.
 */
import {
  gridCell,
  instanceWire,
  mountWorkspace,
  pasteGrid,
  resetWorkspaceHttp,
  selectGridCell,
  workspaceHttp,
} from './canonical-workspace-test-support'
import { QueryClient } from '@tanstack/react-query'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from 'vitest'

import { validSheetDefinitionConfiguration } from '../../../tests/fixtures/sheet-definition'
import { createDataClient } from '#/lib/data-client'
import type { ComposedSheetSnapshot } from '#/lib/sheet-composition-data'
import { fetchComposedSheetRows } from '#/lib/sheet-composition-data'
import { validSheetInstanceState } from '#/lib/sheet-instance.test'
import type { SheetInstance } from '#/lib/sheet-instance-data'
import type { SheetInstanceCalculationResults } from '#/lib/sheet-local-data'
import { canonicalSheetGridMatrix } from '#/lib/canonical-sheet-grid'
import { canonicalWorkspaceGridColumn } from './canonical-workspace-fields'
import { prepareCanonicalWorkspaceWrite } from './canonical-workspace-write-policy'

import { CanonicalSheetEditor } from './canonical-sheet-workspace'
import type { CellConflictRow } from './cell-conflict-panel'

const rpcMock = workspaceHttp.rpc
const listMock = workspaceHttp.list
const renderWorkspace = mountWorkspace

beforeEach(async () => resetWorkspaceHttp(await composedInstance()))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
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
    createDataClient(async () => Response.json(twoDatasetWire())),
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
      presentation: { ...base.presentation, filters: [], sorts: [] },
    },
    duplicatedFromInstanceId: null,
    createdAt: '2026-08-16T12:00:00.000Z',
    updatedAt: '2026-08-16T12:00:00.000Z',
    createdByUserId: 'u1',
    updatedByUserId: 'u1',
  }
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

    await renderWorkspace(
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
    await user.click(screen.getByRole('button', { name: 'More sheet tools' }))
    expect(
      (
        await screen.findByRole('menuitem', { name: 'Comment on selection' })
      ).getAttribute('aria-disabled'),
    ).toBe('true')
    await user.keyboard('{Escape}')
    selectGridCell(1, 0)
    selectGridCell(0, 0, true)
    await user.click(screen.getByRole('button', { name: 'More sheet tools' }))
    await user.click(
      await screen.findByRole('menuitem', { name: 'Comment on selection' }),
    )
    expect(
      screen.getByRole('complementary', { name: 'Sheet comments inspector' }),
    ).toBeTruthy()
    expect(
      screen.getByText(/New comment target: range · 2 rows · 1 field/),
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
          rowKeys: [ROW_A, ROW_B],
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
    await renderWorkspace(
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
    selectGridCell(0, 0)
    await userEvent.click(
      screen.getByRole('button', { name: 'More sheet tools' }),
    )
    expect(
      (
        await screen.findByRole('menuitem', { name: 'Comment on selection' })
      ).getAttribute('aria-disabled'),
    ).toBe('true')
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

    workspaceHttp.local.mockResolvedValue(instanceWire(instance))
    await renderWorkspace(
      <CanonicalSheetEditor
        instance={instance}
        projectId={instance.projectId}
      />,
    )
    const rowId = Object.keys(instance.state.localValues)[0]
    const columnId = instance.state.localFields[0].fieldId
    selectGridCell(0, 0)
    pasteGrid('changed\tsecond')
    await waitFor(() =>
      expect(workspaceHttp.local).toHaveBeenCalledWith(
        expect.objectContaining({
          p_rows: [{ kind: 'local', rowKey: rowId }],
          p_cells: [
            { rowKey: rowId, fieldId: columnId, value: 'changed' },
            { rowKey: rowId, fieldId: ROW_B, value: 'second' },
          ],
        }),
      ),
    )
  })

  it('sends server-proven composed identity values and page offset for a local field edit on a bound row', async () => {
    const instance = await composedInstance()
    rpcMock.mockResolvedValue(twoDatasetWire())
    workspaceHttp.local.mockResolvedValue(instanceWire(instance))
    await renderWorkspace(
      <CanonicalSheetEditor
        instance={instance}
        projectId={instance.projectId}
      />,
    )
    const rowId = (await composedSnapshot()).rows[0].rowKey
    const columnId = instance.state.localFields[0].fieldId
    selectGridCell(0, 2)
    pasteGrid('source annotation')
    await waitFor(() =>
      expect(workspaceHttp.local).toHaveBeenCalledWith(
        expect.objectContaining({
          p_rows: [
            {
              kind: 'composed',
              rowKey: rowId,
              identityValues: [RECORD],
              compositionOffset: 0,
            },
          ],
          p_cells: [
            { rowKey: rowId, fieldId: columnId, value: 'source annotation' },
          ],
        }),
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

    await renderWorkspace(
      <CanonicalSheetEditor
        instance={instance}
        projectId={instance.projectId}
      />,
    )

    // The composed Sheet carries both a local column and the two
    // Dataset-bound columns.
    const matrix = canonicalSheetGridMatrix({
      instance,
      composition: await composedSnapshot(),
    })

    expect(matrix.columns.map((column) => column.label)).toEqual([
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
        rowId: matrix.rowKeys[0],
        columnId: matrix.columns[0].id,
        previous: 'old-a',
        next: '21000000-0000-4000-8000-0000000000c1',
      },
      {
        rowIndex: 0,
        rowId: matrix.rowKeys[0],
        columnId: matrix.columns[1].id,
        previous: 'old-b',
        next: '21000000-0000-4000-8000-0000000000c2',
      },
    ]

    expect(
      prepareCanonicalWorkspaceWrite({
        columns: matrix.columns,
        changes: paste,
        source: 'paste',
      }).result,
    ).toBeUndefined()
    selectGridCell(0, 0)
    pasteGrid(paste.map((change) => change.next).join('\t'))

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
    rpcMock.mockImplementation(async (_name, args) =>
      pageWire(Number(args.p_offset ?? 0), {
        revision: 6,
        hasMore: Number(args.p_offset ?? 0) === 0,
      }),
    )

    await renderWorkspace(
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
    rpcMock.mockImplementation(async (_name, args) => {
      const offset = Number(args.p_offset ?? 0)

      if (offset === 0 && zeroCalls++ === 0) {
        return pageWire(0, { revision: 6, hasMore: true })
      }

      return pageWire(offset, {
        revision: 7,
        hasMore: offset === 0,
      })
    })

    await renderWorkspace(
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
    expect(rpcMock.mock.calls.map((call) => call[1].p_offset)).toEqual([
      0, 200, 0, 200,
    ])
  })
})

describe('CanonicalSheetWorkspace — explain surface (ASSIST-01)', () => {
  it('explains a mixed-authority rejection with a cited, read-only panel', async () => {
    const user = userEvent.setup()
    const instance = await composedInstance()
    rpcMock.mockResolvedValue(twoDatasetWire())

    await renderWorkspace(
      <CanonicalSheetEditor
        instance={instance}
        projectId={instance.projectId}
      />,
    )

    const matrix = canonicalSheetGridMatrix({
      instance,
      composition: await composedSnapshot(),
    })

    const paste = [
      {
        rowIndex: 0,
        rowId: matrix.rowKeys[0],
        columnId: matrix.columns[0].id,
        previous: 'old-a',
        next: '21000000-0000-4000-8000-0000000000c1',
      },
      {
        rowIndex: 0,
        rowId: matrix.rowKeys[0],
        columnId: matrix.columns[1].id,
        previous: 'old-b',
        next: '21000000-0000-4000-8000-0000000000c2',
      },
    ]

    expect(
      prepareCanonicalWorkspaceWrite({
        columns: matrix.columns,
        changes: paste,
        source: 'paste',
      }).result,
    ).toBeUndefined()
    selectGridCell(0, 0)
    pasteGrid(paste.map((change) => change.next).join('\t'))

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

describe('CanonicalSheetEditor — sheet block chrome (EXP-04.2)', () => {
  const CALC = '21000000-0000-4000-8000-00000000000c'

  /** The composed fixture plus one active instance calculation column. */
  async function composedInstanceWithCalculation(): Promise<SheetInstance> {
    const instance = await composedInstance()

    const outputField: SheetInstance['state']['localFields'][number] = {
      fieldId: CALC,
      key: 'step_yield',
      label: 'Step yield',
      description: null,
      logicalType: 'decimal',
      nullable: true,
      defaultValue: null,
      cardinality: 'one',
      quantity: null,
      validation: {},
      category: null,
      relationship: null,
      computation: { mode: 'computed', expressionId: CALC },
      lifecycle: 'active',
    }

    return {
      ...instance,
      state: {
        ...instance.state,
        instanceCalculations: [
          {
            id: CALC,
            key: 'step_yield',
            label: 'Step yield',
            lifecycle: 'active',
            outputField,
            dependencies: [],
            expression: { language: 'sheetbase-formula-v1', source: '=1' },
          },
        ],
      },
    }
  }

  it('names each column source in the header group and marks calculated columns ƒx', async () => {
    const instance = await composedInstanceWithCalculation()
    rpcMock.mockResolvedValue(twoDatasetWire())
    // Owner bands belong to the Details view.
    localStorage.setItem('sheetbase.sheet.details', 'on')
    onTestFinished(() => localStorage.removeItem('sheetbase.sheet.details'))
    await renderWorkspace(
      <CanonicalSheetEditor
        instance={instance}
        projectId={instance.projectId}
      />,
    )

    const columns = canonicalSheetGridMatrix({
      instance,
      composition: await composedSnapshot(),
    }).columns.map((column) =>
      canonicalWorkspaceGridColumn(column, true, () => ({})),
    )

    const byId = new Map(columns.map((column) => [column.id, column]))
    const [columnA, columnB] = validSheetDefinitionConfiguration().columns
    const localField = validSheetInstanceState().localFields[0].fieldId

    // Bound columns name their Dataset binding's parameter, plus the
    // snapshot revision the composition read.
    expect(byId.get(columnA.id)).toMatchObject({
      source: 'bound',
      group: 'Results · rev 9 · edits go back to the source',
      sourceLabel: 'Results · rev 9',
    })
    expect(byId.get(columnB.id)).toMatchObject({
      source: 'bound',
      group: 'Comparison · rev 8 · edits go back to the source',
      sourceLabel: 'Comparison · rev 8',
    })
    // Local and derived columns name their own source kind.
    expect(byId.get(localField)).toMatchObject({
      source: 'local',
      group: 'This experiment · edits make a sheet revision',
    })

    const derived = columns.find((column) => column.source === 'calculated')

    expect(derived).toMatchObject({
      label: 'Step yield',
      group: 'Derived · calculated, not editable',
    })
    expect(derived?.sourceLabel).toBeUndefined()

    // The group header renders, and only the derived column carries the ƒx
    // calculation mark.
    expect(
      screen.getByText('Results · rev 9 · edits go back to the source'),
    ).toBeTruthy()
    expect(screen.getByText(/ƒx/)).toBeTruthy()
    expect(columns.filter((column) => column.source === 'bound')).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({
          group: 'Derived · calculated, not editable',
        }),
      ]),
    )
  })

  it('offers Recalculate beside the stale message and re-reads the results (J-DAT-16)', async () => {
    const instance = await composedInstanceWithCalculation()

    const calculation = instance.state.instanceCalculations?.[0]

    if (!calculation) throw new Error('Missing calculation fixture')

    const resultsFor = (
      calculationStatus: 'current' | 'stale',
    ): SheetInstanceCalculationResults => ({
      instanceId: instance.id,
      revision: instance.revision,
      results: [
        {
          calculationId: CALC,
          rowKey: Object.keys(instance.state.localValues)[0],
          calculatedValue: 1,
          calculationStatus,
          scope: 'instance',
          definitionVersionId: null,
          resultKind: 'value',
          errorCode: null,
          diagnostic: null,
          expression: calculation.expression,
          dependencies: calculation.dependencies,
          outputField: calculation.outputField,
          sourceRevisions: [],
          dependencyProvenance: [],
          calculatedAt: instance.updatedAt,
          permission: { editability: 'read-only' },
        },
      ],
    })

    workspaceHttp.calculations.mockResolvedValue(resultsFor('stale'))
    rpcMock.mockResolvedValue(twoDatasetWire())
    await renderWorkspace(
      <CanonicalSheetEditor
        instance={instance}
        projectId={instance.projectId}
      />,
    )

    expect(
      await screen.findByText(/Calculation results are stale/),
    ).toBeTruthy()
    workspaceHttp.calculations.mockResolvedValue(resultsFor('current'))
    await userEvent.click(screen.getByRole('button', { name: 'Recalculate' }))

    await waitFor(() =>
      expect(screen.queryByText(/Calculation results are stale/)).toBeNull(),
    )
  })

  it('offers the New-run draft row where a run can start', async () => {
    const instance = await composedInstance()
    rpcMock.mockResolvedValue(twoDatasetWire())
    await renderWorkspace(
      <CanonicalSheetEditor
        instance={instance}
        projectId={instance.projectId}
      />,
    )

    expect(
      screen.getByRole('rowheader', {
        name: 'New run — type a condition or paste rows',
      }),
    ).toBeTruthy()
  })

  it('withholds the New-run draft row when the Sheet is read-only', async () => {
    const instance = await composedInstance()
    rpcMock.mockResolvedValue(twoDatasetWire())
    await renderWorkspace(
      <CanonicalSheetEditor instance={instance} projectId={null} readOnly />,
    )

    expect(
      screen.queryByRole('rowheader', {
        name: 'New run — type a condition or paste rows',
      }),
    ).toBeNull()
  })
})

describe('CanonicalSheetEditor — cell conflict inspector (EXP-05.4)', () => {
  const CONFLICT = '21000000-0000-4000-8000-0000000000c1'

  /**
   * A local Sheet whose one column is a quantity field, so the conflict
   * inspector can show the cell's label and its storage unit.
   */
  function conflictInstance(): SheetInstance {
    const base = validSheetInstanceState()
    const field = base.localFields[0]

    return {
      id: INSTANCE,
      workspaceId: '21000000-0000-4000-8000-000000000009',
      projectId: '21000000-0000-4000-8000-00000000000a',
      notebookRecordId: '21000000-0000-4000-8000-00000000000b',
      sourceDefinitionVersionId: null,
      name: 'Conflict sheet',
      description: null,
      lifecycle: 'active',
      revision: 1,
      state: {
        ...base,
        localFields: [
          {
            ...field,
            label: 'Capsid titre',
            logicalType: 'decimal',
            quantity: {
              kind: 'concentration',
              dimension: 'concentration',
              storageUnit: 'mg/mL',
            },
          },
        ],
        localValues: { [ROW_A]: { [field.fieldId]: 91 } },
        presentation: { ...base.presentation, filters: [], sorts: [] },
      },
      duplicatedFromInstanceId: null,
      createdAt: '2026-08-16T12:00:00.000Z',
      updatedAt: '2026-08-16T12:00:00.000Z',
      createdByUserId: 'u1',
      updatedByUserId: 'u1',
    }
  }

  function openConflict(fieldId: string): CellConflictRow {
    return {
      id: CONFLICT,
      sheet_instance_id: INSTANCE,
      row_key: ROW_A,
      field_id: fieldId,
      local_value: 91,
      local_author_user_id: 'member',
      local_at: '2026-10-10T10:14:00.000Z',
      remote_value: 88.5,
      remote_author_user_id: 'priya',
      remote_at: '2026-10-10T10:09:00.000Z',
      state: 'open',
      resolved_value: null,
      resolved_by_user_id: null,
      resolved_at: null,
      reason: null,
    }
  }

  it('renders the conflict on the selected cell, resolves through the RPC and refreshes the Sheet and work items', async () => {
    const user = userEvent.setup()
    const instance = conflictInstance()
    const fieldId = instance.state.localFields[0].fieldId
    const open = openConflict(fieldId)

    const resolved: CellConflictRow = {
      ...open,
      state: 'resolved',
      resolved_value: open.remote_value,
      resolved_by_user_id: 'member',
      resolved_at: '2026-10-10T11:00:00.000Z',
      reason: 'Use the online value',
    }

    listMock.mockImplementation(async (resource: string) =>
      resource === 'sheet_cell_conflicts' ? [open] : [],
    )
    rpcMock.mockImplementation(async (name: string) =>
      name === 'resolve_cell_conflict' ? resolved : {},
    )

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    await renderWorkspace(
      <CanonicalSheetEditor
        instance={instance}
        projectId={instance.projectId}
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
      queryClient,
    )

    // The Sheet-wide count is offered with a way to reach the first conflict.
    await waitFor(() =>
      expect(screen.getByText('1 open cell conflict')).toBeTruthy(),
    )
    await user.click(
      screen.getByRole('button', { name: 'Review first conflict' }),
    )
    expect(gridCell(0, 0).classList.contains('active-cell')).toBe(true)

    // Selecting the conflicted cell is what puts it in the inspector.
    selectGridCell(0, 0)
    expect(
      await screen.findByRole('complementary', { name: 'Resolve conflict' }),
    ).toBeTruthy()
    expect(screen.getByText(/row 1, Capsid titre/)).toBeTruthy()
    expect(screen.getByText('88.5 mg/mL')).toBeTruthy()

    await user.type(
      screen.getByRole('textbox', { name: 'Reason' }),
      'Use the online value',
    )
    await user.click(screen.getByRole('button', { name: 'Resolve' }))

    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith('resolve_cell_conflict', {
        p_conflict_id: CONFLICT,
        p_value: 88.5,
        p_reason: 'Use the online value',
      }),
    )
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['sheet-instance', INSTANCE],
      }),
    )
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['work-items', 'list'],
      }),
    )
    expect(await screen.findByText('Resolved')).toBeTruthy()
  })

  it('renders no conflict panel when the Sheet has no open conflicts', async () => {
    const instance = conflictInstance()
    await renderWorkspace(
      <CanonicalSheetEditor
        instance={instance}
        projectId={instance.projectId}
      />,
    )
    await waitFor(() =>
      expect(listMock).toHaveBeenCalledWith(
        'sheet_cell_conflicts',
        expect.any(String),
      ),
    )
    selectGridCell(0, 0)
    expect(
      screen.queryByRole('complementary', { name: 'Resolve conflict' }),
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Review first conflict' }),
    ).toBeNull()
  })
})

describe('CanonicalSheetWorkspace — stale cell write (GRID-04 parity)', () => {
  /** A local-only Sheet whose first column accepts edits. */
  async function editableLocalInstance(): Promise<SheetInstance> {
    const base = await composedInstance()
    const state = validSheetInstanceState()

    return {
      ...base,
      sourceDefinitionVersionId: null,
      state: {
        ...state,
        bindings: [],
        presentation: { ...state.presentation, filters: [], sorts: [] },
      },
    }
  }

  it('re-reads the instance and retries the committed cell once when a sibling write moved the revision', async () => {
    const instance = await editableLocalInstance()

    const fresh: SheetInstance = {
      ...instance,
      revision: instance.revision + 1,
    }

    workspaceHttp.local
      .mockResolvedValueOnce(
        Response.json(
          {
            code: 'stale_revision',
            message: 'stale revision: the Sheet moved on',
          },
          { status: 409 },
        ),
      )
      .mockResolvedValue(instanceWire(fresh))
    listMock.mockImplementation(async (resource: string) =>
      resource === 'sheet_instances'
        ? [
            {
              id: fresh.id,
              workspace_id: fresh.workspaceId,
              project_id: fresh.projectId,
              notebook_record_id: fresh.notebookRecordId,
              source_definition_version_id: fresh.sourceDefinitionVersionId,
              name: fresh.name,
              description: fresh.description,
              lifecycle: fresh.lifecycle,
              revision: fresh.revision,
              state: fresh.state,
              duplicated_from_instance_id: fresh.duplicatedFromInstanceId,
              created_at: fresh.createdAt,
              updated_at: fresh.updatedAt,
              created_by_user_id: fresh.createdByUserId,
              updated_by_user_id: fresh.updatedByUserId,
            },
          ]
        : [],
    )
    await renderWorkspace(
      <CanonicalSheetEditor
        instance={instance}
        projectId={instance.projectId}
      />,
    )
    const rowId = Object.keys(instance.state.localValues)[0]
    const columnId = instance.state.localFields[0].fieldId
    selectGridCell(0, 0)
    pasteGrid('committed once')
    await waitFor(() => expect(workspaceHttp.local).toHaveBeenCalledTimes(2))
    const calls = workspaceHttp.local.mock.calls
    expect(calls[0][0]).toMatchObject({
      p_expected_revision: instance.revision,
      p_cells: [{ rowKey: rowId, fieldId: columnId, value: 'committed once' }],
    })
    expect(calls[1][0]).toMatchObject({
      p_expected_revision: fresh.revision,
      p_cells: [{ rowKey: rowId, fieldId: columnId, value: 'committed once' }],
    })
    expect(workspaceHttp.local).toHaveBeenCalledTimes(2)
  })

  it('states a non-stale failure instead of retrying it', async () => {
    const instance = await editableLocalInstance()
    workspaceHttp.local.mockResolvedValue(
      Response.json(
        { code: 'invalid_value', message: 'the value is not a number' },
        { status: 400 },
      ),
    )
    await renderWorkspace(
      <CanonicalSheetEditor
        instance={instance}
        projectId={instance.projectId}
      />,
    )
    selectGridCell(0, 0)
    pasteGrid('nope')
    await waitFor(() =>
      // The inspector renders its content in the desktop aside and in the
      // mobile sheet, so the status line appears twice.
      expect(screen.getAllByText('the value is not a number')).not.toHaveLength(
        0,
      ),
    )
    expect(workspaceHttp.local).toHaveBeenCalledTimes(1)
  })
})
