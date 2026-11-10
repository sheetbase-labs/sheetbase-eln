import { describe, expect, it } from 'vitest'

import { safeNextPath, signInRedirect } from './sign-in-redirect'

describe('signInRedirect', () => {
  it('carries the requested location as next', () => {
    expect(signInRedirect({ href: '/settings/account/api?tab=x#a' })).toEqual({
      to: '/sign-in',
      search: { next: '/settings/account/api?tab=x#a' },
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

  it('rejects raw non-string input without coercion', () => {
    for (const raw of [
      undefined,
      null,
      42,
      {},
      [],
      new URL('https://evil.example'),
    ]) {
      expect(safeNextPath(raw)).toBeUndefined()
    }
  })

  it('rejects every ASCII control character and preserves rooted Unicode paths', () => {
    for (let code = 0; code < 0x20; code += 1) {
      expect(
        safeNextPath(`/review/${String.fromCharCode(code)}next`),
      ).toBeUndefined()
    }

    expect(
      safeNextPath(`/review/${String.fromCharCode(0x7f)}next`),
    ).toBeUndefined()
    expect(safeNextPath('/records/🧬?title=測定#résumé')).toBe(
      '/records/🧬?title=測定#résumé',
    )
  })
})
