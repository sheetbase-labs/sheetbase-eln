/**
 * Email for Inbox-only events.
 *
 * Most notifications write a row when they happen and email follows the row.
 * Some Inbox items (a run that failed, a calibration that fell due, an access
 * request) are only ever derived from other tables, so nothing fires when they
 * appear. For people who switched Email on for one of those events, this sweep
 * reads their own Inbox the way the app does (their role, their workspace) and
 * queues one email per new item.
 *
 * The first sweep after someone turns Email on for an event only records what
 * is already waiting, so they are not sent a backlog.
 */
import type { Client } from 'pg'

export interface InboxEmailQuery {
  query: Client['query']
}

interface Subscriber {
  user_id: string
  workspace_id: string | null
  event_type: string
  inbox_kinds: string[]
  primed: boolean
}

interface WaitingItem {
  kind: string
  title: string
  reason: string | null
  item_key: string
}

/**
 * What the person's own Inbox holds for these kinds, ignoring their in-app
 * mute. The key adds the item's time because some kinds are keyed by what they
 * are about (every pending approval of one kind shares an identifier), and a
 * second one must still be emailed.
 */
const WAITING_ITEMS = `
  SELECT i.kind, i.title, i.reason,
         i.kind || ':' || COALESCE(i.source_id::text, i.record_id::text, i.identifier, i.title, 'Untitled')
           || COALESCE('@' || extract(epoch FROM i.created_at)::text, '') AS item_key
    FROM internal.my_work_items_all i
   WHERE i.kind = ANY($1::text[])
     AND i.state IS DISTINCT FROM 'following'
     AND (i.kind <> 'agent_proposal' OR EXISTS (
           SELECT 1 FROM api.agent_operation_proposals ap
            WHERE ap.id = i.source_id
              AND (ap.approver_user_id IS NULL
                   OR ap.approver_user_id::text = api.current_user_id()::text)))`

export async function sweepInboxEmails(
  client: InboxEmailQuery,
  appUrl: string,
): Promise<{ queued: number }> {
  const subscribers = await client.query<Subscriber>(
    'SELECT * FROM internal.inbox_email_subscribers()',
  )
  let queued = 0
  for (const subscriber of subscribers.rows) {
    if (!subscriber.workspace_id) continue
    let items: WaitingItem[]
    try {
      items = await readWaitingItems(client, subscriber)
    } catch (error) {
      // One person's Inbox failing to read must not stop the others.
      console.warn(
        JSON.stringify({
          level: 'warn',
          message: 'inbox email: could not read an Inbox',
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString(),
        }),
      )
      continue
    }
    for (const item of items) {
      const sent = await client.query<{ queued: boolean }>(
        'SELECT internal.queue_inbox_email($1, $2, $3, $4, $5, $6, $7) AS queued',
        [
          subscriber.user_id,
          subscriber.workspace_id,
          subscriber.event_type,
          item.item_key,
          item.title,
          [item.title, item.reason, `Open your Inbox: ${appUrl}/inbox`]
            .filter(Boolean)
            .join('\n'),
          !subscriber.primed,
        ],
      )
      if (sent.rows[0]?.queued) queued += 1
    }
    if (!subscriber.primed) {
      await client.query('SELECT internal.mark_inbox_email_primed($1, $2)', [
        subscriber.user_id,
        subscriber.event_type,
      ])
    }
  }
  return { queued }
}

/** Read one person's Inbox as that person, in their own transaction. */
async function readWaitingItems(
  client: InboxEmailQuery,
  subscriber: Subscriber,
): Promise<WaitingItem[]> {
  await client.query('BEGIN')
  try {
    await client.query('SET LOCAL ROLE authenticated')
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({
        sub: subscriber.user_id,
        workspace_id: subscriber.workspace_id,
        role: 'authenticated',
      }),
    ])
    const result = await client.query<WaitingItem>(WAITING_ITEMS, [
      subscriber.inbox_kinds,
    ])
    return result.rows
  } finally {
    await client.query('ROLLBACK')
  }
}
