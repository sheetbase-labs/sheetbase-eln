import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { DescriptionList, Muted, Section } from '#/components/v3/ui/layout'
import { Status } from '#/components/v3/ui/status'
import {
  datasetIssueSummary,
  datasetValidation,
  useDatasetSummaries,
} from '#/components/v3/datasets/datasets-data'
import type { DatasetListRow } from '#/components/v3/datasets/datasets-data'
import { notebookDataClient } from '#/lib/notebook-data'
import { useUserNames } from '#/lib/user-names'
import { useDatasetVersions } from '../$datasetId'

/**
 * R5-SURF-01 — the dataset detail index, which is the Overview screen the
 * Overview tab links to.
 *
 * Imports, Used by and History are selected by the `view` search parameter on
 * the parent dataset detail route (the layout renders the panel and skips this
 * Outlet), so each is a linkable, reloadable URL (`/datasets/<id>?view=imports`).
 */
export const Route = createFileRoute('/datasets/$datasetId/')({
  component: DatasetOverview,
})

function DatasetOverview() {
  const { datasetId } = Route.useParams()
  const summaries = useDatasetSummaries()
  const dataset = summaries.data?.find((d) => d.uuid === datasetId)
  if (!dataset) {
    return (
      <div className="px-4 py-4 md:px-6">
        <Muted>
          {summaries.isLoading ? 'Loading the dataset…' : 'Dataset not found.'}
        </Muted>
      </div>
    )
  }
  return <DatasetOverviewPanel dataset={dataset} />
}

/**
 * The dataset Overview: what the record is, where it came from and what state
 * it is in. The facts that only exist here — provenance, snapshot state and
 * unresolved flags — are the point; identity already sits in the frame header.
 */
function DatasetOverviewPanel({ dataset }: { dataset: DatasetListRow }) {
  const versions = useDatasetVersions(dataset.uuid)
  const { userLabel } = useUserNames(
    dataset.createdByUserId ? [dataset.createdByUserId] : [],
  )
  const project = useQuery({
    queryKey: ['ui-port', 'dataset-project', dataset.projectId],
    enabled: Boolean(dataset.projectId),
    queryFn: () =>
      notebookDataClient
        .list<{ id: string; title: string }>(
          'projects',
          `?id=eq.${dataset.projectId}&select=id,title&limit=1`,
        )
        .then((rows) => rows.at(0) ?? null),
  })

  const snapshots = versions.data ?? []
  const latest = snapshots.at(0)
  const validation = datasetValidation(dataset)

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6 px-4 py-[22px] md:px-8">
      <Section title="Summary">
        <DescriptionList
          items={[
            ['Model', dataset.model],
            [
              'Project',
              dataset.projectId
                ? (project.data?.title ??
                  (project.isLoading ? 'Loading…' : 'Restricted project'))
                : 'No project',
            ],
            [
              'Owner',
              dataset.createdByUserId ? userLabel(dataset.createdByUserId) : '—',
            ],
            [
              'Experiment',
              dataset.experimentId ? (
                <Link
                  to="/experiments/$expId"
                  params={{ expId: dataset.experimentId }}
                  className="mono"
                >
                  {dataset.experimentId}
                </Link>
              ) : (
                'Not linked to an experiment'
              ),
            ],
            ['Rows', <span className="num">{dataset.rows}</span>],
            [
              'Snapshots',
              snapshots.length
                ? `${snapshots.length} · latest ${latest!.label}`
                : 'None yet',
            ],
            [
              'State',
              <Status tone={validation.tone}>{validation.label}</Status>,
            ],
          ]}
        />
      </Section>

      <Section title="Issues" count={dataset.issues || undefined}>
        {dataset.issues ? (
          <Muted>{datasetIssueSummary(dataset)}</Muted>
        ) : (
          <Muted>
            No unresolved value flags. Flags raised by an import or marked in
            the Rows grid appear here.
          </Muted>
        )}
      </Section>

      {dataset.archived ? (
        <Section title="Archived">
          <Muted>
            This dataset is archived. It stays readable and citable, but it
            cannot be snapshotted and cannot be imported into.
          </Muted>
        </Section>
      ) : null}
    </div>
  )
}
