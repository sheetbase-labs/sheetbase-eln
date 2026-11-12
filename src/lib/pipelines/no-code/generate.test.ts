import { z } from 'zod'
import { describe, expect, it } from 'vitest'

import type { NoCodeForm } from './forms'
import { noCodeStatement } from './generate'
import { noCodeStepProblem, parseNoCodeForm } from './schema'
import { noCodeSummary } from './summary'
import { checkTransformStatement } from '../statement'

const filter = {
  match: 'all' as const,
  conditions: [
    { column: 'od600', op: 'gt' as const, value: '0.4' },
    { column: 'status', op: 'eq' as const, value: "it's ok", text: true },
  ],
}

/** A fixture as the JSON a stored step holds. */
function json(value: NoCodeForm): z.core.util.JSONType {
  // react-doctor-disable-next-line react-doctor/no-json-parse-stringify-clone -- the fixture must be plain JSON, as a stored step is.
  return z.json().parse(JSON.parse(JSON.stringify(value)))
}

describe('no-code step SQL', () => {
  it('writes a filter as one SELECT over the previous step', () => {
    const made = noCodeStatement('filter', filter)

    expect(made.ok).toBe(true)

    if (!made.ok) return
    expect(made.statement).toContain('FROM previous')
    expect(made.statement).toContain("'it''s ok'")
    expect(checkTransformStatement(made.statement).ok).toBe(true)
  })

  it('writes every kind as SQL the sandbox accepts', () => {
    const forms = {
      join: {
        with: 'plates',
        type: 'left' as const,
        keys: [{ left: 'well', right: 'well' }],
        bring: ['plate'],
      },
      calculate: {
        column: 'ratio',
        terms: [{ column: 'a' }, { op: '/' as const, column: 'b' }],
        places: 2,
      },
      check_ranges: {
        ranges: [{ column: 'od600', min: 0, max: 2 }],
        keep: 'all' as const,
      },
      flag: {
        column: 'high',
        match: 'any' as const,
        conditions: filter.conditions,
      },
    }

    for (const [kind, form] of Object.entries(forms)) {
      // SAFETY: the step kind names the shape of its form, checked by parseNoCodeForm.
      const parsed = parseNoCodeForm(kind as keyof typeof forms, json(form))

      expect(parsed).not.toBeNull()

      if (!parsed) continue

      // SAFETY: the step kind names the shape of its form, checked by parseNoCodeForm.
      const made = noCodeStatement(kind as keyof typeof forms, parsed)

      expect(made.ok, kind).toBe(true)

      if (made.ok) expect(checkTransformStatement(made.statement).ok).toBe(true)
    }
  })

  it('refuses values that could end the statement', () => {
    const made = noCodeStatement('filter', {
      match: 'all',
      conditions: [
        { column: 'a', op: 'eq', value: "1'; drop table x --", text: true },
      ],
    })

    expect(made.ok).toBe(false)
  })

  it('flags a step whose SQL is not the SQL its form writes', () => {
    const made = noCodeStatement('filter', filter)

    if (!made.ok) throw new Error('form should be valid')

    expect(noCodeStepProblem('filter', json(filter), made.statement)).toBeNull()
    expect(
      noCodeStepProblem('filter', json(filter), 'SELECT * FROM previous')
        ?.field,
    ).toBe('statement')
    expect(
      noCodeStepProblem('filter', { match: 'nope' }, made.statement)?.field,
    ).toBe('form')
  })

  it('summarises a form in words', () => {
    expect(noCodeSummary('filter', filter)).toContain('od600')
  })
})
