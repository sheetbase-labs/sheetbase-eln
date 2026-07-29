/**
 * Shared server function + client hook for resolving user IDs to display names.
 *
 * `internal.user` is not PostgREST-exposed, so client-side code cannot query
 * user names directly. This module provides a server function that does the
 * lookup and a TanStack Query hook for client-side consumption.
 */
import { useQuery } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { useMemo } from 'react'

const resolveUserNamesFn = createServerFn({ method: 'POST' })
  .validator((userIds: string[]) => userIds)
  .handler(async ({ data }) => {
    const { resolveUserNames } = await import('#/lib/current-user')
    return resolveUserNames(data)
  })

/**
 * Hook: resolve a set of user IDs to { id → name }.
 * Includes the current user's own name (passed in) for instant resolution.
 * Falls back to a short id slice for unknown IDs.
 */
export function useUserNames(
  userIds: string[],
  currentUser?: { id: string; name: string },
) {
  const uniqueIds = useMemo(() => {
    const ids = new Set<string>()
    for (const id of userIds) if (id) ids.add(id)
    return Array.from(ids)
  }, [userIds])

  const query = useQuery({
    queryKey: ['user-names', uniqueIds],
    queryFn: () => resolveUserNamesFn({ data: uniqueIds }),
    enabled: uniqueIds.length > 0,
  })

  const names = useMemo(() => {
    const map: Record<string, string> = {}
    if (currentUser) map[currentUser.id] = currentUser.name
    Object.assign(map, query.data ?? {})
    return map
  }, [currentUser, query.data])

  function userLabel(userId: string): string {
    return (
      names[userId] ??
      (userId.length <= 8 ? userId : userId.slice(0, 8))
    )
  }

  return { names, userLabel }
}
