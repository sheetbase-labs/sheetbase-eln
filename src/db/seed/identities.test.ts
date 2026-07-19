import { describe, expect, it } from 'vitest'

import {
  DEMO_BLOCK_IDS,
  DEMO_VIRUS_STABILITY_PROJECT_ID,
  DEMO_VIRUS_STABILITY_PROTOCOL_RECORD_ID,
  DEMO_VIRUS_STABILITY_RECORD_ID,
  FIXTURE_PROJECT_ID,
  FIXTURE_USER_ID,
  FIXTURE_WORKSPACE_ID,
} from './identities'

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

describe('seed identities', () => {
  it('uses valid UUIDs that database uuid columns accept', () => {
    for (const id of [
      FIXTURE_USER_ID,
      FIXTURE_WORKSPACE_ID,
      FIXTURE_PROJECT_ID,
      DEMO_VIRUS_STABILITY_PROJECT_ID,
      DEMO_VIRUS_STABILITY_RECORD_ID,
      DEMO_VIRUS_STABILITY_PROTOCOL_RECORD_ID,
      ...Object.values(DEMO_BLOCK_IDS),
    ]) {
      expect(id).toMatch(uuidPattern)
    }
  })

  it('marks every seed id with the recognisable zero prefix', () => {
    for (const id of [
      FIXTURE_USER_ID,
      FIXTURE_WORKSPACE_ID,
      FIXTURE_PROJECT_ID,
      DEMO_VIRUS_STABILITY_PROJECT_ID,
      DEMO_VIRUS_STABILITY_RECORD_ID,
      DEMO_VIRUS_STABILITY_PROTOCOL_RECORD_ID,
      ...Object.values(DEMO_BLOCK_IDS),
    ]) {
      expect(id.startsWith('00000000-')).toBe(true)
    }
  })

  it('keeps fixture and demo identities distinct', () => {
    const fixtureIds = [
      FIXTURE_USER_ID,
      FIXTURE_WORKSPACE_ID,
      FIXTURE_PROJECT_ID,
    ]
    expect(fixtureIds).not.toContain(DEMO_VIRUS_STABILITY_PROJECT_ID)
    expect(new Set(fixtureIds).size).toBe(fixtureIds.length)
  })

  it('keeps demo block ids distinct from each other and from record ids', () => {
    const blockIds = Object.values(DEMO_BLOCK_IDS)
    expect(new Set(blockIds).size).toBe(blockIds.length)
    expect(blockIds).not.toContain(DEMO_VIRUS_STABILITY_RECORD_ID)
    expect(blockIds).not.toContain(DEMO_VIRUS_STABILITY_PROTOCOL_RECORD_ID)
  })
})
