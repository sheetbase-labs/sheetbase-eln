import { describe, expect, it } from 'vitest'

import { safeNextPath, signInRedirect } from './sign-in-redirect'

describe('signInRedirect', () => {
  it('carries the requested location as next', () => {
    expect(signInRedirect({ href: '/settings/api?tab=x#a' })).toEqual({
      to: '/sign-in',
      search: { next: '/settings/api?tab=x#a' },
    })
  })
  it('does not loop back to the root or to sign-in', () => {
    expect(signInRedirect({ href: '/' }).search).toEqual({})
    expect(signInRedirect({ href: '/sign-in?x=1' }).search).toEqual({})
  })
  it('drops an off-site location', () => {
    expect(signInRedirect({ href: '//evil.example' }).search).toEqual({})
    expect(safeNextPath('/\\evil')).toBeUndefined()
  })
})
