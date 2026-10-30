import { describe, expect, it } from 'vitest'

import { demoSigningEnabled } from './design-demo-signing'

describe('demo signing seed', () => {
  it('runs only where sign-in is off', () => {
    expect(demoSigningEnabled({ SHEETBASE_DEV_AUTH_FREE: 'true' })).toBe(true)
    expect(demoSigningEnabled({ SHEETBASE_DEV_AUTH_FREE: 'false' })).toBe(false)
    expect(demoSigningEnabled({})).toBe(false)
  })
})
