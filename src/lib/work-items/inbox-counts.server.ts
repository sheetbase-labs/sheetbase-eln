/**
 * QA2-Inbox-1 / QA4-Home-Count — the caller's Inbox counts, server-side.
 *
 * The sidebar badge and Home's counts must state the same set as the Inbox
 * list, so there is one count and one predicate: this calls
 * `api.inbox_needs_action_counts()` (see
 * former migration 0433), which applies the Inbox
 * predicate over the same two read models the list reads — `api.my_work_items`
 * (the item rows) and `api.work_item_views` (the caller's seen keys) — and
 * counts every row rather than transferring a page of them, so a workspace
 * past the list's 200-row preview states the same number here as on Home.
 *
 * The read assumes the caller's own role and claims inside the transaction —
 * the pattern `getScopedClient`, `pipeline-scheduler.server.ts` and
 * `sheet-calculation.server.ts` use — so row-level security scopes the rows
 * exactly as it does for the browser's PostgREST calls, whatever role the app
 * connection holds. A failed read is *unknown*, not zero: zero is a claim that
 * nothing waits, which a failed read cannot back, and it reads as calm on every
 * surface that shows it.
 */
import { db } from '#/db/client.server'

import type { InboxCounts } from './predicate'

/**
 * Count the needs-action items, and their Reviews subset, for one person in
 * one workspace.
 *
 * `null` states *unknown*: the read failed, so this count has no number. A
 * caller must not substitute zero — the shell's badge has no failure channel of
 * its own, so the difference has to survive in the value.
 */
export async function getInboxCounts(
  workspaceId: string,
  userId: string,
): Promise<InboxCounts | null> {
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
    // The function aggregates unconditionally, so it always answers one row: an
    // answer with none raises here and the catch below states it as unknown.
    const [counts] = rows
    return { total: counts.total, reviews: counts.reviews }
  } catch {
    await connection.query('rollback').catch(() => {})
    // Unknown, not zero: the badge renders no number for `null`, where a zero
    // would be stated as one.
    return null
  } finally {
    connection.release()
  }
}
