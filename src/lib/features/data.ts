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

// Reading a model together with its features -------------------------------------

/** Add to a `record_models` select to read the features a model has switched on. */
export const MODEL_FEATURES_EMBED = 'model_capabilities(capability,settings)'

export interface EmbeddedFeature {
  capability: string
  settings: Record<string, unknown>
}

/** What a registry model keeps in its feature settings. */
export interface RegistrySetup {
  keyFields: string[]
  sequenceField: string | null
  structureField: string | null
  lotKind: string | null
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null

export function registrySetupOf(
  settings: Record<string, unknown> | undefined,
): RegistrySetup {
  const keys = settings?.keyFields
  return {
    keyFields: Array.isArray(keys)
      ? keys.filter((k): k is string => typeof k === 'string')
      : [],
    sequenceField: text(settings?.sequenceField),
    structureField: text(settings?.structureField),
    lotKind: text(settings?.lotKind),
  }
}

/** The features a model row came back with, as a set of keys. */
export const featureKeysOf = (
  row: { model_capabilities?: readonly EmbeddedFeature[] | null } | null,
): ReadonlySet<string> =>
  new Set((row?.model_capabilities ?? []).map((f) => f.capability))

export interface FeatureModel {
  key: string
  name: string
  identifier_prefix: string
  settings: Record<string, unknown>
}

/** The models that have a feature switched on, by name, with the feature's settings. */
export async function fetchModelsWithFeature(
  client: DataClient,
  feature: string,
): Promise<FeatureModel[]> {
  const rows = await client.list<{
    key: string
    name: string
    identifier_prefix: string
    model_capabilities: { settings: Record<string, unknown> }[]
  }>(
    'record_models',
    `?select=key,name,identifier_prefix,model_capabilities!inner(settings)&model_capabilities.capability=eq.${encodeURIComponent(feature)}&order=name.asc&limit=500`,
  )
  return rows.map((r) => ({
    key: r.key,
    name: r.name,
    identifier_prefix: r.identifier_prefix,
    settings: r.model_capabilities[0]?.settings ?? {},
  }))
}
