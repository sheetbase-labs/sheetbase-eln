import { describe, expect, it } from 'vitest'

import { parseStartRules } from '#/lib/pipelines/start-rules'

import { conditionWords, readbackLines } from './starts-readback'

describe('readbackLines', () => {
  it('says an unruled pipeline starts on every start', () => {
    const lines = readbackLines(['schedule'], parseStartRules({}))

    expect(lines[0]).toBe('It starts when a schedule is due.')
    expect(lines).toContain('Every start becomes a run.')
  })

  it('names each way once and each condition', () => {
    const rules = parseStartRules({
      window: { days: 'weekdays', from: '07:00', to: '19:00', timeZone: 'UTC' },
      minNewRows: 8,
      waitMinutes: 5,
      missedRuns: 'skip',
    })

    const lines = readbackLines(['snapshot', 'snapshot', 'webhook'], rules)

    expect(lines[0]).toBe(
      'It starts when a new snapshot arrives or a webhook call arrives.',
    )
    expect(lines[1]).toContain('a weekday between 07:00 and 19:00 (UTC)')
    expect(lines[1]).toContain('and a new snapshot added at least 8 rows')
    expect(lines.join(' ')).toContain('waits 5 min')
    expect(lines.join(' ')).toContain('skipped.')
  })

  it('joins conditions with or when any is enough', () => {
    const words = conditionWords(
      parseStartRules({
        conditionsMatch: 'any',
        window: { days: 'daily', from: '07:00', to: '19:00', timeZone: 'UTC' },
        minNewRows: 2,
      }),
    )

    expect(words).toContain(' or ')
  })
})
