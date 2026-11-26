import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { SheetbaseField } from '@sheetbase-labs/sheetbase-shared'

import {
  fetchWorkspaceMemberIdentities,
  workspaceMemberQueryKeys,
} from '#/components/projects/project-data'
import { notebookDataClient } from '#/lib/notebook-data'
import { commonSearchFields, matchOptions } from '#/lib/search-fields'
import { fetchModelSearchFields } from '#/lib/search-model-fields'
import type { SearchFieldSources, SearchOption } from '#/lib/search-fields'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const NO_FIELDS: readonly SheetbaseField[] = []

/**
 * Type-ahead lookups for the Project and Owner pickers: shared by the search
 * builder and the filter on every list.
 */
export function useFieldSources(): SearchFieldSources {
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

    return { loadProjects, loadOwners }
  }, [queryClient])
}

/**
 * The fields the search builder offers, with Project and Owner looked up as
 * the person types. Owner goes through the query cache the page already fills,
 * so opening the picker rarely costs a request.
 */
export function useSearchFields(
  typeFields: readonly SheetbaseField[] = NO_FIELDS,
): SheetbaseField[] {
  // The fields workspaces add to their models, offered whatever the results.
  const modelFields = useQuery({
    queryKey: ['search', 'model-fields'],
    queryFn: () => fetchModelSearchFields(notebookDataClient),
    staleTime: 5 * 60_000,
  }).data

  const sources = useFieldSources()

  return useMemo(() => {
    // A value a result carries under a model field's key is that model field.
    const modelKeys = new Set(
      (modelFields ?? []).map((field) => field.id.split(':').at(-1)),
    )

    return [
      ...commonSearchFields(sources),
      ...(modelFields ?? []),
      ...typeFields.filter(
        (field) => !modelKeys.has(field.id.replace(/^fields\./, '')),
      ),
    ]
  }, [sources, typeFields, modelFields])
}
