import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { WorkspaceMemberIdentity } from '#/components/projects/project-data'
import { hasCapability } from '#/lib/capability'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  deleteSavedSearchOnAccount,
  fetchSavedSearches,
  moveBrowserSavedSearches,
  renameSavedSearch,
  saveSearchOnAccount,
  savedSearchQueryKey,
  setSavedSearchVisibility,
  touchSavedSearch,
} from '#/lib/search'
import type { SavedQuery, SavedSearchFacets } from '#/lib/search'
import { t } from '#/copy'

/**
 * The saved searches a person can see, and what they can do with them: the
 * list, the ways to change it, and who may do what. The results page's popover
 * and the saved searches page both read it, so they never disagree.
 */
export function useSavedSearches({
  workspaceId,
  userId,
  role,
}: {
  workspaceId: string
  /** The signed-in person: their searches are theirs to change. */
  userId?: string
  /** Their role in the workspace, which decides who can share and tidy up. */
  role?: string | null
}) {
  const queryClient = useQueryClient()
  const key = savedSearchQueryKey(workspaceId)

  const list = useQuery({
    queryKey: key,
    queryFn: async () => {
      // Searches an earlier version kept in this browser move onto the account.
      await moveBrowserSavedSearches(notebookDataClient, workspaceId).catch(
        () => 0,
      )

      return fetchSavedSearches(notebookDataClient)
    },
  })

  const members = useQuery({
    queryKey: ['ui-port', 'workspace-members'],
    queryFn: () =>
      notebookDataClient.rpc<WorkspaceMemberIdentity[]>(
        'workspace_members_list',
        {},
      ),
    staleTime: 60_000,
  })

  const memberNames: Record<string, string> = Object.fromEntries(
    (members.data ?? []).map((m) => [m.user_id, m.name]),
  )

  const refresh = () => queryClient.invalidateQueries({ queryKey: key })

  const save = useMutation({
    mutationFn: (v: {
      name: string
      search: { q: string } & SavedSearchFacets
      shared: boolean
    }) =>
      saveSearchOnAccount(
        notebookDataClient,
        v.name,
        v.search,
        v.shared ? 'workspace' : 'private',
      ),
    onSuccess: refresh,
  })

  const remove = useMutation({
    mutationFn: (id: string) =>
      deleteSavedSearchOnAccount(notebookDataClient, id),
    onSuccess: refresh,
  })

  const setVisibility = useMutation({
    mutationFn: (v: { id: string; visibility: 'private' | 'workspace' }) =>
      setSavedSearchVisibility(notebookDataClient, v.id, v.visibility),
    onSuccess: refresh,
  })

  const rename = useMutation({
    mutationFn: (v: { id: string; name: string }) =>
      renameSavedSearch(notebookDataClient, v.id, v.name),
    onSuccess: refresh,
  })

  // Opening a search ranks it as recently used; losing that note is harmless.
  const markUsed = (s: SavedQuery) => {
    void touchSavedSearch(notebookDataClient, s.id)
      .then(refresh)
      .catch(() => undefined)
  }

  const failure = [save, remove, setVisibility, rename]
    .map((m) => (m.isError ? m.error : null))
    .find(Boolean)

  const failureText = failure
    ? /already exists/i.test(String(failure.message))
      ? t('projects.savedSearches.nameTaken')
      : t('projects.savedSearches.failed')
    : null

  // Anyone who can add records can share; viewers keep searches to themselves.
  const canShare = hasCapability(role, 'record.create')
  const isManager = hasCapability(role, 'schema.edit')

  const canChange = (s: SavedQuery) =>
    s.visibility !== 'workspace' || s.savedBy === userId || isManager

  return {
    list,
    saved: list.data ?? [],
    memberNames,
    save,
    remove,
    setVisibility,
    rename,
    failureText,
    canShare,
    canChange,
    markUsed,
  }
}
