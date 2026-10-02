import { describe, expect, it } from 'vitest'

import {
  capabilitiesFromEnv,
  capabilityKeys,
  capabilityRoadmap,
  noCapabilities,
} from './capabilities'

describe('capabilities', () => {
  it('defaults every capability off when nothing is configured', () => {
    expect(capabilitiesFromEnv({})).toEqual(noCapabilities)
    expect(Object.values(noCapabilities).every((on) => on === false)).toBe(true)
  })

  it('enables only the keys in the allow-list', () => {
    const caps = capabilitiesFromEnv({
      SHEETBASE_CAPABILITIES: 'protocolDocuments, notARealCapability',
    })
    expect(caps.protocolDocuments).toBe(true)
    expect(Object.keys(caps)).toHaveLength(capabilityKeys.length)
  })

  it('ignores unknown keys and whitespace', () => {
    const caps = capabilitiesFromEnv({
      SHEETBASE_CAPABILITIES: '  protocolDocuments , notARealCapability ,,',
    })
    expect(caps.protocolDocuments).toBe(true)
    expect(Object.keys(caps)).toEqual([...capabilityKeys])
  })

  it('tracks every capability with a roadmap item', () => {
    for (const key of capabilityKeys) {
      expect(capabilityRoadmap[key]).toMatch(/^RM-\d+$/)
    }
  })
})
