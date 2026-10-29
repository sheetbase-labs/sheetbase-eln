/**
 * One event list behind the Inbox, notification preferences and email
 * (migration 0035).
 *
 * Proves: the database list equals the code list; muting an event hides its
 * Inbox items and bell notifications; email follows a notification unless the
 * person turned it off; the digest carries only ticked events; inbox-only
 * events are emailed by the sweep without a backlog.
 */
import type { Client } from 'pg'
import { Client as PgClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { sweepInboxEmails } from '../../src/lib/inbox-email.server'
import { NOTIFICATION_EVENTS } from '../../src/lib/notification-preferences'
import { expectDenied, prepareTestDatabase, testDatabaseName } from './helpers'

const WS = '00000000-0000-4000-8000-00000000b350'
const SUBMITTER = 'notify-submitter'
const APPROVER = 'notify-approver'

let migrator: Client
let appClient: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
       ($1,'Submitter','notify-submitter@test.invalid',true),
       ($2,'Approver','notify-approver@test.invalid',true)`,
    [SUBMITTER, APPROVER],
  )
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ($1,'notify','Notify')`,
    [WS],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
       ($1,$2,'steward'),
       ($1,$3,'reviewer')`,
    [WS, SUBMITTER, APPROVER],
  )
  // The email sweep runs as the application role, which can act as a person.
  const url = new URL(process.env.DATABASE_URL!)
  url.pathname = `/${testDatabaseName()}`
  appClient = new PgClient({ connectionString: url.toString() })
  await appClient.connect()
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await appClient?.end()
  await migrator?.end()
})

async function actor(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: userId, workspace_id: WS, role: 'authenticated' }),
  ])
  return client
}

async function savePreference(
  client: Client,
  eventType: string,
  inApp: boolean,
  email: boolean,
  digest = false,
): Promise<void> {
  await client.query('SELECT api.save_notification_preference($1,$2,$3,$4)', [
    eventType,
    inApp,
    email,
    digest,
  ])
}

/** A pending approval the reviewer role is asked to decide. */
async function requestApproval(key: string): Promise<string> {
  const submitter = await actor(SUBMITTER)
  const { rows } = await submitter.query<{
    result: { schema_version_id: string }
  }>(
    `SELECT api.create_dataset_schema_definition($1,$2,'Notify schema',null,'[]'::jsonb) result`,
    [WS, key],
  )
  const versionId = rows[0]!.result.schema_version_id
  const request = await submitter.query<{ id: string }>(
    `SELECT id FROM api.submit_approval_request($1,'dataset_schema_version',$2,ARRAY['reviewer'],'Please approve')`,
    [WS, versionId],
  )
  return request.rows[0]!.id
}

describe('the event list', () => {
  it('is the same list in the database and in code', async () => {
    const { rows } = await migrator.query<{ event_type: string }>(
      'SELECT event_type FROM api.notification_events ORDER BY event_type',
    )
    expect(rows.map((row) => row.event_type)).toEqual(
      NOTIFICATION_EVENTS.map((event) => event.key).sort(),
    )
  })

  it('agrees on how each event is delivered and emailed by default', async () => {
    const { rows } = await migrator.query<{
      event_type: string
      source: string
      default_email: boolean
    }>('SELECT event_type, source, default_email FROM api.notification_events')
    for (const event of NOTIFICATION_EVENTS) {
      const row = rows.find((r) => r.event_type === event.key)
      expect(row, event.key).toMatchObject({
        source: event.source,
        default_email: event.defaultEmail,
      })
    }
  })

  it('covers every kind of Inbox item except the ones people follow', async () => {
    const { rows } = await migrator.query<{ def: string }>(
      `SELECT pg_get_viewdef('internal.my_work_items_all'::regclass) AS def`,
    )
    const kinds = new Set(
      [...rows[0]!.def.matchAll(/'([a-z_]+)'::text AS kind/g)].map(
        (match) => match[1]!,
      ),
    )
    kinds.delete('following')
    const covered = await migrator.query<{ kind: string }>(
      'SELECT unnest(inbox_kinds) AS kind FROM api.notification_events',
    )
    const known = new Set(covered.rows.map((row) => row.kind))
    for (const kind of kinds) expect(known.has(kind), kind).toBe(true)
  })

  it('accepts every listed event and refuses an unknown one', async () => {
    const person = await actor(SUBMITTER)
    for (const event of NOTIFICATION_EVENTS) {
      await savePreference(person, event.key, true, event.defaultEmail)
    }
    await expectDenied(
      savePreference(person, 'not_an_event', true, true),
      '22023',
    )
  })
})

describe('muting', () => {
  it('hides an Inbox item and its count once the event is muted in app', async () => {
    await requestApproval('notify_mute')
    const approver = await actor(APPROVER)
    const before = await approver.query(
      `SELECT 1 FROM api.inbox_work_items WHERE kind = 'approval_requested'`,
    )
    expect(before.rowCount).toBeGreaterThan(0)

    await savePreference(approver, 'approval_requested', false, false)
    const after = await approver.query(
      `SELECT 1 FROM api.inbox_work_items WHERE kind = 'approval_requested'`,
    )
    expect(after.rowCount).toBe(0)
    const raw = await approver.query(
      `SELECT 1 FROM api.my_work_items WHERE kind = 'approval_requested'`,
    )
    expect(raw.rowCount).toBe(0)

    await savePreference(approver, 'approval_requested', true, false)
    const back = await approver.query(
      `SELECT 1 FROM api.inbox_work_items WHERE kind = 'approval_requested'`,
    )
    expect(back.rowCount).toBeGreaterThan(0)
  })

  it('leaves a muted notification out of the bell', async () => {
    const person = await actor(SUBMITTER)
    await migrator.query(
      `INSERT INTO internal.notifications(workspace_id,user_id,event_type,title)
       VALUES ($1,$2,'comment_or_mention','A comment')`,
      [WS, SUBMITTER],
    )
    expect(
      (await person.query('SELECT 1 FROM api.my_notifications')).rowCount,
    ).toBeGreaterThan(0)
    await savePreference(person, 'comment_or_mention', false, false)
    expect(
      (
        await person.query(
          `SELECT 1 FROM api.my_notifications WHERE event_type = 'comment_or_mention'`,
        )
      ).rowCount,
    ).toBe(0)
  })
})

describe('email follows a notification', () => {
  const emailsFor = async (userId: string, eventType: string) =>
    (
      await migrator.query(
        `SELECT subject FROM internal.email_deliveries WHERE user_id = $1 AND event_type = $2`,
        [userId, eventType],
      )
    ).rowCount
  const notify = (userId: string, eventType: string, title: string) =>
    migrator.query(
      `INSERT INTO internal.notifications(workspace_id,user_id,event_type,title)
       VALUES ($1,$2,$3,$4)`,
      [WS, userId, eventType, title],
    )

  it('queues an email by default for events that email by default', async () => {
    await notify(APPROVER, 'review_requested', 'Review requested')
    expect(await emailsFor(APPROVER, 'review_requested')).toBe(1)
  })

  it('does not queue one when the person turned email off', async () => {
    const person = await actor(SUBMITTER)
    await savePreference(person, 'material_expiring', true, false)
    await notify(SUBMITTER, 'material_expiring', 'Lot expiring')
    expect(await emailsFor(SUBMITTER, 'material_expiring')).toBe(0)
  })

  it('still sends the email when only the app is muted', async () => {
    const person = await actor(SUBMITTER)
    await savePreference(person, 'validation_error', false, true)
    await notify(SUBMITTER, 'validation_error', 'Bad value')
    expect(await emailsFor(SUBMITTER, 'validation_error')).toBe(1)
    expect(
      (
        await person.query(
          `SELECT 1 FROM api.my_notifications WHERE event_type = 'validation_error'`,
        )
      ).rowCount,
    ).toBe(0)
  })

  it('carries only the events ticked for the digest', async () => {
    const person = await actor(APPROVER)
    await savePreference(person, 'review_requested', true, false, true)
    await savePreference(person, 'signature_requested', true, false, false)
    await migrator.query(
      `DELETE FROM internal.email_deliveries WHERE user_id = $1`,
      [APPROVER],
    )
    await notify(APPROVER, 'signature_requested', 'Sign the thing')
    await migrator.query(
      `INSERT INTO api.user_preferences(user_id, digest_time)
       VALUES ($1, to_char(now() AT TIME ZONE 'UTC','HH24:MI'))
       ON CONFLICT (user_id) DO UPDATE SET digest_time = EXCLUDED.digest_time, digest_last_sent_on = NULL`,
      [APPROVER],
    )
    await migrator.query('SELECT internal.enqueue_daily_digests()')
    const { rows } = await migrator.query<{ body: string }>(
      `SELECT body FROM internal.email_deliveries WHERE user_id = $1 AND event_type = 'digest'`,
      [APPROVER],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.body).toContain('Review requested')
    expect(rows[0]!.body).not.toContain('Sign the thing')
  })

  it('lets an unsent email expire instead of sending it days late', async () => {
    await savePreference(await actor(APPROVER), 'review_requested', true, true)
    await notify(APPROVER, 'review_requested', 'Review requested again')
    await migrator.query(
      `UPDATE internal.email_deliveries SET created_at = now() - interval '4 days'
        WHERE user_id = $1 AND event_type = 'review_requested'`,
      [APPROVER],
    )
    await migrator.query(
      'SELECT * FROM internal.claim_due_email_deliveries(50)',
    )
    const { rows } = await migrator.query<{ status: string }>(
      `SELECT status FROM internal.email_deliveries WHERE user_id = $1 AND event_type = 'review_requested'`,
      [APPROVER],
    )
    expect(rows.map((r) => r.status)).toEqual(['dead'])
  })
})

describe('the Inbox email sweep', () => {
  it('records what is waiting on the first sweep, then emails only what is new', async () => {
    const approver = await actor(APPROVER)
    await savePreference(approver, 'approval_requested', true, true)
    await migrator.query(
      `DELETE FROM internal.email_deliveries WHERE user_id = $1 AND event_type = 'approval_requested'`,
      [APPROVER],
    )

    const first = await sweepInboxEmails(appClient, 'https://eln.example')
    expect(first.queued).toBe(0)
    const sent = () =>
      migrator.query<{ subject: string; body: string }>(
        `SELECT subject, body FROM internal.email_deliveries WHERE user_id = $1 AND event_type = 'approval_requested'`,
        [APPROVER],
      )
    expect((await sent()).rowCount).toBe(0)

    await requestApproval('notify_sweep')
    const second = await sweepInboxEmails(appClient, 'https://eln.example')
    expect(second.queued).toBe(1)
    const { rows } = await sent()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.body).toContain('https://eln.example/inbox')

    const third = await sweepInboxEmails(appClient, 'https://eln.example')
    expect(third.queued).toBe(0)
  })

  it('does not email someone who left Email off', async () => {
    const person = await actor(SUBMITTER)
    await savePreference(person, 'approval_requested', true, false)
    await migrator.query(
      `DELETE FROM internal.email_deliveries WHERE user_id = $1`,
      [SUBMITTER],
    )
    await requestApproval('notify_sweep_off')
    await sweepInboxEmails(appClient, 'https://eln.example')
    expect(
      (
        await migrator.query(
          `SELECT 1 FROM internal.email_deliveries WHERE user_id = $1`,
          [SUBMITTER],
        )
      ).rowCount,
    ).toBe(0)
  })
})
