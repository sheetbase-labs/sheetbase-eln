// @vitest-environment node

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ findFirst: vi.fn() }))

vi.mock('#/db/client.server', () => ({
  db: { query: { user: { findFirst: mocks.findFirst } } },
}))

function stubEnv() {
  vi.stubEnv('DATABASE_URL', 'postgresql://app:app@localhost:5432/sheetbase')
  vi.stubEnv(
    'FORMULA_DATABASE_URL',
    'postgresql://formula:formula@localhost:5432/sheetbase',
  )
  vi.stubEnv(
    'BETTER_AUTH_SECRET',
    'dev-only-insecure-auth-secret-replace-me-0123456789',
  )
  vi.stubEnv(
    'PGRST_JWT_SECRET',
    'dev-only-insecure-jwt-secret-replace-me-0123456789abcdef',
  )
  vi.stubEnv('SHEETBASE_ENV', 'development')
  vi.stubEnv('SHEETBASE_DEV_AUTH_FREE', 'true')
}

describe('auth-free development session', () => {
  beforeEach(() => {
    // env.server parses once per module load, so each case re-imports it with
    // its own SHEETBASE_DEV_USER_ID stub.
    vi.resetModules()
    stubEnv()
    mocks.findFirst.mockReset()
  })

  afterAll(() => vi.unstubAllEnvs())

  it('names the configured identity from its internal.user row', async () => {
    // The data-driven surfaces (Members) read this same row, so the chrome must
    // not present a second name for one person.
    vi.stubEnv('SHEETBASE_DEV_USER_ID', '00000000-0000-4000-8000-000000000310')
    mocks.findFirst.mockResolvedValue({ name: 'Gareth P.' })
    const { getDevSession } = await import('./dev-auth')

    await expect(getDevSession()).resolves.toEqual({
      user: {
        id: '00000000-0000-4000-8000-000000000310',
        name: 'Gareth P.',
        email: 'owner+000000000000@sheetbase.test',
      },
      session: { id: 'dev-auth-free-session' },
    })
  })

  it('keeps the placeholder for an identity with no user row', async () => {
    vi.stubEnv('SHEETBASE_DEV_USER_ID', '00000000-0000-4000-8000-000000000001')
    mocks.findFirst.mockResolvedValue(undefined)
    const { getDevSession } = await import('./dev-auth')

    await expect(getDevSession()).resolves.toEqual({
      user: {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Fixture Owner',
        email: 'owner@sheetbase.test',
      },
      session: { id: 'dev-auth-free-session' },
    })
  })
})
