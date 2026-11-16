// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { eventByName, eventLabel } from '#/lib/event-catalogue'
import { mapEventType } from '#/lib/webhook-events'

import { feature } from './feature'

const CASES = [
  { name: 'ai.preference.saved', operation: 'create' },
  { name: 'ai.preference.updated', operation: 'update' },
  { name: 'ai.preference.deleted', operation: 'delete' },
] as const

describe('AI preference events', () => {
  it.each(CASES)(
    '$name is delivered from ai_preference/$operation',
    ({ name, operation }) => {
      expect(mapEventType('ai_preference', operation, {})).toBe(name)

      const entry = eventByName(name)

      expect(entry?.consumers.webhook).toBe(true)
      expect(eventLabel(name)).toBe(feature.eventLabels[name])
    },
  )
})
