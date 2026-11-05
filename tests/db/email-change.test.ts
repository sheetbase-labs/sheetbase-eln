/**
 * Changing an email address: the link goes to the new address, the address only
 * changes when the link is opened, a link works once and for an hour, and the
 * old sign-ins end.
 */
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  confirmEmailChange,
  createEmailChange,
  emailChangeLink,
} from '../../src/lib/email-change.server'
import { migratorUrl, prepareTestDatabase } from './helpers'

const PERSON = 'ec-person'
const OTHER = 'ec-other'

let pool: Pool
let migrator: Awaited<ReturnType<typeof prepareTestDatabase>>['migrator']

const emailOf = async (id: string) =>
  (
    await migrator.query<{ email: string }>(
      `SELECT email FROM internal."user" WHERE id = $1`,
      [id],
    )
  ).rows[0]?.email

beforeAll(async () => {
  ;({ migrator } = await prepareTestDatabase())
  pool = new Pool({ connectionString: migratorUrl() })
  await migrator.query(
    `INSERT INTO internal."user" (id, name, email, "emailVerified") VALUES
      ('${PERSON}', 'Person', 'person@old.test', true),
      ('${OTHER}', 'Other', 'taken@lab.test', true)`,
  )
})

afterAll(async () => {
  await pool.end()
  await migrator.end()
})

describe('asking for a change', () => {
  it('refuses a bad, unchanged or taken address', async () => {
    const ask = (newEmail: string) =>
      createEmailChange(pool, {
        userId: PERSON,
        newEmail,
        requestedBy: PERSON,
      })
    expect(await ask('not-an-address')).toEqual({
      ok: false,
      reason: 'invalid_address',
    })
    expect(await ask('  PERSON@old.test ')).toEqual({
      ok: false,
      reason: 'same_address',
    })
    expect(await ask('Taken@Lab.test')).toEqual({
      ok: false,
      reason: 'address_taken',
    })
    expect(await emailOf(PERSON)).toBe('person@old.test')
  })

  it('does not change anything until the link is opened', async () => {
    const asked = await createEmailChange(pool, {
      userId: PERSON,
      newEmail: 'New@Lab.test',
      requestedBy: PERSON,
    })
    expect(asked.ok).toBe(true)
    expect(await emailOf(PERSON)).toBe('person@old.test')
    if (asked.ok) {
      expect(asked.newEmail).toBe('new@lab.test')
      expect(emailChangeLink('https://eln.example/', asked.token)).toBe(
        `https://eln.example/confirm-email-change?token=${asked.token}`,
      )
    }
  })
})

describe('opening the link', () => {
  it('changes the address once, signs the old sessions out, and cannot be reused', async () => {
    await migrator.query(
      `INSERT INTO internal.session (id, "expiresAt", token, "userId")
       VALUES ('ec-session', now() + interval '1 day', 'ec-token', '${PERSON}')`,
    )
    const asked = await createEmailChange(pool, {
      userId: PERSON,
      newEmail: 'fresh@lab.test',
      requestedBy: OTHER,
    })
    if (!asked.ok) throw new Error('request refused')

    const done = await confirmEmailChange(pool, asked.token)
    expect(done).toEqual({
      ok: true,
      oldEmail: 'person@old.test',
      newEmail: 'fresh@lab.test',
    })
    expect(await emailOf(PERSON)).toBe('fresh@lab.test')
    const sessions = await migrator.query(
      `SELECT 1 FROM internal.session WHERE "userId" = '${PERSON}'`,
    )
    expect(sessions.rows).toEqual([])

    expect(await confirmEmailChange(pool, asked.token)).toEqual({
      ok: false,
      reason: 'invalid_link',
    })
  })

  it('refuses a made-up link and an expired one', async () => {
    expect(await confirmEmailChange(pool, 'made-up')).toEqual({
      ok: false,
      reason: 'invalid_link',
    })
    const asked = await createEmailChange(pool, {
      userId: PERSON,
      newEmail: 'late@lab.test',
      requestedBy: PERSON,
    })
    if (!asked.ok) throw new Error('request refused')
    await migrator.query(
      `UPDATE internal.verification SET "expiresAt" = now() - interval '1 minute'
        WHERE identifier LIKE 'email-change:%'`,
    )
    expect(await confirmEmailChange(pool, asked.token)).toEqual({
      ok: false,
      reason: 'expired',
    })
    expect(await emailOf(PERSON)).toBe('fresh@lab.test')
  })

  it('refuses when someone else took the address in the meantime', async () => {
    const asked = await createEmailChange(pool, {
      userId: PERSON,
      newEmail: 'race@lab.test',
      requestedBy: PERSON,
    })
    if (!asked.ok) throw new Error('request refused')
    await migrator.query(
      `UPDATE internal."user" SET email = 'race@lab.test' WHERE id = '${OTHER}'`,
    )
    expect(await confirmEmailChange(pool, asked.token)).toEqual({
      ok: false,
      reason: 'address_taken',
    })
  })

  it('replaces an earlier request for the same person', async () => {
    const first = await createEmailChange(pool, {
      userId: PERSON,
      newEmail: 'one@lab.test',
      requestedBy: PERSON,
    })
    const second = await createEmailChange(pool, {
      userId: PERSON,
      newEmail: 'two@lab.test',
      requestedBy: PERSON,
    })
    if (!first.ok || !second.ok) throw new Error('request refused')
    expect(await confirmEmailChange(pool, first.token)).toEqual({
      ok: false,
      reason: 'invalid_link',
    })
    expect((await confirmEmailChange(pool, second.token)).ok).toBe(true)
  })
})
