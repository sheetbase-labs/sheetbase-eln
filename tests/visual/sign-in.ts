import { createHmac } from 'node:crypto'

import { config } from 'dotenv'
import { Client } from 'pg'
import type { Page } from 'playwright/test'

config({ path: ['.env.local', '.env'] })

/**
 * DSYS-06 — sign the parity browser in as a seeded design user by minting a
 * Better Auth session row and the matching signed cookie, the same approach
 * `tests/browser/phase4-proof.test.ts` uses.
 */
export async function signInAsDesignUser(
  page: Page,
  userId: string,
): Promise<void> {
  const secret = process.env.BETTER_AUTH_SECRET
  const databaseUrl = process.env.DATABASE_URL
  if (!secret || !databaseUrl) {
    throw new Error(
      'BETTER_AUTH_SECRET and DATABASE_URL are required to sign in for parity',
    )
  }

  const token = `parity-${userId}`
  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    await client.query(
      `insert into internal.session(id, token, "userId", "expiresAt")
       values ($1, $2, $3, now() + interval '12 hours')
       on conflict (id) do update
         set token = excluded.token,
             "userId" = excluded."userId",
             "expiresAt" = excluded."expiresAt"`,
      [token, token, userId],
    )
  } finally {
    await client.end()
  }

  const signature = createHmac('sha256', secret)
    .update(token, 'utf8')
    .digest('base64')
  // Better Auth runs with useSecureCookies, so the name carries the
  // `__Secure-` prefix and the cookie is Secure/SameSite=None.
  await page.context().addCookies([
    {
      name: '__Secure-better-auth.session_token',
      value: `${token}.${signature}`,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'None',
    },
  ])
}
