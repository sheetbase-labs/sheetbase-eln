import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { notebookDataClient } from '#/lib/notebook-data'
import { fetchMyProjectAssignments } from '#/lib/workspace-access'

export interface WritableProject {
  id: string
  title: string
  archived_at: string | null
  status: string
  display_id?: string | null
  stage?: string | null
  modality?: string | null
}

/**
 * The projects the signed-in account can create records in: editable and not
 * archived. `api.projects` returns every project the account can view, and the
 * create RPCs fail on a view-only one with a raw row-level-security error, so
 * pickers filter first. Reads only while `enabled`.
 */
export function useWritableProjects(
  enabled: boolean,
  client: typeof notebookDataClient = notebookDataClient,
) {
  const projects = useQuery({
    queryKey: ['ui-port', 'writable-projects', 'projects'],
    queryFn: () =>
      client.list<WritableProject>(
        'projects',
        '?select=id,title,archived_at,status,display_id,stage,modality&order=title.asc',
      ),
    enabled,
    staleTime: 60_000,
  })
  const assignments = useQuery({
    queryKey: ['ui-port', 'writable-projects', 'access'],
    queryFn: () => fetchMyProjectAssignments(client),
    enabled,
    staleTime: 60_000,
  })
  const writable = useMemo(
    () =>
      new Set(
        (assignments.data ?? [])
          .filter((a) => a.can_edit)
          .map((a) => a.project_id),
      ),
    [assignments.data],
  )
  const usable = (projects.data ?? []).filter(
    (p) => writable.has(p.id) && !p.archived_at && p.status !== 'archived',
  )
  return {
    usable,
    isLoading: projects.isLoading || assignments.isLoading,
    isError: projects.isError || assignments.isError,
    refetch: () => {
      void projects.refetch()
      void assignments.refetch()
    },
  }
}
