import { useQuery } from '@tanstack/react-query'

import type { Tone } from '#/components/v3/ui/status'
import type { DataClient } from '#/lib/data-client'
import {
  listCanonicalDatasetSchemaDefinitions,
  listCanonicalDatasetSchemaVersions,
  listCanonicalDatasetSchemaVersionFields,
} from '#/lib/dataset-schema-definition-rpc'
import type {
  CanonicalDatasetSchemaDefinition,
  CanonicalDatasetSchemaField,
  CanonicalDatasetSchemaVersion,
} from '#/lib/dataset-schema-definition-rpc'
import { notebookDataClient } from '#/lib/notebook-data'

/**
 * UI port (roadmap-4/ui-app3): the Models board reads the canonical dataset
 * schema registry, not a fixture. A model is a `dataset_schema_definition`; its
 * versions are `dataset_schema_versions` and its fields live on the selected
 * version. The app-3 Record/Measurement split and owner/display id are not in
 * this model and render as gaps.
 */
export interface ModelRow extends CanonicalDatasetSchemaDefinition {
  versions: CanonicalDatasetSchemaVersion[]
  latestVersion: CanonicalDatasetSchemaVersion | null
  fieldCount: number
  datasetCount: number
}

export function modelStatus(lifecycle: string): { tone: Tone; label: string } {
  switch (lifecycle) {
    case 'active':
      return { tone: 'ok', label: 'Active' }
    case 'draft':
      return { tone: 'draft', label: 'Draft' }
    case 'retired':
      return { tone: 'stored', label: 'Retired' }
    default:
      return {
        tone: 'none',
        label:
          lifecycle.charAt(0).toUpperCase() +
          lifecycle.slice(1).replace(/_/g, ' '),
      }
  }
}

export const modelsQueryKeys = {
  list: ['ui-port', 'models', 'list'] as const,
  versions: (modelId: string) =>
    ['ui-port', 'models', 'versions', modelId] as const,
  fields: (versionId: string) =>
    ['ui-port', 'models', 'fields', versionId] as const,
  datasets: (modelId: string) =>
    ['ui-port', 'models', 'datasets', modelId] as const,
}

/** Pure aggregation so the list mapping can be tested without a client. */
export function buildModelRows(
  definitions: CanonicalDatasetSchemaDefinition[],
  versions: CanonicalDatasetSchemaVersion[],
  fields: { schema_version_id: string }[],
  datasets: { schema_version_id: string }[],
): ModelRow[] {
  const bySchema = new Map<string, CanonicalDatasetSchemaVersion[]>()
  for (const v of versions) {
    const list = bySchema.get(v.schema_id) ?? []
    list.push(v)
    bySchema.set(v.schema_id, list)
  }
  for (const list of bySchema.values())
    list.sort((a, b) => b.version - a.version)
  const fieldCounts = new Map<string, number>()
  for (const f of fields)
    fieldCounts.set(
      f.schema_version_id,
      (fieldCounts.get(f.schema_version_id) ?? 0) + 1,
    )
  const datasetCounts = new Map<string, number>()
  for (const d of datasets)
    datasetCounts.set(
      d.schema_version_id,
      (datasetCounts.get(d.schema_version_id) ?? 0) + 1,
    )
  return definitions.map((d) => {
    const list = bySchema.get(d.id) ?? []
    const latestId = list.at(0)?.id
    return {
      ...d,
      versions: list,
      latestVersion: list.at(0) ?? null,
      fieldCount: latestId ? (fieldCounts.get(latestId) ?? 0) : 0,
      datasetCount: latestId ? (datasetCounts.get(latestId) ?? 0) : 0,
    }
  })
}

export function useModels(client: DataClient = notebookDataClient) {
  return useQuery({
    queryKey: modelsQueryKeys.list,
    queryFn: async (): Promise<ModelRow[]> => {
      const definitions = await listCanonicalDatasetSchemaDefinitions(client)
      if (definitions.length === 0) return []
      const versions = await client.list<CanonicalDatasetSchemaVersion>(
        'dataset_schema_versions',
        '?select=id,schema_id,version,revision,lifecycle,published_at&order=version.desc',
      )
      const latestVersionIds = definitions
        .map((d) => versions.find((v) => v.schema_id === d.id)?.id)
        .filter((id): id is string => Boolean(id))
      const [fields, datasets] = await Promise.all([
        latestVersionIds.length
          ? client.list<{ field_id: string; schema_version_id: string }>(
              'dataset_schema_version_fields',
              `?schema_version_id=in.(${latestVersionIds.join(',')})&select=field_id,schema_version_id`,
            )
          : Promise.resolve([]),
        latestVersionIds.length
          ? client.list<{ id: string; schema_version_id: string }>(
              'datasets',
              `?schema_version_id=in.(${latestVersionIds.join(',')})&select=id,schema_version_id`,
            )
          : Promise.resolve([]),
      ])
      return buildModelRows(definitions, versions, fields, datasets)
    },
    staleTime: 15_000,
  })
}

export function useModelDefinition(
  modelId: string,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: ['ui-port', 'models', 'definition', modelId],
    queryFn: () =>
      client
        .list<CanonicalDatasetSchemaDefinition>(
          'dataset_schema_definitions',
          `?id=eq.${modelId}&select=id,key,name,description,lifecycle,created_at,updated_at`,
        )
        .then((rows) => rows[0] ?? null),
    staleTime: 15_000,
  })
}

export function useModelVersions(
  modelId: string,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: modelsQueryKeys.versions(modelId),
    queryFn: () => listCanonicalDatasetSchemaVersions(client, modelId),
    staleTime: 15_000,
  })
}

export function useModelFields(
  versionId: string | undefined,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: modelsQueryKeys.fields(versionId ?? ''),
    queryFn: () =>
      listCanonicalDatasetSchemaVersionFields(client, versionId as string),
    enabled: Boolean(versionId),
    staleTime: 15_000,
  })
}

export interface ModelDatasetUse {
  id: string
  schema_version_id: string
  name: string | null
  display_id: string | null
  archived_at: string | null
  updated_at: string
}

export function useModelDatasets(
  versionIds: string[],
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: [...modelsQueryKeys.datasets(versionIds.join(',')), versionIds],
    queryFn: () =>
      client.list<ModelDatasetUse>(
        'datasets',
        `?schema_version_id=in.(${versionIds.join(',')})&select=id,schema_version_id,name,display_id,archived_at,updated_at&order=updated_at.desc`,
      ),
    enabled: versionIds.length > 0,
    staleTime: 15_000,
  })
}

export type { CanonicalDatasetSchemaField, CanonicalDatasetSchemaVersion }
