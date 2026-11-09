/**
 * Following (account basics). A person follows a record or a project to have it
 * in their Inbox's Following tab; following a record also tells them about new
 * comments. Commenting on a record or being mentioned follows it for them. The
 * rows are read under row-level security (your own only) and written through
 * `follow_record` / `unfollow_record` and `follow_project` /
 * `unfollow_project`.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { DataClient } from './data-client'
import { notebookDataClient } from './notebook-data'
import { requestShellRefresh } from './shell-refresh'

export type FollowKind = 'record' | 'project'

const TABLE: Record<FollowKind, string> = {
  record: 'work_item_follows',
  project: 'project_follows',
}

const COLUMN: Record<FollowKind, string> = {
  record: 'record_id',
  project: 'project_id',
}

const FOLLOW_RPC: Record<FollowKind, string> = {
  record: 'follow_record',
  project: 'follow_project',
}

const UNFOLLOW_RPC: Record<FollowKind, string> = {
  record: 'unfollow_record',
  project: 'unfollow_project',
}

const ARGUMENT: Record<FollowKind, string> = {
  record: 'p_record_id',
  project: 'p_project_id',
}

export const followQueryKey = (kind: FollowKind, id: string) =>
  ['follows', kind, id] as const

/** Whether the signed-in person follows this record or project. */
export function fetchIsFollowing(
  client: DataClient,
  kind: FollowKind,
  id: string,
): Promise<boolean> {
  return client
    .list<Record<string, string>>(
      TABLE[kind],
      `?${COLUMN[kind]}=eq.${encodeURIComponent(id)}&select=${COLUMN[kind]}&limit=1`,
    )
    .then((rows) => rows.length > 0)
}

export function setFollowing(
  client: DataClient,
  kind: FollowKind,
  id: string,
  following: boolean,
): Promise<unknown> {
  return client.rpc(following ? FOLLOW_RPC[kind] : UNFOLLOW_RPC[kind], {
    [ARGUMENT[kind]]: id,
  })
}

export function useFollowState(
  kind: FollowKind,
  id: string | null | undefined,
  client: DataClient = notebookDataClient,
) {
  const queryClient = useQueryClient()
  const key = followQueryKey(kind, id ?? '')

  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchIsFollowing(client, kind, id ?? ''),
    enabled: Boolean(id),
  })

  const mutation = useMutation({
    mutationFn: (following: boolean) =>
      setFollowing(client, kind, id ?? '', following),
    // The button flips at once; a refused write rolls it back.
    onMutate: async (following: boolean) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<boolean>(key)
      queryClient.setQueryData(key, following)

      return { previous }
    },
    onError: (_error, _following, context) => {
      queryClient.setQueryData(key, context?.previous ?? false)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key })
      // The Inbox's Following tab and its count change with a follow.
      requestShellRefresh()
      void queryClient.invalidateQueries({ queryKey: ['work-items'] })
    },
  })

  return {
    following: query.data ?? false,
    ready: query.isSuccess,
    pending: mutation.isPending,
    error: mutation.error,
    setFollowing: (following: boolean) => mutation.mutate(following),
  }
}
