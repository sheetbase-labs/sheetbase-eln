/**
 * Sidebar counts (SHELL): the Inbox, Datasets and Pipelines entries carry a
 * live count, as the reference design shows. Scoped to the active workspace.
 */
import { db } from '#/db/client.server'

import { getInboxCounts } from '#/lib/work-items/inbox-counts.server'

export interface ShellCounts {
  /**
   * The Inbox badge's number. Absent when the number is known to be zero (the
   * badge states no zero), and `null` when the count could not be read: an
   * unknown count is not a zero, and the shell has no failure channel of its
   * own, so the badge states no number rather than one it cannot back.
   */
  inbox?: string | null
  datasets?: string
  pipelines?: string
}

export async function getShellCounts(
  workspaceId: string,
  userId: string,
): Promise<ShellCounts> {
  const client = db.$client
  // The badge labels the Inbox's "Needs action" tab, and Home's
  // "Open inbox · N items" uses the same number. Both read the same
  // server-side count (`api.inbox_needs_action_counts`, the Inbox predicate of
  // `work-items/predicate.ts` applied over every row the caller can see), so
  // the sidebar cannot state a set the list hides behind the seen state or the
  // Done tab, nor a smaller one than Home past the list's 200-row preview.
  const inbox = await getInboxCounts(workspaceId, userId)

  const [flags, failed] = await Promise.all([
    client.query<{ n: string }>(
      // The badge counts datasets with an unresolved value flag, matching the
      // design's "2 errors" (two datasets), not the raw flag rows. Home's
      // "datasets with errors" chip counts the same set from
      // `dataset_list_summary` (one row per readable Dataset with an active
      // flag) and excludes archived datasets, so the two screens agree.
      `select count(distinct f.dataset_id)::int as n
         from api.dataset_value_flags f
         join api.datasets d on d.id = f.dataset_id
        where f.workspace_id = $1 and f.cleared_at is null
          and d.archived_at is null`,
      [workspaceId],
    ),
    client.query<{ n: string }>(
      `select count(*)::int as n from (
         select distinct on (d.id) r.status
           from api.pipeline_definitions d
           join api.pipeline_definition_versions v on v.definition_id = d.id
           join api.pipeline_runs r on r.definition_version_id = v.id
          where d.workspace_id = $1
          order by d.id, r.started_at desc nulls last
       ) t where t.status = 'failed'`,
      [workspaceId],
    ),
  ])
  const num = (q: { rows: { n: string }[] }) => Number(q.rows[0]?.n ?? 0)
  const flagCount = num(flags)
  const failedCount = num(failed)
  return {
    // Unknown (`null`) travels as a value, not as an absent key: the badge
    // renders no number for either, but only `null` says the read failed.
    ...(inbox === null
      ? { inbox: null }
      : inbox.total > 0
        ? { inbox: String(inbox.total) }
        : {}),
    ...(flagCount > 0
      ? { datasets: `${flagCount} ${flagCount === 1 ? 'error' : 'errors'}` }
      : {}),
    ...(failedCount > 0 ? { pipelines: `${failedCount} failed` } : {}),
  }
}
