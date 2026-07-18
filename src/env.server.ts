import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
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
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
})
