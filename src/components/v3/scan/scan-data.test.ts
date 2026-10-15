import { describe, expect, it } from 'vitest'

import type { DataClient } from '#/lib/data-client'
import { resolveScanCode } from './scan-data'

/** A client that answers the exact-identifier reads only, so resolveScanCode
 * returns the single target it found. */
function stubClient(rows: {
  records?: Record<string, unknown>[]
  instruments?: Record<string, unknown>[]
}): DataClient {
  return {
    list: async (resource: string, query?: string) =>
      resource === 'records'
        ? (rows.records ?? []).filter((r) => query?.includes(String(r.identifier)))
        : resource === 'instruments'
          ? (rows.instruments ?? []).filter((r) =>
              query?.includes(String(r.display_id)),
            )
          : [],
  } as unknown as DataClient
}

describe('resolveScanCode', () => {
  it('reports a scanned sample’s real status, not a neutral one', async () => {
    const result = await resolveScanCode(
      'SMP-1',
      stubClient({
        records: [
          {
            id: 'r-1',
            identifier: 'SMP-1',
            title: 'Serum lot',
            kind: 'sample',
            status: 'quarantined',
          },
        ],
      }),
    )
    expect(result.found).toBe(true)
    expect(result.hit?.status).toEqual({ tone: 'warn', label: 'Quarantine' })
  })

  it('distinguishes an available sample from a consumed one', async () => {
    const available = await resolveScanCode(
      'SMP-2',
      stubClient({
        records: [
          {
            id: 'r-2',
            identifier: 'SMP-2',
            title: 'Plasma lot',
            kind: 'sample',
            status: 'available',
          },
        ],
      }),
    )
    const consumed = await resolveScanCode(
      'SMP-3',
      stubClient({
        records: [
          {
            id: 'r-3',
            identifier: 'SMP-3',
            title: 'Plasma lot',
            kind: 'sample',
            status: 'consumed',
          },
        ],
      }),
    )
    expect(available.hit?.status.tone).toBe('ok')
    expect(consumed.hit?.status.tone).toBe('stored')
    expect(consumed.hit?.status.tone).not.toBe(available.hit?.status.tone)
  })

  it('reports an instrument’s intake method rather than a connection flag', async () => {
    const result = await resolveScanCode(
      'INS-1',
      stubClient({
        instruments: [
          {
            id: 'i-1',
            display_id: 'INS-1',
            name: 'HPLC-1',
            instrument_type: 'hplc',
            intake_method: 'none',
          },
        ],
      }),
    )
    expect(result.found).toBe(true)
    expect(result.hit?.kind).toBe('instrument')
    expect(result.hit?.status.label).toBe('Not connected')
  })
})
