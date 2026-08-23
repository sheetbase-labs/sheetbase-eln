/**
 * SCI-03 analysis block contract tests: payload validation (draft,
 * definition reference, frozen shape) and the frozen-evidence guarantee —
 * re-executing runAnalysis over pinned inputs reproduces the same result
 * without any live reads.
 */
import { describe, expect, it } from 'vitest'

import { validateAnalysisBlockPayload } from './analysis-block'
import type { AnalysisBlockPayload, FrozenAnalysis } from './analysis-block'
import type { AnalysisDefinition } from './analysis-definition'
import { runAnalysis } from './analysis-definition'
import type { ChartColumn } from './chart-spec'

const TABLE_ID = '0198d970-e266-4000-8000-000000000001'

const DEFINITION: AnalysisDefinition = {
  definitionVersion: 1,
  kind: 'regression',
  datasets: [{ tableId: TABLE_ID }],
  outcome: {
    columnId: '0198d970-e266-4000-8000-000000000003',
    fieldName: 'recovery',
  },
  predictor: {
    columnId: '0198d970-e266-4000-8000-000000000002',
    fieldName: 'time_h',
  },
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
    datasetProvenance: [
      { tableId: TABLE_ID, schemaVersion: 2, rowCount: 3, checksum: 'abc123' },
    ],
    data: {
      columns: [
        {
          columnId: '0198d970-e266-4000-8000-000000000002',
          fieldName: 'time_h',
          label: 'Time (h)',
          logicalType: 'integer',
        },
        {
          columnId: '0198d970-e266-4000-8000-000000000003',
          fieldName: 'recovery',
          label: 'Recovery (%)',
          logicalType: 'decimal',
        },
      ],
      rows: [
        { time_h: 0, recovery: 1 },
        { time_h: 24, recovery: 3 },
        { time_h: 48, recovery: 5 },
      ],
    },
  }
}

describe('validateAnalysisBlockPayload', () => {
  it('accepts an empty draft and a complete payload', () => {
    expect(validateAnalysisBlockPayload({})).toEqual([])
    const payload: AnalysisBlockPayload = {
      title: 'Recovery over time',
      definitionId: TABLE_ID.replace(/1$/, '2'),
      provenance: 'From the stability assay',
      frozen: null,
    }
    expect(validateAnalysisBlockPayload(payload)).toEqual([])
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
      title: 'T',
      definitionId: '0198d970-e266-4000-8000-000000000009',
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
})

describe('frozen evidence reproduction', () => {
  it('re-executes identically over the pinned inputs', () => {
    const snapshot = frozen()
    const columns: ChartColumn[] = snapshot.data.columns.map((c) => ({
      id: c.columnId,
      fieldName: c.fieldName,
      label: c.label,
      logicalType: c.logicalType,
    }))
    const first = runAnalysis(snapshot.definition, columns, snapshot.data.rows)
    const second = runAnalysis(snapshot.definition, columns, snapshot.data.rows)
    expect(first).toEqual(second)
    expect(first.ok && first.result.rows[0]).toMatchObject({
      group: 'all',
      n: 3,
    })
    if (first.ok && first.result.kind === 'regression') {
      expect(first.result.rows[0].coefficients[1]).toBeCloseTo(2 / 24, 6)
    }
  })
})
