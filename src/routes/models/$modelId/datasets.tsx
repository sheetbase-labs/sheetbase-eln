import { createFileRoute, Link } from '@tanstack/react-router'

import { Status } from '#/components/v3/ui/status'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Muted } from '#/components/v3/ui/layout'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import {
  useModelDatasets,
  useModelVersions,
} from '#/components/v3/models/models-data'

/** UI port (roadmap-4/ui-app3): the Datasets tab lists the datasets built on
 * any version of this model. app-3 calls these "records"; in the ELN model a
 * dataset is the instance of a schema. */
export const Route = createFileRoute('/models/$modelId/datasets')({
  component: ModelDatasets,
})

function ModelDatasets() {
  const { modelId } = Route.useParams()
  const versions = useModelVersions(modelId)
  const list = versions.data ?? []
  const datasets = useModelDatasets(list.map((v) => v.id))
  const rows = datasets.data ?? []
  const versionNumber = (versionId: string) =>
    list.find((v) => v.id === versionId)?.version

  if (!rows.length) {
    return (
      <div className="px-4 py-4 md:px-6">
        <EmptyState
          icon="table"
          title="No datasets use this model"
          body="Datasets appear here when an import or a notebook creates them against this schema."
        />
      </div>
    )
  }

  return (
    <div className="min-w-0 flex-1 overflow-auto px-4 py-4 md:px-6">
      <TableBox>
        <Table aria-label="Datasets using this model">
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Status</TableHead>
              <TableHead align="right">Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="mono">
                  {d.display_id ?? d.id.slice(0, 8)}
                </TableCell>
                <TableCell>
                  <Link
                    to="/datasets/$datasetId/snapshots"
                    params={{ datasetId: d.id }}
                  >
                    {d.name ?? 'Untitled dataset'}
                  </Link>
                </TableCell>
                <TableCell>
                  {versionNumber(d.schema_version_id)
                    ? `v${versionNumber(d.schema_version_id)}`
                    : '—'}
                </TableCell>
                <TableCell>
                  <Status tone={d.archived_at ? 'stored' : 'ok'}>
                    {d.archived_at ? 'Archived' : 'Active'}
                  </Status>
                </TableCell>
                <TableCell align="right" className="text-fg-muted">
                  {d.updated_at.slice(0, 10)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableBox>
      <Muted className="mt-3">
        {rows.length} {rows.length === 1 ? 'dataset' : 'datasets'} across{' '}
        {list.length} {list.length === 1 ? 'version' : 'versions'} of this
        model.
      </Muted>
    </div>
  )
}
