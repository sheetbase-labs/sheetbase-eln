import { describe, expect, it } from 'vitest'

import { authOutcome } from './auth-outcome'

describe('authOutcome', () => {
  it('treats a plain result as ok', () => {
    expect(authOutcome({ token: 'x' })).toBe('ok')
    expect(authOutcome(null)).toBe('ok')
    expect(authOutcome({ status: true })).toBe('ok')
  })

  it('reads the code of an API error', () => {
    expect(
      authOutcome({
        status: 'UNAUTHORIZED',
        body: { code: 'INVALID_PASSWORD' },
      }),
    ).toBe('error:INVALID_PASSWORD')
  })

  it('reads a failure carried on a redirect', () => {
    const headers = new Headers({ location: 'http://x/?error=INVALID_TOKEN' })
    expect(authOutcome({ status: 'FOUND', headers })).toBe(
      'error:INVALID_TOKEN',
    )
  })

  it('treats a clean redirect as ok', () => {
    const headers = new Headers({ location: '/' })
    expect(authOutcome({ status: 'FOUND', headers })).toBe('ok')
  })
})
