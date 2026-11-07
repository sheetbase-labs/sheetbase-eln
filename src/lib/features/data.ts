/**
 * Model features, read and changed through the database (migration
 * model_features). Reads go straight to the table under row-level security;
 * a change is an RPC so the rules stay in the database.
 */
import { useQuery } from '@tanstack/react-query'

import type { DataClient } from '#/lib/data-client'
import { notebookDataClient } from '#/lib/notebook-data'

export const featureKeys = {
  all: ['model-features'] as const,
  list: ['model-features', 'list'] as const,
}

export interface ModelFeatureRow {
  model_key: string
  capability: string
  settings: Record<string, unknown>
}

/** Every feature switched on, for every model of the lab. */
export function fetchModelFeatures(
  client: DataClient,
): Promise<ModelFeatureRow[]> {
  return client.list<ModelFeatureRow>(
    'model_capabilities',
    '?select=model_key,capability,settings&order=model_key.asc,capability.asc&limit=2000',
  )
}

export const setModelFeature = (
  client: DataClient,
  modelKey: string,
  feature: string,
  enabled: boolean,
  settings?: Record<string, unknown>,
) =>
  client.rpc<boolean>('set_model_capability', {
    p_model_key: modelKey,
    p_capability: feature,
    p_enabled: enabled,
    ...(settings ? { p_settings: settings } : {}),
  })

/** The model keys that have a feature, from rows already read. */
export const modelsWithFeature = (
  rows: readonly ModelFeatureRow[],
  feature: string,
): string[] =>
  rows.filter((r) => r.capability === feature).map((r) => r.model_key)

/** The features switched on, for every model of the lab. */
export function useModelFeatures(client: DataClient = notebookDataClient) {
  return useQuery({
    queryKey: featureKeys.list,
    queryFn: () => fetchModelFeatures(client),
    staleTime: 30_000,
  })
}
