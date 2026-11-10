import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { DataClient } from '#/lib/data-client'
import { fetchCellConflicts } from './cell-conflict-data'

/** Keep a resolved selection visible while removing it from the open count. */
export function useCanonicalWorkspaceConflicts({
  instanceId,
  hasSelection,
  selectedRowKey,
  selectedColumnId,
  client,
}: {
  instanceId: string
  hasSelection: boolean
  selectedRowKey: string | undefined
  selectedColumnId: string | undefined
  client: DataClient
}) {
  const conflicts = useQuery({
    queryKey: ['sheet-cell-conflicts', instanceId, 'open'],
    queryFn: () => fetchCellConflicts(client, instanceId, { state: 'open' }),
  })

  const [resolvedConflictIds, setResolvedConflictIds] = useState<
    ReadonlySet<string>
  >(() => new Set())

  const cached = conflicts.data ?? []

  const openConflicts = cached.filter(
    (conflict) => !resolvedConflictIds.has(conflict.id),
  )

  const selectedConflict =
    hasSelection && selectedRowKey && selectedColumnId
      ? (cached.find(
          (conflict) =>
            conflict.row_key === selectedRowKey &&
            conflict.field_id === selectedColumnId,
        ) ?? null)
      : null

  return { openConflicts, selectedConflict, setResolvedConflictIds }
}
