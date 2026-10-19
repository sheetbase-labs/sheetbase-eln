import { describe, expect, it, vi } from 'vitest'

import { createDataClient } from './data-client'
import {
  fetchStepDeviations,
  isPinnedProtocolStep,
  normaliseDeviationReason,
  recordDeviationReason,
} from './protocol-deviations'

const BLOCK = '00000000-0000-4000-8000-000000000001'
const DEVIATION = '00000000-0000-4000-8000-000000000002'
const RECORD = '00000000-0000-4000-8000-000000000003'

const row = {
  id: DEVIATION,
  record_id: RECORD,
  block_id: BLOCK,
  protocol_version_id: null,
  frozen_text: 'Hold 14 days',
  recorded_text: 'Hold 21 days',
  reason: null,
  reason_by_user_id: null,
  reason_at: null,
  created_by_user_id: 'sam',
  created_at: '2026-09-01T00:00:00Z',
}

function clientReturning(value: unknown) {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(value), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
  return { client: createDataClient(fetcher), fetcher }
}

describe('protocol deviations client', () => {
  it('reads one step’s deviations newest first', async () => {
    const { client, fetcher } = clientReturning([row])
    expect(await fetchStepDeviations(client, BLOCK)).toEqual([row])
    const url = String(fetcher.mock.calls[0]?.[0])
    expect(url).toContain(`/protocol_deviations?block_id=eq.${BLOCK}`)
    expect(url).toContain('order=created_at.desc')
  })

  it('sends the trimmed reason to the database function', async () => {
    const { client, fetcher } = clientReturning({ ...row, reason: 'Fridge' })
    await recordDeviationReason(client, DEVIATION, '  Fridge  ')
    expect(String(fetcher.mock.calls[0]?.[0])).toContain(
      '/rpc/record_protocol_deviation_reason',
    )
    expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual({
      p_deviation_id: DEVIATION,
      p_reason: 'Fridge',
    })
  })

  it('refuses an empty reason before calling the server', async () => {
    const { client, fetcher } = clientReturning(row)
    await expect(
      recordDeviationReason(client, DEVIATION, '   '),
    ).rejects.toThrow('Say why')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('bounds the reason like the database does', () => {
    expect(normaliseDeviationReason('')).toBeNull()
    expect(normaliseDeviationReason('x'.repeat(2001))).toBeNull()
    expect(normaliseDeviationReason(' ok ')).toBe('ok')
  })

  it('knows a step copied from a protocol by its provenance ids', () => {
    expect(
      isPinnedProtocolStep({
        sourceProtocolRevisionId: 'r',
        sourceStepBlockId: 's',
      }),
    ).toBe(true)
    expect(isPinnedProtocolStep({ text: 'free step' })).toBe(false)
  })
})
