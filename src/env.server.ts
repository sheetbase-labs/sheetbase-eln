import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

import { validateDeploymentConfig } from '#/lib/deployment-config'
import { DEFAULT_DEV_USER_ID } from '#/lib/dev-identity'

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    FORMULA_DATABASE_URL: z.string().url(),
    // Pipeline SQL sandbox login (`pipeline_sandbox`): the only credential
    // untrusted transform SQL ever runs under. Optional so a deployment that
    // has not provisioned the role fails pipeline SQL steps closed with a
    // clear error instead of failing to boot.
    PIPELINE_SANDBOX_DATABASE_URL: z.string().url().optional(),
    // Ed25519 private key (PKCS#8 PEM) that signs pipeline run manifests.
    // Unset: manifests are still hashed and chained, but not signed.
    PIPELINE_MANIFEST_SIGNING_KEY: z.string().min(1).optional(),
    // AI provider profiles (JSON). Non-secret: every profile names the server
    // environment variable holding its key. Unset means no external provider
    // is configured and the assistant uses the deterministic built-in model.
    // See docs/operations/ai.md.
    AI_PROVIDER_PROFILES: z.string().optional(),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.string().url().default('http://localhost:3000'),
    // GitHub OAuth is optional locally: auth routes mount either way, and the
    // sign-in screen reports "not configured" until both values are set.
    GITHUB_CLIENT_ID: z.string().min(1).optional(),
    GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
    // Company single sign-on over OpenID Connect (any compliant IdP: Entra ID,
    // Okta, Google Workspace, Keycloak). Active when issuer, client id and
    // client secret are all set; the issuer must serve
    // `/.well-known/openid-configuration`.
    OIDC_ISSUER_URL: z.string().url().optional(),
    OIDC_CLIENT_ID: z.string().min(1).optional(),
    OIDC_CLIENT_SECRET: z.string().min(1).optional(),
    OIDC_PROVIDER_NAME: z.string().min(1).default('Company SSO'),
    // Email sign-in by one-time link. Needs SMTP_HOST (email delivery). Only
    // people who already have an account can use it, plus anyone whose
    // address is in EMAIL_LOGIN_ALLOWED_DOMAINS (comma-separated).
    EMAIL_LOGIN_ENABLED: z.enum(['true', 'false']).default('false'),
    EMAIL_LOGIN_ALLOWED_DOMAINS: z.string().optional(),
    // Server-only upstream for the data proxy. The browser only ever talks
    // to the same-origin /api/db boundary.
    POSTGREST_URL: z.string().url().default('http://localhost:3001'),
    // PostgREST admin server (live/ready healthchecks). Server-only.
    POSTGREST_ADMIN_URL: z.string().url().default('http://localhost:3002'),
    PGRST_JWT_SECRET: z.string().min(32),
    // SCI-003 object-storage boundary. Files live in the database by default,
    // so a deploy or a new container never loses them and a database backup
    // covers them. Set `s3` (with the FILE_STORAGE_S3_* values) to keep them in
    // any S3-compatible service instead; `local` keeps them on this
    // machine's disk.
    FILE_STORAGE_BACKEND: z
      .enum(['database', 'local', 's3'])
      .default('database'),
    FILE_STORAGE_DIR: z.string().default('./.storage/objects'),
    // S3-compatible service (AWS S3, Cloudflare R2, Backblaze B2, Garage,
    // SeaweedFS ...). The endpoint is only needed for non-AWS services.
    FILE_STORAGE_S3_BUCKET: z.string().min(1).optional(),
    FILE_STORAGE_S3_ENDPOINT: z.string().url().optional(),
    FILE_STORAGE_S3_REGION: z.string().min(1).default('us-east-1'),
    FILE_STORAGE_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    FILE_STORAGE_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    // Path-style addressing (https://host/bucket/key) works on every service;
    // set `false` only for a service that needs bucket.host addressing.
    FILE_STORAGE_S3_PATH_STYLE: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    FILE_STORAGE_S3_PREFIX: z.string().default(''),
    // REL-001 deployment identity. Local development has explicit harmless
    // defaults; staging and production are rejected unless an immutable
    // artifact, expected migration and managed secret source are supplied.
    SHEETBASE_ENV: z
      .enum(['development', 'test', 'staging', 'production'])
      .default('development'),
    SHEETBASE_SECRET_SOURCE: z
      .enum(['local-env', 'vps-local', 'secret-manager'])
      .default('local-env'),
    SHEETBASE_ARTIFACT_VERSION: z.string().min(1).default('local'),
    SHEETBASE_ARTIFACT_DIGEST: z.string().min(1).default('untracked'),
    SHEETBASE_EXPECTED_MIGRATION: z.string().min(1).default('untracked'),
    // Explicit opt-in for the disposable, public development surface. This
    // is rejected for staging/production by validateDeploymentConfig.
    SHEETBASE_DEV_AUTH_FREE: z
      .union([
        z.boolean(),
        z.enum(['true', 'false']).transform((v) => v === 'true'),
      ])
      .default(false),
    // COLLAB: Liveblocks collaboration substrate. Optional so local/CI runs
    // without a Liveblocks account keep working; the collaboration layer
    // reports `disabled` until this is set. Server-only secret.
    LIVEBLOCKS_SECRET_KEY: z.string().min(1).optional(),
    // PLAT-02 metrics endpoint bearer token. Optional in development/test;
    // the metrics endpoint fails closed in staging/production when absent.
    SHEETBASE_METRICS_TOKEN: z.string().min(32).optional(),
    // PLAT-03 — general API abuse bound for the data proxy and file byte
    // routes (credential exchange keeps its own per-credential limiter).
    // Requests per window per authenticated principal; fail-open posture.
    SHEETBASE_RATE_LIMIT_MAX: z.coerce
      .number()
      .int()
      .min(10)
      .max(100_000)
      .default(600),
    SHEETBASE_RATE_LIMIT_WINDOW_SECONDS: z.coerce
      .number()
      .int()
      .min(1)
      .max(3_600)
      .default(60),
    // Where data-access members' read-only SQL logins connect. The database is
    // usually private, so this is a name or address people can reach (a proxy
    // or private-network host). Unset: the app says SQL access is not set up.
    SHEETBASE_SQL_HOST: z.string().min(1).optional(),
    SHEETBASE_SQL_PORT: z.coerce
      .number()
      .int()
      .min(1)
      .max(65_535)
      .default(5432),
    SHEETBASE_SQL_DATABASE: z.string().min(1).default('sheetbase'),
    SHEETBASE_DEV_USER_ID: z.string().uuid().default(DEFAULT_DEV_USER_ID),
    // R5-CONFIG-01 — optional workspace plan limits. Configuration, not a
    // hard-coded number in the UI. Absent means no limit is configured, so the
    // usage screen says so instead of inventing a theatre threshold.
    SHEETBASE_WORKSPACE_STORAGE_QUOTA_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .optional(),
    SHEETBASE_WORKSPACE_SEAT_LIMIT: z.coerce
      .number()
      .int()
      .positive()
      .optional(),
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
    OIDC_ISSUER_URL: env.OIDC_ISSUER_URL,
    OIDC_CLIENT_ID: env.OIDC_CLIENT_ID,
    OIDC_CLIENT_SECRET: env.OIDC_CLIENT_SECRET,
    SHEETBASE_DEV_AUTH_FREE: env.SHEETBASE_DEV_AUTH_FREE,
  })
}
