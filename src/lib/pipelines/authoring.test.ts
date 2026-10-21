import { describe, expect, it } from 'vitest'

import {
  addParameter,
  addStep,
  defaultConfirm,
  moveStep,
  parseDefault,
  removeStep,
  setConfirmPatch,
  setStepConfirm,
  suggestPipelineKey,
  updateParameter,
  updateStep,
} from './authoring'
import { validatePipelineConfig } from './config'

describe('parameters', () => {
  it('adds uniquely named text parameters', () => {
    const one = addParameter([])
    const two = addParameter(one)
    expect(two.map((p) => p.name)).toEqual(['parameter_1', 'parameter_2'])
  })

  it('drops the default when a parameter becomes required or changes type', () => {
    const list = updateParameter(
      [{ name: 'n', type: 'integer', required: false, default: 3 }],
      0,
      { required: true },
    )
    expect(list[0]).not.toHaveProperty('default')
    const typed = updateParameter(
      [{ name: 'n', type: 'integer', required: false, default: 3 }],
      0,
      { type: 'text' },
    )
    expect(typed[0]).not.toHaveProperty('default')
  })

  it('reads a default as its type, or nothing', () => {
    expect(parseDefault('integer', '4')).toBe(4)
    expect(parseDefault('integer', '4.5')).toBeUndefined()
    expect(parseDefault('decimal', '4.5')).toBe(4.5)
    expect(parseDefault('boolean', 'true')).toBe(true)
    expect(parseDefault('boolean', 'maybe')).toBeUndefined()
    expect(parseDefault('text', '  hi ')).toBe('hi')
    expect(parseDefault('text', ' ')).toBeUndefined()
  })
})

describe('steps', () => {
  const two = addStep(addStep([]))

  it('adds uniquely named steps that the validator accepts', () => {
    expect(two.map((s) => s.name)).toEqual(['step_1', 'step_2'])
    const errors = validatePipelineConfig({
      configVersion: 1,
      parameters: [],
      inputs: [],
      transform: { language: 'sql', statement: 'select 1' },
      output: { mode: 'none', datasetLabel: 'x' },
      steps: two,
    })
    expect(errors.filter((e) => e.field.startsWith('steps'))).toEqual([])
  })

  it('moves a step and stops at the ends', () => {
    expect(moveStep(two, 0, 1).map((s) => s.name)).toEqual(['step_2', 'step_1'])
    expect(moveStep(two, 0, -1)).toBe(two)
  })

  it('adds a confirm that validates, and removes it again', () => {
    const asked = setStepConfirm(two, 0, defaultConfirm(['u-1']))
    expect(asked[0].confirm?.askedUserIds).toEqual(['u-1'])
    const errors = validatePipelineConfig({
      configVersion: 1,
      parameters: [],
      inputs: [],
      transform: { language: 'sql', statement: 'select 1' },
      output: { mode: 'none', datasetLabel: 'x' },
      steps: asked,
    })
    expect(errors.filter((e) => e.field.startsWith('steps'))).toEqual([])
    expect(setStepConfirm(asked, 0, undefined)[0]).not.toHaveProperty('confirm')
  })

  it('keeps skips pointing at real steps when one is renamed or removed', () => {
    let steps = setStepConfirm(two, 0, defaultConfirm(['u-1']))
    steps = setConfirmPatch(steps, 0, { skipSteps: ['step_2'] })
    const renamed = updateStep(steps, 1, { name: 'clean' })
    expect(renamed[0].confirm?.skipSteps).toEqual(['clean'])
    const removed = removeStep(steps, 1)
    expect(removed).toHaveLength(1)
    expect(removed[0].confirm?.skipSteps).toEqual([])
  })
})

describe('suggestPipelineKey', () => {
  it('turns a name into a key the database accepts', () => {
    expect(suggestPipelineKey('Viability summary')).toBe('viability_summary')
    expect(suggestPipelineKey('  Plate-reader  PR-01 export! ')).toBe(
      'plate_reader_pr_01_export',
    )
    expect(suggestPipelineKey('Résumé des résultats')).toBe(
      'resume_des_resultats',
    )
  })

  it('starts with a letter and stays within 60 characters', () => {
    expect(suggestPipelineKey('2026 stability')).toBe('p_2026_stability')
    const long = suggestPipelineKey('word '.repeat(40))
    expect(long.length).toBeLessThanOrEqual(60)
    expect(long).toMatch(/^[a-z][a-z0-9_]*[a-z0-9]$/)
  })

  it('has no suggestion for a name with nothing usable', () => {
    expect(suggestPipelineKey('  !!! ')).toBe('')
  })
})
