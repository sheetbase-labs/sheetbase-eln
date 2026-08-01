import { describe, expect, it } from 'vitest'

import { validateDeploymentConfig } from './deployment-config'

const productionConfig = {
  SHEETBASE_ENV: 'production',
  SHEETBASE_SECRET_SOURCE: 'secret-manager',
  SHEETBASE_ARTIFACT_VERSION: '2026.07.26-4f9c3c1',
  SHEETBASE_ARTIFACT_DIGEST: `sha256:${'a'.repeat(64)}`,
  SHEETBASE_EXPECTED_MIGRATION: '1784920000000',
  BETTER_AUTH_URL: 'https://sheetbase.example.com',
  DATABASE_URL: 'postgresql://app@postgres.internal/sheetbase',
  POSTGREST_URL: 'http://postgrest.internal:3000',
  POSTGREST_ADMIN_URL: 'http://postgrest.internal:3001',
  GITHUB_CLIENT_ID: 'github-client',
  GITHUB_CLIENT_SECRET: 'injected-secret',
} as const

type DeploymentInput = Parameters<typeof validateDeploymentConfig>[0]

const invalidProductionCases: Array<
  [string, Partial<DeploymentInput>, RegExp]
> = [
  [
    'local secrets',
    { SHEETBASE_SECRET_SOURCE: 'local-env' },
    /requires a managed secret source/,
  ],
  [
    'a mutable artifact identity',
    { SHEETBASE_ARTIFACT_DIGEST: 'latest' },
    /invalid_string|Invalid string/,
  ],
  [
    'a local authentication origin',
    { BETTER_AUTH_URL: 'http://localhost:3000' },
    /requires an HTTPS BETTER_AUTH_URL/,
  ],
  [
    'a local database',
    { DATABASE_URL: 'postgresql://app@localhost/sheetbase' },
    /DATABASE_URL must not target localhost/,
  ],
]

describe('validateDeploymentConfig', () => {
  it('accepts a production configuration with immutable artifact and managed secrets', () => {
    expect(validateDeploymentConfig(productionConfig)).toEqual(
      expect.objectContaining({
        environment: 'production',
        artifact: {
          version: '2026.07.26-4f9c3c1',
          digest: `sha256:${'a'.repeat(64)}`,
        },
        expectedMigration: '1784920000000',
      }),
    )
  })

  it.each(invalidProductionCases)(
    'rejects production with %s',
    (_label, override, message) => {
      expect(() =>
        validateDeploymentConfig({ ...productionConfig, ...override }),
      ).toThrow(message)
    },
  )

  it('accepts a VPS-local production secret file', () => {
    expect(
      validateDeploymentConfig({
        ...productionConfig,
        SHEETBASE_SECRET_SOURCE: 'vps-local',
      }),
    ).toEqual(expect.objectContaining({ secretSource: 'vps-local' }))
  })

  it('allows local environment inputs in development', () => {
    expect(
      validateDeploymentConfig({
        ...productionConfig,
        SHEETBASE_ENV: 'development',
        SHEETBASE_SECRET_SOURCE: 'local-env',
        SHEETBASE_ARTIFACT_VERSION: 'local',
        SHEETBASE_ARTIFACT_DIGEST: 'untracked',
        SHEETBASE_EXPECTED_MIGRATION: 'untracked',
        BETTER_AUTH_URL: 'http://localhost:3000',
        DATABASE_URL: 'postgresql://app@localhost/sheetbase',
        POSTGREST_URL: 'http://localhost:3001',
        POSTGREST_ADMIN_URL: 'http://localhost:3002',
        GITHUB_CLIENT_ID: undefined,
        GITHUB_CLIENT_SECRET: undefined,
      }),
    ).toEqual(
      expect.objectContaining({
        environment: 'development',
        secretSource: 'local-env',
      }),
    )
  })
})
