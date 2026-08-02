// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

describe('auth-free development session', () => {
  beforeAll(() => {
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
  })

  afterAll(() => vi.unstubAllEnvs())

  it('resolves the seeded fixture user without a cookie', async () => {
    const { getAppSession } = await import('./auth')

    await expect(getAppSession(new Headers())).resolves.toEqual({
      user: {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Fixture Owner',
        email: 'owner@sheetbase.test',
      },
      session: { id: 'dev-auth-free-session' },
    })
  })
})
