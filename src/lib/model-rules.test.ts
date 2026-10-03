import { describe, expect, it } from 'vitest'

import { evaluateModelRules, modelRuleConditionMatches } from './model-rules'
import type { ModelRule } from './model-rules'

function rule(overrides: Partial<ModelRule> = {}): ModelRule {
  return {
    id: 'r-1',
    workspaceId: 'ws-1',
    modelKey: 'cell_bank',
    name: 'Working banks',
    fieldKeys: ['passage'],
    condition: { field: 'passage', op: 'gt', value: 30 },
    effect: 'warn',
    message: 'Working banks must be at passage 30 or lower',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('modelRuleConditionMatches', () => {
  it('treats an empty condition as always matching', () => {
    expect(modelRuleConditionMatches({}, {})).toBe(true)
  })

  it('compares numbers numerically', () => {
    const condition = { field: 'passage', op: 'gt' as const, value: 30 }
    expect(modelRuleConditionMatches(condition, { passage: 34 })).toBe(true)
    expect(modelRuleConditionMatches(condition, { passage: 30 })).toBe(false)
  })

  it('supports in and not_in', () => {
    expect(
      modelRuleConditionMatches(
        { field: 'sterility', op: 'in', value: ['negative'] },
        { sterility: 'negative' },
      ),
    ).toBe(true)
    expect(
      modelRuleConditionMatches(
        { field: 'sterility', op: 'not_in', value: ['negative'] },
        { sterility: 'negative' },
      ),
    ).toBe(false)
  })

  it('supports is_null, not_null and null leaves', () => {
    expect(modelRuleConditionMatches({ field: 'x', op: 'is_null' }, {})).toBe(
      true,
    )
    expect(
      modelRuleConditionMatches({ field: 'x', op: 'not_null' }, { x: 1 }),
    ).toBe(true)
    expect(
      modelRuleConditionMatches({ field: 'x', op: 'eq', value: 1 }, {}),
    ).toBe(false)
  })

  it('supports all, any and not combinators', () => {
    const values = { passage: 34, vials_left: 5 }
    expect(
      modelRuleConditionMatches(
        {
          all: [
            { field: 'passage', op: 'gt', value: 30 },
            { field: 'vials_left', op: 'gt', value: 0 },
          ],
        },
        values,
      ),
    ).toBe(true)
    expect(
      modelRuleConditionMatches(
        { any: [{ field: 'passage', op: 'gt', value: 40 }] },
        values,
      ),
    ).toBe(false)
    expect(
      modelRuleConditionMatches(
        { not: { field: 'passage', op: 'gt', value: 30 } },
        values,
      ),
    ).toBe(false)
  })

  it('supports a POSIX-style regex match', () => {
    expect(
      modelRuleConditionMatches(
        { field: 'name', op: 'matches', value: '^HEK' },
        { name: 'HEK293' },
      ),
    ).toBe(true)
  })
})

describe('evaluateModelRules', () => {
  const warn = rule()
  const block = rule({
    id: 'r-2',
    effect: 'block',
    fieldKeys: ['vials_left'],
    condition: { field: 'vials_left', op: 'lt', value: 0 },
    message: "Vials left can't go below 0",
  })
  const flag = rule({
    id: 'r-3',
    effect: 'flag_block_submit',
    condition: {},
    message: 'Needs QA review',
  })

  it('groups matched rules by effect', () => {
    const result = evaluateModelRules([warn, block, flag], {
      passage: 34,
      vials_left: -1,
    })
    expect(result.blocked).toBe(true)
    expect(result.blockSubmit).toBe(true)
    expect(result.blocks.map((m) => m.ruleId)).toEqual(['r-2'])
    expect(result.warnings.map((m) => m.ruleId)).toEqual(['r-1'])
    expect(result.submitBlocks.map((m) => m.ruleId)).toEqual(['r-3'])
  })

  it('reports nothing when no rule matches', () => {
    const result = evaluateModelRules([warn, block], {
      passage: 12,
      vials_left: 4,
    })
    expect(result).toMatchObject({
      blocked: false,
      blockSubmit: false,
      warnings: [],
      blocks: [],
      submitBlocks: [],
    })
  })
})
