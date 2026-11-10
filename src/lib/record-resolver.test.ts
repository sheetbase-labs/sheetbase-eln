/**
 * LAB-05.3 — resolving a printed identifier to its record.
 */
import { describe, expect, it, vi } from 'vitest'

import { createDataClient } from '#/lib/data-client'
import { resolveRecordByIdentifier } from '#/lib/record-resolver'
import type { ResolvedRecord } from '#/lib/record-resolver'

const SERUM_POOL: ResolvedRecord = {
  id: 'rec-1',
  identifier: 'SMP-0007',
  kind: 'sample',
  title: 'Serum pool A',
}

/** A real client over a recorded transport, so a test reads the request it builds. */
function clientAnswering(rows: readonly ResolvedRecord[]) {
  const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(rows))

  return { client: createDataClient(fetchImpl), fetchImpl }
}

describe('resolveRecordByIdentifier', () => {
  it('resolves a scanned identifier to the record it names', async () => {
    const { client, fetchImpl } = clientAnswering([SERUM_POOL])

    const record = await resolveRecordByIdentifier(client, 'SMP-0007')

    expect(record).toEqual({
      id: 'rec-1',
      identifier: 'SMP-0007',
      kind: 'sample',
      title: 'Serum pool A',
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('identifier=eq.SMP-0007'),
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('trims the scanned value before matching', async () => {
    const { client, fetchImpl } = clientAnswering([])

    await resolveRecordByIdentifier(client, '  TB-02  ')

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('identifier=eq.TB-02'),
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('returns null for an identifier that names nothing', async () => {
    const { client } = clientAnswering([])

    expect(await resolveRecordByIdentifier(client, 'SMP-9999')).toBeNull()
  })

  it('asks the database nothing for an empty code', async () => {
    const { client, fetchImpl } = clientAnswering([])

    expect(await resolveRecordByIdentifier(client, '   ')).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
