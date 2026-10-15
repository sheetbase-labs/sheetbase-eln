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
  resolved_dataset_binding: 'Binds this dataset',
  snapshot_of_dataset: 'Snapshot of this dataset',
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
        <p className="text-body text-fg-muted">Loading references…</p>
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
              ? 'References are not available to you'
              : 'References could not be loaded'
          }
          body={
            access === 'denied'
              ? 'A dataset’s dependents belong to its workspace. Ask a workspace member for access.'
              : 'The dependency read model could not be read. Try again, or check the workspace connection.'
          }
        />
      </div>
    )
  }

  const users = datasetUsers(query.data?.dependencies ?? [])

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-auto px-4 py-5 md:px-6">
      <Section title="Used by" count={users.length}>
        {users.length ? (
          <TableBox>
            <Table aria-label="Used by">
              <TableHeader>
                <TableRow>
                  <TableHead className="first:pl-3">Record</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>How</TableHead>
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
            title="Nothing references this dataset yet"
            body="Sheets that bind it, records that carry its values and other dependents appear here as they are created."
          />
        )}
      </Section>
    </div>
  )
}
