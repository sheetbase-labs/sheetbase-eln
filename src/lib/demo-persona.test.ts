import { describe, expect, it } from 'vitest'

import {
  VIEW_AS_COOKIE,
  parseViewAsCookie,
  personaSessionId,
} from './demo-persona'

const MEI = '00000000-0000-4000-8000-000000000312'

describe('view as', () => {
  it('reads the chosen person from the cookie header', () => {
    expect(
      parseViewAsCookie(`sb-theme=dark; ${VIEW_AS_COOKIE}=${MEI}; other=1`),
    ).toBe(MEI)
  })

  it('ignores a missing, empty or hand-edited cookie', () => {
    expect(parseViewAsCookie(null)).toBeNull()
    expect(parseViewAsCookie('sb-theme=dark')).toBeNull()
    expect(parseViewAsCookie(`${VIEW_AS_COOKIE}=`)).toBeNull()
    expect(parseViewAsCookie(`${VIEW_AS_COOKIE}='; drop table`)).toBeNull()
  })

  it('gives each person a session of their own', () => {
    expect(personaSessionId(MEI)).toBe(`dev-auth-free-session-${MEI}`)
  })
})
