/**
 * SCI-03 analysis block contract tests: payload validation (draft,
 * definition reference, frozen shape) and the frozen-evidence guarantee —
 * frozen payloads pin an immutable Dataset Version (metadata + provenance,
 * never rows), and re-executing runAnalysis over that Version's rows
 * reproduces the same result without any live reads.
 */
import { describe, expect, it } from 'vitest'

import { validateAnalysisBlockPayload } from './analysis-block'
import type { AnalysisBlockPayload, FrozenAnalysis } from './analysis-block'
import type { AnalysisDefinition } from './analysis-definition'
import { runAnalysis } from './analysis-definition'
import { fetchFrozenAnalysisRows } from './chart-data'
import type { ChartColumn } from './chart-spec'
import type { DataClient } from './data-client'

const DATASET_ID = '0198d970-e266-4000-8000-000000000001'
const FIELD_TIME = '0198d970-e266-4000-8000-000000000002'
const FIELD_RECOVERY = '0198d970-e266-4000-8000-000000000003'
const VERSION_ID = '0198d970-e266-4000-8000-00000000000a'

const DEFINITION: AnalysisDefinition = {
  definitionVersion: 1,
  kind: 'regression',
  datasets: [{ datasetId: DATASET_ID }],
  outcome: { fieldId: FIELD_RECOVERY },
  predictor: { fieldId: FIELD_TIME },
  degree: 1,
}

function frozen(): FrozenAnalysis {
  return {
    revisionId: null,
    frozenAt: '2026-08-23T10:00:00Z',
    frozenByUserId: 'user-1',
    definition: DEFINITION,
    definitionName: 'Recovery slope',
    definitionVersion: 4,
    columns: [
      { fieldId: FIELD_TIME, label: 'Time (h)', logicalType: 'integer' },
      {
        fieldId: FIELD_RECOVERY,
        label: 'Recovery (%)',
        logicalType: 'decimal',
      },
    ],
    datasetProvenance: [
      {
        datasetId: DATASET_ID,
        datasetVersionId: VERSION_ID,
        schemaVersionNumber: 2,
        sourceDatasetRevision: 41,
        rowCount: 3,
        checksum: 'abc123',
      },
    ],
  }
}

function completePayload(): AnalysisBlockPayload {
  return {
    title: 'Recovery over time',
    definitionId: '0198d970-e266-4000-8000-000000000009',
    provenance: 'From the stability assay',
    frozen: null,
  }
}

describe('validateAnalysisBlockPayload', () => {
  it('accepts an empty draft and a complete payload', () => {
    expect(validateAnalysisBlockPayload({})).toEqual([])
    expect(validateAnalysisBlockPayload(completePayload())).toEqual([])
  })

  it('requires a title and a saved definition reference', () => {
    const errors = validateAnalysisBlockPayload({ title: '' })
    expect(errors).toContainEqual(expect.objectContaining({ field: 'title' }))
    expect(errors).toContainEqual(
      expect.objectContaining({ field: 'definitionId' }),
    )
  })

  it('validates the pinned definition inside a frozen payload', () => {
    const errors = validateAnalysisBlockPayload({
      ...completePayload(),
      frozen: {
        ...frozen(),
        definition: {
          ...DEFINITION,
          degree: 99,
        } as unknown as AnalysisDefinition,
      },
    })
    expect(errors).toContainEqual(
      expect.objectContaining({
        field: expect.stringContaining('frozen.definition'),
      }),
    )
  })

  it('rejects a frozen payload that embeds source rows', () => {
    // Frozen evidence pins Dataset Versions; a `data` key would turn the
    // block into a bulk data store and is never accepted.
    const errors = validateAnalysisBlockPayload({
      ...completePayload(),
      frozen: {
        ...frozen(),
        data: {
          columns: [],
          rows: [{ [FIELD_TIME]: 0, [FIELD_RECOVERY]: 1 }],
        },
      },
    })
    expect(errors).toContainEqual(
      expect.objectContaining({ field: 'frozen.data' }),
    )
  })

  it('pins exactly one Dataset Version in datasetProvenance', () => {
    for (const datasetProvenance of [
      [],
      [
        ...frozen().datasetProvenance,
        {
          datasetId: DATASET_ID,
          datasetVersionId: '0198d970-e266-4000-8000-00000000000b',
          schemaVersionNumber: 2,
          sourceDatasetRevision: 41,
          rowCount: 3,
          checksum: 'def456',
        },
      ],
    ]) {
      const errors = validateAnalysisBlockPayload({
        ...completePayload(),
        frozen: { ...frozen(), datasetProvenance },
      })
      expect(errors).toContainEqual(
        expect.objectContaining({ field: 'frozen.datasetProvenance' }),
      )
    }
  })

  it('rejects provenance entries without rowCount and checksum', () => {
    const errors = validateAnalysisBlockPayload({
      ...completePayload(),
      frozen: {
        ...frozen(),
        datasetProvenance: [
          {
            datasetId: DATASET_ID,
            datasetVersionId: VERSION_ID,
            schemaVersionNumber: 2,
            sourceDatasetRevision: 41,
            rowCount: -1,
            checksum: '',
          },
        ],
      },
    })
    expect(errors).toContainEqual(
      expect.objectContaining({ field: 'frozen.datasetProvenance' }),
    )
  })
})

describe('frozen evidence reproduction', () => {
  it('re-executes identically over the pinned Dataset Version inputs', async () => {
    const snapshot = frozen()
    // The immutable Version holds exactly the rows the provenance pinned;
    // fetchFrozenAnalysisRows pages them back and verifies the row count.
    const versionRows = [
      {
        rowId: 'r1',
        revision: 1,
        values: { [FIELD_TIME]: 0, [FIELD_RECOVERY]: 1 },
      },
      {
        rowId: 'r2',
        revision: 1,
        values: { [FIELD_TIME]: 24, [FIELD_RECOVERY]: 3 },
      },
      {
        rowId: 'r3',
        revision: 1,
        values: { [FIELD_TIME]: 48, [FIELD_RECOVERY]: 5 },
      },
    ]
    const client = {
      rpc: async (
        _name: string,
        args: { p_limit: number; p_offset: number },
      ) => ({
        rows: versionRows.slice(args.p_offset, args.p_offset + args.p_limit),
        totalCount: versionRows.length,
      }),
    } as unknown as DataClient

    const pinned = await fetchFrozenAnalysisRows(
      client,
      snapshot.datasetProvenance[0].datasetVersionId,
      snapshot.datasetProvenance[0].rowCount,
    )
    expect(pinned.matchesProvenance).toBe(true)
    expect(pinned.totalCount).toBe(3)

    const columns: ChartColumn[] = snapshot.columns.map((c) => ({
      id: c.fieldId,
      label: c.label,
      logicalType: c.logicalType,
    }))
    const first = runAnalysis(snapshot.definition, columns, pinned.rows)
    const second = runAnalysis(snapshot.definition, columns, pinned.rows)
    expect(first).toEqual(second)
    if (!first.ok || first.result.kind !== 'regression') return
    expect(first.result.rows[0]).toMatchObject({ group: 'all', n: 3 })
    expect(first.result.rows[0].coefficients[1]).toBeCloseTo(2 / 24, 6)
  })

  it('flags a Version whose row count diverged from the pinned provenance', async () => {
    // The Version grew to 7 rows after the freeze pinned 3; the paged read
    // must report the divergence rather than reconstruct partial evidence.
    const versionRows = Array.from({ length: 7 }, (_, i) => ({
      rowId: `r${i + 1}`,
      revision: 2,
      values: { [FIELD_TIME]: i, [FIELD_RECOVERY]: i },
    }))
    const client = {
      rpc: async (
        _name: string,
        args: { p_limit: number; p_offset: number },
      ) => ({
        rows: versionRows.slice(args.p_offset, args.p_offset + args.p_limit),
        totalCount: versionRows.length,
      }),
    } as unknown as DataClient
    const pinned = await fetchFrozenAnalysisRows(client, VERSION_ID, 3)
    expect(pinned.matchesProvenance).toBe(false)
    expect(pinned.totalCount).toBe(7)
  })
})
