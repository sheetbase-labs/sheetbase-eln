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
  userId: string,
): Promise<ShellCounts> {
  const client = db.$client
  // The Inbox view reads the caller's claims, so run it in a transaction with
  // the claims set for the pool connection.
  const inboxCount = await (async () => {
    const c = await client.connect()
    try {
      await c.query('begin')
      await c.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({
          sub: userId,
          workspace_id: workspaceId,
          role: 'authenticated',
        }),
      ])
      const r = await c.query<{ n: string }>(
        "select count(*)::int as n from api.my_work_items where state <> 'following'",
      )
      await c.query('commit')
      return Number(r.rows[0]?.n ?? 0)
    } catch {
      await c.query('rollback').catch(() => {})
      return 0
    } finally {
      c.release()
    }
  })()

  const [flags, failed] = await Promise.all([
    client.query<{ n: string }>(
      // The badge counts datasets with an unresolved value flag, matching the
      // design's "2 errors" (two datasets), not the raw flag rows.
      `select count(distinct dataset_id)::int as n from api.dataset_value_flags
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
    ...(inboxCount > 0 ? { inbox: String(inboxCount) } : {}),
    ...(flagCount > 0
      ? { datasets: `${flagCount} ${flagCount === 1 ? 'error' : 'errors'}` }
      : {}),
    ...(failedCount > 0 ? { pipelines: `${failedCount} failed` } : {}),
  }
}
