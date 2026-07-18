import { describe, expect, it } from 'vitest'

import {
  REQUEST_ID_HEADER,
  resolveRequestId,
  stampRequestId,
} from './request-id'

describe('resolveRequestId', () => {
  it('returns a valid incoming x-request-id', () => {
    const headers = new Headers({ [REQUEST_ID_HEADER]: 'req-abc-123' })
    expect(resolveRequestId(headers)).toBe('req-abc-123')
  })

  it('rejects malformed incoming ids and generates a fresh one', () => {
    const headers = new Headers({ [REQUEST_ID_HEADER]: 'bad value!' })
    const id = resolveRequestId(headers)
    expect(id).not.toBe('bad value!')
    expect(id).toMatch(/^[a-f0-9]{32}$/)
  })

  it('generates a 32-hex id when no header is present', () => {
    const id = resolveRequestId(new Headers())
    expect(id).toMatch(/^[a-f0-9]{32}$/)
    expect(id).toHaveLength(32)
  })

  it('generates unique ids across calls', () => {
    const a = resolveRequestId(new Headers())
    const b = resolveRequestId(new Headers())
    expect(a).not.toBe(b)
  })
})

describe('stampRequestId', () => {
  it('sets the x-request-id header on the response', () => {
    const response = stampRequestId(new Response('ok'), 'req-xyz')
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe('req-xyz')
  })
})
