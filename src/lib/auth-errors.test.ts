import { describe, expect, it } from 'vitest'

import { describeSignInError } from './auth-errors'

describe('describeSignInError', () => {
  it('says nothing when there is no error', () => {
    expect(describeSignInError(undefined)).toBeNull()
    expect(describeSignInError('')).toBeNull()
  })

  it('explains declined consent as recoverable', () => {
    expect(describeSignInError('access_denied')).toMatch(/declined/i)
    expect(describeSignInError('access_denied')).toMatch(/nothing was created/i)
  })

  it('explains the missing-email case with a concrete fix', () => {
    expect(describeSignInError('github_email_not_found')).toMatch(/email/i)
  })

  it('treats expired state as retryable', () => {
    expect(describeSignInError('state_mismatch')).toMatch(/expired/i)
  })

  it('never echoes unknown provider detail', () => {
    expect(describeSignInError('some_raw_provider_payload')).toBe(
      'Sign-in failed. Try again, and contact the workspace owner if it keeps failing.',
    )
  })
})
