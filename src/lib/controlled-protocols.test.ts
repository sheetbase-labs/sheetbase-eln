import { describe, expect, it, vi } from 'vitest'

import { createDataClient } from './data-client'
import {
  acknowledgeProtocolVersion,
  fetchProtocolAcknowledgements,
  fetchProtocolVersions,
  protocolVersionSchema,
} from './controlled-protocols'

const RECORD = '00000000-0000-4000-8000-00000000b701'
const REVISION = '00000000-0000-4000-8000-00000000b702'
const version = {
  id: REVISION,
  workspace_id: '00000000-0000-4000-8000-00000000b700',
  protocol_record_id: RECORD,
  version: 3,
  status: 'in_review',
  effective_at: null,
  review_due_at: '2027-09-02T00:00:00Z',
  change_summary: 'Preserve 100 LMH ±5 and 2–8 °C hold.',
  created_by_user_id: 'author',
  created_at: '2026-08-28T12:00:00Z',
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

describe('controlled protocol client boundary', () => {
  it('reads actual version numbers and lifecycle without inferring effective from approval', async () => {
    const { client, fetcher } = clientReturning([version])
    expect(await fetchProtocolVersions(client, RECORD)).toEqual([version])
    expect(String(fetcher.mock.calls[0]?.[0])).toContain(
      `/protocol_versions?protocol_record_id=eq.${RECORD}&order=version.desc`,
    )
    expect(
      protocolVersionSchema.safeParse({ ...version, status: 'active' }).success,
    ).toBe(false)
  })

  it('does not accept mutable semantic-version text as revision identity', async () => {
    const { client, fetcher } = clientReturning([])
    await expect(fetchProtocolAcknowledgements(client, '3.0')).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('fetches acknowledgement for the exact revision, not the protocol record', async () => {
    const row = {
      protocol_version_id: REVISION,
      user_id: 'sam',
      acknowledged_at: '2026-10-04T12:00:00Z',
    }
    const { client, fetcher } = clientReturning([row])
    expect(await fetchProtocolAcknowledgements(client, REVISION)).toEqual([row])
    expect(String(fetcher.mock.calls[0]?.[0])).toContain(
      `/protocol_acknowledgements?protocol_version_id=eq.${REVISION}`,
    )
  })

  it('leaves acknowledgement attribution to the server', async () => {
    const row = {
      protocol_version_id: REVISION,
      user_id: 'sam',
      acknowledged_at: '2026-10-04T12:00:00Z',
    }
    const { client, fetcher } = clientReturning(row)
    expect(await acknowledgeProtocolVersion(client, REVISION)).toEqual(row)
    expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual({
      p_protocol_version_id: REVISION,
    })
  })
})
