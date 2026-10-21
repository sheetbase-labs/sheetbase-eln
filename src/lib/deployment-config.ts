import { z } from 'zod'

export const deploymentEnvironmentSchema = z.enum([
  'development',
  'test',
  'staging',
  'production',
])

export type DeploymentEnvironment = z.infer<typeof deploymentEnvironmentSchema>

const sha256Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const migrationVersion = z.string().regex(/^\d{13}$/)

const deploymentInputSchema = z.object({
  SHEETBASE_ENV: deploymentEnvironmentSchema,
  SHEETBASE_SECRET_SOURCE: z.enum(['local-env', 'vps-local', 'secret-manager']),
  SHEETBASE_ARTIFACT_VERSION: z.string().min(1),
  SHEETBASE_ARTIFACT_DIGEST: z.string().min(1),
  SHEETBASE_EXPECTED_MIGRATION: z.string().min(1),
  BETTER_AUTH_URL: z.string().url(),
  DATABASE_URL: z.string().url(),
  POSTGREST_URL: z.string().url(),
  POSTGREST_ADMIN_URL: z.string().url(),
  GITHUB_CLIENT_ID: z.string().min(1).optional(),
  GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
  OIDC_ISSUER_URL: z.string().url().optional(),
  OIDC_CLIENT_ID: z.string().min(1).optional(),
  OIDC_CLIENT_SECRET: z.string().min(1).optional(),
  SHEETBASE_DEV_AUTH_FREE: z.boolean().default(false),
  /** Test seam: pins the application's notion of now (see src/lib/clock.ts). */
  SHEETBASE_NOW: z.string().datetime({ offset: true }).optional(),
})

export interface DeploymentConfig {
  environment: DeploymentEnvironment
  secretSource: 'local-env' | 'vps-local' | 'secret-manager'
  artifact: { version: string; digest: string }
  expectedMigration: string
}

/**
 * Enforces the boundaries that differ between a developer process and a
 * deployable environment. Secret values remain ordinary runtime inputs; this
 * only verifies that staging and production identify a managed injection
 * source and an immutable artifact/database contract.
 */
export function validateDeploymentConfig(
  input: z.input<typeof deploymentInputSchema>,
): DeploymentConfig {
  const parsed = deploymentInputSchema.parse(input)
  const deployed = ['staging', 'production'].includes(parsed.SHEETBASE_ENV)

  if (
    parsed.SHEETBASE_DEV_AUTH_FREE &&
    parsed.SHEETBASE_ENV !== 'development'
  ) {
    throw new Error('SHEETBASE_DEV_AUTH_FREE is only allowed in development')
  }

  if (parsed.SHEETBASE_NOW && deployed) {
    throw new Error(
      'SHEETBASE_NOW is a test seam and is only allowed outside staging and production',
    )
  }

  if (deployed) {
    if (
      parsed.SHEETBASE_SECRET_SOURCE !== 'secret-manager' &&
      parsed.SHEETBASE_SECRET_SOURCE !== 'vps-local'
    ) {
      throw new Error(
        `${parsed.SHEETBASE_ENV} requires a managed secret source`,
      )
    }
    sha256Digest.parse(parsed.SHEETBASE_ARTIFACT_DIGEST)
    migrationVersion.parse(parsed.SHEETBASE_EXPECTED_MIGRATION)
    if (!parsed.BETTER_AUTH_URL.startsWith('https://')) {
      throw new Error(
        `${parsed.SHEETBASE_ENV} requires an HTTPS BETTER_AUTH_URL`,
      )
    }
    const github = Boolean(
      parsed.GITHUB_CLIENT_ID || parsed.GITHUB_CLIENT_SECRET,
    )
    const oidc = Boolean(
      parsed.OIDC_ISSUER_URL ||
      parsed.OIDC_CLIENT_ID ||
      parsed.OIDC_CLIENT_SECRET,
    )
    if (github && !(parsed.GITHUB_CLIENT_ID && parsed.GITHUB_CLIENT_SECRET)) {
      throw new Error(
        `${parsed.SHEETBASE_ENV} requires both GitHub OAuth credentials`,
      )
    }
    if (
      oidc &&
      !(
        parsed.OIDC_ISSUER_URL &&
        parsed.OIDC_CLIENT_ID &&
        parsed.OIDC_CLIENT_SECRET
      )
    ) {
      throw new Error(
        `${parsed.SHEETBASE_ENV} requires OIDC_ISSUER_URL, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET together`,
      )
    }
    if (!github && !oidc) {
      throw new Error(
        `${parsed.SHEETBASE_ENV} requires GitHub OAuth or OIDC sign-in credentials`,
      )
    }
    for (const [name, value] of [
      ['DATABASE_URL', parsed.DATABASE_URL],
      ['POSTGREST_URL', parsed.POSTGREST_URL],
      ['POSTGREST_ADMIN_URL', parsed.POSTGREST_ADMIN_URL],
    ] as const) {
      if (
        new URL(value).hostname === 'localhost' ||
        new URL(value).hostname === '127.0.0.1'
      ) {
        throw new Error(
          `${parsed.SHEETBASE_ENV} ${name} must not target localhost`,
        )
      }
    }
  }

  return {
    environment: parsed.SHEETBASE_ENV,
    secretSource: parsed.SHEETBASE_SECRET_SOURCE,
    artifact: {
      version: parsed.SHEETBASE_ARTIFACT_VERSION,
      digest: parsed.SHEETBASE_ARTIFACT_DIGEST,
    },
    expectedMigration: parsed.SHEETBASE_EXPECTED_MIGRATION,
  }
}
