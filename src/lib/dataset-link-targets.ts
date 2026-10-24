import type { DataClient } from './data-client'
import { listByIds } from './chunk-ids'

export interface DatasetLinkTarget {
  id: string
  workspace_id: string
  primary_project_id: string | null
  display_id: string | null
  name: string
  archived_at: string | null
  created_at: string
  updated_at: string
  created_by_user_id: string
}

/** Resolve links through Dataset RLS, never by creating a companion Record. */
export async function fetchDatasetLinkTargets(
  client: DataClient,
  references: readonly string[],
): Promise<Map<string, DatasetLinkTarget>> {
  const unique = [...new Set(references)].filter(Boolean)
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const [byId, byIdentifier] = await Promise.all(
    ['id', 'display_id'].map((column) =>
      listByIds(
        unique
          .filter((ref) => uuid.test(ref) === (column === 'id'))
          .map((ref) => JSON.stringify(ref)),
        (values) =>
          client.list<DatasetLinkTarget>(
            'datasets',
            `?${column}=in.(${values})&select=id,workspace_id,primary_project_id,display_id,name,archived_at,created_at,updated_at,created_by_user_id`,
          ),
      ),
    ),
  )
  const targets = new Map<string, DatasetLinkTarget>()
  for (const target of [...byId, ...byIdentifier]) {
    targets.set(target.id, target)
    if (target.display_id) targets.set(target.display_id, target)
  }
  return targets
}
