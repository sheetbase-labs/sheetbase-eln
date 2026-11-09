// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { eventByName, eventLabel } from '#/lib/event-catalogue'
import { mapEventType } from '#/lib/webhook-events'

import { AGENT_POLICY_EVENT_LABELS } from './events'
import { AGENT_POLICY_EVENT_CASES } from './events.test-cases'

describe('agent events', () => {
  it.each(AGENT_POLICY_EVENT_CASES)(
    '$name is delivered from $entityType/$operation',
    ({ name, entityType, operation, payload }) => {
      expect(mapEventType(entityType, operation, payload)).toBe(name)
      const entry = eventByName(name)
      expect(entry?.status).toBe('stable')
      expect(entry?.consumers.webhook).toBe(true)
    },
  )

  it('gives every agent event a label in plain words', () => {
    for (const { name } of AGENT_POLICY_EVENT_CASES) {
      expect(AGENT_POLICY_EVENT_LABELS[name]).toBeDefined()
      expect(eventLabel(name)).toBe(AGENT_POLICY_EVENT_LABELS[name])
    }
  })
})
