import { z } from 'zod'
import { createDataClient } from '#/lib/data-client'
import type { CanonicalDatasetSource } from '#/lib/chart-data'
import type { ChartRow } from '#/lib/chart-spec'
import type { DatasetVersionSummary } from '#/lib/dataset-explorer-data'

export function versionSummary(
  overrides: Partial<DatasetVersionSummary> = {},
): DatasetVersionSummary {
  return {
    id: 'ver-1',
    label: 'v1',
    createdAt: '2026-10-01T00:00:00Z',
    createdByUserId: null,
    createdByCredentialId: null,
    createdByName: null,
    sourceDatasetRevision: 1,
    rowCount: 2,
    contentHash: 'fixture-content-hash',
    rowsRemovedAt: null,
    change: null,
    retention: { reason: 'active_dataset', keptUntil: null },
    source: null,
    citedBy: { signedRevisions: [], pipelineRuns: [], analyses: [] },
    ...overrides,
  }
}

/** Same-origin read fixtures, consumed by the production DataClient and resolvers. */
export function sourceHttpFixture({
  sources = [],
  rows = [],
  snapshotRows = rows,
  versions = [versionSummary()],
}: {
  sources?: CanonicalDatasetSource[]
  rows?: ChartRow[]
  snapshotRows?: ChartRow[]
  versions?: DatasetVersionSummary[]
} = {}) {
  const requests: Array<{
    path: string
    datasetId?: string
    versionId?: string
  }> = []

  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      'http://localhost',
    )

    const path = url.pathname

    const args = init?.body
      ? z
          .object({
            p_dataset_id: z.string().optional(),
            p_dataset_version_id: z.string().optional(),
          })
          .parse(JSON.parse(z.string().parse(init.body)))
      : {}

    const datasetId =
      args.p_dataset_id ??
      url.searchParams.get('dataset_id')?.replace('eq.', '') ??
      (path === '/api/db/datasets'
        ? url.searchParams.get('id')?.replace('eq.', '')
        : undefined)

    requests.push({
      path,
      datasetId,
      versionId:
        args.p_dataset_version_id ??
        (path === '/api/db/dataset_versions'
          ? url.searchParams.get('id')?.replace('eq.', '')
          : undefined),
    })

    const source = datasetId
      ? sources.find((candidate) => candidate.datasetId === datasetId)
      : sources.at(0)

    const selectedRows = args.p_dataset_version_id ? snapshotRows : rows

    const rowPage = {
      rows: selectedRows.map(({ __sheetbaseRowId, ...values }) => ({
        rowId: __sheetbaseRowId,
        revision: 1,
        values,
      })),
      totalCount: selectedRows.length,
      datasetRevision: source?.revision ?? 1,
    }

    switch (path) {
      case '/api/db/rpc/dataset_version_list':
        return Response.json(versions)
      case '/api/db/rpc/query_dataset_rows':
      case '/api/db/rpc/query_dataset_version_rows':
        return Response.json(rowPage)
      case '/api/db/datasets':
        return Response.json(
          source
            ? [
                {
                  id: source.datasetId,
                  name: source.name,
                  workspace_id: source.workspaceId,
                  schema_version_id: source.schemaVersionId,
                  revision: source.revision,
                  lifecycle: 'active',
                },
              ]
            : [],
        )
      case '/api/db/dataset_versions':
        return Response.json(
          source
            ? [
                {
                  id: 'ver-1',
                  dataset_id: source.datasetId,
                  schema_version_id: source.schemaVersionId,
                  source_dataset_revision: source.revision,
                },
              ]
            : [],
        )
      case '/api/db/dataset_schema_version_fields':
        return Response.json(
          source?.columns.map((column) => ({
            field_id: column.id,
            label: column.label,
            logical_type: column.logicalType,
            quantity: null,
          })) ?? [],
        )
      case '/api/db/dataset_schema_versions':
        return Response.json(
          source
            ? [
                {
                  id: source.schemaVersionId,
                  version: source.schemaVersionNumber,
                },
              ]
            : [],
        )
      case '/api/db/dataset_value_flags':
        return Response.json([])
      default:
        throw new Error(`Unexpected source request: ${path}`)
    }
  }

  return { client: createDataClient(fetcher), requests }
}
