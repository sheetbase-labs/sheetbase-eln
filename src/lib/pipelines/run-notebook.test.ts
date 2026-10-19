import { describe, expect, it, vi } from 'vitest'

import {
  addRunToNotebook,
  runCitationLines,
  runCitationPayload,
} from './run-notebook'
import type { DataClient } from '#/lib/data-client'

const mutations = vi.hoisted(() => ({
  insertBlock: vi.fn(async () => ({ block: {}, structureVersion: 3 })),
}))
vi.mock('#/lib/notebook-mutations', () => mutations)
vi.mock('#/lib/notebook-data', () => ({
  fetchRecord: vi.fn(async () => ({
    identifier: 'EXP-0001',
    structureVersion: 7,
  })),
}))

const run = {
  id: '12345678-aaaa',
  status: 'succeeded' as const,
  started_at: '2026-10-19T09:30:11Z',
  input_versions: { readings: 'abcdef12-0000' },
}

describe('runCitationLines', () => {
  it('names the run, version, inputs and kept snapshots', () => {
    const lines = runCitationLines(run, {
      pipelineKey: 'qc-daily',
      versionNumber: 5,
      outputs: [{ label: 'Summary', dataset_version_id: '99887766-bbbb' }],
    })
    expect(lines[0]).toBe(
      'Pipeline run 12345678 of qc-daily v5 succeeded, started 2026-10-19 09:30.',
    )
    expect(lines[1]).toBe('Inputs: readings (abcdef12).')
    expect(lines[2]).toBe('Kept: Summary (snapshot 99887766).')
  })

  it('leaves out inputs and outputs it does not have', () => {
    const lines = runCitationLines(
      { ...run, input_versions: {} },
      { pipelineKey: 'qc-daily', versionNumber: null, outputs: [] },
    )
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('qc-daily succeeded')
  })
})

describe('addRunToNotebook', () => {
  it('inserts a rich text block at the notebook structure version', async () => {
    const result = await addRunToNotebook({} as DataClient, {
      recordId: 'rec-1',
      lines: ['One.', 'Two.'],
    })
    expect(result.identifier).toBe('EXP-0001')
    expect(mutations.insertBlock).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        recordId: 'rec-1',
        type: 'rich_text',
        expectedStructureVersion: 7,
        payload: runCitationPayload(['One.', 'Two.']),
      }),
    )
  })
})
