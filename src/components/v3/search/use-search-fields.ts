import { useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { SheetbaseField } from '@sheetbase-labs/sheetbase-shared'

import {
  fetchWorkspaceMemberIdentities,
  workspaceMemberQueryKeys,
} from '#/components/v3/projects/project-data'
import { notebookDataClient } from '#/lib/notebook-data'
import { commonSearchFields, matchOptions } from '#/lib/search-fields'
import type { SearchOption } from '#/lib/search-fields'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const NO_FIELDS: readonly SheetbaseField[] = []

/**
 * The fields the search builder offers, with Project and Owner looked up as
 * the person types. Owner goes through the query cache the page already fills,
 * so opening the picker rarely costs a request.
 */
export function useSearchFields(
  typeFields: readonly SheetbaseField[] = NO_FIELDS,
): SheetbaseField[] {
  const queryClient = useQueryClient()
  return useMemo(() => {
    const loadProjects = async (query: string): Promise<SearchOption[]> => {
      const needle = query.trim().replace(/[*,()]/g, ' ')
      // A value already in a filter is looked up by itself to find its name.
      if (UUID.test(needle)) {
        const found = await notebookDataClient.list<{
          id: string
          title: string
        }>('projects', `?select=id,title&id=eq.${needle}`)
        return found.map((row) => ({ value: row.id, label: row.title }))
      }
      const rows = await notebookDataClient.list<{ id: string; title: string }>(
        'projects',
        `?select=id,title&order=title&limit=20${
          needle ? `&title=ilike.*${encodeURIComponent(needle)}*` : ''
        }`,
      )
      return rows.map((row) => ({ value: row.id, label: row.title }))
    }
    const loadOwners = async (query: string): Promise<SearchOption[]> => {
      const members = await queryClient.fetchQuery({
        queryKey: workspaceMemberQueryKeys.identities,
        queryFn: fetchWorkspaceMemberIdentities,
        staleTime: 60_000,
      })
      return matchOptions(
        members.map((m) => ({ value: m.user_id, label: m.name })),
        query,
      )
    }
    return [...commonSearchFields({ loadProjects, loadOwners }), ...typeFields]
  }, [queryClient, typeFields])
}
