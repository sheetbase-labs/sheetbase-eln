import { describe, expect, it, vi } from 'vitest'

vi.mock('../request-auth', () => ({
  realSessionAuthDeps: {},
  requestErrorResponse: vi.fn(),
  resolveSessionAuth: vi.fn(),
}))

import { describeIntakeFailure } from './intake.server'
import { parserKeyFromName } from './webhook-parser-admin.server'

describe('describeIntakeFailure', () => {
  it('names the parser and what to do next', () => {
    expect(
      describeIntakeFailure('parser_not_approved', { parser: 'qPCR export' }),
    ).toBe('qPCR export isn’t approved yet. Once QA approves it, try again.')
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
