import { describe, expect, it } from 'vitest'

import { annotateRequest } from './request-log'

describe('annotateRequest', () => {
  it('does nothing outside a request', () => {
    expect(() => annotateRequest({ user: { id: 'u1' } })).not.toThrow()
  })
})
