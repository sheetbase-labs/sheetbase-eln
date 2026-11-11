/**
 * The dataset Snapshots tab's reads, state and writes.
 *
 * DSET-03.1: retention, producer, hash and cited-by are read from the model.
 * DSET-03.3 adds the manual "Create snapshot" action and the comparison point.
 * DSET-04.3 adds the prune warning with a reason-bearing "Keep", and the
 * tombstone state for a snapshot whose rows the retention job removed.
 *
 * The route file describes the screen; this module owns which snapshot is
 * selected, the Dataset revision the manual snapshot is checked against, and
 * the two writes it can make.
 */
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { DialogRootActions } from '@base-ui/react/dialog'

import { t } from '#/copy'
import { toast } from '#/components/ui/sonner'
import { useRowFocus } from '#/components/inventory/registry-grid'
import { useRunForDatasetVersion } from '#/components/pipelines/pipelines-data'
import {
  countSnapshotCitations,
  describeKeepError,
  describeSnapshotCitations,
  describeSnapshotError,
  describeSnapshotKeeping,
  isSnapshotTombstone,
  mostUrgentPruneWarning,
} from '#/components/datasets/snapshot-data'
import type { SnapshotVersion } from '#/components/datasets/snapshot-data'
import { hasCapability } from '#/lib/capability'
import { keepDatasetVersion } from '#/lib/dataset-explorer-data'
import { snapshotDataset } from '#/lib/dataset-product'
import { notebookDataClient } from '#/lib/notebook-data'
import { formatDate } from '#/lib/format-date'
import { datasetVersionsQueryKey, useDatasetVersions } from '../$datasetId'

/** One inspector row: a label and what it reads. */
export type SnapshotProperty = [string, React.ReactNode]

/** The "Previous" row, when there is an earlier snapshot. */
export function previousRows(
  previous: SnapshotVersion | undefined,
): SnapshotProperty[] {
  return previous ? [[t('common.actions.previous'), previous.label]] : []
}

/** The "Rows removed" row, when the retention job took this snapshot's rows. */
export function removedRows(rowsRemovedAt: string | null): SnapshotProperty[] {
  return rowsRemovedAt
    ? [[t('data.datasetSnapshots.rowsRemoved'), formatDate(rowsRemovedAt)]]
    : []
}

/**
 * Why "Create snapshot" is disabled, or null when it is enabled.
 *
 * A failed read is not an archive state: say which it is, so the disabled
 * action does not blame the dataset's lifecycle for a broken request.
 */
export function snapshotDisabledReason(input: {
  canWrite: boolean
  loading: boolean
  failed: boolean
  dataset: { lifecycle: string } | null | undefined
}): string | null {
  if (!input.canWrite) return t('data.datasetSnapshots.haveReadAccessDataset')

  if (input.loading) return t('data.datasetSnapshots.checkingDatasetSCurrent')

  if (input.failed) return t('data.datasetSnapshots.datasetSCurrentRevision')

  if (!input.dataset)
    return t('data.datasetSnapshots.datasetLongerReadableHere')

  if (input.dataset.lifecycle !== 'active')
    return t('data.datasetSnapshots.archivedDatasetsCannotSnapshotted')

  return null
}

/** Who is looking at the tab, and with what authority. */
export interface SnapshotsViewer {
  workspace?: { id?: string; role?: string } | null
  user: { name: string }
}

/** Everything the Snapshots tab reads, derives and can write. */
export function useSnapshotsScreen(input: {
  datasetId: string
  viewer: SnapshotsViewer
}) {
  const { datasetId, viewer } = input
  const queryClient = useQueryClient()
  const versions = useDatasetVersions(datasetId)
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion -- `dataset_version_list` returns DatasetVersionSummary rows (see listDatasetVersionSummaries); the shared query still names that payload with its older DatasetVersion type, so only the name differs.
  const rows = (versions.data ?? []) as unknown as SnapshotVersion[]
  const [selected, setSelected] = useState<string | null>(null)

  const { rowSelection, onRowSelectionChange } = useRowFocus(
    selected,
    setSelected,
  )

  const [dialogOpen, setDialogOpen] = useState(false)
  const [compareWith, setCompareWith] = useState<string | null>(null)
  const [keepTarget, setKeepTarget] = useState<SnapshotVersion | null>(null)
  const [citeTarget, setCiteTarget] = useState<SnapshotVersion | null>(null)
  const current = rows.find((v) => v.id === selected) ?? rows.at(0)
  const producingRun = useRunForDatasetVersion(current?.id)

  // The manual snapshot RPC is optimistically concurrent-checked, so the
  // action needs the Dataset's current revision. Read it here rather than
  // trusting a cached list row.
  const datasetQuery = useQuery({
    queryKey: ['ui-port', 'dataset-revision', datasetId],
    queryFn: async () => {
      const found = await notebookDataClient.list<{
        id: string
        revision: number | string
        lifecycle: string
      }>(
        'datasets',
        `?id=eq.${encodeURIComponent(datasetId)}&select=id,revision,lifecycle`,
      )

      return found.at(0) ?? null
    },
  })

  // base-ui keeps a closed popup in the document until a frame has painted past
  // its exit transition. A hidden or throttled tab may never deliver that frame,
  // which leaves the closed dialog on screen with live controls — clicking
  // "Save snapshot" again would then write a second snapshot. Unmounting on
  // close is base-ui's documented way to take the dialog out of the document
  // immediately, so a closed confirmation can never be submitted twice.
  const createDialogActions = useRef<DialogRootActions | null>(null)
  const keepDialogActions = useRef<DialogRootActions | null>(null)

  const revision = datasetQuery.data ? Number(datasetQuery.data.revision) : null

  const create = useMutation({
    // SAFETY: the create button is enabled only when `canSnapshot`, which
    // requires a loaded revision, so the dialog cannot submit without one.
    mutationFn: (label: string) =>
      snapshotDataset(notebookDataClient, {
        datasetId,
        expectedRevision: revision as number,
        label,
      }),
    onSuccess: (created) => {
      setDialogOpen(false)
      setSelected(created.id)
      void queryClient.invalidateQueries({
        queryKey: datasetVersionsQueryKey(datasetId),
      })
      void queryClient.invalidateQueries({
        queryKey: ['ui-port', 'dataset-revision', datasetId],
      })
      toast(t('data.datasetSnapshots.snapshotSaved', { label: created.label }))
    },
    onError: (cause) =>
      toast(t('data.datasetSnapshots.couldSaveSnapshot'), {
        description: describeSnapshotError(cause),
      }),
  })

  const keep = useMutation({
    mutationFn: (entry: { version: SnapshotVersion; reason: string }) =>
      keepDatasetVersion(notebookDataClient, entry.version.id, entry.reason),
    onSuccess: (_result, entry) => {
      setKeepTarget(null)
      void queryClient.invalidateQueries({
        queryKey: datasetVersionsQueryKey(datasetId),
      })
      toast(
        t('data.datasetSnapshots.snapshotKept', { label: entry.version.label }),
        {
          description: t('data.datasetSnapshots.rowsRemovedRetentionWhile'),
        },
      )
    },
    onError: (cause) =>
      toast(t('data.datasetSnapshots.couldKeepSnapshot'), {
        description: describeKeepError(cause),
      }),
  })

  useEffect(() => {
    if (!dialogOpen) createDialogActions.current?.unmount()
  }, [dialogOpen])
  useEffect(() => {
    if (!keepTarget) keepDialogActions.current?.unmount()
  }, [keepTarget])

  const index = current ? rows.indexOf(current) : -1

  const previous = index >= 0 ? rows[index + 1] : undefined

  const keeping = describeSnapshotKeeping(current)

  const tombstone = current ? isSnapshotTombstone(current) : false

  const pruneWarning = mostUrgentPruneWarning(rows)

  const citations = countSnapshotCitations(current?.citedBy)

  const citationLines = describeSnapshotCitations(current?.citedBy)

  const citedCount =
    citations.signedRevisions + citations.pipelineRuns + citations.analyses

  const canWrite = hasCapability(viewer.workspace?.role, 'record.create')

  const canSnapshot =
    canWrite && revision !== null && datasetQuery.data?.lifecycle === 'active'

  const disabledReason = snapshotDisabledReason({
    canWrite,
    loading: datasetQuery.isLoading,
    failed: datasetQuery.isError,
    dataset: datasetQuery.data,
  })

  const others = rows.filter((v) => v.id !== current?.id)

  const compareTarget =
    compareWith && others.some((v) => v.id === compareWith)
      ? compareWith
      : (previous?.id ?? others.at(0)?.id ?? null)

  /** Keep the snapshot a prune warning names, when the list still holds it. */
  const requestKeep = (versionId: string) => {
    const target = rows.find((v) => v.id === versionId)

    if (target) setKeepTarget(target)
  }

  return {
    rows,
    rowSelection,
    onRowSelectionChange,
    versionsLoading: versions.isLoading,
    selected,
    setSelected,
    current,
    previous,
    others,
    compareTarget,
    setCompareWith,
    keeping,
    tombstone,
    pruneWarning,
    citations,
    citationLines,
    citedCount,
    canWrite,
    canSnapshot,
    disabledReason,
    datasetFailed: datasetQuery.isError,
    producingRun,
    dialogOpen,
    setDialogOpen,
    createDialogActions,
    keepDialogActions,
    keepTarget,
    setKeepTarget,
    citeTarget,
    setCiteTarget,
    create,
    keep,
    requestKeep,
  }
}
