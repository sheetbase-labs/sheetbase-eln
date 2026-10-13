/**
 * QA2-Inbox-1 — the caller's Inbox counts, server-side.
 *
 * The sidebar badge and Home's counts must state the same set as the Inbox
 * list, so both this and the list run the shared predicate in `predicate.ts`
 * over the same two read models: `api.my_work_items` (the item rows) and
 * `api.work_item_views` (the caller's seen keys). Reads the claims-scoped
 * views, so it runs in a transaction with the caller's claims set, exactly as
 * the previous state-only count did.
 */
import { db } from '#/db/client.server'

import { countNeedsAction, NEEDS_ACTION_STATES } from './predicate'
import type { InboxCounts } from './predicate'

interface WorkItemRow {
  kind: string
  state: string
  record_id: string | null
  identifier: string | null
  title: string | null
  source_id: string | null
}

/**
 * Count the needs-action items, and their Reviews subset, for one person in
 * one workspace. A failed read degrades to zero, as the badge always has.
 */
export async function getInboxCounts(
  workspaceId: string,
  userId: string,
): Promise<InboxCounts> {
  const client = db.$client
  const connection = await client.connect()
  try {
    await connection.query('begin')
    await connection.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({
        sub: userId,
        workspace_id: workspaceId,
        role: 'authenticated',
      }),
    ])
    const [items, seen] = await Promise.all([
      connection.query<WorkItemRow>(
        `select kind, state, record_id, identifier, title, source_id
           from api.my_work_items
          where state = any($1::text[])`,
        [[...NEEDS_ACTION_STATES]],
      ),
      connection.query<{ item_key: string }>(
        'select item_key from api.work_item_views',
      ),
    ])
    await connection.query('commit')
    return countNeedsAction(
      items.rows.map((row) => ({
        kind: row.kind,
        state: row.state,
        recordId: row.record_id,
        identifier: row.identifier,
        title: row.title,
        sourceId: row.source_id,
      })),
      new Set(seen.rows.map((row) => row.item_key)),
    )
  } catch {
    await connection.query('rollback').catch(() => {})
    return { total: 0, reviews: 0 }
  } finally {
    connection.release()
  }
}
