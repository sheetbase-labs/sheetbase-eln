/**
 * Project access, as the lists need to know it.
 *
 * Projects, their records and their datasets are gated by
 * `internal.can_view_project` (the restrictive read policies on `api.projects`,
 * `api.records` and `api.datasets`), and `api.my_project_permissions` exposes
 * exactly that predicate for the caller. So a list that comes back empty has two
 * very different meanings, and the UI must not confuse them:
 *
 * - the workspace holds nothing of that kind, or
 * - the workspace holds things this person cannot see.
 *
 * The UI cannot count what it cannot read — that would leak the existence of
 * inaccessible rows — so the honest statement is about the *person*: "no
 * projects you have access to". This hook supplies the one fact that is safe and
 * sufficient: whether the caller can view any project at all.
 */
import { useQuery } from '@tanstack/react-query'

import { t } from '#/copy'
import type { DataClient } from '#/lib/data-client'
import { notebookDataClient } from '#/lib/notebook-data'
import { fetchMyProjectAssignments } from '#/lib/workspace-access'

export const projectAccessQueryKey = [
  'workspace',
  'my-project-assignments',
] as const

/**
 * `true` — the caller can view at least one project here.
 * `false` — the caller can view no project here (access, not absence).
 * `undefined` — not known yet (loading, or the read failed): callers must fall
 * back to their neutral copy rather than assert a denial they cannot prove.
 */
export function useHasProjectAccess(
  client: DataClient = notebookDataClient,
): boolean | undefined {
  const query = useQuery({
    queryKey: projectAccessQueryKey,
    queryFn: () => fetchMyProjectAssignments(client),
    staleTime: 60_000,
  })
  if (!query.data) return undefined
  return query.data.length > 0
}

/** Empty-list title when the reason is access, not absence. */
export function noProjectAccessTitle(noun: string): string {
  return t('projects.projectAccess.title', { noun })
}

export const NO_PROJECT_ACCESS_BODY = t('projects.projectAccess.body')
