import { describe, expect, it } from 'vitest'

import {
  HOST_CAPABILITIES,
  hostCapabilitiesFor,
  isHostCapability,
} from './host-capabilities'

describe('host capabilities', () => {
  it('knows its own names only', () => {
    expect(isHostCapability('registry.create')).toBe(true)
    expect(isHostCapability('toString')).toBe(false)
    expect(isHostCapability(42)).toBe(false)
  })

  it('unlocks a call only for a plugin that declared its scope', () => {
    expect(hostCapabilitiesFor([])).toEqual([])
    expect(hostCapabilitiesFor(['files:read'])).toEqual([
      'files.list',
      'files.read',
    ])
  })

  it('asks the person before every change', () => {
    for (const [name, capability] of Object.entries(HOST_CAPABILITIES))
      expect(capability.write, name).toBe(capability.scope.endsWith(':write'))
  })
})
