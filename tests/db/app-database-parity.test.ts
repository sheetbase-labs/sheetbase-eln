/**
 * Rules the app needs for its first render are written twice, once in
 * TypeScript and once in SQL. Each case here runs both on the same input and
 * fails naming the pair when they differ.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { BUILT_IN_RULES } from '#/lib/release-rules'
import { effectiveHoldDeadline } from '#/lib/sample-hold.server'

import { prepareTestDatabase } from './helpers'

let migrator: Client

beforeAll(async () => {
  ;({ migrator } = await prepareTestDatabase())
})

afterAll(async () => {
  await migrator.end()
})

describe('sample hold deadline', () => {
  const created = '2027-03-01T09:30:00Z'

  const cases: Array<[string, Record<string, unknown>]> = [
    ['an explicit date wins', { holdUntil: '2027-06-01T00:00:00Z' }],
    [
      'a date wins over a duration',
      { holdUntil: '2027-06-01T00:00:00Z', holdDurationDays: 3 },
    ],
    ['a duration counts from creation', { holdDurationDays: 14 }],
    [
      'a duration counts from the start',
      { holdStartedAt: '2027-02-10T12:00:00Z', holdDurationDays: 30 },
    ],
    ['a duration written as text', { holdDurationDays: '7' }],
  ]

  it.each(cases)('%s', async (_name, properties) => {
    const { rows } = await migrator.query<{ deadline: Date }>(
      `select internal.sample_hold_deadline($1::jsonb, $2::timestamptz) as deadline`,
      [JSON.stringify(properties), created],
    )

    expect(
      effectiveHoldDeadline({
        createdAt: created,
        properties: properties as never,
      })?.toISOString(),
      'src/lib/sample-hold.server.ts and internal.sample_hold_deadline must give the same deadline',
    ).toBe(rows[0]!.deadline.toISOString())
  })
})

describe('release rules', () => {
  it('start from the rules the database falls back to', async () => {
    const { rows } = await migrator.query<{ rules: Array<{ key?: string }> }>(
      `select internal.canonical_sample_release_rules() as rules`,
    )

    // The database also gives each rule a key; the app doesn't need it.
    const inDatabase = rows[0]!.rules.map(({ key: _key, ...rest }) => rest)

    expect(
      [...BUILT_IN_RULES],
      'BUILT_IN_RULES in src/lib/release-rules.ts and internal.canonical_sample_release_rules must be the same rules',
    ).toEqual(inDatabase)
  })
})
