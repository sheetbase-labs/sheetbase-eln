/**
 * QA2-Inbox-1 / QA4-Home-Count — the caller's Inbox counts, server-side.
 *
 * The sidebar badge and Home's counts must state the same set as the Inbox
 * list, so there is one count and one predicate: this calls
 * `api.inbox_needs_action_counts()` (see
 * `drizzle/0433_inbox_needs_action_counts.sql`), which applies the Inbox
 * predicate over the same two read models the list reads — `api.my_work_items`
 * (the item rows) and `api.work_item_views` (the caller's seen keys) — and
 * counts every row rather than transferring a page of them, so a workspace
 * past the list's 200-row preview states the same number here as on Home.
 *
 * The read assumes the caller's own role and claims inside the transaction —
 * the pattern `getScopedClient`, `pipeline-scheduler.server.ts` and
 * `sheet-calculation.server.ts` use — so row-level security scopes the rows
 * exactly as it does for the browser's PostgREST calls, whatever role the app
 * connection holds. A failed read degrades to zero, as the badge always has:
 * the shell has no failure channel, and Home is the surface that states a
 * failed count.
 */
import { db } from '#/db/client.server'

import type { InboxCounts } from './predicate'

/**
 * Count the needs-action items, and their Reviews subset, for one person in
 * one workspace.
 */
export async function getInboxCounts(
  workspaceId: string,
  userId: string,
): Promise<InboxCounts> {
  const client = db.$client
  const connection = await client.connect()
  try {
    await connection.query('begin')
    await connection.query('set local role authenticated')
    await connection.query(
      "select set_config('request.jwt.claims', $1, true)",
      [
        JSON.stringify({
          sub: userId,
          workspace_id: workspaceId,
          role: 'authenticated',
        }),
      ],
    )
    const { rows } = await connection.query<InboxCounts>(
      'select total, reviews from api.inbox_needs_action_counts()',
    )
    await connection.query('commit')
    const [counts] = rows
    return { total: counts.total, reviews: counts.reviews }
  } catch {
    await connection.query('rollback').catch(() => {})
    return { total: 0, reviews: 0 }
  } finally {
    connection.release()
  }
}
