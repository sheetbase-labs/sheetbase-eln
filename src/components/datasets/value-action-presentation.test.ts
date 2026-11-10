import { describe, expect, it } from 'vitest'

import {
  formatProvenanceValue,
  formatRuleThreshold,
  formatSelectedValue,
} from './value-action-presentation'
import type { DatasetSystemFlagProvenance } from '#/lib/dataset-flags'

describe('value action presentation', () => {
  it('uses JSON hooks for object provenance but string-hint hooks for selected values', () => {
    const reads: string[] = []

    const value = {
      toJSON() {
        reads.push('JSON')

        return { result: '<0.1' }
      },
      [Symbol.toPrimitive](hint: string) {
        reads.push(hint)

        return 'native result'
      },
    }

    expect(formatProvenanceValue(value)).toBe('{"result":"<0.1"}')
    expect(reads).toEqual(['JSON'])
    expect(formatSelectedValue(value)).toBe('native result')
    expect(reads).toEqual(['JSON', 'string'])
  })

  it('preserves non-object provenance, symbol support and distinct nullish labels', () => {
    const callable = Object.assign(() => 1, {
      [Symbol.toPrimitive]: (hint: string) => `callable ${hint}`,
      toJSON: () => 'incorrect JSON path',
    })

    expect(formatProvenanceValue(callable)).toBe('callable string')
    expect(formatProvenanceValue(Symbol('native'))).toBe('Symbol(native)')
    expect(formatSelectedValue(Symbol('native'))).toBe('Symbol(native)')
    expect(formatProvenanceValue(null)).toBe('no value')
    expect(formatSelectedValue(undefined)).toBe('—')
  })

  it('does not impose finite JSON restrictions or catch JSON failures', () => {
    expect(formatProvenanceValue({ result: Infinity })).toBe('{"result":null}')
    expect(formatProvenanceValue({ toJSON: () => undefined })).toBeUndefined()
    expect(formatProvenanceValue(new Date('2026-10-01T09:00:00Z'))).toBe(
      '"2026-10-01T09:00:00.000Z"',
    )
    expect(() => formatProvenanceValue({ result: 10n })).toThrow(TypeError)
    expect(() =>
      formatProvenanceValue({
        toJSON() {
          throw new Error('JSON refusal')
        },
      }),
    ).toThrow('JSON refusal')
  })

  it('keeps the original threshold object and reads min then max before string-hint coercion', () => {
    const reads: string[] = []

    const minimum = {
      [Symbol.toPrimitive](hint: string) {
        reads.push(`min ${hint}`)

        return '<0.1'
      },
    }

    const maximum = {
      [Symbol.toPrimitive](hint: string) {
        reads.push(`max ${hint}`)

        return Infinity
      },
    }

    const threshold = {
      get min() {
        expect(this).toBe(threshold)
        reads.push('get min')

        return minimum
      },
      get max() {
        expect(this).toBe(threshold)
        reads.push('get max')

        return maximum
      },
      get cvPercent() {
        throw new Error('unrelated CV read')
      },
      get requiresUnit() {
        throw new Error('unrelated unit read')
      },
    }

    expect(formatRuleThreshold('out_of_range', threshold)).toBe(
      'expected <0.1–Infinity',
    )
    expect(reads).toEqual(['get min', 'get max', 'min string', 'max string'])
  })

  it('does not inspect any threshold properties for missing-unit rules', () => {
    const threshold = new Proxy(
      {},
      {
        get() {
          throw new Error('must not read threshold members')
        },
        ownKeys() {
          throw new Error('must not enumerate threshold members')
        },
      },
    )

    expect(formatRuleThreshold('missing_unit', threshold)).toBe(
      'the field requires a unit',
    )
  })

  it('reads CV members twice in original order and uses the second values', () => {
    const reads: string[] = []
    let cvReads = 0
    let replicateReads = 0
    let limitReads = 0

    const threshold = {
      get cvPercent() {
        reads.push('CV')
        cvReads += 1

        return cvReads === 1
          ? 1
          : {
              [Symbol.toPrimitive]: (hint: string) => {
                reads.push(hint)

                return 'second CV'
              },
            }
      },
      get replicateCount() {
        reads.push('replicates')
        replicateReads += 1

        return replicateReads === 1 ? 2 : undefined
      },
      get maxCvPercent() {
        reads.push('limit')
        limitReads += 1

        return limitReads === 1 ? 3 : null
      },
      get min() {
        throw new Error('unrelated minimum read')
      },
    }

    expect(formatRuleThreshold('high_cv', threshold)).toBe(
      'CV second CV% · undefined replicates · limit null%',
    )
    expect(reads).toEqual([
      'CV',
      'CV',
      'string',
      'replicates',
      'replicates',
      'limit',
      'limit',
    ])
  })

  it('skips the second nullish CV read without skipping later members', () => {
    const reads: string[] = []

    const threshold = {
      get cvPercent() {
        reads.push('CV')

        return null
      },
      get replicateCount() {
        reads.push('replicates')

        return 2
      },
      get maxCvPercent() {
        reads.push('limit')

        return undefined
      },
    }

    expect(formatRuleThreshold('high_cv', threshold)).toBe('2 replicates')
    expect(reads).toEqual(['CV', 'replicates', 'replicates', 'limit'])
  })

  it('retains inherited and array members, while rejecting callable thresholds', () => {
    class HistoricalThreshold {
      get min() {
        return -Infinity
      }
      get max() {
        return 10n
      }
    }

    expect(formatRuleThreshold('out_of_range', new HistoricalThreshold())).toBe(
      'expected -Infinity–10',
    )
    expect(
      formatRuleThreshold(
        'out_of_range',
        Object.assign([], { max: 'above curve' }),
      ),
    ).toBe('expected at most above curve')
    expect(
      formatRuleThreshold(
        'out_of_range',
        Object.assign(() => 1, { max: 10 }),
      ),
    ).toBeNull()
    expect(formatRuleThreshold('missing_unit', false)).toBeNull()
    expect(formatRuleThreshold('out_of_range', null)).toBeNull()
  })

  interface SymbolThresholdCase {
    rule: DatasetSystemFlagProvenance['rule']
    threshold: DatasetSystemFlagProvenance['threshold']
  }

  const symbolCases: SymbolThresholdCase[] = [
    { rule: 'out_of_range', threshold: { min: Symbol('min'), max: 2 } },
    { rule: 'out_of_range', threshold: { min: 1, max: Symbol('max') } },
    { rule: 'out_of_range', threshold: { min: Symbol('min') } },
    { rule: 'out_of_range', threshold: { max: Symbol('max') } },
    { rule: 'high_cv', threshold: { cvPercent: Symbol('CV') } },
    { rule: 'high_cv', threshold: { replicateCount: Symbol('replicates') } },
    { rule: 'high_cv', threshold: { maxCvPercent: Symbol('limit') } },
  ]

  it.each(symbolCases)(
    'throws rather than String-coercing symbols in $rule thresholds',
    ({ rule, threshold }) => {
      expect(() => formatRuleThreshold(rule, threshold)).toThrow(TypeError)
    },
  )

  it('reads max before a minimum coercion throws, but never coerces max', () => {
    const reads: string[] = []

    const threshold = {
      get min() {
        reads.push('get min')

        return Symbol('min')
      },
      get max() {
        reads.push('get max')

        return {
          [Symbol.toPrimitive]: () => {
            throw new Error('must not coerce max')
          },
        }
      },
    }

    expect(() => formatRuleThreshold('out_of_range', threshold)).toThrow(
      TypeError,
    )
    expect(reads).toEqual(['get min', 'get max'])
  })

  it('stops CV traversal when the second getter or its coercion throws', () => {
    let reads = 0

    const threshold = {
      get cvPercent() {
        reads += 1

        if (reads === 2) throw new Error('second CV read failed')

        return 1
      },
      get replicateCount() {
        throw new Error('must not read replicates')
      },
    }

    expect(() => formatRuleThreshold('high_cv', threshold)).toThrow(
      'second CV read failed',
    )
    expect(reads).toBe(2)
    expect(() =>
      formatSelectedValue({
        [Symbol.toPrimitive]: () => {
          throw new Error('native refusal')
        },
      }),
    ).toThrow('native refusal')
  })
})
