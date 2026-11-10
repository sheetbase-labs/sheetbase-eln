import { describe, expect, it } from 'vitest'

import {
  coerceDatasetCellValue,
  columnsForPinnedSchemaVersion,
  commitDatasetRowBatch,
  createDataset,
  datasetRowsToCsv,
  describeDatasetCommitError,
  listPublishedDatasetSchemas,
  parseTsvRows,
  sheetLinksFromDependencies,
  snapshotDataset,
} from './dataset-product'
import type { DataClient } from './data-client'
import type { ScientificColumnWire } from './scientific-sheet-data'

/** The row a fake `insert` receives. */
type InsertRow = Parameters<DataClient['insert']>[1]

/** The arguments a fake `rpc` receives. */
type RpcArgs = Parameters<DataClient['rpc']>[1]

/** What the catalogue answers a Dataset create with in these tests. */
interface CreatedDatasetReply {
  id: string
  name?: string
  revision?: number
}

/** What a Dataset RPC answers with in these tests. */
interface RpcReply {
  ok?: boolean
  id?: string
  datasetRevision?: number
}

/** Either reply a fake answers with. */
type FakeReply = CreatedDatasetReply | RpcReply

/**
 * The DataClient these tests work against: only the methods a test supplies
 * answer, and every other method refuses, so a call the test did not plan fails
 * loudly instead of reaching the network.
 */
function fakeDataClient(overrides: Partial<DataClient> = {}): DataClient {
  const refuse = () =>
    Promise.reject(new Error('This test answers no other client method.'))

  return {
    list: refuse,
    count: refuse,
    rpc: refuse,
    insert: refuse,
    patch: refuse,
    remove: refuse,
    ...overrides,
  }
}

/** An `insert` that records each call and answers with the fixed reply. */
function insertReturning(reply: FakeReply) {
  const calls: Array<Parameters<DataClient['insert']>> = []

  const insert: DataClient['insert'] = async <T>(
    resource: string,
    row: InsertRow,
  ): Promise<T> => {
    calls.push([resource, row])

    // SAFETY: the fake answers every insert with the fixed reply the test supplies; the caller's generic is the type it reads that reply as.
    return reply as T
  }

  return { calls, insert }
}

/** An `rpc` that records each call and answers with the fixed reply. */
function rpcReturning(reply: FakeReply) {
  const calls: Array<Parameters<DataClient['rpc']>> = []

  const rpc: DataClient['rpc'] = async <T>(
    name: string,
    args: RpcArgs,
  ): Promise<T> => {
    calls.push([name, args])

    // SAFETY: the fake answers every RPC with the fixed reply the test supplies; the caller's generic is the type it reads that reply as.
    return reply as T
  }

  return { calls, rpc }
}

function column(
  overrides: Partial<ScientificColumnWire> = {},
): ScientificColumnWire {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    field_name: '11111111-1111-4111-8111-111111111111',
    label: 'pH',
    display_order: 0,
    logical_type: 'decimal',
    nullable: true,
    unit: null,
    validation: {},
    width: null,
    options: [],
    ...overrides,
  }
}

describe('listPublishedDatasetSchemas', () => {
  it('pairs active Schema Definitions with their latest published Version', async () => {
    const definitions = [
      {
        id: 'def-1',
        key: 'assay',
        name: 'Assay',
        description: null,
        lifecycle: 'active',
      },
      {
        id: 'def-2',
        key: 'retired',
        name: 'Retired',
        description: null,
        lifecycle: 'active',
      },
    ]

    const versions = [
      {
        id: 'ver-2',
        schema_id: 'def-1',
        version: 2,
        lifecycle: 'active',
        published_at: '2026-01-02',
      },
      {
        id: 'ver-1',
        schema_id: 'def-1',
        version: 1,
        lifecycle: 'active',
        published_at: '2026-01-01',
      },
    ]

    const list: DataClient['list'] = async <T>(
      resource: string,
    ): Promise<T[]> => {
      const rows =
        resource === 'dataset_schema_definitions' ? definitions : versions

      // SAFETY: the fixtures are the rows each of these two resources holds in the catalogue this test describes.
      return rows as T[]
    }

    const options = await listPublishedDatasetSchemas(fakeDataClient({ list }))

    expect(options).toEqual([
      {
        schemaDefinitionId: 'def-1',
        schemaVersionId: 'ver-2',
        key: 'assay',
        name: 'Assay',
        description: null,
        version: 2,
      },
    ])
  })
})

describe('createDataset', () => {
  it('inserts api.datasets with the selected Schema Version', async () => {
    const { calls, insert } = insertReturning({
      id: 'ds-1',
      name: 'HPLC results',
      revision: 1,
    })

    const created = await createDataset(fakeDataClient({ insert }), {
      workspaceId: 'ws-1',
      schemaVersionId: 'ver-2',
      name: '  HPLC results  ',
      description: 'live',
    })

    expect(calls).toEqual([
      [
        'datasets',
        {
          workspace_id: 'ws-1',
          schema_version_id: 'ver-2',
          name: 'HPLC results',
          description: 'live',
          primary_project_id: null,
          // The catalogue has no database-side default for the creator, so a
          // create that is given no person records none rather than guessing.
          created_by_user_id: null,
        },
      ],
    ])
    expect(created).toEqual({ id: 'ds-1', name: 'HPLC results', revision: 1 })
  })

  it('records the person a new Dataset is attributed to', async () => {
    const { calls, insert } = insertReturning({
      id: 'ds-2',
      name: 'HPLC results',
      revision: 1,
    })

    await createDataset(fakeDataClient({ insert }), {
      workspaceId: 'ws-1',
      schemaVersionId: 'ver-2',
      name: 'HPLC results',
      createdByUserId: 'user-9',
    })
    expect(calls[0]?.[1]).toMatchObject({
      schema_version_id: 'ver-2',
      created_by_user_id: 'user-9',
    })
  })
})

describe('snapshot and live-edit RPCs', () => {
  it('snapshots through snapshot_dataset', async () => {
    const { calls, rpc } = rpcReturning({ id: 'ver-snap' })

    await snapshotDataset(fakeDataClient({ rpc }), {
      datasetId: 'ds-1',
      expectedRevision: 4,
      label: '  Freeze A  ',
    })
    expect(calls[0]).toEqual([
      'snapshot_dataset',
      {
        p_dataset_id: 'ds-1',
        p_expected_dataset_revision: 4,
        p_label: 'Freeze A',
      },
    ])
  })

  it('commits live edits through commit_dataset_row_batch', async () => {
    const { calls, rpc } = rpcReturning({ ok: true, datasetRevision: 5 })

    const result = await commitDatasetRowBatch(fakeDataClient({ rpc }), {
      datasetId: 'ds-1',
      expectedRevision: 4,
      idempotencyKey: 'edit-1',
      rows: [
        {
          operation: 'update',
          rowId: 'row-1',
          expectedRevision: 2,
          values: { f1: 7.1 },
        },
      ],
    })

    expect(calls[0]?.[0]).toBe('commit_dataset_row_batch')
    expect(result.ok).toBe(true)
  })
})

describe('cell coercion, TSV paste and CSV export', () => {
  it('coerces typed values and rejects invalid numbers', () => {
    expect(coerceDatasetCellValue(column(), '7.4')).toBe(7.4)
    expect(
      coerceDatasetCellValue(column({ logical_type: 'boolean' }), 'yes'),
    ).toBe(true)
    expect(
      coerceDatasetCellValue(column({ logical_type: 'text' }), ''),
    ).toBeNull()
    expect(() => coerceDatasetCellValue(column(), 'nope')).toThrow(
      /Invalid number/,
    )
    expect(
      coerceDatasetCellValue(column({ logical_type: 'integer' }), '12'),
    ).toBe(12)
    expect(
      coerceDatasetCellValue(column({ logical_type: 'integer' }), '-3'),
    ).toBe(-3)
    expect(() =>
      coerceDatasetCellValue(column({ logical_type: 'integer' }), '1.5'),
    ).toThrow(/Invalid integer/)
    expect(() =>
      coerceDatasetCellValue(column({ logical_type: 'integer' }), '12abc'),
    ).toThrow(/Invalid integer/)
    expect(() =>
      coerceDatasetCellValue(column({ logical_type: 'decimal' }), '12abc'),
    ).toThrow(/Invalid number/)
    expect(() =>
      coerceDatasetCellValue(column({ logical_type: 'boolean' }), 'maybe'),
    ).toThrow(/Invalid boolean/)
  })

  it('maps TSV lines onto Schema fields in display order', () => {
    const rows = parseTsvRows('A\t7.2\nB\t7.4', [
      column({
        id: 'f-text',
        field_name: 'f-text',
        label: 'Sample',
        logical_type: 'text',
      }),
      column({ id: 'f-ph', field_name: 'f-ph' }),
    ])

    expect(rows).toHaveLength(2)
    expect(rows[0]?.operation).toBe('create')
    expect(rows[0]?.values).toEqual({ 'f-text': 'A', 'f-ph': 7.2 })
  })

  it('exports current rows as CSV using Schema labels', () => {
    const csv = datasetRowsToCsv(
      [
        column({
          id: 'f-text',
          field_name: 'f-text',
          label: 'Sample',
          logical_type: 'text',
        }),
        column({ id: 'f-ph', field_name: 'f-ph' }),
      ],
      [{ 'f-text': 'A,1', 'f-ph': 7.2 }],
    )

    expect(csv).toBe('Sample,pH\n"A,1",7.2')
  })
})

describe('describeDatasetCommitError and Sheet links', () => {
  it('maps the first Core validation code', () => {
    expect(
      describeDatasetCommitError({
        ok: false,
        errors: [{ code: 'required_value' }],
      }),
    ).toBe('A required field is missing.')
  })

  it('extracts Sheet Instance deep links from dependency discovery', () => {
    expect(
      sheetLinksFromDependencies([
        {
          kind: 'sheet_instance',
          id: 'inst-1',
          relation: 'resolved_dataset_binding',
          liveness: 'active',
          effect: 'blocks_deletion',
          label: 'Assay grid',
        },
        {
          kind: 'dataset_version',
          id: 'ver-1',
          relation: 'snapshot_of_dataset',
          liveness: 'historical',
          effect: 'blocks_deletion',
          label: 'ver-1',
        },
      ]),
    ).toEqual([{ instanceId: 'inst-1', name: 'Assay grid', historical: false }])
  })
})

describe('historical Schema Version columns', () => {
  it('uses the pinned Schema Version fields, not later live Schema columns', () => {
    const liveColumnIds = ['ph-field', 'colour-field']

    const historical = columnsForPinnedSchemaVersion([
      {
        field_id: 'ph-field',
        key: 'ph',
        label: 'pH',
        description: null,
        logical_type: 'decimal',
        nullable: true,
        cardinality: 'one',
        lifecycle: 'active',
        display_order: 0,
      },
      {
        field_id: 'retired-field',
        key: 'old',
        label: 'Retired',
        description: null,
        logical_type: 'text',
        nullable: true,
        cardinality: 'one',
        lifecycle: 'retired',
        display_order: 1,
      },
    ])

    expect(historical.map((entry) => entry.id)).toEqual(['ph-field'])
    expect(historical.map((entry) => entry.label)).toEqual(['pH'])
    expect(historical.map((entry) => entry.id)).not.toEqual(liveColumnIds)
    expect(historical.some((entry) => entry.id === 'colour-field')).toBe(false)
  })
})
