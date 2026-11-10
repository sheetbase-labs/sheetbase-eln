// @vitest-environment node
import { afterAll, describe, expect, it, vi } from 'vitest'

import { describeIntakeFailure } from './intake.server'
import { parserKeyFromName } from './webhook-parser-admin.server'

vi.hoisted(() => {
  vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost:5432/test')
  vi.stubEnv(
    'FORMULA_DATABASE_URL',
    'postgresql://test:test@localhost:5432/test',
  )
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-at-least-thirty-two-characters')
  vi.stubEnv('PGRST_JWT_SECRET', 'test-jwt-secret-at-least-thirty-two-chars')
})

afterAll(() => vi.unstubAllEnvs())

describe('describeIntakeFailure', () => {
  it('names the parser and what to do next', () => {
    expect(
      describeIntakeFailure('parser_not_approved', { parser: 'qPCR export' }),
    ).toBe(
      'This data needs an approved parser, and qPCR export isn’t approved yet. Once it’s approved, try again.',
    )
  })

  it('passes a parser’s own words through for refused files', () => {
    expect(
      describeIntakeFailure('webhook_refused', {
        parser: 'Acme service',
        detail: 'No Sample column.',
      }),
    ).toBe('Acme service couldn’t read the file: No Sample column.')
  })

  it('falls back to the detail, then to a plain sentence', () => {
    expect(describeIntakeFailure('odd_code', { detail: 'Disk full.' })).toBe(
      'Disk full.',
    )
    expect(describeIntakeFailure('odd_code')).toBe('The file couldn’t be read.')
  })
})

describe('parserKeyFromName', () => {
  it('makes a lowercase key a person can read', () => {
    expect(parserKeyFromName('qPCR bench service')).toBe('qpcr-bench-service')
    expect(parserKeyFromName('Café – Stéréo')).toBe('cafe-stereo')
  })

  it('never returns an empty key', () => {
    expect(parserKeyFromName('!!!')).toBe('webhook-parser')
  })
})
