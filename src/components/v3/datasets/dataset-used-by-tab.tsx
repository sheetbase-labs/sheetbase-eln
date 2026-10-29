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
import { useQuery } from '@tanstack/react-query'

import { t } from '#/copy'
import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Section } from '#/components/v3/ui/layout'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { classifyDatasetTabAccess } from '#/components/v3/datasets/dataset-detail-tabs'
import { datasetPath, recordPath, sheetPath } from '#/lib/navigation'
import { notebookDataClient } from '#/lib/notebook-data'
import { discoverObjectDependencies } from '#/lib/object-dependencies'
import type { ObjectDependency } from '#/lib/object-dependencies'

const RELATION_LABELS: Record<string, string> = {
  resolved_dataset_binding: t('data.datasetUsedByTab.bindsDataset'),
  snapshot_of_dataset: t('data.datasetUsedByTab.snapshotDataset'),
}

function relationLabel(relation: string): string {
  return RELATION_LABELS[relation] ?? relation.replaceAll('_', ' ')
}

function dependencyHref(kind: string, id: string): string | null {
  if (kind === 'sheet_instance') return sheetPath(id)
  if (kind === 'dataset') return datasetPath(id)
  if (kind === 'record') return recordPath(id)
  return null
}

/** External dependents only — a dataset's own snapshot versions are not users. */
export function datasetUsers(
  dependencies: ObjectDependency[],
): ObjectDependency[] {
  return dependencies.filter((d) => d.kind !== 'dataset_version')
}

export function DatasetUsedByTab({ datasetId }: { datasetId: string }) {
  const query = useQuery({
    queryKey: ['ui-port', 'dataset-usage', datasetId] as const,
    queryFn: () =>
      discoverObjectDependencies(notebookDataClient, 'dataset', datasetId),
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
          <TableBox>
            <Table aria-label={t('data.datasetUsedByTab.usedBy')}>
              <TableHeader>
                <TableRow>
                  <TableHead className="first:pl-3">
                    {t('data.datasetUsedByTab.record')}
                  </TableHead>
                  <TableHead>{t('data.datasetUsedByTab.title')}</TableHead>
                  <TableHead>{t('data.datasetUsedByTab.how')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((dependency) => {
                  const href = dependencyHref(dependency.kind, dependency.id)
                  return (
                    <TableRow key={`${dependency.kind}:${dependency.id}`}>
                      <TableCell className="first:pl-3">
                        {href ? (
                          <a href={href} className="mono text-link">
                            {dependency.id.slice(0, 8)}
                          </a>
                        ) : (
                          <span className="mono">
                            {dependency.id.slice(0, 8)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {dependency.label ||
                          dependency.kind.replaceAll('_', ' ')}
                      </TableCell>
                      <TableCell>
                        {relationLabel(dependency.relation)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableBox>
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
