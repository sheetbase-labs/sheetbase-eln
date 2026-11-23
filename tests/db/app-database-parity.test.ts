/**
 * Rules the app needs for its first render are written twice, once in
 * TypeScript and once in SQL. Each case here runs both on the same input and
 * fails naming the pair when they differ.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  agentActionAlwaysAsk,
  agentActionAlwaysNever,
} from '#/lib/agent-action-policy'
import { PUBLIC_EMAIL_DOMAINS } from '#/lib/join-domains'
import { modelRuleConditionMatches } from '#/lib/model-rules'
import type { ModelRuleCondition } from '#/lib/model-rules'
import { LAB_RPCS } from '#/lib/lab-api-surface'
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

describe('what agents may never do or always need a person for', () => {
  // Every action the lab API has, plus keys that sit on the edge of each rule.
  const keys = [
    ...Object.keys(LAB_RPCS),
    'sign_record',
    'amend_record',
    'unlock_record',
    'delete_file',
    'delete_notebook_block',
    'purge_everything',
    'submit_for_review',
    'submit_experiment_x',
    'resubmit_experiment',
    'decide_review',
    'release_sample',
    'approve_signature',
    'set_agent_action_policy',
    'update_workspace_ai_settings',
    'create_record',
  ]

  it('agree on every action key', async () => {
    const { rows } = await migrator.query<{
      key: string
      never: boolean
      ask: boolean
    }>(
      `select k as key,
              internal.agent_action_always_never(k) as never,
              internal.agent_action_always_ask(k) as ask
         from unnest($1::text[]) k`,
      [keys],
    )

    const differing = rows
      .filter(
        (row) =>
          row.never !== agentActionAlwaysNever(row.key) ||
          row.ask !== agentActionAlwaysAsk(row.key),
      )
      .map(
        (row) =>
          `${row.key}: database never=${row.never} ask=${row.ask}, app never=${agentActionAlwaysNever(row.key)} ask=${agentActionAlwaysAsk(row.key)}`,
      )

    expect(
      differing,
      'src/lib/agent-action-policy.ts and internal.agent_action_always_never / _always_ask must agree',
    ).toEqual([])
  })
})

describe('public email domains', () => {
  it('are the same list in the settings card and the database', async () => {
    const { rows } = await migrator.query<{ def: string }>(
      `select pg_get_functiondef('internal.public_email_domain(text)'::regprocedure) as def`,
    )

    const inDatabase = [...rows[0]!.def.matchAll(/'([a-z0-9.-]+)'/g)]
      .map((match) => match[1]!)
      .sort()

    expect(
      [...PUBLIC_EMAIL_DOMAINS].sort(),
      'src/lib/join-domains.ts and internal.public_email_domain must list the same domains',
    ).toEqual(inDatabase)
  })
})

describe('model rule conditions', () => {
  // Typed values, as saved. The form also lets text typed into a number field
  // count as that number, which the database doesn't, so mixed cases are left
  // out on purpose.
  const values = { passage: 34, name: 'cell', clean: true, empty: null }

  const conditions: Array<[string, ModelRuleCondition]> = [
    ['nothing', {}],
    ['number equal', { field: 'passage', op: 'eq', value: 34 }],
    ['number not equal', { field: 'passage', op: 'neq', value: 34 }],
    ['default operator is equal', { field: 'name', value: 'cell' }],
    ['text equal', { field: 'name', op: 'eq', value: 'cell' }],
    ['text different', { field: 'name', op: 'eq', value: 'tissue' }],
    ['text not equal', { field: 'name', op: 'neq', value: 'tissue' }],
    ['boolean equal', { field: 'clean', op: 'eq', value: true }],
    ['in the list', { field: 'passage', op: 'in', value: [10, 34] }],
    ['not in the list', { field: 'passage', op: 'not_in', value: [10, 20] }],
    ['text in the list', { field: 'name', op: 'in', value: ['cell', 'x'] }],
    ['number above', { field: 'passage', op: 'gt', value: 30 }],
    ['number not above', { field: 'passage', op: 'gt', value: 34 }],
    ['number at least', { field: 'passage', op: 'gte', value: 34 }],
    ['number below', { field: 'passage', op: 'lt', value: 40 }],
    ['number at most', { field: 'passage', op: 'lte', value: 33 }],
    ['text after', { field: 'name', op: 'gt', value: 'bell' }],
    ['text before', { field: 'name', op: 'lt', value: 'bell' }],
    ['pattern matches', { field: 'name', op: 'matches', value: '^ce' }],
    ['pattern misses', { field: 'name', op: 'matches', value: '^x' }],
    ['null field is null', { field: 'empty', op: 'is_null' }],
    ['missing field is null', { field: 'absent', op: 'is_null' }],
    ['set field is not null', { field: 'passage', op: 'not_null' }],
    ['missing field is not set', { field: 'absent', op: 'not_null' }],
    ['missing field never equals', { field: 'absent', op: 'eq', value: 1 }],
    ['missing field never differs', { field: 'absent', op: 'neq', value: 1 }],
    ['null field never compares', { field: 'empty', op: 'gt', value: 1 }],
    [
      'all true',
      {
        all: [
          { field: 'passage', op: 'gt', value: 1 },
          { field: 'clean', op: 'eq', value: true },
        ],
      },
    ],
    [
      'all with one false',
      {
        all: [
          { field: 'passage', op: 'gt', value: 1 },
          { field: 'name', op: 'eq', value: 'x' },
        ],
      },
    ],
    [
      'any with one true',
      {
        any: [
          { field: 'passage', op: 'lt', value: 1 },
          { field: 'name', op: 'eq', value: 'cell' },
        ],
      },
    ],
    ['any with none true', { any: [{ field: 'passage', op: 'lt', value: 1 }] }],
    ['not', { not: { field: 'passage', op: 'eq', value: 34 } }],
    [
      'nested',
      {
        not: {
          any: [
            { field: 'passage', op: 'gt', value: 100 },
            { all: [{ field: 'clean', op: 'eq', value: false }] },
          ],
        },
      },
    ],
  ]

  it.each(conditions)('%s', async (_name, condition) => {
    const { rows } = await migrator.query<{ matches: boolean }>(
      `select internal.model_rule_condition_matches($1::jsonb, $2::jsonb) as matches`,
      [JSON.stringify(condition), JSON.stringify(values)],
    )

    expect(
      modelRuleConditionMatches(condition, values),
      'src/lib/model-rules.ts and internal.model_rule_condition_matches must agree',
    ).toBe(rows[0]!.matches)
  })
})
