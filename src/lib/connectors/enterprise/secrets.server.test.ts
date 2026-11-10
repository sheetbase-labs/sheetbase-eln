// @vitest-environment node
import { afterAll, expect, it, vi } from 'vitest'
import { redactSecrets } from './secrets.server'

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

it('redacts nested JSON string values without changing scientific keys, scalars or the input', () => {
  const payload = {
    message: 'prefix credential-a suffix credential-a',
    rows: [
      { value: 'credential-b', count: 7.4, missing: null, accepted: false },
      'unrelated',
    ],
    details: Object.fromEntries([['__proto__', 'credential-a']]),
    short: 'abc',
  }

  expect(
    redactSecrets(payload, {
      first: 'credential-a',
      second: 'credential-b',
      short: 'abc',
    }),
  ).toEqual({
    message: 'prefix [redacted] suffix [redacted]',
    rows: [
      { value: '[redacted]', count: 7.4, missing: null, accepted: false },
      'unrelated',
    ],
    details: Object.fromEntries([['__proto__', '[redacted]']]),
    short: 'abc',
  })
  expect(payload.message).toBe('prefix credential-a suffix credential-a')
  expect(payload.rows[0]).toEqual({
    value: 'credential-b',
    count: 7.4,
    missing: null,
    accepted: false,
  })
  expect(
    Object.getOwnPropertyDescriptor(payload.details, '__proto__')?.value,
  ).toBe('credential-a')
})
