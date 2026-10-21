import { describe, expect, it } from 'vitest'

import { EVENT_CATALOGUE } from './event-catalogue'
import {
  nextRunAt,
  normalizeTriggerEventName,
  PIPELINE_TRIGGER_EVENTS,
  specBindings,
  upcomingRuns,
  validateScheduleSpec,
} from './pipeline-schedule'

describe('validateScheduleSpec instrument filter', () => {
  const id = '3f2b8a52-7c1d-4a2e-9b1a-0d6f5e4c3b2a'

  it('accepts an instrument id or null', () => {
    expect(
      validateScheduleSpec('event', {
        eventType: 'dataset.versioned',
        instrumentId: id,
      }),
    ).toBeNull()
    expect(
      validateScheduleSpec('event', {
        eventType: 'dataset.versioned',
        instrumentId: null,
      }),
    ).toBeNull()
  })

  it('refuses a value that is not an instrument id', () => {
    for (const instrumentId of ['plate-reader', 7]) {
      expect(
        validateScheduleSpec('event', {
          eventType: 'dataset.versioned',
          instrumentId,
        }),
      ).toEqual({ message: 'instrumentId must be an instrument id or null' })
    }
  })
})

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

describe('cron triggers', () => {
  it('validates the expression and the zone', () => {
    expect(
      validateScheduleSpec('cron', {
        cron: '0 9 * * 1-5',
        timeZone: 'Europe/London',
      }),
    ).toBeNull()
    expect(validateScheduleSpec('cron', { cron: '0 9 * *' })).toEqual({
      message:
        'cron must be five fields: minute hour day-of-month month day-of-week',
    })
    expect(
      validateScheduleSpec('cron', {
        cron: '0 9 * * *',
        timeZone: 'Nowhere/Land',
      }),
    ).toEqual({ message: 'timeZone must be a valid IANA time zone name' })
    expect(validateScheduleSpec('cron', { cron: '0 0 31 2 *' })).toEqual({
      message: 'cron never fires',
    })
  })

  it('computes the next run and a run of previews', () => {
    const from = new Date('2026-10-21T10:00:00Z')
    const spec = { cron: '0 9 * * 1', timeZone: 'UTC' }
    expect(nextRunAt('cron', spec, from)).toEqual(
      new Date('2026-10-26T09:00:00Z'),
    )
    expect(upcomingRuns('cron', spec, from, 3)).toEqual([
      new Date('2026-10-26T09:00:00Z'),
      new Date('2026-11-02T09:00:00Z'),
      new Date('2026-11-09T09:00:00Z'),
    ])
  })
})

describe('input bindings and the missed-run policy', () => {
  const dataset = '3f2b8a52-7c1d-4a2e-9b1a-0d6f5e4c3b2a'
  const version = '0e1d2c3b-4a59-4687-8a9b-0c1d2e3f4a5b'

  it('accepts pinned, latest and incremental bindings on timed triggers', () => {
    expect(
      validateScheduleSpec('daily', {
        dailyAt: '06:00',
        missedRunPolicy: 'skip',
        inputs: {
          readings: { mode: 'incremental', datasetId: dataset },
          reference: { mode: 'latest', datasetId: dataset },
          baseline: { mode: 'pinned', versionId: version },
        },
      }),
    ).toBeNull()
  })

  it('refuses incremental on an event trigger, which already runs on new data', () => {
    expect(
      validateScheduleSpec('event', {
        eventType: 'dataset.versioned',
        inputs: { readings: { mode: 'incremental', datasetId: dataset } },
      }),
    ).toEqual({
      message: 'input readings: an event trigger already runs only on new data',
    })
  })

  it('refuses malformed bindings and policies', () => {
    const daily = { dailyAt: '06:00' }
    expect(
      validateScheduleSpec('daily', { ...daily, missedRunPolicy: 'later' }),
    ).toEqual({ message: 'missedRunPolicy must be run_once or skip' })
    expect(
      validateScheduleSpec('daily', {
        ...daily,
        inputs: { Bad: { mode: 'latest', datasetId: dataset } },
      }),
    ).not.toBeNull()
    expect(
      validateScheduleSpec('daily', {
        ...daily,
        inputs: { readings: { mode: 'latest' } },
      }),
    ).toEqual({ message: 'input readings needs a Dataset' })
    expect(
      validateScheduleSpec('daily', {
        ...daily,
        inputs: { readings: { mode: 'pinned', versionId: 'nope' } },
      }),
    ).toEqual({ message: 'input readings needs a Dataset Version to pin' })
    expect(
      validateScheduleSpec('daily', {
        ...daily,
        inputs: { readings: { mode: 'sometimes' } },
      }),
    ).toEqual({ message: 'input readings has an unknown mode' })
  })

  it('reads legacy inputVersions as pinned and lets bindings win', () => {
    expect(
      specBindings({
        inputVersions: { a: version, b: version },
        inputs: { b: { mode: 'latest', datasetId: dataset } },
      }),
    ).toEqual({
      a: { mode: 'pinned', versionId: version },
      b: { mode: 'latest', datasetId: dataset },
    })
  })
})
