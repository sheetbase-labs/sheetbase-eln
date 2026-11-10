import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { undoToast } from '#/lib/undo-toast'
import { t } from '#/copy'

import { projectDataClient, PROJECTS_KEY } from './project-data'
import type { ProjectRow } from './types'

type BulkOperation = 'archive' | 'restore'

const rpcFor = (operation: BulkOperation) =>
  operation === 'archive' ? 'archive_project' : 'unarchive_project'

async function applyToAll(
  operation: BulkOperation,
  ids: readonly string[],
): Promise<number> {
  const settled = await Promise.allSettled(
    ids.map((id) =>
      projectDataClient.rpc(rpcFor(operation), { p_project_id: id }),
    ),
  )

  return settled.filter((result) => result.status === 'rejected').length
}

/**
 * Which projects the person has ticked, and what may be done with them.
 * `archive_project`/`unarchive_project` admit a workspace owner or admin only,
 * so the selection exists only for a caller the server will accept. A refused
 * project leaves the rest applied and says so, and a clean run offers Undo.
 */
export function useProjectSelection({
  meId,
  rows,
}: {
  meId?: string
  rows: readonly ProjectRow[]
}) {
  const queryClient = useQueryClient()
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)

  const role = useQuery({
    queryKey: ['workspace', 'my-role', meId ?? ''],
    enabled: Boolean(meId),
    queryFn: () =>
      projectDataClient
        .list<{ role: string }>(
          'workspace_memberships',
          `?user_id=eq.${encodeURIComponent(meId ?? '')}&select=role&limit=1`,
        )
        .then((memberships) => memberships[0]?.role ?? null),
    staleTime: 60_000,
  })

  const canBulkArchive = role.data === 'owner' || role.data === 'admin'
  const selected = rows.filter((p) => checked.has(p.id))
  const archivable = selected.filter((p) => !p.archived)
  const restorable = selected.filter((p) => p.archived)

  const targetsOf = (operation: BulkOperation) =>
    operation === 'archive' ? archivable : restorable

  const bulk = useMutation({
    mutationFn: async (operation: BulkOperation) => {
      const targets = targetsOf(operation)

      return {
        operation,
        count: targets.length,
        refused: await applyToAll(
          operation,
          targets.map((p) => p.uuid),
        ),
      }
    },
    onMutate: () => setBulkError(null),
    onSuccess: ({ operation, count, refused }) => {
      void queryClient.invalidateQueries({ queryKey: PROJECTS_KEY })
      setConfirmArchive(false)
      const done = count - refused

      if (refused) {
        setBulkError(
          operation === 'archive'
            ? t('projects.projectsPage.bulk.partialArchived', { done, count })
            : t('projects.projectsPage.bulk.partialRestored', { done, count }),
        )

        return
      }

      const undoIds = targetsOf(operation).map((p) => p.uuid)
      setChecked(new Set())
      undoToast(
        operation === 'archive'
          ? t('projects.projectsPage.bulk.archived', { count })
          : t('projects.projectsPage.bulk.restored', { count }),
        async () => {
          await applyToAll(
            operation === 'archive' ? 'restore' : 'archive',
            undoIds,
          )
        },
        () => void queryClient.invalidateQueries({ queryKey: PROJECTS_KEY }),
      )
    },
    onError: (failure: Error) => {
      setConfirmArchive(false)
      setBulkError(failure.message || t('projects.projectsPage.bulk.refused'))
    },
  })

  const toggleAll = (on: boolean) =>
    setChecked(on ? new Set(rows.map((r) => r.id)) : new Set())

  const toggleRow = (id: string, on: boolean) =>
    setChecked((s) => {
      const n = new Set(s)

      if (on) n.add(id)
      else n.delete(id)

      return n
    })

  return {
    checked,
    canBulkArchive,
    confirmArchive,
    setConfirmArchive,
    bulkError,
    bulk,
    archivable,
    restorable,
    toggleAll,
    toggleRow,
    clear: () => setChecked(new Set()),
  }
}
