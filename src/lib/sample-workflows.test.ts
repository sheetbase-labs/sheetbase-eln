import { describe, expect, it } from 'vitest'

import {
  blankAction,
  blankStage,
  blankWorkflow,
  daysUntil,
  describeAction,
  draftToWire,
  validateWorkflow,
} from './sample-workflows'

function valid() {
  const draft = blankWorkflow()
  draft.name = 'Intake'

  return draft
}

describe('validateWorkflow', () => {
  it('accepts a new workflow once it is named', () => {
    expect(validateWorkflow(blankWorkflow())).toMatch(/name/i)
    expect(validateWorkflow(valid())).toBeNull()
  })

  it('refuses duplicate step names and bad turnarounds', () => {
    const draft = valid()
    draft.stages[1].name = draft.stages[0].name.toUpperCase()
    expect(validateWorkflow(draft)).toMatch(/Two steps/)
    draft.stages[1].name = 'Done'
    draft.stages[0].turnaroundDays = '1.5'
    expect(validateWorkflow(draft)).toMatch(/whole days/)
  })

  it('finds steps no sample can reach and steps that lead nowhere', () => {
    const draft = valid()
    const extra = blankStage('Side')
    draft.stages.splice(1, 0, extra)
    expect(validateWorkflow(draft)).toMatch(/can’t be reached/)
    draft.stages[0].next.push(extra.key)
    expect(validateWorkflow(draft)).toMatch(/leads nowhere/)
    extra.next = [draft.stages[2].key]
    expect(validateWorkflow(draft)).toBeNull()
  })

  it('follows a chain of steps from the first to the last', () => {
    const draft = valid()
    const middle = blankStage('In QC')
    draft.stages.splice(1, 0, middle)
    draft.stages[0].next = [middle.key]
    middle.next = [draft.stages[2].key]
    expect(validateWorkflow(draft)).toBeNull()
  })

  it('wants an automation to be complete', () => {
    const draft = valid()
    draft.stages[0].actions = [blankAction('start_experiment')]
    expect(validateWorkflow(draft)).toMatch(/template/)
  })
})

describe('draftToWire', () => {
  it('leaves nothing after the last step and drops empty strings', () => {
    const draft = valid()
    draft.stages[1].next = [draft.stages[0].key]
    draft.stages[0].turnaroundDays = ' 3 '

    const wire = draftToWire(draft) as {
      stages: { next: string[]; turnaroundDays: number | null }[]
    }

    expect(wire.stages[1].next).toEqual([])
    expect(wire.stages[0].turnaroundDays).toBe(3)
  })
})

describe('describeAction and daysUntil', () => {
  it('describes automations in plain words', () => {
    expect(describeAction({ kind: 'notify', to: 'role:steward' })).toBe(
      'Tell Everyone who is a steward',
    )
    expect(describeAction({ kind: 'quarantine' })).toBe('Quarantine')
  })

  it('counts whole days to a due date', () => {
    const now = Date.parse('2026-11-05T12:00:00Z')
    expect(daysUntil('2026-11-07T12:00:00Z', now)).toBe(2)
    expect(daysUntil('2026-11-04T00:00:00Z', now)).toBe(-1)
    expect(daysUntil(null, now)).toBeNull()
  })
})
