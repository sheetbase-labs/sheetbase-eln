import { describe, expect, it } from 'vitest'

import { devToolbarAvailable } from './dev-availability'

describe('devToolbarAvailable', () => {
  it('follows the switch in development, for any role', () => {
    expect(
      devToolbarAvailable({ dev: true, role: 'viewer', enabled: true }),
    ).toBe(true)
    expect(
      devToolbarAvailable({ dev: true, role: 'viewer', enabled: false }),
    ).toBe(false)
  })

  it('needs an owner or admin who switched it on in production', () => {
    expect(
      devToolbarAvailable({ dev: false, role: 'admin', enabled: true }),
    ).toBe(true)
    expect(
      devToolbarAvailable({ dev: false, role: 'owner', enabled: true }),
    ).toBe(true)
    expect(
      devToolbarAvailable({ dev: false, role: 'admin', enabled: false }),
    ).toBe(false)
    expect(
      devToolbarAvailable({ dev: false, role: 'scientist', enabled: true }),
    ).toBe(false)
    expect(
      devToolbarAvailable({ dev: false, role: undefined, enabled: true }),
    ).toBe(false)
  })
})
