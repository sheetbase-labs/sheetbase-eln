/**
 * Sidebar counts (SHELL): the Inbox, Datasets and Pipelines entries carry a
 * live count, as the reference design shows. Scoped to the active workspace.
 */
import { db } from '#/db/client.server'

export interface ShellCounts {
  inbox?: string
  datasets?: string
  pipelines?: string
}

export async function getShellCounts(
  workspaceId: string,
): Promise<ShellCounts> {
  const client = db.$client
  const [flags, failed] = await Promise.all([
    client.query<{ n: string }>(
      `select count(*)::int as n from api.dataset_value_flags
        where workspace_id = $1 and cleared_at is null`,
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
    ...(flagCount > 0
      ? { datasets: `${flagCount} ${flagCount === 1 ? 'error' : 'errors'}` }
      : {}),
    ...(failedCount > 0 ? { pipelines: `${failedCount} failed` } : {}),
  }
}
