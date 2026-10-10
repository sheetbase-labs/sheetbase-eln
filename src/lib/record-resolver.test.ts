/**
 * LAB-05.3 — resolving a printed identifier to its record.
 */
import { describe, expect, it, vi } from 'vitest'

import { resolveRecordByIdentifier } from '#/lib/record-resolver'
import type { DataClient } from '#/lib/data-client'

describe('resolveRecordByIdentifier', () => {
  it('resolves a scanned identifier to the record it names', async () => {
    const list = vi
      .fn()
      .mockResolvedValue([
        {
          id: 'rec-1',
          identifier: 'SMP-0007',
          kind: 'sample',
          title: 'Serum pool A',
        },
      ])
    const record = await resolveRecordByIdentifier(
      { list } as unknown as DataClient,
      'SMP-0007',
    )
    expect(record).toEqual({
      id: 'rec-1',
      identifier: 'SMP-0007',
      kind: 'sample',
      title: 'Serum pool A',
    })
    expect(list).toHaveBeenCalledWith(
      'records',
      expect.stringContaining('identifier=eq.SMP-0007'),
    )
  })

  it('trims the scanned value before matching', async () => {
    const list = vi.fn().mockResolvedValue([])
    await resolveRecordByIdentifier(
      { list } as unknown as DataClient,
      '  TB-02  ',
    )
    expect(list).toHaveBeenCalledWith(
      'records',
      expect.stringContaining('identifier=eq.TB-02'),
    )
  })

  it('returns null for an identifier that names nothing', async () => {
    const list = vi.fn().mockResolvedValue([])
    expect(
      await resolveRecordByIdentifier(
        { list } as unknown as DataClient,
        'SMP-9999',
      ),
    ).toBeNull()
  })

  it('asks the database nothing for an empty code', async () => {
    const list = vi.fn()
    expect(
      await resolveRecordByIdentifier({ list } as unknown as DataClient, '   '),
    ).toBeNull()
    expect(list).not.toHaveBeenCalled()
  })
})
