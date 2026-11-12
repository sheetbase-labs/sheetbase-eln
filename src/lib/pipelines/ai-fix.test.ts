import { describe, expect, it } from 'vitest'

import { applyStepFix, buildFixText, parseFailureReply } from './ai-fix'
import type { PipelineConfig } from './config'

const config: PipelineConfig = {
  configVersion: 2,
  mode: 'standard',
  parameters: [],
  inputs: [{ name: 'readings', required: true }],
  output: { mode: 'none', datasetLabel: 'x' },
  steps: [
    { name: 'analysis', kind: 'sql', statement: 'select * from readingz' },
    {
      name: 'summary',
      kind: 'sql',
      statement: 'select 1 as n from previous',
    },
  ],
}

/** The statement of the step at an index, for a SQL or Python step. */
function statementAt(source: PipelineConfig, index: number) {
  const step = source.steps.at(index)

  return step?.kind === 'sql' || step?.kind === 'python'
    ? step.statement
    : undefined
}

function withStatement(index: number, statement: string): PipelineConfig {
  return {
    ...config,
    steps: config.steps.map((step, at) =>
      at === index && step.kind === 'sql' ? { ...step, statement } : step,
    ),
  }
}

describe('buildFixText', () => {
  it('carries the error, the log and every statement', () => {
    const text = buildFixText({
      errorCode: 'transform_failed',
      errorMessage: 'relation "readingz" does not exist',
      logLines: ['a', 'b'],
      failedStep: 'analysis',
      config,
    })

    expect(text).toContain('transform_failed')
    expect(text).toContain('Error log:\na\nb')
    expect(text).toContain('Inputs: readings')
    expect(text).toContain('select * from readingz')
    expect(text).toContain('Step "summary"')
  })
})

describe('parseFailureReply', () => {
  it('reads a fix for a step, with or without code fences', () => {
    const body = JSON.stringify({
      explanation: 'Typo in the table name.',
      fix: {
        target: 'analysis',
        language: 'sql',
        statement: 'select * from readings',
      },
    })

    for (const text of [body, '```json\n' + body + '\n```']) {
      const parsed = parseFailureReply(text, config)
      expect(parsed?.fix?.target).toBe('analysis')
      expect(parsed?.fix?.statement).toBe('select * from readings')
    }
  })

  it('keeps plain prose as an explanation with no fix', () => {
    expect(parseFailureReply('The input is missing.', config)).toEqual({
      explanation: 'The input is missing.',
      fix: null,
    })
  })

  it('drops a fix aimed at a step that does not exist, or one that changes language, or changes nothing', () => {
    const wrap = (fix: {
      target: string
      language: string
      statement: string
    }) => parseFailureReply(JSON.stringify({ explanation: 'x', fix }), config)

    expect(
      wrap({ target: 'nope', language: 'sql', statement: 'select 1' })?.fix,
    ).toBeNull()
    expect(
      wrap({ target: 'analysis', language: 'python', statement: 'x' })?.fix,
    ).toBeNull()
    expect(
      wrap({
        target: 'analysis',
        language: 'sql',
        statement: 'select * from readingz',
      })?.fix,
    ).toBeNull()
  })

  it('returns null for an empty reply or JSON without an explanation', () => {
    expect(parseFailureReply('  ', config)).toBeNull()
    expect(parseFailureReply('{"fix":null}', config)).toBeNull()
  })
})

describe('applyStepFix', () => {
  it.each([
    ['analysis', 0],
    ['summary', 1],
  ] as const)(
    'repairs an invalid %s statement before validating the draft',
    (target, index) => {
      const base = withStatement(index, '')

      const result = applyStepFix(base, {
        explanation: 'x',
        target,
        language: 'sql',
        statement: 'select 2 as n',
      })

      expect(result.ok).toBe(true)

      if (!result.ok) throw new Error(result.reason)

      expect(statementAt(result.config, index)).toBe('select 2 as n')
      expect(statementAt(base, index)).toBe('')
      expect(
        applyStepFix(
          { ...base, output: { mode: 'invalid' } },
          {
            explanation: 'x',
            target,
            language: 'sql',
            statement: 'select 2 as n',
          },
        ).ok,
      ).toBe(false)
    },
  )

  it.each([
    null,
    [],
    {},
    { ...config, steps: null },
    { ...config, steps: [null] },
  ])('rejects malformed draft shapes without asserting their type', (base) => {
    expect(
      applyStepFix(base, {
        explanation: 'x',
        target: 'analysis',
        language: 'sql',
        statement: 'select 2',
      }).ok,
    ).toBe(false)
  })

  it('replaces only the targeted statement and leaves the base untouched', () => {
    const result = applyStepFix(config, {
      explanation: 'x',
      target: 'summary',
      language: 'sql',
      statement: 'select 2 as n from previous',
    })

    expect(result.ok).toBe(true)

    if (result.ok) {
      expect(statementAt(result.config, 1)).toBe('select 2 as n from previous')
      expect(statementAt(result.config, 0)).toBe('select * from readingz')
    }

    expect(statementAt(config, 1)).toBe('select 1 as n from previous')
  })

  it('refuses a target the draft does not have, or one with no code', () => {
    for (const target of ['gone', 'tell'])
      expect(
        applyStepFix(
          {
            ...config,
            steps: [
              ...config.steps,
              {
                name: 'tell',
                kind: 'notify',
                notify: {
                  subscriptionId: '11111111-1111-4111-8111-111111111111',
                },
              },
            ],
          },
          { explanation: 'x', target, language: 'sql', statement: 'select 1' },
        ).ok,
      ).toBe(false)
  })
})
