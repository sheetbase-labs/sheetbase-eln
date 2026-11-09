import { describe, expect, it } from 'vitest'

import {
  TRANSFORM_TARGET,
  applyStepFix,
  buildFixText,
  parseFailureReply,
} from './ai-fix'
import type { PipelineConfig } from './config'

const config: PipelineConfig = {
  configVersion: 1,
  parameters: [],
  inputs: [{ name: 'readings', required: true }],
  transform: { language: 'sql', statement: 'select * from readingz' },
  output: { mode: 'none', datasetLabel: 'x' },
  steps: [
    {
      name: 'summary',
      language: 'sql',
      statement: 'select 1 as n from previous',
    },
  ],
}

describe('buildFixText', () => {
  it('carries the error, the log and every statement', () => {
    const text = buildFixText({
      errorCode: 'transform_failed',
      errorMessage: 'relation "readingz" does not exist',
      logLines: ['a', 'b'],
      failedStep: TRANSFORM_TARGET,
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
  it('reads a fix for the transform, with or without code fences', () => {
    const body = JSON.stringify({
      explanation: 'Typo in the table name.',
      fix: {
        target: 'transform',
        language: 'sql',
        statement: 'select * from readings',
      },
    })

    for (const text of [body, '```json\n' + body + '\n```']) {
      const parsed = parseFailureReply(text, config)
      expect(parsed?.fix?.target).toBe('transform')
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
    const wrap = (fix: unknown) =>
      parseFailureReply(JSON.stringify({ explanation: 'x', fix }), config)

    expect(
      wrap({ target: 'nope', language: 'sql', statement: 'select 1' })?.fix,
    ).toBeNull()
    expect(
      wrap({ target: 'transform', language: 'python', statement: 'x' })?.fix,
    ).toBeNull()
    expect(
      wrap({
        target: 'transform',
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
  it('replaces only the targeted statement and leaves the base untouched', () => {
    const result = applyStepFix(config, {
      explanation: 'x',
      target: 'summary',
      language: 'sql',
      statement: 'select 2 as n from previous',
    })

    expect(result.ok).toBe(true)

    if (result.ok) {
      expect(result.config.steps?.[0]?.statement).toBe(
        'select 2 as n from previous',
      )
      expect(result.config.transform.statement).toBe('select * from readingz')
    }

    expect(config.steps?.[0]?.statement).toBe('select 1 as n from previous')
  })

  it('refuses a target the draft does not have', () => {
    const result = applyStepFix(config, {
      explanation: 'x',
      target: 'gone',
      language: 'sql',
      statement: 'select 1',
    })

    expect(result.ok).toBe(false)
  })
})
