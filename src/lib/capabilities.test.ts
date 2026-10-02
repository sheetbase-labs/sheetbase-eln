import { describe, expect, it } from 'vitest'

import {
  capabilitiesFromEnv,
  capabilityKeys,
  capabilityRoadmap,
  noCapabilities,
} from './capabilities'

describe('capabilities', () => {
  it('has no capability gaps left to gate', () => {
    expect(capabilityKeys).toEqual([])
    expect(capabilityRoadmap).toEqual({})
    expect(noCapabilities).toEqual({})
  })

  it('returns the same empty baseline from the environment', () => {
    expect(capabilitiesFromEnv({})).toEqual(noCapabilities)
    expect(
      capabilitiesFromEnv({
        SHEETBASE_CAPABILITIES: 'protocolDocuments, notARealCapability',
      }),
    ).toEqual(noCapabilities)
  })
})
