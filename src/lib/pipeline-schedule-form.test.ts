import { describe, expect, it } from 'vitest'

import {
  describeInputs,
  describeSchedule,
  draftError,
  draftToSchedule,
  emptyDraft,
  relativeTime,
  scheduleToDraft,
  eventLabel,
  triggerLabel,
} from './pipeline-schedule-form'
import { validateScheduleSpec } from './pipeline-schedule'
import type { ScheduleDraft } from './pipeline-schedule-form'

const dataset = '3f2b8a52-7c1d-4a2e-9b1a-0d6f5e4c3b2a'
const version = '0e1d2c3b-4a59-4687-8a9b-0c1d2e3f4a5b'

function draft(patch: Partial<ScheduleDraft>): ScheduleDraft {
  return { ...emptyDraft('Europe/London'), ...patch }
}

describe('draftToSchedule', () => {
  it('writes every calendar preset as a spec the database accepts', () => {
    const cases: Array<
      [Partial<ScheduleDraft>, string, Record<string, unknown>]
    > = [
      [{ repeat: 'daily', time: '06:30' }, 'daily', { dailyAt: '06:30' }],
      [{ repeat: 'weekdays', time: '07:15' }, 'cron', { cron: '15 7 * * 1-5' }],
      [
        { repeat: 'weekly', time: '09:00', weekday: 3 },
        'cron',
        { cron: '0 9 * * 3' },
      ],
      [
        { repeat: 'monthly', time: '08:00', monthDay: '15' },
        'cron',
        { cron: '0 8 15 * *' },
      ],
      [
        { repeat: 'interval', intervalValue: '2', intervalUnit: 'hours' },
        'interval',
        { intervalMinutes: 120 },
      ],
      [
        { repeat: 'interval', intervalValue: '1', intervalUnit: 'days' },
        'interval',
        { intervalMinutes: 1440 },
      ],
    ]
    for (const [patch, kind, expected] of cases) {
      const built = draftToSchedule(draft(patch), [], {})
      expect(built.kind).toBe(kind)
      expect(built.spec).toMatchObject(expected)
      expect(validateScheduleSpec(built.kind, built.spec)).toBeNull()
    }
  })

  it('always stores the zone of a clock-time trigger', () => {
    expect(
      draftToSchedule(draft({ repeat: 'daily' }), [], {}).spec,
    ).toMatchObject({ timeZone: 'Europe/London' })
    expect(
      draftToSchedule(draft({ repeat: 'weekly', timeZone: '' }), [], {}).spec,
    ).toMatchObject({ timeZone: 'UTC' })
  })

  it('carries input bindings, parameters and the missed-run policy', () => {
    const built = draftToSchedule(
      draft({
        repeat: 'daily',
        missedRunPolicy: 'skip',
        inputs: {
          readings: { mode: 'incremental', datasetId: dataset, versionId: '' },
          baseline: { mode: 'pinned', datasetId: '', versionId: version },
        },
      }),
      ['readings', 'baseline'],
      { plate_size: 384 },
    )
    expect(built.spec).toMatchObject({
      missedRunPolicy: 'skip',
      parameters: { plate_size: 384 },
      inputs: {
        readings: { mode: 'incremental', datasetId: dataset },
        baseline: { mode: 'pinned', versionId: version },
      },
    })
    expect(validateScheduleSpec(built.kind, built.spec)).toBeNull()
  })

  it('leaves the input an event delivers out of the bindings', () => {
    const built = draftToSchedule(
      draft({
        repeat: 'event',
        inputName: 'raw',
        inputs: {
          raw: { mode: 'event', datasetId: '', versionId: '' },
          reference: { mode: 'latest', datasetId: dataset, versionId: '' },
        },
      }),
      ['raw', 'reference'],
      {},
    )
    expect(built.kind).toBe('event')
    expect(built.spec).toMatchObject({
      eventType: 'dataset.versioned',
      inputName: 'raw',
      inputs: { reference: { mode: 'latest', datasetId: dataset } },
    })
    expect((built.spec.inputs as Record<string, unknown>).raw).toBeUndefined()
  })
})

describe('draftError', () => {
  it('names what is wrong in words', () => {
    expect(draftError(draft({ repeat: 'daily', time: '' }), [])).toMatch(
      /time of day/,
    )
    expect(
      draftError(draft({ repeat: 'interval', intervalValue: '0' }), []),
    ).toMatch(/how often/)
    expect(draftError(draft({ repeat: 'cron', cron: '* * *' }), [])).toMatch(
      /five fields/,
    )
    expect(draftError(draft({ repeat: 'cron', cron: '0 0 31 2 *' }), [])).toBe(
      'That cron expression never fires.',
    )
    expect(
      draftError(draft({ repeat: 'weekly', timeZone: 'Nowhere/Land' }), []),
    ).toMatch(/time zone/)
    expect(
      draftError(draft({ repeat: 'monthly', monthDay: '32' }), []),
    ).toMatch(/1 to 31/)
  })

  it('wants a Dataset or a version for each input', () => {
    expect(
      draftError(
        draft({
          inputs: {
            readings: { mode: 'latest', datasetId: '', versionId: '' },
          },
        }),
        ['readings'],
      ),
    ).toBe('Choose which Dataset readings follows.')
    expect(
      draftError(
        draft({
          inputs: {
            readings: { mode: 'pinned', datasetId: '', versionId: '' },
          },
        }),
        ['readings'],
      ),
    ).toBe('Choose which Dataset Version readings reads.')
    expect(draftError(draft({}), [])).toBeNull()
  })
})

describe('scheduleToDraft', () => {
  it('reads each stored rule back into the preset it came from', () => {
    const round = (kind: never, spec: Record<string, unknown>) =>
      scheduleToDraft({ kind, spec }, [], 'UTC')
    expect(round('cron' as never, { cron: '15 7 * * 1-5' })).toMatchObject({
      repeat: 'weekdays',
      time: '07:15',
    })
    expect(round('cron' as never, { cron: '0 9 * * 3' })).toMatchObject({
      repeat: 'weekly',
      weekday: 3,
      time: '09:00',
    })
    expect(round('cron' as never, { cron: '0 8 15 * *' })).toMatchObject({
      repeat: 'monthly',
      monthDay: '15',
    })
    // Not one of the shapes the form offers: kept as written.
    expect(round('cron' as never, { cron: '*/15 * * * *' })).toMatchObject({
      repeat: 'cron',
      cron: '*/15 * * * *',
    })
    expect(round('interval' as never, { intervalMinutes: 180 })).toMatchObject({
      repeat: 'interval',
      intervalUnit: 'hours',
      intervalValue: '3',
    })
  })

  it('reads a daily trigger stored without a zone as UTC, as it ran', () => {
    expect(
      scheduleToDraft(
        { kind: 'daily', spec: { dailyAt: '09:10' } },
        [],
        'America/New_York',
      ),
    ).toMatchObject({ repeat: 'daily', timeZone: 'UTC' })
  })

  it('reads legacy pinned inputs and binding modes', () => {
    const read = scheduleToDraft(
      {
        kind: 'daily',
        spec: {
          dailyAt: '06:00',
          inputVersions: { baseline: version },
          inputs: { readings: { mode: 'incremental', datasetId: dataset } },
          missedRunPolicy: 'skip',
        },
      },
      ['readings', 'baseline', 'other'],
      'UTC',
    )
    expect(read.inputs.baseline).toMatchObject({
      mode: 'pinned',
      versionId: version,
    })
    expect(read.inputs.readings).toMatchObject({
      mode: 'incremental',
      datasetId: dataset,
    })
    // Unbound inputs are offered the latest data, not nothing.
    expect(read.inputs.other?.mode).toBe('latest')
    expect(read.missedRunPolicy).toBe('skip')
  })

  it('survives a round trip through the spec', () => {
    const original = draft({
      repeat: 'weekly',
      weekday: 5,
      time: '16:45',
      timeZone: 'Asia/Tokyo',
      missedRunPolicy: 'skip',
      inputs: {
        readings: { mode: 'latest', datasetId: dataset, versionId: '' },
      },
    })
    const built = draftToSchedule(original, ['readings'], {})
    const back = scheduleToDraft(built, ['readings'], 'UTC')
    expect(back).toMatchObject({
      repeat: 'weekly',
      weekday: 5,
      time: '16:45',
      timeZone: 'Asia/Tokyo',
      missedRunPolicy: 'skip',
    })
    expect(back.inputs.readings).toMatchObject({
      mode: 'latest',
      datasetId: dataset,
    })
  })
})

describe('describing a stored trigger', () => {
  const names = new Map([[dataset, 'Plate reader readings']])

  it('reads timed rules in plain words', () => {
    expect(describeSchedule('interval', { intervalMinutes: 1440 }, names)).toBe(
      'Every day',
    )
    expect(describeSchedule('interval', { intervalMinutes: 360 }, names)).toBe(
      'Every 6 hours',
    )
    expect(
      describeSchedule(
        'cron',
        { cron: '0 9 1 * *', timeZone: 'Europe/London' },
        names,
      ),
    ).toBe('Monthly on day 1 at 09:00 (Europe/London)')
    expect(describeSchedule('cron', { cron: 'nope' }, names)).toBe('—')
  })

  it('names what each input follows', () => {
    expect(
      describeInputs(
        {
          inputs: {
            readings: { mode: 'latest', datasetId: dataset },
            plate: { mode: 'incremental', datasetId: dataset },
          },
          inputVersions: { baseline: version },
        },
        names,
      ),
    ).toEqual([
      'baseline: a fixed Dataset Version',
      'readings: latest version of Plate reader readings',
      'plate: new versions of Plate reader readings only',
    ])
  })
})

describe('relativeTime', () => {
  const now = new Date('2026-10-21T12:00:00Z')
  it('reads past and future', () => {
    expect(relativeTime('2026-10-21T12:00:20Z', now)).toBe('any moment')
    expect(relativeTime('2026-10-21T12:45:00Z', now)).toBe('in 45 min')
    expect(relativeTime('2026-10-21T18:00:00Z', now)).toBe('in 6 h')
    expect(relativeTime('2026-10-21T09:00:00Z', now)).toBe('3 h ago')
    expect(relativeTime('2026-10-14T12:00:00Z', now)).toBe('7 d ago')
  })
})

describe('plain names for events and triggers', () => {
  it('words a known event the way a scientist would', () => {
    expect(eventLabel('dataset.versioned')).toBe('A Dataset gets a new version')
    expect(eventLabel('pipeline.run.completed')).toBe('A pipeline run finishes')
  })

  it('spells out an event it does not know instead of showing a code', () => {
    expect(eventLabel('sheet.row_moved')).toBe('Sheet row moved')
  })

  it('says how a run was started', () => {
    expect(triggerLabel('manual')).toBe('By hand')
    expect(triggerLabel('scheduled')).toBe('On a schedule')
    expect(triggerLabel('event')).toBe('When something happened')
  })
})
