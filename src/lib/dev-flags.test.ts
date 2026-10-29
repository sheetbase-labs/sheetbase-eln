import { afterEach, describe, expect, it } from 'vitest'

import {
  devFlagValue,
  parseOverrides,
  setDevFlag,
  setDevFlagsActive,
} from './dev-flags'

afterEach(() => {
  setDevFlagsActive(false)
  setDevFlag('liveUpdates', undefined)
})

describe('dev flags', () => {
  it('ignores bad stored values', () => {
    expect(parseOverrides(null)).toEqual({})
    expect(parseOverrides('{nope')).toEqual({})
    expect(
      parseOverrides('{"liveUpdates":false,"collaboration":"no","other":true}'),
    ).toEqual({ liveUpdates: false })
  })

  it('only counts an override while the toolbar is active', () => {
    setDevFlag('liveUpdates', false)
    expect(devFlagValue('liveUpdates')).toBe(true)
    setDevFlagsActive(true)
    expect(devFlagValue('liveUpdates')).toBe(false)
    setDevFlag('liveUpdates', undefined)
    expect(devFlagValue('liveUpdates')).toBe(true)
  })
})
