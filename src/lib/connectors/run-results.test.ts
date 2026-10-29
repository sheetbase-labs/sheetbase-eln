import { describe, expect, it, vi } from 'vitest'

import { recordRunSampleResults, sampleResultsFromPayload } from './run-results'
import type { DataClient } from '../data-client'

const payload = (
  headers: string[],
  rows: string[][],
  metadata: Record<string, string> = {},
) => ({
  headers,
  rows: rows.map((cells) =>
    Object.fromEntries(headers.map((header, i) => [header, cells[i] ?? ''])),
  ),
  metadata,
  warnings: [],
})

describe('sampleResultsFromPayload', () => {
  it('makes a reading for each numeric column, with the unit the file gave', () => {
    const results = sampleResultsFromPayload(
      payload(
        ['Sample', 'Turbidity', 'Dilution', 'Timestamp'],
        [
          ['SMP-1', '12.4', '1', '2026-09-25T09:02:11'],
          ['SMP-2', '13.1', '1', '2026-09-25T09:02:41'],
        ],
        { 'Turbidity unit': 'NTU' },
      ),
    )
    expect(results).toEqual([
      {
        sample: 'SMP-1',
        checks: [{ name: 'Turbidity', type: 'info', value: 12.4, unit: 'NTU' }],
      },
      {
        sample: 'SMP-2',
        checks: [{ name: 'Turbidity', type: 'info', value: 13.1, unit: 'NTU' }],
      },
    ])
  })

  it('reads a pass or fail column as the instrument’s own verdict', () => {
    const [one, two, three] = sampleResultsFromPayload(
      payload(
        ['Sample ID', 'Viability', 'QC'],
        [
          ['A', '96,1', 'Pass'],
          ['B', '71', 'FAIL'],
          ['C', '88', 'maybe'],
        ],
      ),
    )
    expect(one.checks).toEqual([
      { name: 'Viability', type: 'info', value: 96.1 },
      { name: 'QC', type: 'pass' },
    ])
    expect(two.checks).toContainEqual({
      name: 'QC',
      type: 'fail',
      message: 'FAIL',
    })
    // A word that isn't a verdict is not turned into one.
    expect(three.checks.map((c) => c.type)).toEqual(['info'])
  })

  it('skips a column that is not all numbers, and files with no sample column', () => {
    const [row] = sampleResultsFromPayload(
      payload(['Sample', 'Colour', 'pH'], [['A', 'amber', '7.2']]),
    )
    expect(row.checks.map((c) => c.name)).toEqual(['pH'])
    expect(
      sampleResultsFromPayload(payload(['Well', 'OD'], [['A1', '0.2']])),
    ).toEqual([])
  })

  it('keeps every row of a sample that was read more than once', () => {
    const [one] = sampleResultsFromPayload(
      payload(
        ['Sample', 'OD'],
        [
          ['A', '0.2'],
          ['A', '0.3'],
        ],
      ),
    )
    expect(one.checks).toHaveLength(2)
  })
})

describe('recordRunSampleResults', () => {
  it('sends the results in chunks and adds the outcomes up', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ linked: 1, checks: 1, unknown: ['X'] })
    const client = { rpc } as unknown as DataClient
    const results = Array.from({ length: 401 }, (_, i) => ({
      sample: `S-${i}`,
      checks: [],
    }))
    const outcome = await recordRunSampleResults(client, {
      workspaceId: 'w',
      runId: 'r',
      results,
    })
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc.mock.calls[0][1].p_results).toHaveLength(400)
    expect(outcome).toEqual({ linked: 2, checks: 2, unknown: ['X', 'X'] })
  })
})
