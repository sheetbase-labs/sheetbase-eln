import { describe, expect, it } from 'vitest'

import { describeGateBlock } from './gate'
import { contractImpact } from './impact'
import { odcsFileName, odcsToYaml, parseOdcs } from './odcs'
import {
  BLANK_DRAFT,
  describeFinding,
  describeRule,
  draftProblem,
  draftToRule,
  ruleToDraft,
  worseStatus,
} from './rules'
import type { ContractRule } from './types'

const range: ContractRule = {
  id: 'r1',
  kind: 'range',
  field: 'od600',
  mode: 'block',
  min: 0,
  max: 4,
}

describe('rule forms', () => {
  it('asks for a field, limits and units before a rule exists', () => {
    expect(draftProblem(BLANK_DRAFT)).toBeTruthy()
    expect(draftProblem({ ...BLANK_DRAFT, field: 'od600' })).toBeNull()
    expect(
      draftProblem({ ...BLANK_DRAFT, kind: 'range', field: 'a' }),
    ).toBeTruthy()
    expect(
      draftProblem({
        ...BLANK_DRAFT,
        kind: 'range',
        field: 'a',
        min: '5',
        max: '1',
      }),
    ).toBeTruthy()
    expect(
      draftProblem({ ...BLANK_DRAFT, kind: 'units', field: 'a', units: ' , ' }),
    ).toBeTruthy()
    expect(
      draftProblem({
        ...BLANK_DRAFT,
        kind: 'completeness',
        field: 'a',
        threshold: '101',
      }),
    ).toBeTruthy()
    expect(
      draftProblem({
        ...BLANK_DRAFT,
        kind: 'row_count',
        min: '1.5',
      }),
    ).toBeTruthy()
  })

  it('turns a draft into a rule and back', () => {
    const rule = draftToRule(ruleToDraft(range), 'r1')
    expect(rule).toEqual(range)

    const freshness: ContractRule = {
      id: 'f',
      kind: 'freshness',
      mode: 'warn',
      maxAgeMinutes: 2880,
    }

    expect(ruleToDraft(freshness)).toMatchObject({
      maxAge: '2',
      maxAgeUnit: 'days',
    })
    expect(draftToRule(ruleToDraft(freshness), 'f')).toEqual(freshness)
  })

  it('reads the worse of two standings', () => {
    expect(worseStatus('pass', 'warning')).toBe('warning')
    expect(worseStatus('fail', 'warning')).toBe('fail')
    expect(worseStatus(null, 'pass')).toBe('pass')
  })

  it('says what a rule asks and what it found', () => {
    expect(describeRule(range)).toBe('Values are 0 to 4')
    expect(
      describeFinding(
        {
          ruleId: 'r1',
          kind: 'range',
          field: 'od600',
          mode: 'block',
          status: 'fail',
          checked: 10,
          failed: 2,
        },
        range,
        'OD600',
      ),
    ).toBe('2 of 10 values are outside 0 to 4')
  })
})

describe('contract impact of a new model version', () => {
  const rules: ContractRule[] = [
    range,
    { id: 'u', kind: 'units', field: 'conc', mode: 'warn', units: ['mg/mL'] },
    { id: 'n', kind: 'row_count', mode: 'warn', min: 1 },
  ]

  it('finds a removed field, a field no longer numeric and a changed unit', () => {
    expect(contractImpact(rules, [])).toEqual([
      { rule: rules[0], reason: 'removed' },
      { rule: rules[1], reason: 'removed' },
    ])
    expect(
      contractImpact(rules, [
        { key: 'od600', logicalType: 'text' },
        { key: 'conc', logicalType: 'decimal', unit: 'ug/mL' },
      ]).map((impact) => impact.reason),
    ).toEqual(['not_number', 'unit_changed'])
  })

  it('finds nothing when the new fields still fit', () => {
    expect(
      contractImpact(rules, [
        { key: 'od600', logicalType: 'decimal' },
        { key: 'conc', logicalType: 'decimal', unit: 'mg/mL' },
      ]),
    ).toEqual([])
  })
})

describe('ODCS files', () => {
  it('writes YAML that reads back, and reads JSON too', () => {
    const document = { apiVersion: 'v3.1.0', kind: 'DataContract', id: 'x' }
    expect(parseOdcs(odcsToYaml(document))).toEqual(document)
    expect(parseOdcs(JSON.stringify(document))).toEqual(document)
  })

  it('refuses text that is not a contract', () => {
    expect(() => parseOdcs('- a\n- b')).toThrow(/not a data contract/)
    expect(() => parseOdcs('a: [')).toThrow(/not valid/)
  })

  it('names the file from the contract', () => {
    expect(odcsFileName('Plate reads (v2)')).toBe('plate-reads-v2.odcs.yaml')
    expect(odcsFileName('???')).toBe('data-contract.odcs.yaml')
  })
})

describe('what a blocked commit says', () => {
  it('names the contract and the broken blocking rules only', () => {
    const text = describeGateBlock({
      ok: false,
      checked: true,
      blocked: true,
      contractName: 'Plate reads',
      results: [
        {
          ruleId: 'r1',
          kind: 'range',
          field: 'od600',
          mode: 'block',
          status: 'fail',
        },
        {
          ruleId: 'r2',
          kind: 'required',
          field: 'well',
          mode: 'warn',
          status: 'fail',
        },
      ],
    })

    expect(text).toContain('Plate reads')
    expect(text).toContain('Range on od600')
    expect(text).not.toContain('Required')
  })
})
