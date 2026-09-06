import { describe, expect, it } from 'vitest'

import { EVENT_CATALOGUE } from './event-catalogue'
import {
  nextRunAt,
  normalizeTriggerEventName,
  PIPELINE_TRIGGER_EVENTS,
  validateScheduleSpec,
} from './pipeline-schedule'

describe('validateScheduleSpec', () => {
  it('accepts valid interval/daily/event specs', () => {
    expect(validateScheduleSpec('interval', { intervalMinutes: 30 })).toBeNull()
    expect(validateScheduleSpec('daily', { dailyAt: '09:30' })).toBeNull()
    expect(
      validateScheduleSpec('event', {
        eventType: 'dataset.versioned',
        inputName: 'input',
      }),
    ).toBeNull()
  })

  it('accepts wire aliases and the legacy name at the intake boundary', () => {
    for (const alias of [
      'dataset_version_created',
      'sheet_instance.created',
      'sheet_definition.versioned',
      'notebook_template.updated',
    ]) {
      expect(validateScheduleSpec('event', { eventType: alias })).toBeNull()
    }
    expect(normalizeTriggerEventName('dataset_version_created')).toBe(
      'dataset.versioned',
    )
    expect(normalizeTriggerEventName('sheet_instance.created')).toBe(
      'sheet.created',
    )
  })

  it('rejects invalid specs', () => {
    expect(
      validateScheduleSpec('interval', { intervalMinutes: 0 }),
    ).not.toBeNull()
    expect(
      validateScheduleSpec('interval', { intervalMinutes: 1.5 }),
    ).not.toBeNull()
    expect(validateScheduleSpec('daily', { dailyAt: '25:00' })).not.toBeNull()
    expect(validateScheduleSpec('daily', { dailyAt: '9am' })).not.toBeNull()
    expect(
      validateScheduleSpec('event', { eventType: 'dataset_updated' }),
    ).not.toBeNull()
    expect(
      validateScheduleSpec('event', {
        eventType: 'dataset.versioned',
        inputName: 'Bad!',
      }),
    ).not.toBeNull()
  })

  it('rejects non-triggerable catalogue names', () => {
    // Provisional (pipeline.*), reserved (notebook.amended), administration
    // (project.*) and excluded producers are never pipeline triggers.
    for (const name of [
      'pipeline.created',
      'notebook.amended',
      'project.created',
      'record.amended',
      'workspace.settings.updated',
      'storage_movement',
      'future.unknown',
    ]) {
      expect(
        validateScheduleSpec('event', { eventType: name }),
        name,
      ).not.toBeNull()
      expect(normalizeTriggerEventName(name), name).toBeNull()
    }
  })
})

describe('PIPELINE_TRIGGER_EVENTS', () => {
  it('covers exactly the stable record/dataset/sheet/notebook events with producers', () => {
    const expected = EVENT_CATALOGUE.filter(
      (entry) =>
        entry.status === 'stable' &&
        entry.producer !== null &&
        ['record', 'dataset', 'sheet', 'notebook'].includes(entry.family),
    ).map((entry) => entry.name)
    expect([...PIPELINE_TRIGGER_EVENTS].sort()).toEqual(expected.sort())
    expect(PIPELINE_TRIGGER_EVENTS).toHaveLength(24)
  })

  it('normalizes every triggerable name to itself', () => {
    for (const name of PIPELINE_TRIGGER_EVENTS) {
      expect(normalizeTriggerEventName(name)).toBe(name)
    }
  })

  it('marks every triggerable entry as a pipeline consumer in the catalogue', () => {
    for (const name of PIPELINE_TRIGGER_EVENTS) {
      const entry = EVENT_CATALOGUE.find((candidate) => candidate.name === name)
      expect(entry?.consumers.pipeline, name).toBe(true)
    }
  })
})

describe('nextRunAt', () => {
  it('adds the interval to the reference time', () => {
    const from = new Date('2026-08-28T10:00:00Z')
    const next = nextRunAt('interval', { intervalMinutes: 30 }, from)
    expect(next?.toISOString()).toBe('2026-08-28T10:30:00.000Z')
  })

  it('computes the next daily occurrence today when still ahead', () => {
    // Daily schedules use an explicit IANA time zone (default UTC); assert
    // absolute instants so the test is timezone-agnostic.
    const from = new Date('2026-08-28T09:00:00Z')
    const next = nextRunAt('daily', { dailyAt: '14:30' }, from)
    expect(next?.toISOString()).toBe('2026-08-28T14:30:00.000Z')
  })

  it('rolls to tomorrow when the daily time already passed', () => {
    const from = new Date('2026-08-28T16:00:00Z')
    const next = nextRunAt('daily', { dailyAt: '09:30' }, from)
    expect(next?.toISOString()).toBe('2026-08-29T09:30:00.000Z')
  })

  it('honours an explicit IANA time zone independently of the server zone', () => {
    // 09:00 in Europe/London (UTC+1 in August) = 08:00 UTC.
    const from = new Date('2026-08-28T07:00:00Z')
    const next = nextRunAt(
      'daily',
      { dailyAt: '09:00', timeZone: 'Europe/London' },
      from,
    )
    expect(next?.toISOString()).toBe('2026-08-28T08:00:00.000Z')
  })

  it('rolls across a DST boundary deterministically', () => {
    // 30 March 2026 is after the spring forward (29 March): London is BST
    // (UTC+1). 09:00 BST = 08:00 UTC, and the rollover lands on the 31st.
    const from = new Date('2026-03-30T08:30:00Z')
    const next = nextRunAt(
      'daily',
      { dailyAt: '09:00', timeZone: 'Europe/London' },
      from,
    )
    expect(next?.toISOString()).toBe('2026-03-31T08:00:00.000Z')
  })

  it('rejects an invalid IANA time zone', () => {
    expect(
      validateScheduleSpec('daily', {
        dailyAt: '09:00',
        timeZone: 'Mars/Olympus',
      }),
    ).not.toBeNull()
  })
})
