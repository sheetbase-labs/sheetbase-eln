import { describe, expect, it } from 'vitest'

import { parseStartRules } from '#/lib/pipelines/start-rules'

import { conditionWords, readbackLines } from './starts-readback'

describe('readbackLines', () => {
  it('says an unruled pipeline starts on every start', () => {
    const lines = readbackLines(['schedule'], parseStartRules({}))

    expect(lines[0]).toBe('Starts when <b>a schedule</b> is due.')
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
      'Starts when <b>a new snapshot</b> arrives or <b>a webhook call</b> arrives.',
    )
    expect(lines[1]).toContain('on <b>weekdays 07:00–19:00</b> (UTC time)')
    expect(lines[1]).toContain(
      'and if the snapshot has <b>8 or more new rows</b>',
    )
    expect(lines.join(' ')).toContain('Waits <b>5 min</b>')
    expect(lines.join(' ')).toContain('<b>skipped</b>')
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
