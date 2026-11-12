import { describe, expect, it } from 'vitest'

import {
  convertToSql,
  duplicateStep,
  freeStepName,
  moveStep,
  newStep,
  removeStep,
  updateStep,
} from './step-list'
import type { PipelineStep } from './config'

const context = {
  inputs: [{ name: 'readings' }],
  parameters: [],
  hasPrevious: false,
  askedUserIds: ['u-1'],
}

function steps(): PipelineStep[] {
  const first = newStep('filter', [], context)
  const second = newStep('calculate', [first], context)

  return [first, second]
}

describe('step list operations', () => {
  it('names new steps so they never collide', () => {
    const list = steps()

    expect(list.map((s) => s.name)).toEqual(['filter_1', 'calculate_1'])
    expect(freeStepName('filter', list)).toBe('filter_2')
  })

  it('moves a step and keeps the ends in place', () => {
    const list = steps()

    expect(moveStep(list, 0, 1).map((s) => s.name)).toEqual([
      'calculate_1',
      'filter_1',
    ])
    expect(moveStep(list, 0, -1)).toBe(list)
  })

  it('duplicates a step under a new name', () => {
    const list = duplicateStep(steps(), 0)

    expect(list).toHaveLength(3)
    expect(new Set(list.map((s) => s.name)).size).toBe(3)
  })

  it('turns a form step into SQL, keeping its code, and leaves SQL steps alone', () => {
    const list = convertToSql(steps(), 0)
    const converted = list[0]

    expect(converted.kind).toBe('sql')
    expect('statement' in converted && converted.statement).toContain(
      'previous',
    )
    expect(convertToSql(list, 0)).toBe(list)
  })

  it('removes a step from an ask step’s skip list', () => {
    const list = steps()
    const ask = newStep('ask', list, context)

    if (ask.kind !== 'ask') throw new Error('expected an ask step')

    const withSkip = [
      ...list,
      { ...ask, ask: { ...ask.ask, skipSteps: ['calculate_1'] } },
    ]

    const after = removeStep(withSkip, 1)
    const last = after.at(-1)

    expect(after).toHaveLength(2)
    expect(last?.kind === 'ask' && last.ask.skipSteps).toBeFalsy()
  })

  it('renaming a step updates the steps that skip it', () => {
    const list = steps()
    const ask = newStep('ask', list, context)

    if (ask.kind !== 'ask') throw new Error('expected an ask step')

    const withSkip = [
      ...list,
      { ...ask, ask: { ...ask.ask, skipSteps: ['calculate_1'] } },
    ]

    const renamed = updateStep(withSkip, 1, { ...withSkip[1], name: 'ratio' })
    const last = renamed.at(-1)

    expect(last?.kind === 'ask' && last.ask.skipSteps).toEqual(['ratio'])
  })
})
