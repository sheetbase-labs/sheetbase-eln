import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

import { validateDeploymentConfig } from '#/lib/deployment-config'

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    FORMULA_DATABASE_URL: z.string().url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.string().url().default('http://localhost:3000'),
    // GitHub OAuth is optional locally: auth routes mount either way, and the
    // sign-in screen reports "not configured" until both values are set.
    GITHUB_CLIENT_ID: z.string().min(1).optional(),
    GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
    // Server-only upstream for the data proxy. The browser only ever talks
    // to the same-origin /api/db boundary.
    POSTGREST_URL: z.string().url().default('http://localhost:3001'),
    // PostgREST admin server (live/ready healthchecks). Server-only.
    POSTGREST_ADMIN_URL: z.string().url().default('http://localhost:3002'),
    PGRST_JWT_SECRET: z.string().min(32),
    // SCI-003 object-storage boundary. The local backend is the orb default
    // and needs no cloud credentials; S3 wiring is configuration-only.
    FILE_STORAGE_BACKEND: z.enum(['local', 's3']).default('local'),
    FILE_STORAGE_DIR: z.string().default('./.storage/objects'),
    // REL-001 deployment identity. Local development has explicit harmless
    // defaults; staging and production are rejected unless an immutable
    // artifact, expected migration and managed secret source are supplied.
    SHEETBASE_ENV: z
      .enum(['development', 'test', 'staging', 'production'])
      .default('development'),
    SHEETBASE_SECRET_SOURCE: z
      .enum(['local-env', 'secret-manager'])
      .default('local-env'),
    SHEETBASE_ARTIFACT_VERSION: z.string().min(1).default('local'),
    SHEETBASE_ARTIFACT_DIGEST: z.string().min(1).default('untracked'),
    SHEETBASE_EXPECTED_MIGRATION: z.string().min(1).default('untracked'),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
})

/** Validate cross-variable deployment rules at the server entry points. */
export function getDeploymentConfig() {
  return validateDeploymentConfig({
    SHEETBASE_ENV: env.SHEETBASE_ENV,
    SHEETBASE_SECRET_SOURCE: env.SHEETBASE_SECRET_SOURCE,
    SHEETBASE_ARTIFACT_VERSION: env.SHEETBASE_ARTIFACT_VERSION,
    SHEETBASE_ARTIFACT_DIGEST: env.SHEETBASE_ARTIFACT_DIGEST,
    SHEETBASE_EXPECTED_MIGRATION: env.SHEETBASE_EXPECTED_MIGRATION,
    BETTER_AUTH_URL: env.BETTER_AUTH_URL,
    DATABASE_URL: env.DATABASE_URL,
    POSTGREST_URL: env.POSTGREST_URL,
    POSTGREST_ADMIN_URL: env.POSTGREST_ADMIN_URL,
    GITHUB_CLIENT_ID: env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET,
  })
}
