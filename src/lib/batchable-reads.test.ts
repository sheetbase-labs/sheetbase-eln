import { describe, expect, it } from 'vitest'

import { BATCHABLE_READ_RPCS, isBatchableRead } from './batchable-reads'

describe('isBatchableRead', () => {
  it('batches every table read', () => {
    expect(isBatchableRead('GET', '/records?id=eq.1')).toBe(true)
    expect(isBatchableRead(undefined, '/record_links')).toBe(true)
  })

  it('batches the listed stable functions, called with POST', () => {
    for (const name of BATCHABLE_READ_RPCS)
      expect(isBatchableRead('POST', `/rpc/${name}`)).toBe(true)
  })

  it('never batches a write', () => {
    expect(isBatchableRead('POST', '/records')).toBe(false)
    expect(isBatchableRead('PATCH', '/records?id=eq.1')).toBe(false)
    expect(isBatchableRead('DELETE', '/records?id=eq.1')).toBe(false)
  })

  it('never batches a function that is not on the list', () => {
    expect(isBatchableRead('POST', '/rpc/create_experiment')).toBe(false)
    expect(isBatchableRead('POST', '/rpc/record_recent_view')).toBe(false)
    expect(isBatchableRead('POST', '/rpc/record_series/../x')).toBe(false)
  })
})
