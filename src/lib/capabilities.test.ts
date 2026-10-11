import { describe, expect, it } from 'vitest'

import {
  capabilitiesFromEnv,
  capabilityKeys,
  capabilityRoadmap,
  noCapabilities,
} from './capabilities'

describe('capabilities', () => {
  it('defaults every capability off', () => {
    expect(noCapabilities).toEqual({
      sampleMeasurements: false,
      experimentResults: false,
    })
    expect(capabilitiesFromEnv({})).toEqual(noCapabilities)
    expect(capabilitiesFromEnv({ SHEETBASE_CAPABILITIES: '' })).toEqual(
      noCapabilities,
    )
    expect(capabilitiesFromEnv({ SHEETBASE_CAPABILITIES: '   ' })).toEqual(
      noCapabilities,
    )
  })

  it('enables only the keys named in the allow-list', () => {
    expect(
      capabilitiesFromEnv({ SHEETBASE_CAPABILITIES: 'sampleMeasurements' }),
    ).toEqual({ sampleMeasurements: true, experimentResults: false })
    expect(
      capabilitiesFromEnv({
        SHEETBASE_CAPABILITIES: 'sampleMeasurements,experimentResults',
      }),
    ).toEqual({ sampleMeasurements: true, experimentResults: true })
  })

  it('ignores unknown keys, stray separators and surrounding whitespace', () => {
    expect(
      capabilitiesFromEnv({
        SHEETBASE_CAPABILITIES:
          ' experimentResults , notARealCapability, sampleMeasurements ',
      }),
    ).toEqual({ sampleMeasurements: true, experimentResults: true })
  })

  it('tracks every capability key in the roadmap map', () => {
    expect(Object.keys(capabilityRoadmap).sort()).toEqual(
      [...capabilityKeys].sort(),
    )
    for (const key of capabilityKeys) {
      expect(capabilityRoadmap[key]).toMatch(/^RM-\d+$/)
    }
  })
})
