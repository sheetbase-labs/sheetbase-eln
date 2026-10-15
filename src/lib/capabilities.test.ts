import { describe, expect, it } from 'vitest'

import {
  capabilitiesFromEnv,
  capabilityKeys,
  capabilityRoadmap,
  noCapabilities,
} from './capabilities'

/**
 * No capability key is registered (see `capabilities.ts`): every app-3 design
 * gap is a shipped feature, and nothing is gated. These tests pin the contract
 * the mechanism must keep for the day a key is added — an unset or unknown
 * allow-list enables nothing, and every registered key carries a roadmap entry.
 */
describe('capabilities', () => {
  it('registers no key and gates nothing', () => {
    expect(capabilityKeys).toEqual([])
    expect(noCapabilities).toEqual({})
  })

  it('enables nothing when the allow-list is unset, empty or blank', () => {
    expect(capabilitiesFromEnv({})).toEqual({})
    expect(capabilitiesFromEnv({ SHEETBASE_CAPABILITIES: '' })).toEqual({})
    expect(capabilitiesFromEnv({ SHEETBASE_CAPABILITIES: '   ' })).toEqual({})
    expect(capabilitiesFromEnv({ SHEETBASE_CAPABILITIES: ',,' })).toEqual({})
  })

  it('ignores names that are not registered keys', () => {
    // `sampleMeasurements` and `experimentResults` are shipped features, so
    // naming them must not switch anything off or on.
    expect(
      capabilitiesFromEnv({
        SHEETBASE_CAPABILITIES:
          ' sampleMeasurements , experimentResults , notARealCapability ',
      }),
    ).toEqual({})
  })

  it('tracks every registered key in the roadmap map', () => {
    expect(Object.keys(capabilityRoadmap).sort()).toEqual(
      [...capabilityKeys].sort(),
    )
    for (const key of capabilityKeys) {
      expect(capabilityRoadmap[key]).toMatch(/^RM-\d+$/)
    }
  })
})
