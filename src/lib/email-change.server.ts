/**
 * Changing your email address.
 *
 * Sign-in works by an emailed link, so an address that cannot be changed locks
 * a person out when theirs does. A change is asked for (by the person, or by a
 * workspace administrator for them), a link goes to the NEW address, and the
 * address only changes when that link is opened. The link is a one-hour token;
 * only its hash is kept, in Better Auth's verification table.
 */
import { createHash, randomBytes } from 'node:crypto'

import type { Pool } from 'pg'

const IDENTIFIER_PREFIX = 'email-change:'
const LIFETIME_MS = 60 * 60 * 1000
const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type EmailChangeRefusal =
  'invalid_address' | 'same_address' | 'address_taken' | 'unknown_user'

export type EmailChangeConfirmation =
  | { ok: true; oldEmail: string; newEmail: string }
  | { ok: false; reason: 'invalid_link' | 'expired' | 'address_taken' }

const hashOf = (token: string) =>
  createHash('sha256').update(token).digest('hex')

export function normaliseAddress(value: string): string {
  return value.trim().toLowerCase()
}

/** The link a person opens on the new address. */
export function emailChangeLink(origin: string, token: string): string {
  return `${origin.replace(/\/$/, '')}/confirm-email-change?token=${encodeURIComponent(token)}`
}

/**
 * Start a change for `userId`. Returns the token to put in the link, or the
 * reason the change cannot be asked for. A newer request replaces an older one.
 */
export async function createEmailChange(
  pool: Pick<Pool, 'query'>,
  input: { userId: string; newEmail: string; requestedBy: string },
): Promise<
  | { ok: true; token: string; oldEmail: string; newEmail: string }
  | { ok: false; reason: EmailChangeRefusal }
> {
  const newEmail = normaliseAddress(input.newEmail)
  if (!ADDRESS.test(newEmail) || newEmail.length > 254) {
    return { ok: false, reason: 'invalid_address' }
  }
  const current = await pool.query<{ email: string }>(
    `SELECT email FROM internal."user" WHERE id = $1`,
    [input.userId],
  )
  const oldEmail = current.rows.at(0)?.email
  if (!oldEmail) return { ok: false, reason: 'unknown_user' }
  if (oldEmail.toLowerCase() === newEmail) {
    return { ok: false, reason: 'same_address' }
  }
  const taken = await pool.query(
    `SELECT 1 FROM internal."user" WHERE lower(email) = $1 AND id <> $2`,
    [newEmail, input.userId],
  )
  if (taken.rows.length > 0) return { ok: false, reason: 'address_taken' }

  const token = randomBytes(32).toString('base64url')
  await pool.query(
    `DELETE FROM internal.verification
      WHERE identifier LIKE $1 AND (value::jsonb ->> 'userId') = $2`,
    [`${IDENTIFIER_PREFIX}%`, input.userId],
  )
  await pool.query(
    `INSERT INTO internal.verification (id, identifier, value, "expiresAt")
     VALUES (gen_random_uuid()::text, $1, $2, $3)`,
    [
      IDENTIFIER_PREFIX + hashOf(token),
      JSON.stringify({
        userId: input.userId,
        email: newEmail,
        requestedBy: input.requestedBy,
      }),
      new Date(Date.now() + LIFETIME_MS),
    ],
  )
  return { ok: true, token, oldEmail, newEmail }
}

/**
 * Open the link: the address changes, the old sign-ins end (whoever holds the
 * new address now controls the account), and the link cannot be used again.
 */
export async function confirmEmailChange(
  pool: Pick<Pool, 'connect'>,
  token: string,
): Promise<EmailChangeConfirmation> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const found = await client.query<{
      id: string
      value: string
      expires_at: Date
    }>(
      `SELECT id, value, "expiresAt" AS expires_at FROM internal.verification
        WHERE identifier = $1 FOR UPDATE`,
      [IDENTIFIER_PREFIX + hashOf(token)],
    )
    const row = found.rows.at(0)
    if (!row) {
      await client.query('ROLLBACK')
      return { ok: false, reason: 'invalid_link' }
    }
    await client.query(`DELETE FROM internal.verification WHERE id = $1`, [
      row.id,
    ])
    if (row.expires_at.getTime() < Date.now()) {
      await client.query('COMMIT')
      return { ok: false, reason: 'expired' }
    }
    const pending = JSON.parse(row.value) as { userId: string; email: string }
    const taken = await client.query(
      `SELECT 1 FROM internal."user" WHERE lower(email) = $1 AND id <> $2`,
      [pending.email, pending.userId],
    )
    if (taken.rows.length > 0) {
      await client.query('COMMIT')
      return { ok: false, reason: 'address_taken' }
    }
    const before = await client.query<{ email: string }>(
      `SELECT email FROM internal."user" WHERE id = $1 FOR UPDATE`,
      [pending.userId],
    )
    const oldEmail = before.rows.at(0)?.email
    if (!oldEmail) {
      await client.query('ROLLBACK')
      return { ok: false, reason: 'invalid_link' }
    }
    await client.query(
      `UPDATE internal."user"
          SET email = $2, "emailVerified" = true, "updatedAt" = now()
        WHERE id = $1`,
      [pending.userId, pending.email],
    )
    await client.query(`DELETE FROM internal.session WHERE "userId" = $1`, [
      pending.userId,
    ])
    await client.query('COMMIT')
    return { ok: true, oldEmail, newEmail: pending.email }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}
