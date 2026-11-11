/**
 * R5-SURF-01 — the dataset Used by tab.
 *
 * Result shape: the canonical dependency read model for a dataset,
 * `api.discover_object_dependencies('dataset', <id>)` (CORE-054, extended by
 * MODEL-04). It answers "what references this dataset" from server authority
 * rather than a browser table scan. The dataset's own snapshots
 * (`dataset_version` / `snapshot_of_dataset`) are excluded: they are the
 * dataset's versions, already the Snapshots tab, and are not a *user* of it —
 * Used by lists the objects that depend on the dataset.
 *
 * States are explicit: loading, denied, error, and an honest empty state when
 * nothing references the dataset yet.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { t } from '#/copy'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { Section } from '#/components/ui/layout'
import { TableBox } from '#/components/ui/table'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { classifyDatasetTabAccess } from '#/components/datasets/dataset-detail-tabs'
import { datasetPath, recordPath, sheetPath } from '#/lib/navigation'
import { notebookDataClient } from '#/lib/notebook-data'
import { discoverObjectDependencies } from '#/lib/object-dependencies'
import type { DataClient } from '#/lib/data-client'
import { datasetUsers } from './dataset-users'

const RELATION_LABELS = new Map([
  ['resolved_dataset_binding', t('data.datasetUsedByTab.bindsDataset')],
  ['snapshot_of_dataset', t('data.datasetUsedByTab.snapshotDataset')],
])

function relationLabel(relation: string): string {
  return RELATION_LABELS.get(relation) ?? relation.replaceAll('_', ' ')
}

function dependencyHref(kind: string, id: string): string | null {
  if (kind === 'sheet_instance') return sheetPath(id)

  if (kind === 'dataset') return datasetPath(id)

  if (kind === 'record') return recordPath(id)

  return null
}

type Dependent = ReturnType<typeof datasetUsers>[number]

function UsedByTable({ users }: { users: Dependent[] }) {
  const columns = useMemo<RegistryColumn<Dependent>[]>(
    () => [
      {
        id: 'record',
        header: t('data.datasetUsedByTab.record'),
        accessorFn: (row) => row.id,
        enableHiding: false,
        cell: ({ row }) => {
          const href = dependencyHref(row.original.kind, row.original.id)

          return href ? (
            <a href={href} className="mono text-link">
              {row.original.id.slice(0, 8)}
            </a>
          ) : (
            <span className="mono">{row.original.id.slice(0, 8)}</span>
          )
        },
      },
      {
        id: 'title',
        header: t('data.datasetUsedByTab.title'),
        accessorFn: (row) => row.label || row.kind.replaceAll('_', ' '),
        cell: ({ row }) =>
          row.original.label || row.original.kind.replaceAll('_', ' '),
      },
      {
        id: 'how',
        header: t('data.datasetUsedByTab.how'),
        accessorFn: (row) => relationLabel(row.relation),
        cell: ({ row }) => relationLabel(row.original.relation),
      },
    ],
    [],
  )

  return (
    <TableBox>
      <RegistryGrid
        label={t('data.datasetUsedByTab.usedBy')}
        rows={users}
        columns={columns}
        getRowId={(row) => `${row.kind}:${row.id}`}
        selectable={false}
      />
    </TableBox>
  )
}

export function DatasetUsedByTab({
  datasetId,
  client = notebookDataClient,
}: {
  datasetId: string
  client?: DataClient
}) {
  const query = useQuery({
    queryKey: ['ui-port', 'dataset-usage', datasetId] as const,
    queryFn: () => discoverObjectDependencies(client, 'dataset', datasetId),
  })

  const access = classifyDatasetTabAccess(query.error)

  if (query.isLoading) {
    return (
      <div className="px-4 py-6 md:px-6" aria-busy="true">
        <p className="text-body text-fg-muted">
          {t('data.datasetUsedByTab.loadingReferences')}
        </p>
      </div>
    )
  }

  if (access) {
    return (
      <div className="px-4 py-6 md:px-6">
        <EmptyState
          icon="link"
          title={
            access === 'denied'
              ? t('data.datasetUsedByTab.referencesAvailable')
              : t('data.datasetUsedByTab.referencesCouldLoaded')
          }
          description={
            access === 'denied'
              ? t('data.datasetUsedByTab.datasetSDependentsBelong')
              : t('data.datasetUsedByTab.dependencyReadModelCould')
          }
          action={
            access === 'error' ? (
              <Button variant="primary" onClick={() => void query.refetch()}>
                {t('common.actions.tryAgain')}
              </Button>
            ) : undefined
          }
        />
      </div>
    )
  }

  const users = datasetUsers(query.data?.dependencies ?? [])

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-auto px-4 py-5 md:px-6">
      <Section title={t('data.datasetUsedByTab.usedBy')} count={users.length}>
        {users.length ? (
          <UsedByTable users={users} />
        ) : (
          <EmptyState
            icon="link"
            title={t('data.datasetUsedByTab.nothingReferencesDatasetYet')}
            description={t('data.datasetUsedByTab.sheetsBindRecordsCarry')}
          />
        )}
      </Section>
    </div>
  )
}
