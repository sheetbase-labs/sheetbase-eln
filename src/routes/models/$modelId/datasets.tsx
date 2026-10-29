import { useMemo } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'

import { Status } from '#/components/v3/ui/status'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Muted } from '#/components/v3/ui/layout'
import { TableBox } from '#/components/v3/ui/table'
import {
  RegistryGrid,
  rightAligned,
} from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import {
  useModelDatasets,
  useModelVersions,
} from '#/components/v3/models/models-data'
import type { ModelDatasetUse } from '#/components/v3/models/models-data'
import { t } from '#/copy'

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

  const columns = useMemo<RegistryColumn<ModelDatasetUse>[]>(
    () => [
      {
        id: 'id',
        header: t('library.models.datasets.id'),
        cell: ({ row }) => (
          <span className="mono">
            {row.original.display_id ?? row.original.id.slice(0, 8)}
          </span>
        ),
      },
      {
        id: 'name',
        header: t('library.models.datasets.name'),
        cell: ({ row }) => (
          <Link
            to="/datasets/$datasetId/snapshots"
            params={{ datasetId: row.original.id }}
          >
            {row.original.name ?? t('library.models.datasets.untitledDataset')}
          </Link>
        ),
      },
      {
        id: 'version',
        header: t('library.models.datasets.version'),
        cell: ({ row }) => {
          const version = versionNumber(row.original.schema_version_id)
          return version ? `v${version}` : '—'
        },
      },
      {
        id: 'status',
        header: t('library.models.datasets.status'),
        cell: ({ row }) => (
          <Status tone={row.original.archived_at ? 'stored' : 'ok'}>
            {row.original.archived_at
              ? t('library.models.datasets.archived')
              : t('library.models.datasets.active')}
          </Status>
        ),
      },
      {
        id: 'updated',
        header: t('library.models.datasets.updated'),
        cell: ({ row }) => (
          <span className="text-fg-muted">
            {row.original.updated_at.slice(0, 10)}
          </span>
        ),
        meta: rightAligned<ModelDatasetUse>().meta,
      },
    ],
    [list],
  )

  if (!rows.length) {
    return (
      <div className="px-4 py-4 md:px-6">
        <EmptyState
          icon="table"
          title={t('library.models.datasets.noDatasetsUseThisModel')}
          description={t('library.models.datasets.datasetsAppearHereWhenAn')}
        />
      </div>
    )
  }

  return (
    <div className="min-w-0 flex-1 overflow-auto px-4 py-4 md:px-6">
      <TableBox>
        <RegistryGrid
          label={t('library.models.datasets.datasetsUsingThisModel')}
          rows={rows}
          columns={columns}
          getRowId={(d) => d.id}
          selectable={false}
        />
      </TableBox>
      <Muted className="mt-3">
        {t('library.models.datasets.datasetsAcrossVersions', {
          datasets: t('library.models.counts.datasets', {
            count: rows.length,
          }),
          versions: t('library.models.counts.versions', {
            count: list.length,
          }),
        })}
      </Muted>
    </div>
  )
}
