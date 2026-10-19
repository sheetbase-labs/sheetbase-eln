import { describe, expect, it, vi } from 'vitest'

import {
  blocksForNewRun,
  setExperimentStatus,
  startExperimentRecord,
} from '#/lib/experiment-lifecycle'
import type { DataClient } from '#/lib/data-client'

const block = (
  type: string,
  order: number,
  payload: Record<string, unknown> = {},
) => ({ type, payload, payloadSchemaVersion: 1, order })

describe('blocksForNewRun', () => {
  it('keeps the writing and method in order and drops the results', () => {
    const kept = blocksForNewRun([
      block('chart', 3),
      block('rich_text', 2, { doc: 'method' }),
      block('analysis', 4),
      block('rich_text', 1, { doc: 'aim' }),
    ])
    expect(kept.map((b) => b.payload)).toEqual([
      { doc: 'aim' },
      { doc: 'method' },
    ])
    expect(kept.map((b) => b.order)).toEqual([1, 2])
  })

  it('unchecks checklist items so the run starts clean', () => {
    const [kept] = blocksForNewRun([
      block('checklist', 1, {
        items: [
          { id: 'a', text: 'Thaw', checked: true },
          { id: 'b', text: 'Spin', checked: true },
        ],
      }),
    ])
    expect(kept.payload.items).toEqual([
      { id: 'a', text: 'Thaw', checked: false },
      { id: 'b', text: 'Spin', checked: false },
    ])
  })

  it('never returns an empty notebook', () => {
    const kept = blocksForNewRun([block('chart', 1)])
    expect(kept).toHaveLength(1)
    expect(kept[0].type).toBe('rich_text')
  })
})

describe('status transitions', () => {
  function client() {
    return {
      list: vi.fn(async () => [{ metadata_version: 7 }]),
      rpc: vi.fn(async () => undefined),
    } as unknown as DataClient & {
      rpc: ReturnType<typeof vi.fn>
    }
  }

  it('starts with the record’s current metadata version', async () => {
    const c = client()
    await startExperimentRecord(c, { recordId: 'r1' })
    expect(c.rpc).toHaveBeenCalledWith(
      'start_experiment',
      expect.objectContaining({
        p_record_id: 'r1',
        p_expected_metadata_version: 7,
        p_protocol_version_id: null,
      }),
    )
  })

  it('puts on hold with the reason it was given', async () => {
    const c = client()
    await setExperimentStatus(c, {
      recordId: 'r1',
      status: 'on_hold',
      reason: ' Waiting on reagent ',
    })
    expect(c.rpc).toHaveBeenCalledWith(
      'set_experiment_status',
      expect.objectContaining({
        p_status: 'on_hold',
        p_reason: 'Waiting on reagent',
      }),
    )
  })
})
