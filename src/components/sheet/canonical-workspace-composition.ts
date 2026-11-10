import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type { DataClient } from '#/lib/data-client'
import { fetchComposedSheetPaged } from '#/lib/sheet-composition-data'
import type { ComposedSheetPagedSnapshot } from '#/lib/sheet-composition-data'

/** Append only the requested window, unless a write invalidated the snapshot. */
export function useCanonicalWorkspaceComposition({
  instanceId,
  pageCount,
  enabled,
  client,
}: {
  instanceId: string
  pageCount: number
  enabled: boolean
  client: DataClient
}) {
  const queryClient = useQueryClient()

  return useQuery({
    queryKey: ['composed-sheet', instanceId, pageCount],
    queryFn: () => {
      const previousKey = ['composed-sheet', instanceId, pageCount - 1]

      const previous =
        pageCount > 1
          ? queryClient.getQueryData<ComposedSheetPagedSnapshot>(previousKey)
          : undefined

      const previousState = queryClient.getQueryState(previousKey)

      const reusable =
        previous && !previousState?.isInvalidated ? previous : undefined

      return fetchComposedSheetPaged(instanceId, {
        pageCount,
        previous: reusable?.snapshot ?? null,
        previousPageCount: reusable ? pageCount - 1 : 0,
        client,
      })
    },
    enabled,
    placeholderData: keepPreviousData,
  })
}
