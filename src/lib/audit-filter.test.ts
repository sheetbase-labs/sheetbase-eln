import { describe, expect, it } from 'vitest'

import { auditFilterFromSearch } from './audit-filter'
import { auditEventsRpcArgs } from './audit-history'

describe('auditFilterFromSearch', () => {
  it('turns the URL into the RPC filter, days inclusive', () => {
    const filter = auditFilterFromSearch({
      record: 'rec-1',
      from: '2026-09-01',
      to: '2026-09-30',
    })
    expect(filter).toEqual({
      object: 'rec-1',
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-09-30T23:59:59.999Z',
    })
    const args = auditEventsRpcArgs(filter)
    expect(args.p_object).toBe('rec-1')
    expect(args.p_from).toBe('2026-09-01T00:00:00.000Z')
    expect(args.p_to).toBe('2026-09-30T23:59:59.999Z')
  })

  it('adds nothing for an empty search', () => {
    expect(auditFilterFromSearch({})).toEqual({})
  })
})
