// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { eventByName, eventLabel } from '#/lib/event-catalogue'
import { mapEventType } from '#/lib/webhook-events'

import { PARAMETER_SET_EVENT_LABELS } from './events'
import { PARAMETER_SET_EVENT_CASES } from './events.test-cases'

describe('parameter set events', () => {
  it.each(PARAMETER_SET_EVENT_CASES)(
    '$name is delivered from $entityType/$operation',
    ({ name, entityType, operation, payload }) => {
      expect(mapEventType(entityType, operation, payload)).toBe(name)
      const entry = eventByName(name)
      expect(entry?.status).toBe('stable')
      expect(entry?.consumers.webhook).toBe(true)
    },
  )

  it('gives every event a label in plain words', () => {
    for (const { name } of PARAMETER_SET_EVENT_CASES) {
      expect(eventLabel(name)).toBe(PARAMETER_SET_EVENT_LABELS[name])
    }
  })
})
